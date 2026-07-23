# `data/<baseLang>/manifest.json`

The navigation index. Loaded **once**, in the base language only (`dataPath + baseLang +
"/manifest.json"`) — ids are shared across all languages, so one manifest drives the
sidebar, routing and cross-reference resolution for every column.

The viewer only reads the fields below; any extra keys (`level`, `order`,
`is_numbered_chapter`, `chapter_number`, `default_chapter_id`, …) are ignored, so you can
keep pipeline metadata in the file.

## Top-level fields

| Field | Required | Description |
|-------|----------|-------------|
| `chapters` | yes | Ordered array of chapter objects (see below). Defines sidebar order and the page → chapter mapping. |
| `toc` | yes | Array of `{ page_id, title }`. Supplies titles for **sub-pages** (a chapter's 2nd+ `page_ids`) in the sidebar. |
| `anchor_index` | yes | Map of every internal anchor id → the `page_id` that contains it. Powers O(1) cross-page `#anchor` jumps. |
| `default_page_id` | recommended | Page shown when there is no URL hash. Falls back to the first chapter's first page. |

## `chapters[i]`

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Chapter id. Also the content filename: `data/<lang>/chapters/<id>.json`. |
| `title` | yes | Sidebar label for the chapter's landing (first) page. |
| `number` | no | Chapter number rendered as a prefix badge (omit / `null` for front-matter, bibliography, etc.). |
| `page_ids` | yes | Ordered page ids in this chapter. `page_ids[0]` is the landing page; the rest appear as indented sub-pages (titled from `toc`). |

## `anchor_index`

Every id a `#href` might target — theorem/section ids (`"2.1"`), display-math ids
(`"disp-2-1"`), equation tags (`"eq:2.2.1"`), footnotes (`"fn-3-1"`), bib entries
(`"bib-4"`), and each page id itself — must map to the page id where it lives. Anchors
missing here won't resolve on click. (A `toc-anchor-<CHAP>` hash is also accepted and
maps to the chapter landing page.)

## Example (abridged)

```json
{
  "chapters": [
    { "id": "intro", "title": "Introduction", "number": null, "page_ids": ["intro"] },
    { "id": "1", "title": "Notations et rappels", "number": "1", "page_ids": ["1"] },
    { "id": "4", "title": "Compléments", "number": "4", "page_ids": ["4", "4-1", "4-2"] }
  ],
  "toc": [
    { "page_id": "4-1", "title": "4.1. Dégénérescence relative" },
    { "page_id": "4-2", "title": "4.2. Pôles logarithmiques" }
  ],
  "default_page_id": "front",
  "anchor_index": { "1.2": "1", "disp-1-2": "1", "eq:2.2.1": "2", "bib-4": "bibliographie" }
}
```

Content for each chapter lives in per-language files — see `chapter.schema.md`.
