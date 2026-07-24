#!/usr/bin/env node
/* Measure horizontal overflow of rendered math in the root viewer pages
   (sga1.html … sga7.html) in headless Chrome.

   Modes:
     baseline  Enumerate every display equation wider than its column, every
               wide inline equation and every wide table.tabular, ranked by
               overflow. Also records per-page mjx-merror counts so `verify`
               can prove the CSS fix caused no typeset regressions.
     verify    Assert, for EVERY display equation: its start is visible
               (svg left edge not left of its scroll container) and the whole
               equation is reachable by horizontal scrolling; per page, no
               horizontal overflow escapes to <main>; per page, mjx-merror
               count matches the baseline. Exit 1 on any failure.

   Usage (normally via check_overflow.sh):
     node check_overflow.js --base http://localhost:8765 --mode baseline
       [--vols sga5,sga7] [--pages I-1,I-2] [--out issues/overflow_baseline.json]
       [--baseline issues/overflow_baseline.json] [--viewport 1440x900]
*/
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const ALL_VOLS = ['sga1', 'sga2', 'sga3', 'sga4', 'sga4.5', 'sga5', 'sga6', 'sga7'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const opts = { mode: 'baseline', vols: ALL_VOLS, pages: null, out: null, baseline: null, viewport: { w: 1440, h: 900 } };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const v = a[i + 1];
    switch (a[i]) {
      case '--base': opts.base = v; i++; break;
      case '--mode': opts.mode = v; i++; break;
      case '--vols': opts.vols = v.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--pages': opts.pages = new Set(v.split(',').map((s) => s.trim()).filter(Boolean)); i++; break;
      case '--out': opts.out = v; i++; break;
      case '--baseline': opts.baseline = v; i++; break;
      case '--viewport': { const m = /^(\d+)x(\d+)$/.exec(v); if (m) opts.viewport = { w: +m[1], h: +m[2] }; i++; break; }
      default: console.error('unknown arg: ' + a[i]); process.exit(2);
    }
  }
  if (!opts.base) { console.error('--base http://localhost:PORT is required'); process.exit(2); }
  if (opts.mode !== 'baseline' && opts.mode !== 'verify') { console.error('--mode must be baseline|verify'); process.exit(2); }
  if (!opts.out) opts.out = path.join(ROOT, 'issues', opts.mode === 'baseline' ? 'overflow_baseline.json' : 'overflow_verify.json');
  if (!opts.baseline) opts.baseline = path.join(ROOT, 'issues', 'overflow_baseline.json');
}

function loadPages(vol) {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', vol, 'fr', 'manifest.json'), 'utf8'));
  const pages = [];
  for (const ch of mf.chapters || []) {
    for (const pid of ch.page_ids || []) pages.push({ pid, chapter: ch.id });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Browser-side helpers (serialized into page.evaluate / waitForFunction)
// ---------------------------------------------------------------------------

// Wait until the viewer finished building the requested page AND MathJax's
// typeset chain went quiet. viewer.typeset() REASSIGNS MathJax.startup.promise
// (viewer.js:65), so quiescence = the promise identity stops changing after an
// await. This also covers XyJax (runs inside typesetPromise) and the viewer's
// 150 ms MathJax-not-loaded-yet retry loop.
async function waitForPage(page, pid) {
  await page.waitForFunction(
    (p) => {
      const panes = document.getElementById('panes');
      return panes && panes.dataset.pageId === p && panes.querySelector('.align-row');
    },
    { timeout: 120000, polling: 100 }, pid
  );
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 600; i++) {
      if (window.MathJax && MathJax.startup && MathJax.startup.promise) break;
      await wait(100);
    }
    if (!(window.MathJax && MathJax.startup && MathJax.startup.promise)) throw new Error('MathJax did not load');
    let p;
    do {
      p = MathJax.startup.promise;
      await p;
      await wait(60);
    } while (p !== MathJax.startup.promise);
  });
}

// Scan the rendered page. Returns per-container measurements plus page-level
// counters. Runs with scrollLeft untouched (0) on every scroll container.
function measure() {
  const S = JSON.stringify;
  const panes = document.getElementById('panes');
  const content = document.getElementById('content'); // <main id="content">

  // container -> source TeX (MathJax 3 MathItem list; stale items are skipped
  // via isConnected because the viewer never calls typesetClear)
  const srcMap = new Map();
  try {
    for (const item of MathJax.startup.document.math) {
      const r = item.typesetRoot;
      if (r && r.isConnected) srcMap.set(r, item.math);
    }
  } catch (e) { /* leave empty */ }

  const heading = (cell) => {
    const sideSel = cell.classList.contains('cell-left') ? '.cell-left' : '.cell-right';
    let row = cell.closest('.align-row');
    while (row) {
      const c = row.querySelector(sideSel);
      if (c) {
        const h = c.querySelector('h1,h2,h3,h4');
        if (h) return h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      row = row.previousElementSibling;
    }
    return null;
  };

  const round = (x) => Math.round(x * 10) / 10;
  const display = [];
  const inline = [];
  for (const c of panes.querySelectorAll('.cell mjx-container[jax="SVG"]')) {
    const svg = c.querySelector(':scope > svg');
    if (!svg) continue; // merror-only container
    const cell = c.closest('.cell');
    const cR = c.getBoundingClientRect();
    const sR = svg.getBoundingClientRect();
    const cellR = cell.getBoundingClientRect();
    const isDisplay = c.getAttribute('display') === 'true';
    const tex = srcMap.get(c) || '';
    if (isDisplay) {
      const hiddenInk = Math.max(0, sR.width - cR.width);
      const tagM = /\\tag\*?\{([^{}]*)\}\s*('?)/.exec(tex);
      display.push({
        kind: c.getAttribute('width') === 'full' ? 'display-full' : 'display',
        side: cell.classList.contains('cell-left') ? 'fr' : 'en',
        blockId: cell.dataset.blockId || null,
        blockIndex: +cell.dataset.blockIndex,
        heading: heading(cell),
        justify: c.hasAttribute('justify'),
        tag: tagM ? tagM[1] + tagM[2] : null,
        tex: tex.length > 300 ? tex.slice(0, 300) + '…' : tex,
        svgW: round(sR.width),
        cellW: round(cellR.width),
        contClientW: c.clientWidth,
        contScrollW: c.scrollWidth,
        cellOverflowPx: round(sR.width - cellR.width),
        startClipped: sR.left < cR.left - 1,
        reachable: (c.scrollWidth - c.clientWidth) >= Math.floor(hiddenInk) - 1,
        centeredOffset: hiddenInk === 0 ? round(Math.abs((sR.left + sR.width / 2) - (cR.left + cR.width / 2))) : 0,
      });
    } else if (sR.width > cellR.width + 1) {
      inline.push({
        kind: 'inline',
        side: cell.classList.contains('cell-left') ? 'fr' : 'en',
        blockId: cell.dataset.blockId || null,
        blockIndex: +cell.dataset.blockIndex,
        heading: heading(cell),
        tex: tex.length > 300 ? tex.slice(0, 300) + '…' : tex,
        svgW: round(sR.width),
        cellW: round(cellR.width),
        cellOverflowPx: round(sR.width - cellR.width),
      });
    }
  }

  const tables = [];
  for (const t of panes.querySelectorAll('.cell table.tabular')) {
    const cell = t.closest('.cell');
    const tR = t.getBoundingClientRect();
    const cellR = cell.getBoundingClientRect();
    if (tR.width > cellR.width + 1) {
      tables.push({
        kind: 'table',
        side: cell.classList.contains('cell-left') ? 'fr' : 'en',
        heading: heading(cell),
        tableW: round(tR.width),
        cellW: round(cellR.width),
        cellOverflowPx: round(tR.width - cellR.width),
      });
    }
  }

  // Typeset failures. In SVG output MathJax renders errors INSIDE the svg
  // (g[data-mml-node="merror"]) — the HTML <mjx-merror> element only exists in
  // CHTML output, so a selector for it alone silently misses every SVG error.
  const svgMerrors = [];
  {
    const seen = new Set();
    for (const g of panes.querySelectorAll('mjx-container svg [data-mml-node="merror"]')) {
      const c = g.closest('mjx-container');
      if (seen.has(c)) continue;
      seen.add(c);
      const cell = c.closest('.cell');
      svgMerrors.push({
        side: cell && cell.classList.contains('cell-left') ? 'fr' : 'en',
        error: g.getAttribute('data-mjx-error') || '',
        tex: (srcMap.get(c) || '').slice(0, 200),
      });
    }
  }

  return S({
    display, inline, tables, svgMerrors,
    merrors: panes.querySelectorAll('mjx-merror').length,
    mainOverflow: content ? content.scrollWidth - content.clientWidth : 0,
    displayCount: display.length,
  });
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
(async () => {
  let baselineData = null;
  if (opts.mode === 'verify') {
    try { baselineData = JSON.parse(fs.readFileSync(opts.baseline, 'utf8')); }
    catch (e) { console.warn('warn: no baseline at ' + opts.baseline + ' — merror comparison skipped'); }
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 180000,
  });

  const findings = [];        // baseline: overflow records | verify: failing records
  const merrorsByPage = {};   // vol -> pid -> count
  const svgMerrorFindings = []; // typeset failures rendered inside the svg (pre-existing content bugs)
  const pageProblems = [];    // navigation/typeset errors, per page
  const totals = {
    pages: 0, displayContainers: 0, overflowingDisplay: 0, startClipped: 0,
    notReachable: 0, inlineWide: 0, tables: 0, pagesWithMerrors: 0,
    mainOverflowPages: 0, centeredDrift: 0, svgMerrors: 0,
  };
  const verifyFailures = [];

  for (const vol of opts.vols) {
    let pages;
    try { pages = loadPages(vol); }
    catch (e) { console.error(vol + ': cannot read manifest — ' + e.message); continue; }
    if (opts.pages) pages = pages.filter((p) => opts.pages.has(p.pid));
    if (!pages.length) continue;

    const page = await browser.newPage();
    await page.setViewport({ width: opts.viewport.w, height: opts.viewport.h });
    // Deterministic layout: both columns, en right pane, sidebar visible.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('displayMode', 'both');
        localStorage.setItem('rightLang', 'en');
        localStorage.setItem('sidebarCollapsed', '0');
      } catch (e) {}
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    merrorsByPage[vol] = {};
    let volOverflow = 0;

    for (let i = 0; i < pages.length; i++) {
      const { pid, chapter } = pages[i];
      try {
        if (i === 0) {
          await page.goto(opts.base + '/' + vol + '.html#' + encodeURIComponent(pid), { waitUntil: 'load', timeout: 120000 });
        } else {
          // Same-document fragment navigation fires popstate -> viewer navigate()
          await page.evaluate((h) => { location.hash = h; }, '#' + encodeURIComponent(pid));
        }
        await waitForPage(page, pid);
        const scan = JSON.parse(await page.evaluate(measure));

        totals.pages++;
        totals.displayContainers += scan.displayCount;
        merrorsByPage[vol][pid] = scan.merrors;
        if (scan.merrors > 0) totals.pagesWithMerrors++;
        if (scan.mainOverflow > 1) totals.mainOverflowPages++;

        for (const rec of scan.display) {
          const over = rec.cellOverflowPx > 1;
          if (over) { totals.overflowingDisplay++; volOverflow++; }
          if (rec.startClipped) totals.startClipped++;
          if (!rec.reachable) totals.notReachable++;
          if (rec.centeredOffset > 2 && !rec.justify) totals.centeredDrift++;
          const full = Object.assign({ vol, page: pid, chapter }, rec);
          if (opts.mode === 'baseline') {
            if (over || rec.startClipped) findings.push(full);
          } else if (rec.startClipped || !rec.reachable) {
            verifyFailures.push(full);
            findings.push(full);
          }
        }
        for (const rec of scan.inline) {
          totals.inlineWide++;
          findings.push(Object.assign({ vol, page: pid, chapter }, rec));
        }
        for (const rec of scan.tables) {
          totals.tables++;
          findings.push(Object.assign({ vol, page: pid, chapter }, rec));
        }
        for (const rec of scan.svgMerrors) {
          totals.svgMerrors++;
          svgMerrorFindings.push(Object.assign({ vol, page: pid, chapter }, rec));
        }
        if (opts.mode === 'verify') {
          if (scan.mainOverflow > 1) {
            verifyFailures.push({ vol, page: pid, chapter, kind: 'main-overflow', px: scan.mainOverflow });
          }
          const baseM = baselineData && baselineData.merrorsByPage && baselineData.merrorsByPage[vol];
          if (baseM && baseM[pid] !== undefined && scan.merrors !== baseM[pid]) {
            verifyFailures.push({ vol, page: pid, chapter, kind: 'merror-regression', before: baseM[pid], after: scan.merrors });
          }
        }
      } catch (e) {
        pageProblems.push({ vol, page: pid, chapter, error: String(e).slice(0, 300) });
        console.error('  ! ' + vol + ' ' + pid + ': ' + String(e).split('\n')[0]);
      }
      if ((i + 1) % 25 === 0) console.log('  … ' + vol + ' ' + (i + 1) + '/' + pages.length);
    }

    if (pageErrors.length) pageProblems.push({ vol, page: '(page-level)', error: pageErrors.slice(0, 5).join(' | ') });
    console.log(vol + ': ' + pages.length + ' pages, ' + volOverflow + ' overflowing display equations');
    await page.close();
  }

  await browser.close();

  findings.sort((a, b) => (b.cellOverflowPx || 0) - (a.cellOverflowPx || 0));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: opts.mode,
    viewport: opts.viewport,
    base: opts.base,
    vols: opts.vols,
    totals,
    pageProblems,
    merrorsByPage,
    svgMerrorFindings,
    verifyFailures: opts.mode === 'verify' ? verifyFailures : undefined,
    findings,
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(report, null, 1));

  console.log('\n=== ' + opts.mode.toUpperCase() + ' SUMMARY ===');
  console.log('pages scanned:            ' + totals.pages);
  console.log('display equations:        ' + totals.displayContainers);
  console.log('overflowing (> column):   ' + totals.overflowingDisplay);
  console.log('start clipped:            ' + totals.startClipped);
  console.log('not reachable by scroll:  ' + totals.notReachable);
  console.log('wide inline math:         ' + totals.inlineWide);
  console.log('wide tables:              ' + totals.tables);
  console.log('pages with mjx-merror:    ' + totals.pagesWithMerrors);
  console.log('svg typeset errors:       ' + totals.svgMerrors + ' (pre-existing content bugs, not asserted)');
  console.log('pages with main overflow: ' + totals.mainOverflowPages);
  console.log('page problems (nav/typeset): ' + pageProblems.length);
  console.log('report: ' + path.relative(ROOT, opts.out));

  if (opts.mode === 'verify') {
    if (verifyFailures.length || pageProblems.length) {
      console.log('\nVERIFY FAILED: ' + verifyFailures.length + ' assertion failures, ' + pageProblems.length + ' page problems');
      process.exit(1);
    }
    console.log('\nVERIFY PASSED');
  } else {
    const top = findings.filter((f) => f.kind !== 'inline' && f.kind !== 'table').slice(0, 10);
    if (top.length) {
      console.log('\ntop offenders:');
      for (const f of top) {
        console.log('  ' + f.vol + ' ' + f.page + ' [' + f.side + '] ' +
          (f.tag ? '(' + f.tag + ') ' : '') + '+' + f.cellOverflowPx + 'px  ' +
          (f.tex || '').replace(/\s+/g, ' ').slice(0, 70));
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(2); });
