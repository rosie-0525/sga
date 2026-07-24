/* In-viewer error comments.

   Lets a proofreader select text in any block (a theorem, paragraph, equation —
   French left column or the EN/CN translation on the right) and attach a note,
   mostly to flag errors. Comments live in localStorage and can be exported as
   `comments.json`, a file an agent reads to locate and fix each flagged error.

   Each comment records where it lives so the fix is mechanical:
     data/<lang>/chapters/<chapterId>.json  ->  pages[].id === pageId  ->  the
     entry in page.blocks[] by blockId (or by blockIndex)  ->  the exact `quote`.

   Visual marking is block-level (a 💬 badge + tint): MathJax replaces math with
   SVG after typesetting, so re-wrapping an arbitrary substring of rendered
   content is fragile. The precise quote is still stored for the agent.

   "Resolve" deletes the comment (a flagged error, once handled, is removed). */
(function () {
  'use strict';

  var STORE_KEY = 'docComments';
  var elPanes = document.getElementById('panes');
  var elContent = document.getElementById('content');
  var comments = loadComments();

  // ---------------------------------------------------------------- store ----

  function loadComments() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveComments() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(comments)); } catch (_) {}
  }
  // Persist + refresh everything that reflects the comment set.
  function commit() { saveComments(); renderBadges(); updateTopCount(); refreshPanel(); }

  function uid() { return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }
  function byId(id) { return comments.filter(function (c) { return c.id === id; })[0] || null; }

  // --------------------------------------------------------------- helpers ----

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function collapseWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function langLabel(l) { return l === 'fr' ? 'FR' : l === 'en' ? 'EN' : l === 'cn' ? '中文' : (l || '?'); }
  function sideOf(c) { return c.lang === 'fr' ? 'left' : 'right'; }

  // Resolve the block context for a node (typically a selection's anchor): which
  // cell it sits in, that cell's language and block index, the page/chapter, and
  // the block's own (canonical, un-prefixed) id — both stamped on the cell by
  // viewer.js's buildRow (data-block-index / data-block-id).
  function contextForNode(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var cell = el && el.closest ? el.closest('#panes .cell') : null;
    if (!cell) return null;
    var lang = cell.lang || (cell.classList.contains('cell-right') ? '' : 'fr');
    return {
      cell: cell,
      lang: lang,
      blockIndex: cell.dataset.blockIndex != null ? parseInt(cell.dataset.blockIndex, 10) : null,
      blockId: cell.dataset.blockId || null,
      pageId: elPanes.dataset.pageId || null,
      chapterId: elPanes.dataset.chapterId || null
    };
  }

  function cellFor(side, blockIndex) {
    return elPanes.querySelector('.cell-' + side + '[data-block-index="' + String(blockIndex) + '"]');
  }

  // A comment's block id (`anchorId` on comments saved before the rename).
  function locId(c) { return c.blockId || c.anchorId || null; }
  function locLabel(c) { return locId(c) ? '#' + locId(c) : 'block ' + c.blockIndex; }

  // -------------------------------------------------- selection → float btn ----

  var pending = null;  // { ctx, quote }
  var floatBtn = document.createElement('button');
  floatBtn.id = 'cmt-float';
  floatBtn.type = 'button';
  floatBtn.className = 'cmt-ui';
  floatBtn.textContent = '💬 Comment';
  floatBtn.hidden = true;
  document.body.appendChild(floatBtn);

  function hideFloat() { floatBtn.hidden = true; pending = null; }

  document.addEventListener('mouseup', function (e) {
    if (e.target.closest && e.target.closest('.cmt-ui')) return;  // our own UI
    setTimeout(captureSelection, 0);  // let the selection settle
  });
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if ((!sel || sel.isCollapsed || !collapseWs(sel.toString())) && !document.querySelector('.cmt-popover')) {
      hideFloat();
    }
  });
  if (elContent) elContent.addEventListener('scroll', hideFloat, { passive: true });

  function captureSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideFloat();
    var quote = collapseWs(sel.toString());
    if (!quote) return hideFloat();
    var ctx = contextForNode(sel.getRangeAt(0).startContainer);
    if (!ctx) return hideFloat();
    pending = { ctx: ctx, quote: quote };
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    floatBtn.hidden = false;  // show before measuring so offsetWidth/Height are real
    floatBtn.style.top = Math.max(6, rect.top - floatBtn.offsetHeight - 6) + 'px';
    floatBtn.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - floatBtn.offsetWidth - 6)) + 'px';
  }

  floatBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });  // keep the selection
  floatBtn.addEventListener('click', function () {
    if (!pending) return;
    openCreate(pending.ctx, pending.quote, floatBtn.getBoundingClientRect());
    floatBtn.hidden = true;
  });

  // ------------------------------------------------------------- popovers ----

  function popoverShell() { var p = document.createElement('div'); p.className = 'cmt-popover cmt-ui'; return p; }
  function closePopovers() { document.querySelectorAll('.cmt-popover').forEach(function (p) { p.remove(); }); }

  // place a popover near an anchor rect, kept inside the viewport
  function positionPopover(pop, rect) {
    document.body.appendChild(pop);
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var top = rect.bottom + 6;
    if (top + h > window.innerHeight - 6) top = rect.top - h - 6;
    var left = rect.left;
    if (left + w > window.innerWidth - 6) left = window.innerWidth - w - 6;
    pop.style.top = Math.max(6, top) + 'px';
    pop.style.left = Math.max(6, left) + 'px';
  }

  // New comment for a block. quote may be '' (commenting the whole block via "+ Add").
  function openCreate(ctx, quote, anchorRect) {
    closePopovers();
    var pop = popoverShell();
    pop.innerHTML =
      (quote ? '<div class="cmt-pop-quote">“' + esc(truncate(quote, 160)) + '”</div>' : '') +
      '<div class="cmt-pop-meta">' + langLabel(ctx.lang) + ' · ' + esc(locLabel(ctx)) +
        (quote ? '' : ' · (whole block)') + '</div>' +
      '<textarea class="cmt-pop-text" rows="3" placeholder="Describe the error / note…"></textarea>' +
      '<div class="cmt-pop-actions">' +
        '<button type="button" class="cmt-btn cmt-primary cmt-save">Save</button>' +
        '<button type="button" class="cmt-btn cmt-cancel">Cancel</button>' +
      '</div>';
    positionPopover(pop, anchorRect);
    var ta = pop.querySelector('.cmt-pop-text');
    ta.focus();
    pop.querySelector('.cmt-cancel').addEventListener('click', closePopovers);
    pop.querySelector('.cmt-save').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      comments.push({
        id: uid(), pageId: ctx.pageId, chapterId: ctx.chapterId, lang: ctx.lang,
        blockIndex: ctx.blockIndex, blockId: ctx.blockId, quote: quote,
        comment: text, createdAt: new Date().toISOString()
      });
      commit();
      closePopovers();
    });
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') pop.querySelector('.cmt-save').click();
      else if (e.key === 'Escape') closePopovers();
    });
  }

  // Thread for one block: list its comments with resolve (= delete) / edit / add.
  // The click handler is delegated and bound ONCE here; renderThread only rebuilds
  // the popover's innerHTML, so handlers never stack across re-renders.
  function openThread(side, blockIndex, anchorRect) {
    closePopovers();
    var pop = popoverShell();
    pop.dataset.side = side;
    pop.dataset.blockIndex = blockIndex;
    pop.addEventListener('click', onThreadClick);
    renderThread(pop);
    positionPopover(pop, anchorRect);
  }

  function onThreadClick(e) {
    var pop = e.currentTarget;
    var btn = e.target.closest && e.target.closest('button[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'close') { closePopovers(); return; }
    if (act === 'add') {
      var cell = cellFor(pop.dataset.side, pop.dataset.blockIndex);
      var ctx = cell ? contextForNode(cell) : null;
      if (ctx) openCreate(ctx, '', pop.getBoundingClientRect());
      return;
    }
    var item = btn.closest('.cmt-item');
    var c = byId(item && item.getAttribute('data-id'));
    if (!c) return;
    if (act === 'resolve') { removeComment(c.id); renderThread(pop); }  // resolve = delete
    else if (act === 'edit') startEdit(item, c, pop);
  }

  function threadComments(side, blockIndex) {
    var pageId = elPanes.dataset.pageId;
    return comments.filter(function (c) {
      return c.pageId === pageId && sideOf(c) === side && String(c.blockIndex) === String(blockIndex);
    });
  }

  function renderThread(pop) {
    var side = pop.dataset.side, bi = pop.dataset.blockIndex;
    var list = threadComments(side, bi);
    if (!list.length) { pop.remove(); return; }
    var html = '<div class="cmt-pop-head">Comments</div><div class="cmt-thread">';
    list.forEach(function (c) {
      html += '<div class="cmt-item" data-id="' + esc(c.id) + '">' +
        (c.quote ? '<div class="cmt-item-quote">“' + esc(truncate(c.quote, 140)) + '”</div>' : '') +
        '<div class="cmt-item-text">' + esc(c.comment) + '</div>' +
        '<div class="cmt-item-foot"><span class="cmt-tag">' + langLabel(c.lang) +
          (locId(c) ? ' · #' + esc(locId(c)) : '') + '</span>' +
          '<span class="cmt-actions">' +
            '<button type="button" data-act="resolve" title="Mark this error handled — deletes the comment">Resolve</button>' +
            '<button type="button" data-act="edit">Edit</button>' +
          '</span></div></div>';
    });
    html += '</div><div class="cmt-pop-actions">' +
      '<button type="button" class="cmt-btn cmt-add" data-act="add">+ Add</button>' +
      '<button type="button" class="cmt-btn cmt-cancel" data-act="close">Close</button></div>';
    pop.innerHTML = html;
  }

  // Inline edit of one comment's text, in place inside its thread item.
  function startEdit(item, c, pop) {
    if (item.querySelector('.cmt-edit')) return;
    var textDiv = item.querySelector('.cmt-item-text');
    var wrap = document.createElement('div');
    wrap.className = 'cmt-edit';
    wrap.innerHTML = '<textarea class="cmt-edit-text" rows="3"></textarea>' +
      '<div class="cmt-pop-actions">' +
        '<button type="button" class="cmt-btn cmt-primary cmt-edit-save">Save</button>' +
        '<button type="button" class="cmt-btn cmt-edit-cancel">Cancel</button></div>';
    var ta = wrap.querySelector('.cmt-edit-text');
    ta.value = c.comment;
    textDiv.replaceWith(wrap);
    ta.focus();
    wrap.querySelector('.cmt-edit-cancel').addEventListener('click', function () { renderThread(pop); });
    wrap.querySelector('.cmt-edit-save').addEventListener('click', function () {
      var v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      c.comment = v; commit(); renderThread(pop);
    });
  }

  function removeComment(id) { comments = comments.filter(function (c) { return c.id !== id; }); commit(); }

  // close popovers on an outside click
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest && e.target.closest('.cmt-ui, .cmt-badge')) return;
    closePopovers();
  });

  // --------------------------------------------------------------- badges ----

  // (Re)draw a 💬 badge + tint on every block of the current page that has a
  // comment. Runs on each `panes:rendered` (and after any mutation).
  function renderBadges() {
    elPanes.querySelectorAll('.cmt-badge').forEach(function (b) { b.remove(); });
    elPanes.querySelectorAll('.has-comment').forEach(function (c) { c.classList.remove('has-comment'); });
    var pageId = elPanes.dataset.pageId;
    if (!pageId) return;
    var groups = {};  // "side:blockIndex" -> comments
    comments.forEach(function (c) {
      if (c.pageId !== pageId) return;
      var key = sideOf(c) + ':' + c.blockIndex;
      (groups[key] || (groups[key] = [])).push(c);
    });
    Object.keys(groups).forEach(function (key) {
      var i = key.indexOf(':'), side = key.slice(0, i), bi = key.slice(i + 1);
      var cell = cellFor(side, bi);
      if (!cell) return;
      cell.classList.add('has-comment');
      var list = groups[key];
      var badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'cmt-badge cmt-ui';
      badge.textContent = '💬' + (list.length > 1 ? ' ' + list.length : '');
      badge.title = list.length + ' comment' + (list.length > 1 ? 's' : '');
      badge.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openThread(side, bi, badge.getBoundingClientRect());
      });
      cell.appendChild(badge);
    });
  }

  // ----------------------------------------------------------- side panel ----

  var panel = buildPanel();

  function buildPanel() {
    var p = document.createElement('aside');
    p.id = 'cmt-panel';
    p.className = 'cmt-ui';
    p.hidden = true;
    p.innerHTML =
      '<div class="cmt-panel-head"><strong>Error comments</strong>' +
        '<button type="button" class="cmt-x" aria-label="Close">✕</button></div>' +
      '<div class="cmt-panel-tools">' +
        '<button type="button" class="cmt-btn" data-act="export">Export comments.json</button>' +
        '<button type="button" class="cmt-btn" data-act="copy">Copy</button>' +
        '<button type="button" class="cmt-btn" data-act="import">Import…</button>' +
        '<button type="button" class="cmt-btn cmt-danger" data-act="clear">Clear all</button>' +
        '<input type="file" accept="application/json,.json" class="cmt-file" hidden></div>' +
      '<div class="cmt-panel-list"></div>';
    document.body.appendChild(p);
    p.querySelector('.cmt-x').addEventListener('click', togglePanel);
    p.querySelector('.cmt-file').addEventListener('change', onImportFile);
    p.querySelector('.cmt-panel-tools').addEventListener('click', onPanelTool);
    p.querySelector('.cmt-panel-list').addEventListener('click', onPanelListClick);
    return p;
  }

  function togglePanel() { panel.hidden = !panel.hidden; if (!panel.hidden) refreshPanel(); }

  function refreshPanel() {
    if (panel.hidden) return;
    var listEl = panel.querySelector('.cmt-panel-list');
    if (!comments.length) {
      listEl.innerHTML = '<p class="cmt-empty">No comments yet. Select text in the document and click “💬 Comment”.</p>';
      return;
    }
    var order = [], groups = {};
    comments.forEach(function (c) {
      var k = c.pageId || '(unknown)';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(c);
    });
    var html = '';
    order.forEach(function (pid) {
      html += '<div class="cmt-grp"><div class="cmt-grp-head">Page ' + esc(pid) + '</div>';
      groups[pid].forEach(function (c) {
        html += '<div class="cmt-row" data-id="' + esc(c.id) + '">' +
          '<div class="cmt-row-text">' + esc(c.comment) + '</div>' +
          (c.quote ? '<div class="cmt-row-quote">“' + esc(truncate(c.quote, 120)) + '”</div>' : '') +
          '<div class="cmt-row-foot"><span class="cmt-tag">' + langLabel(c.lang) + ' · ' + esc(locLabel(c)) + '</span>' +
            '<span class="cmt-actions">' +
              '<button type="button" data-act="jump" title="Scroll to this comment\'s block">Go</button>' +
              '<button type="button" data-act="resolve" title="Mark this error handled — deletes the comment">Resolve</button>' +
            '</span></div></div>';
      });
      html += '</div>';
    });
    listEl.innerHTML = html;
  }

  function onPanelListClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var row = btn.closest('.cmt-row');
    var c = byId(row && row.getAttribute('data-id'));
    if (!c) return;
    var act = btn.getAttribute('data-act');
    if (act === 'jump') goToComment(c);
    else if (act === 'resolve') removeComment(c.id);  // resolve = delete
  }

  function onPanelTool(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'export') exportJSON();
    else if (act === 'copy') copyJSON(btn);
    else if (act === 'import') panel.querySelector('.cmt-file').click();
    else if (act === 'clear') {
      if (comments.length && window.confirm('Delete all ' + comments.length + ' comments?')) { comments = []; commit(); }
    }
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(comments, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'comments.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyJSON(btn) {
    var text = JSON.stringify(comments, null, 2);
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = t; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) {}
    ta.remove();
  }

  function onImportFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error('expected a JSON array');
        var byid = {};
        comments.forEach(function (c) { byid[c.id] = c; });
        arr.forEach(function (c) { if (!c || typeof c !== 'object') return; if (!c.id) c.id = uid(); byid[c.id] = c; });
        comments = Object.keys(byid).map(function (k) { return byid[k]; });
        commit();
      } catch (err) { window.alert('Import failed: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------- plumbing ----

  // Navigate via a synthetic anchor click so the viewer's existing #-link router
  // (which intercepts clicks on a[href^="#"]) resolves the page + anchor for us.
  function navTo(hash) {
    var a = document.createElement('a');
    a.href = hash; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Scroll the comment's exact block into view and flash it. Works whether or not
  // the block has an id (anchors by blockIndex via cellFor), and targets the right
  // column when the comment was made on the translation side.
  function scrollToBlock(side, blockIndex) {
    var cell = cellFor(side, blockIndex);
    if (!cell) return;
    // If that side is hidden (single-language display mode), reveal its row.
    var target = cell.getClientRects().length ? cell : cell.parentElement;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('target-flash');
    setTimeout(function () { target.classList.remove('target-flash'); }, 1300);
  }

  // "Go": reveal the block a comment is attached to, navigating pages if needed.
  function goToComment(c) {
    if (!c) return;
    // Defer past the viewer's own post-render scroll-to-top so ours wins.
    var reveal = function () { setTimeout(function () { scrollToBlock(sideOf(c), c.blockIndex); }, 0); };
    if (elPanes.dataset.pageId === c.pageId) { reveal(); return; }
    document.addEventListener('panes:rendered', function once() {
      document.removeEventListener('panes:rendered', once);
      reveal();
    });
    navTo('#' + c.pageId);
  }

  function updateTopCount() {
    var badge = document.getElementById('cmt-count');
    if (!badge) return;
    var n = comments.length;
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
  }

  // ----------------------------------------------------------------- boot ----

  var toggleBtn = document.getElementById('cmt-toggle');
  if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);
  document.addEventListener('panes:rendered', renderBadges);
  updateTopCount();
  renderBadges();  // harmless before the first page renders (no pageId yet)
})();
