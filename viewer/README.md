# translation-viewer

A generic, build-free web viewer for **aligned translations** — a source-language document
in the left column and one or more translations on the right, laid out block-by-block so
every theorem/paragraph/equation lines up. Renders math offline with vendored MathJax 3 +
XyJax-v3, and includes an in-page comment/error-flagging tool. Designed to be dropped into
any translation project as a **git submodule**: the code is project-agnostic; each project
supplies only its content under `data/`.

## Contents

| File | Role |
|------|------|
| `viewer.js` | Engine: config + manifest loading, lazy chapter fetch, block-aligned rendering, `#anchor` routing, language switching, collapsible proofs, MathJax typesetting. |
| `viewer.css` | Layout (two-column grid), typography, responsive/mobile, theorem/proof styling, comment UI. |
| `comments.js` | Selection → comment UI; per-block badges; `localStorage` persistence; export/import `comments.json`. |
| `viewer-bootstrap.js` | Fetches `data/config.json`, exposes `window.TVConfigPromise`, configures + injects the vendored MathJax/XyJax. |
| `vendor/mathjax/tex-svg-full.js` | MathJax 3 (SVG output, all extensions), vendored for offline use. |
| `vendor/xyjax/xypic.js` | XyJax-v3 xy-pic extension for commutative diagrams. |
| `paper.template.html` | The generic entry page — copy to your project root as `paper.html`. |
| `docs/` | The data contract a consuming project must satisfy. |

## Quick start

```sh
git submodule add <repo-url> translation-viewer
cp translation-viewer/paper.template.html ./paper.html
# create ./data/ per docs/, then:
python3 -m http.server 8000   # open http://localhost:8000/paper.html
```

See **[`docs/README.md`](docs/README.md)** for the full guide and
[`docs/config.schema.md`](docs/config.schema.md) · [`docs/manifest.schema.md`](docs/manifest.schema.md) ·
[`docs/chapter.schema.md`](docs/chapter.schema.md) for the `data/` format.

## Flagging errors / comments

Select text in either column to attach a comment (e.g. a translation error). Comments are
saved in `localStorage` and anchored to their block; open the panel to review, jump to, or
export them as `comments.json` for an agent to act on. `comments.json` is a local working
file — add it to your project's `.gitignore`.
