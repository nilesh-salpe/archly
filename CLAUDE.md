# Archly

A drag-and-drop system-design diagramming tool: pick components from a
categorized palette, connect them with numbered flow arrows, and play an
animation that steps through the request flow in order. Live at
https://nilesh-salpe.github.io/archly/, repo at
https://github.com/nilesh-salpe/archly.

## Stack & philosophy

Plain HTML/CSS/JS. **No build step, no npm, no external libraries or CDNs** —
every script tag in `index.html` is hand-written and loaded directly. This is
deliberate: keep it small, dependency-free, and trivially deployable to GitHub
Pages via "deploy from branch." When adding a feature, prefer a small
hand-written implementation (see `js/yaml.js`) over reaching for a library.

Icons are hand-built inline SVG fragments (24×24 viewBox, stroke-based) — see
the `ICONS` object in `js/components.js`. Never copy a real cloud provider's
icon; keep glyphs simple and original.

## Running locally

```
python3 -m http.server 8000
```
then open `http://localhost:8000`. **Browsers aggressively cache local static
files** — after editing a `.js`/`.css` file, do a hard reload (Cmd+Shift+R) or
you'll silently keep running the old version. This bit us repeatedly during
development; don't skip it when testing a change.

## Architecture

Everything renders into **one `<svg>` element** (`#canvas` in `index.html`),
not a mix of HTML+SVG — this is what makes PNG/SVG export a simple
serialize-and-rasterize operation. Layers, back to front: `layer-containers`
(Region/AZ/VPC/Group boxes), `layer-edges`, `layer-nodes`, `layer-overlay`
(drag previews, the flow-play dot — marked `.no-export` so it never appears in
exports).

- **`js/components.js`** — the palette catalog. `COMPONENTS` is a flat array
  of `{id, category, label, icon, container?, textOnly?, w?, h?}`.
  `CATEGORY_COLORS`/`CATEGORY_FILLS`/`CATEGORY_LABELS` key the 17 categories
  (Client, Edge, Network & Boundary, Services, Compute, Communication, Cache,
  Data, Processing, Reliability, Security, Observability, ML, GenAI, RAG,
  External, General). `container: true` marks boundary/grouping shapes
  (Region, AZ, VPC, Subnet, Group) that render as large dashed background
  rects. `textOnly: true` marks the freeform "Text" tool (transparent body,
  word-wrapped, auto-grows height — see `recomputeTextOnlyHeight` in
  `js/canvas.js`).
- **`js/canvas.js`** — owns `state` (`{nodes, edges, selected}`) and all
  rendering/interaction: drag-drop from palette, node drag/resize/rename,
  edge creation via connector handles, the right-click context menu builders
  (`buildNodeMenuItems`/`buildEdgeMenuItems` — also reused by the toolbar's
  "Edit ▾" dropdown so both stay in sync), copy/paste, layering
  (bring-to-front/send-to-back via array order — SVG paints in document
  order), view prefs (grid/rulers/palette-drawer, persisted to
  `localStorage`), and the diagram autosave (`STORAGE_KEY`, also
  `localStorage`).
- **`js/arrows.js`** — pure geometry: clips a line to each node's rect border,
  and computes one of three edge routings selected by `edge.routing`/
  `edge.curve`: straight (default), curved (either auto-bent when parallel
  edges share a node pair, or manually set via `edge.curve` — dragging
  anywhere along an edge's line bends it, draw.io-style; see `startEdgeBend`
  in canvas.js), or `routing: 'orthogonal'` (right-angle elbow path).
- **`js/animate.js`** — the "Play" flow animation. Edges are grouped by
  `number`; same-numbered edges animate **concurrently** (each gets its own
  dot via `getFlowDotFor`), and the engine waits for a whole group before
  advancing — this is what lets you show fan-out/parallel steps.
- **`js/patterns.js`** — fetches and parses `patterns/*.yaml` at startup
  (`loadPatternDefinitions`, awaited before the palette/pattern-select build
  in `js/app.js`). `PATTERN_FILES` is a hardcoded filename list (no directory
  listing on static hosting). Adding a pattern = add a YAML file here + one
  line in `PATTERN_FILES`.
- **`js/yaml.js`** — a minimal hand-written YAML reader/writer, scoped
  deliberately to block-style only (nested mappings, sequences-of-mappings,
  plain/quoted scalars, `#` comments). No flow style, anchors, multi-line
  block scalars, or multi-document support. This is what both the pattern
  files and the diagram Export/Import YAML feature use — don't reach for a
  real YAML library, extend this one if a new construct is genuinely needed.
- **`js/export.js`** — PNG/SVG/YAML export + YAML import. `EXPORT_STYLE` is a
  hand-inlined copy of every CSS rule an exported element depends on, because
  the exported file is a **standalone SVG with no access to `styles.css`** —
  anything not in `EXPORT_STYLE` silently falls back to SVG defaults (usually
  black fill). If you add a new visual element class to the live canvas
  (badges, chips, icons, whatever), it needs a matching rule in
  `EXPORT_STYLE` or it'll render wrong (or invisible) in exports specifically.
  Same reasoning for `computeContentBBox()`: it must account for anything that
  can render outside the nodes' own bounding box (curved-edge control points,
  protocol labels) or that content gets clipped out of the export — this bit
  us once already, see the git history.
- **`js/app.js`** — palette build (+ search/filter, + collapsible category
  sections, all default-collapsed) and toolbar wiring.

## Editing model quick reference

- Node label: click the label text to rename inline (single-line `<input>`,
  or a `<textarea>` for the textOnly "Text" tool). Body/icon drag to move.
- Edge: drag anywhere along the line to curve it; click (no movement) selects
  it; right-click for the full menu (line style, routing, arrowhead,
  protocol label, delete). The numbered badge itself is click-to-edit-number
  only, unrelated to bending.
- Selection actions (rename/duplicate/copy/layer/delete for nodes; line
  style/routing/arrowhead/protocol/delete for edges) live in exactly one
  place — `buildNodeMenuItems`/`buildEdgeMenuItems` in `js/canvas.js` — and
  are rendered by both the right-click context menu and the toolbar's
  "Edit ▾" button. Extend those functions, not the callers.

## Deploying

```
git push origin main
```
GitHub Pages ("deploy from branch") rebuilds automatically. **Bump the
cache-busting version first** — every `?v=` in `index.html`'s `<script>`/
`<link>` tags, plus `ASSET_VERSION` in `js/patterns.js` (must match), so
returning visitors' browsers fetch the new files instead of stale cached
ones. There's no build tool to do this for you; bump the literal strings by
hand, e.g. `sed -i '' 's/?v=2/?v=3/g' index.html` plus the matching edit in
`js/patterns.js`.

Renaming the GitHub repo (`gh repo rename`) changes the Pages URL — update the
local git remote (`git remote set-url origin ...`) to match afterward.
