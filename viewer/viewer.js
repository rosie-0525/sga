/* SGA 2 viewer: loads the JSON manifest + per-chapter content and renders it
   with client-side MathJax 3 + XyJax-v3. Resolves cross-page anchors via the
   manifest's anchor_index. */
(function () {
  'use strict';

  // The left column always shows the base language (CFG.baseLang, the reference);
  // the right column shows one target language (one of CFG.rightLangs) chosen via
  // state.rightLang. The two are laid out block-by-block in shared grid rows so
  // every theorem/proof/paragraph aligns vertically (see renderAligned).
  // state.displayMode picks which columns are visible (both cells are always
  // built; body.mode-left/.mode-right hide the other one via CSS).
  // Navigation, the TOC and anchorIndex are driven by the base-language manifest
  // only; all languages share identical chapter/page/element ids.
  var state = {
    config: null,                              // data/config.json (loaded by the bootstrap)
    manifest: null,                            // base-language manifest only
    rightLang: null,                           // current target language (from config, persisted)
    displayMode: 'both',                       // 'left' | 'right' | 'both' (persisted)
    chapterCache: {},                          // lang -> chapterId -> chapter JSON (created lazily)
    pageToChapter: {},                         // pageId -> chapterId
    anchorIndex: {},                           // elementId -> pageId
    currentPage: null
  };
  // Parsed data/config.json. Everything project-specific (title, language set,
  // per-language UI strings, data path) lives here so this engine stays generic.
  var CFG = null;

  var elPanes = document.getElementById('panes');
  var elSidebar = document.getElementById('sidebar');
  var elContent = document.getElementById('content');

  // Per-language UI strings (empty-page notice, footnote backref title, load
  // errors, switcher label) come from CFG.languages[code]; the base language's
  // entry also carries pageTitle/bookTitle/toc for the document chrome. Unknown
  // languages fall back to the base language so a pane never renders empty labels.
  function strings(code) {
    var langs = (CFG && CFG.languages) || {};
    return langs[code] || langs[CFG && CFG.baseLang] || {};
  }

  // Base path for the content tree; always normalized to a trailing slash so
  // dataPath() + lang + '/manifest.json' resolves correctly. Defaults to 'data/'.
  function dataPath() {
    var p = (CFG && CFG.dataPath) || 'data/';
    return p.charAt(p.length - 1) === '/' ? p : p + '/';
  }

  function applyChrome() {
    var s = strings(CFG.baseLang);
    document.documentElement.lang = CFG.baseLang;
    if (s.pageTitle) document.title = s.pageTitle;
    var bt = document.getElementById('book-title');
    if (bt && s.bookTitle) bt.textContent = s.bookTitle;
    if (elSidebar && s.toc) elSidebar.setAttribute('aria-label', s.toc);
  }

  // Typeset an element, chaining through MathJax's startup promise so we never
  // race the async CDN load (and so concurrent typesets serialize cleanly).
  // The MathJax library is loaded with `async`, so on the first render its
  // startup.promise may not exist yet; in that case defer and retry until it is
  // ready (otherwise the initial page would show raw \(..\) until you navigate).
  function typeset(el) {
    if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
      MathJax.startup.promise = MathJax.startup.promise
        .then(function () { return MathJax.typesetPromise([el]); })
        .then(function () { markWideMath(el); })
        .catch(function (e) { console.warn('MathJax typeset', e); });
    } else if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([el])
        .then(function () { markWideMath(el); })
        .catch(function (e) { console.warn('MathJax', e); });
    } else {
      setTimeout(function () { typeset(el); }, 150);  // MathJax not loaded yet
    }
  }

  // Wide INLINE math can't be handled in pure CSS: a blanket overflow rule
  // would turn every inline formula into an inline-block, whose baseline is
  // its bottom edge — wrecking baseline alignment everywhere. Instead, tag
  // only the rare containers that actually overhang their column; the
  // .mjx-wide-inline CSS rule then lets just those scroll. (Display math
  // scrolls via pure CSS — see the equations section of viewer.css.)
  function markWideMath(root) {
    root.querySelectorAll('mjx-container[jax="SVG"]:not([display])').forEach(function (c) {
      c.classList.remove('mjx-wide-inline');
      var limit = c.closest('.cell') || c.parentElement;
      if (!limit) return;
      if (c.getBoundingClientRect().width > limit.getBoundingClientRect().width + 1) {
        c.classList.add('mjx-wide-inline');
      }
    });
  }

  // Column widths change on resize; re-evaluate which inline formulas overhang.
  var wideMathTimer;
  window.addEventListener('resize', function () {
    clearTimeout(wideMathTimer);
    wideMathTimer = setTimeout(function () { markWideMath(elPanes); }, 150);
  });

  function fetchJSON(url) {
    // Tie data fetches to the viewer's cache-busting stamp (see viewer-bootstrap.js)
    // so a viewer update never runs against stale cached JSON.
    if (CFG && CFG.assetVersion) url += '?v=' + CFG.assetVersion;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  // The manifest is loaded once, in the base language — it drives the sidebar,
  // navigation and anchorIndex for every language (ids are shared across langs).
  function loadManifest() {
    return fetchJSON(dataPath() + CFG.baseLang + '/manifest.json').then(function (m) {
      state.manifest = m;
      applyChrome();
      state.pageToChapter = {};
      state.anchorIndex = m.anchor_index || {};
      m.chapters.forEach(function (ch) {
        (ch.page_ids || []).forEach(function (pid) { state.pageToChapter[pid] = ch.id; });
      });
      buildSidebar();
    });
  }

  function buildSidebar() {
    var m = state.manifest;
    var tocByPage = {};
    m.toc.forEach(function (t) { tocByPage[t.page_id] = t; });
    var html = '';
    m.chapters.forEach(function (ch) {
      var pids = ch.page_ids || [];
      var landing = pids[0];
      // Chapters may carry an alias (e.g. "EXPOSÉ") naming the printed chapter
      // word; render it inside the number span so "EXPOSÉ I" reads as one marker.
      var label = (ch.alias ? ch.alias + ' ' : '') + (ch.number || '');
      var num = label ? '<span class="cnum">' + label + '</span>' : '';
      html += '<div class="chap" data-chapter="' + ch.id + '">';
      html += '<a href="#' + encodeURIComponent(landing) + '" data-page="' + landing + '">' +
              num + ch.title + '</a>';
      if (pids.length > 1) {
        html += '<div class="pages">';
        pids.slice(1).forEach(function (pid) {
          var t = tocByPage[pid] || { title: pid };
          html += '<a href="#' + encodeURIComponent(pid) + '" data-page="' + pid + '">' +
                  t.title + '</a>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    elSidebar.innerHTML = html;
    typeset(elSidebar);
  }

  function chapterFor(pageId) {
    return state.pageToChapter[pageId] ||
           (state.manifest.chapters[0] && state.manifest.chapters[0].id);
  }

  function loadChapter(lang, chapterId) {
    var cache = state.chapterCache[lang] || (state.chapterCache[lang] = {});
    if (cache[chapterId]) return Promise.resolve(cache[chapterId]);
    return fetchJSON(dataPath() + lang + '/chapters/' + chapterId + '.json').then(function (c) {
      cache[chapterId] = c;
      return c;
    });
  }

  function pickPage(chapter, pageId) {
    var page = (chapter.pages || []).filter(function (p) { return p.id === pageId; })[0];
    return page || chapter.pages[0];
  }

  function showPage(pageId, anchor) {
    renderPageAligned(pageId, anchor, false);
  }

  // Render French (left) and the right-language translation side by side, with
  // every top-level block (theorem / proof / paragraph / equation) paired into a
  // shared grid ROW so corresponding statements line up vertically. The two
  // chapters are loaded together because alignment needs both before laying out;
  // French stays canonical (it drives currentPage, sidebar highlight, scrolling).
  // keepScroll preserves the scroll position (used when only the right language
  // changes); otherwise we jump to the anchor or the top.
  function renderPageAligned(pageId, anchor, keepScroll) {
    var chId = chapterFor(pageId);
    if (!chId) return;
    var rlang = state.rightLang;
    var prevScroll = elContent.scrollTop;
    Promise.all([
      loadChapter(CFG.baseLang, chId),
      loadChapter(rlang, chId).catch(function (e) { return { __err: e }; })
    ]).then(function (res) {
      var frPage = pickPage(res[0], pageId);
      pageId = frPage.id;
      state.currentPage = pageId;
      // Expose the page/chapter ids on the panes container so comments.js can
      // record where each comment lives (data/<lang>/chapters/<chapterId>.json).
      elPanes.dataset.pageId = pageId;
      elPanes.dataset.chapterId = chId;
      var rChapter = res[1], rPage, rErr = null;
      if (rChapter && rChapter.__err) {
        rErr = strings(rlang).loadErr + rChapter.__err.message;
        rPage = { html: '', title: frPage.title };
      } else {
        rPage = pickPage(rChapter, pageId);
      }
      renderAligned(frPage, rPage, rlang, rErr);
      markCurrent(pageId);
      if (keepScroll) elContent.scrollTop = prevScroll;
      else if (anchor) scrollToAnchor(anchor);
      else elContent.scrollTop = 0;
    }).catch(function (e) {
      elPanes.innerHTML = '<p class="error">' + strings(CFG.baseLang).loadErr + e.message + '</p>';
    });
  }

  // Build the DOM element for one stored block (a {id,type,label,title,html}
  // record from the page's `blocks` array). The translation pipeline preserves
  // the block sequence 1:1 across fr/en/cn (same count and kind in the same
  // order), so the left/right blocks pair cleanly by index.
  function blockEl(block) {
    var tpl = document.createElement('template');
    tpl.innerHTML = (block && block.html) || '';
    return tpl.content.firstElementChild;
  }

  // Build the footnotes <section> as a detached element so it can be paired into
  // a trailing aligned row (mirrors the old per-pane footnotes block).
  function footnotesEl(page, lang) {
    if (!page || !page.footnotes || !page.footnotes.length) return null;
    var s = strings(lang);
    var sec = document.createElement('section');
    sec.id = 'footnotes';
    var ol = document.createElement('ol');
    page.footnotes.forEach(function (f) {
      var li = document.createElement('li');
      li.id = f.id;
      li.innerHTML = f.html +
        ' <a class="backref" href="#' + f.id + 'ref" title="' + s.backref + '">↩</a>';
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    return sec;
  }

  function renderAligned(frPage, rPage, rlang, rErr) {
    var s = strings(rlang);
    var toRec = function (b) { return { el: blockEl(b), id: b.id }; };
    var left = (frPage.blocks || []).map(toRec);
    var right;
    if (rPage && rPage.blocks && rPage.blocks.length) {
      right = rPage.blocks.map(toRec);
    } else {
      // No translation (or load error): one placeholder block beside the French
      // title; the remaining rows keep the French text reading on the left.
      var ph = document.createElement('div');
      ph.innerHTML = '<h1>' + ((rPage && rPage.title) || frPage.title || '') + '</h1>' +
        (rErr ? '<p class="error">' + rErr + '</p>'
              : '<p class="muted"><em>' + s.notrans + '</em></p>');
      right = [{ el: ph, id: null }];
    }
    // Footnotes pair as a final aligned row.
    var lf = footnotesEl(frPage, CFG.baseLang);
    var rf = footnotesEl(rPage, rlang);
    if (lf) left.push({ el: lf, id: 'footnotes' });
    if (rf) right.push({ el: rf, id: 'footnotes' });

    var frag = document.createDocumentFragment();
    var n = Math.max(left.length, right.length);
    for (var i = 0; i < n; i++) {
      frag.appendChild(buildRow(left[i] || null, right[i] || null, rlang, i));
    }
    elPanes.innerHTML = '';
    elPanes.appendChild(frag);
    wireProofs(elPanes);
    typeset(elPanes);
    // Let comments.js (re-)apply its block badges for the page just rendered.
    document.dispatchEvent(new CustomEvent('panes:rendered'));
  }

  // One aligned row: French block in the left cell, its translation in the right
  // cell. align-items:start (in CSS) tops them out, so each pair lines up. Each
  // cell carries its block index (same on both cells, stable across fr/en/cn) and
  // the block's own id, so comments.js can anchor a comment to its block — by id
  // when it has one, by index otherwise. leftRec/rightRec are {el, id} or null.
  function buildRow(leftRec, rightRec, rlang, idx) {
    var row = document.createElement('div');
    row.className = 'align-row';
    var lc = document.createElement('div');
    lc.className = 'cell cell-left';
    lc.lang = CFG.baseLang;
    lc.dataset.blockIndex = idx;
    lc.dataset.blockId = (leftRec && leftRec.id) || '';
    if (leftRec && leftRec.el) lc.appendChild(leftRec.el);
    var rc = document.createElement('div');
    rc.className = 'cell cell-right';
    rc.lang = rlang;
    rc.dataset.blockIndex = idx;
    // The canonical (un-prefixed) id; the DOM ids inside the cell get an r- prefix.
    rc.dataset.blockId = (rightRec && rightRec.id) || '';
    if (rightRec && rightRec.el) {
      rc.appendChild(rightRec.el);
      // The right cell reuses the same element ids as the left (ids are shared
      // across languages), so namespace them to keep the DOM valid and ensure
      // getElementById/scrollToAnchor resolve to the canonical left (French) cell.
      namespaceIds(rc);
    }
    row.appendChild(lc);
    row.appendChild(rc);
    return row;
  }

  // Prefix every id in the right cell so it never collides with the left cell.
  function namespaceIds(el) {
    el.querySelectorAll('[id]').forEach(function (n) { n.id = 'r-' + n.id; });
  }

  // Wire collapsible proofs. Proof blocks carry stable ids (proof-x <-> r-proof-x),
  // so toggling one proof toggles its paired translation, keeping the row aligned.
  function wireProofs(root) {
    root.querySelectorAll('.proof-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var proof = h.parentNode;
        var collapsed = proof.classList.toggle('collapsed');
        var id = proof.id;
        if (!id) return;
        var mateId = id.indexOf('r-') === 0 ? id.slice(2) : 'r-' + id;
        var mate = document.getElementById(mateId);
        if (mate) mate.classList.toggle('collapsed', collapsed);
      });
    });
  }

  function markCurrent(pageId) {
    elSidebar.querySelectorAll('a.current').forEach(function (a) { a.classList.remove('current'); });
    var a = elSidebar.querySelector('a[data-page="' + cssEscape(pageId) + '"]');
    if (a) {
      a.classList.add('current');
      a.scrollIntoView({ block: 'nearest' });
    }
  }

  function scrollToAnchor(id) {
    var el = document.getElementById(id);
    // Canonical ids live in the left cell; when that cell is hidden (mode-right,
    // or a collapsed proof) fall back to the r- prefixed mate, then to the row.
    if (el && el.getClientRects().length === 0) {
      var mate = document.getElementById('r-' + id);
      if (mate && mate.getClientRects().length) el = mate;
      else el = el.closest('.align-row') || el;
    }
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('target-flash');
      setTimeout(function () { el.classList.remove('target-flash'); }, 1300);
    }
  }

  function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

  // Resolve a hash like "#I.1.3" or "#I-1" into a {page, anchor}.
  function resolveHash(hash) {
    var raw = decodeURIComponent(hash.replace(/^#/, ''));
    if (!raw) return null;
    if (state.pageToChapter.hasOwnProperty(raw)) return { page: raw, anchor: null };
    var pid = state.anchorIndex[raw];
    if (pid) return { page: pid, anchor: raw };
    // toc-anchor-<CHAP> style fallbacks -> jump to chapter landing page
    var m = raw.match(/^toc-anchor-(.+)$/);
    if (m) {
      var key = m[1].replace(/-/g, '.');
      var pid2 = state.anchorIndex[key] || (state.pageToChapter.hasOwnProperty(key) ? key : null);
      if (pid2) return { page: pid2, anchor: key };
    }
    return null;
  }

  function navigate(hash) {
    var r = resolveHash(hash);
    if (!r) {
      var def = state.manifest.default_page_id || state.manifest.chapters[0].page_ids[0];
      showPage(def, null);
      return;
    }
    showPage(r.page, r.anchor);
  }

  // intercept internal link clicks (incl. links inside rendered content)
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var hash = a.getAttribute('href');
    e.preventDefault();
    if (history.pushState) history.pushState(null, '', hash);
    navigate(hash);
  });

  window.addEventListener('popstate', function () { navigate(location.hash); });

  // display-mode / language switch ([FR] [EN] [FR·EN]): picks which columns are
  // shown and, on the right/both buttons, which target language.
  document.getElementById('lang-switch').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    var mode = b.getAttribute('data-mode');
    var rlang = b.getAttribute('data-rlang');            // absent on the base-only button
    var langChanged = !!rlang && rlang !== state.rightLang;
    if (mode === state.displayMode && !langChanged) return;
    state.displayMode = mode;
    if (langChanged) state.rightLang = rlang;
    try {
      localStorage.setItem('displayMode', mode);
      if (langChanged) localStorage.setItem('rightLang', rlang);
    } catch (_) {}
    syncSwitchUI();
    // Rebuild + retypeset, preserving scroll: math revealed by the switch must be
    // typeset while visible (MathJax metrics — notably \tag placement — are wrong
    // inside display:none), and the right blocks change height on lang change.
    if (state.currentPage) renderPageAligned(state.currentPage, null, true);
  });

  // menu toggle: mobile shows the sidebar as an overlay (.open); on desktop it
  // collapses the sidebar entirely (persisted).
  document.getElementById('menu-toggle').addEventListener('click', function () {
    if (window.matchMedia('(max-width: 800px)').matches) {
      elSidebar.classList.toggle('open');
    } else {
      var collapsed = document.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (_) {}
    }
  });

  // Build the display-mode switch from config: a base-only button, then a
  // solo + side-by-side button per target language (CFG.rightLangs) — for one
  // right language that's [FR] [EN] [FR·EN]. The click handler above is
  // delegated on #lang-switch, so it keeps working with these dynamic buttons.
  function buildLangSwitch() {
    var sw = document.getElementById('lang-switch');
    if (!sw) return;
    var baseLbl = strings(CFG.baseLang).label || CFG.baseLang.toUpperCase();
    var html = '<button data-mode="left">' + baseLbl + '</button>';
    (CFG.rightLangs || []).forEach(function (code) {
      var lbl = strings(code).label || code.toUpperCase();
      html += '<button data-mode="right" data-rlang="' + code + '">' + lbl + '</button>' +
              '<button data-mode="both" data-rlang="' + code + '">' + baseLbl + '·' + lbl + '</button>';
    });
    sw.innerHTML = html;
    syncSwitchUI();
  }

  // Reflect state.displayMode/state.rightLang on the switch buttons and <body>
  // (body.mode-left / body.mode-right drive the CSS that hides the other cell).
  function syncSwitchUI() {
    document.querySelectorAll('#lang-switch button').forEach(function (b) {
      var on = b.getAttribute('data-mode') === state.displayMode &&
               (!b.hasAttribute('data-rlang') || b.getAttribute('data-rlang') === state.rightLang);
      b.classList.toggle('active', on);
    });
    document.body.classList.toggle('mode-left', state.displayMode === 'left');
    document.body.classList.toggle('mode-right', state.displayMode === 'right');
  }

  // boot: wait for the shared config (fetched by viewer-bootstrap.js), pick the
  // target language, restore persisted prefs, then load the manifest and render.
  function boot(cfg) {
    CFG = cfg;
    state.config = cfg;
    var rights = cfg.rightLangs || [];
    state.rightLang = rights[0] || cfg.baseLang;
    // restore persisted prefs before the first render (avoids a layout flash)
    try {
      var rl = localStorage.getItem('rightLang');
      if (rights.indexOf(rl) !== -1) state.rightLang = rl;
      var dm = localStorage.getItem('displayMode');
      if (dm === 'left' || dm === 'right' || dm === 'both') state.displayMode = dm;
      if (localStorage.getItem('sidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed');
    } catch (_) {}
    if (!rights.length) state.displayMode = 'left';   // no translations to show
    buildLangSwitch();
    loadManifest().then(function () {
      navigate(location.hash || ('#' + (state.manifest.default_page_id || '')));
    }).catch(function (e) {
      elPanes.innerHTML = '<p class="error">Impossible de charger le manifeste / Could not load the manifest (' +
                         e.message + '). Servez ce dossier via un serveur HTTP / Serve this folder over HTTP ' +
                         '(<code>python3 -m http.server</code>).</p>';
    });
  }

  if (window.TVConfigPromise && typeof window.TVConfigPromise.then === 'function') {
    window.TVConfigPromise.then(boot).catch(function (e) {
      elPanes.innerHTML = '<p class="error">Could not load ' + dataPath() + 'config.json (' +
                         (e && e.message) + '). Serve this folder over HTTP ' +
                         '(<code>python3 -m http.server</code>).</p>';
    });
  } else {
    elPanes.innerHTML = '<p class="error">Viewer bootstrap missing — include ' +
                       '&lt;script src="translation-viewer/viewer-bootstrap.js"&gt; in the page &lt;head&gt; ' +
                       'before viewer.js.</p>';
  }
})();
