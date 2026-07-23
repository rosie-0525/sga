# Using translation-viewer in a project

`translation-viewer` is a generic, build-free reader for a **bilingual/multilingual
translation**: a source-language document in the left column and one-or-more translations
on the right, aligned block-by-block, with client-side MathJax + XyJax and an in-page
comment/error-flagging tool. All code is project-agnostic — a project supplies only a
`data/` folder (in the format documented here) and a copy of `paper.html`.

## 1. Add the submodule

Mount it at `translation-viewer/` in your project root (the folder name matters — the
entry page and the course, if any, reference `translation-viewer/…`):

```sh
git submodule add <repo-url> translation-viewer
git submodule update --init
```

When cloning a project that uses it: `git clone --recurse-submodules <project-url>`
(or `git submodule update --init` after a plain clone).

## 2. Add the entry page

Copy the template to your project root — it needs no edits:

```sh
cp translation-viewer/paper.template.html ./paper.html
```

## 3. Provide `data/`

```
data/
├── config.json                 # project settings — see config.schema.md
├── <baseLang>/manifest.json    # navigation index — see manifest.schema.md
├── <baseLang>/chapters/<id>.json
└── <lang>/chapters/<id>.json   # one dir per language in config (baseLang + rightLangs)
```

- **`config.json`** — title, `baseLang`, `rightLangs`, per-language labels + UI strings,
  and MathJax macros. → [`config.schema.md`](config.schema.md)
- **`manifest.json`** — chapters, TOC, `anchor_index`, default page. Base language only.
  → [`manifest.schema.md`](manifest.schema.md)
- **chapter files** — the content, one per chapter per language; top-level blocks stay 1:1
  by index across languages. → [`chapter.schema.md`](chapter.schema.md)

## 4. Serve over HTTP

The viewer uses `fetch`, so open it via a server (not `file://`):

```sh
python3 -m http.server 8000
# → http://localhost:8000/paper.html
```

## How it loads

1. `paper.html` loads `translation-viewer/viewer-bootstrap.js` from its `<head>`.
2. The bootstrap fetches `data/config.json`, exposes `window.TVConfigPromise`, sets up
   MathJax from `config.mathjax`, and injects the vendored MathJax/XyJax (found next to the
   script, so the submodule mount path doesn't matter).
3. `viewer.js` waits on `TVConfigPromise`, loads the base-language manifest, builds the
   sidebar + language switcher from config, and renders pages on navigation.
4. `comments.js` adds the selection → comment UI, storing notes in `localStorage` (export
   as `comments.json`).

Because `data/` paths are resolved relative to `paper.html`, keep `paper.html` and `data/`
at the project root; the submodule folder can be moved/renamed as long as `paper.html`'s
two `translation-viewer/…` references are updated to match.
