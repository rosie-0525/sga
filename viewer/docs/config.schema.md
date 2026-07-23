# `data/config.json`

The single per-project config the viewer reads first. Everything project-specific
lives here — the viewer engine (`viewer.js`, `viewer.css`, `comments.js`) stays generic.
Fetched by `viewer-bootstrap.js` (relative to the page; default path `data/config.json`,
overridable via the `data-config` attribute on the bootstrap `<script>`).

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `baseLang` | yes | The single **source** language code. Shown in the left column; drives the manifest, sidebar, navigation and anchor index. Must be a key in `languages`. |
| `rightLangs` | yes | Array of **target** language codes (one or more) offered by the right-column switcher, in display order. The first is the default. Each must be a key in `languages`. |
| `dataPath` | no | Base path of the content tree, relative to the page. Default `"data/"`. A trailing slash is optional (normalized). |
| `languages` | yes | Map of language code → `{ label, … }` (see below). Must contain `baseLang` and every entry of `rightLangs`. |
| `mathjax` | no | `{ macros, packages }` for MathJax (see below). Omit if the project has no math. |

### `languages[code]`

| Field | Required | Used for |
|-------|----------|----------|
| `label` | yes | Text on the language-switch button / the base-language marker (e.g. `"FR"`, `"EN"`, `"中文"`). |
| `notrans` | recommended | Notice shown in the right column when a page has no translation in that language. |
| `loadErr` | recommended | Prefix for a load-error message (e.g. `"Loading error: "`). |
| `backref` | recommended | `title` of the footnote back-reference arrow (e.g. `"back"`). |
| `pageTitle` | base lang only | Sets `document.title`. |
| `bookTitle` | base lang only | Sets the topbar `#book-title`. |
| `toc` | base lang only | `aria-label` of the sidebar. |

Unknown languages fall back to `baseLang`'s strings, so a missing string degrades
gracefully rather than rendering blank.

### `mathjax`

| Field | Required | Description |
|-------|----------|-------------|
| `macros` | no | Map of TeX macro name → definition string, e.g. `{ "Om": "{\\Omega}" }`. Passed straight to MathJax's `tex.macros`. Backslashes are JSON-escaped (`"\\Omega"`). Macros taking arguments use MathJax's `[def, nargs]` array form. |
| `packages` | no | Extra TeX packages to enable. Default `["xypic", "ams", "color", "mathtools"]`. |

The bootstrap fixes the rest of the MathJax setup generically: SVG output, `\(..\)` /
`\[..\]` delimiters, auto-tagging off (`tags: 'none'`), and the vendored XyJax loader.

## Minimal example

```json
{
  "baseLang": "fr",
  "rightLangs": ["en"],
  "languages": {
    "fr": { "label": "FR", "pageTitle": "My paper", "bookTitle": "My paper",
            "toc": "Contents", "notrans": "(no translation)", "loadErr": "Error: ", "backref": "back" },
    "en": { "label": "EN", "notrans": "(no translation)", "loadErr": "Error: ", "backref": "back" }
  },
  "mathjax": { "macros": { "R": "{\\mathbf{R}}" } }
}
```

See `manifest.schema.md` and `chapter.schema.md` for the content files this config points at.
