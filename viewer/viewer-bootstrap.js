/* translation-viewer bootstrap.
   Loaded from the page <head>, before viewer.js. It does two things so the host
   page (paper.html) can stay fully generic — no project specifics, no inline
   MathJax config:

     1. Fetches the per-project config (data/config.json by default) and exposes it
        as window.TVConfigPromise. viewer.js waits on this promise before booting.
     2. Configures MathJax from config.mathjax (macros + packages) and injects the
        vendored MathJax + XyJax-v3 (SVG output) shipped alongside this script, so
        the page renders fully offline with no CDN / network requests.

   Everything project-specific lives in config.json; this file is generic. */
(function () {
  'use strict';

  // Capture our own <script> synchronously (document.currentScript is null inside
  // async callbacks). We need its src (to locate the vendored libs) and its
  // optional data-config attribute (the project config path).
  var self = document.currentScript;

  // Base dir of THIS script, e.g. ".../translation-viewer/". Used to locate the
  // vendored libraries so the submodule works regardless of where it is mounted.
  var base = self && self.src ? self.src.replace(/[^/]*$/, '') : '';

  // Project config path — resolved relative to the DOCUMENT (the project root),
  // not this script. Override with data-config on the <script> tag.
  var configUrl = (self && self.getAttribute('data-config')) || 'data/config.json';

  // viewer.js gates its boot on this promise (and surfaces any load error in-page).
  window.TVConfigPromise = fetch(configUrl).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + configUrl);
    return r.json();
  });

  // Configure MathJax from config, then inject the vendored library. window.MathJax
  // must exist before the library script runs, so we append the script only here,
  // once the config has resolved. Math uses \(..\) / \[..\] delimiters; equation
  // numbers are injected as \tag, so MathJax auto-tagging stays off.
  window.TVConfigPromise.then(function (cfg) {
    var mj = (cfg && cfg.mathjax) || {};
    window.MathJax = {
      loader: {
        load: ['[custom]/xypic.js'],
        paths: { custom: base + 'vendor/xyjax' }
      },
      tex: {
        packages: { '[+]': mj.packages || ['xypic', 'ams', 'color', 'mathtools'] },
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
        tags: 'none',
        macros: mj.macros || {}
      },
      options: { enableMenu: true },
      startup: { typeset: false }
    };
    var s = document.createElement('script');
    s.src = base + 'vendor/mathjax/tex-svg-full.js';
    s.id = 'MathJax-script';
    s.async = true;
    document.head.appendChild(s);
  }).catch(function (e) {
    // viewer.js renders the user-facing config-load error; just trace it here.
    console.error('translation-viewer: could not load ' + configUrl, e);
  });
})();
