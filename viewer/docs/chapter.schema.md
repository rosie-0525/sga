# `data/<lang>/chapters/<chapterId>.json`

The actual content, one file per chapter **per language**. Loaded lazily and cached when
a page in that chapter is first shown. The base language (left column) is loaded together
with the current right-column language.

There must be a file for **every** `chapterId` in the manifest, under **every** language
in `config.json` (`baseLang` + each of `rightLangs`), at matching paths.

## Structure

```jsonc
{
  "chapter_id": "1",          // informational; the manifest is the source of truth
  "title": "…",               // informational
  "number": "1",              // informational
  "pages": [
    {
      "id": "1",              // page id — must match a page_id in the manifest
      "title": "…",           // used as the right-column heading when a translation is missing
      "blocks": [ /* … */ ],
      "footnotes": [ /* … */ ]
    }
  ]
}
```

### `blocks[i]` — the aligned content units

Top-level blocks are paired **by index** between the base and target columns to line up in
shared grid rows.

| Field | Required | Description |
|-------|----------|-------------|
| `html` | yes | The block's rendered HTML, injected as-is (math in `\(..\)` / `\[..\]`, diagrams in `\xymatrix{…}`). This is the only field the layout requires. |
| `id` | recommended | The block's anchor id (matches the manifest's `anchor_index`). Enables cross-references and lets the comment tool anchor to the block by id. `null` for un-referenced blocks (they anchor by index instead). |
| `type` | optional | Kind hint (`paragraph`, `heading`, `theoreme`, `proposition`, `lemme`, `corollaire`, `remarque`, `proof`, `equation`, `displaymath`, `bibliography`, …). Metadata; not required by the viewer. |
| `label`, `title` | optional | Human labels (e.g. `"1.2"`, `"Théorème"`). Metadata. |

### The alignment invariant

**The base and target `blocks` arrays for the same page must be 1:1 — same length, same
order, same kind at each index.** Blocks pair positionally, so a mismatch shifts the whole
column. A page may be entirely absent in a target language (the column then shows the
`notrans` notice); partial pages must still keep the block count aligned.

### `footnotes[i]`

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Footnote id; the in-text marker links to `#<id>`, and a back-arrow to `#<id>ref`. |
| `html` | yes | Footnote body HTML. |
| `number` | no | Display number. |

### Ids and namespacing

Ids are **shared across languages** (the same theorem is `"1.2"` in every column). The
viewer keeps the left (base) column canonical for `getElementById` / anchor scrolling and
automatically prefixes the right column's ids with `r-` to avoid DOM collisions — so author
your JSON with the same ids on both sides and let the viewer handle it.

## Example block

```json
{
  "id": "1.2",
  "type": "theoreme",
  "label": "1.2",
  "title": "Théorème",
  "html": "<div class=\"thm thm-plain theoreme\" id=\"1.2\"><div class=\"thm-head\">…</div><div class=\"thm-body\"><p>…\\(C^{-1}\\)…</p></div></div>"
}
```
