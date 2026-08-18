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
- **`js/canvas.js`** — owns `state` (`{nodes, edges, selected, multiIds}`) and
  all rendering/interaction: drag-drop from palette, node drag/resize/rename,
  edge creation via connector handles, the right-click context menu builders
  (`buildNodeMenuItems`/`buildEdgeMenuItems`/`buildMultiSelectMenuItems` —
  also reused by the toolbar's "Edit ▾" dropdown so both stay in sync),
  copy/paste (single or multi-node, via `clipboardNodes`), layering
  (bring-to-front/send-to-back via array order, plus `*Silent` variants for
  bulk multi-select ops — SVG paints in document order), view prefs
  (grid/rulers/palette-drawer, persisted to `localStorage`), and the diagram
  autosave (`STORAGE_KEY`, also `localStorage`).
  - **Multi-select**: `state.multiIds` is a `Set` of node ids selected via
    shift-click (`toggleMultiSelect`) or a marquee drag on empty canvas
    (`onCanvasPointerDown`/`onMarqueeMove`/`onMarqueeUp`). `state.selected`
    stays the single-item selection and is `null` whenever `multiIds` holds
    0 or 2+ nodes. Dragging any member of a multi-selection moves the whole
    group (`startDragNode`'s `isGroupDrag` branch).
  - **Snapping**: single-node drags snap to a 10px grid, or to alignment with
    other nodes' edges/centers (drawn as `.align-guide` lines) when within
    threshold — see `computeAlignmentSnap`/`snapToGrid` in the node-dragging
    section. Hold Alt to bypass both. Group drags and container resizes are
    grid-snapped only (no alignment guides).
  - **Undo/redo**: `saveState()` is the single choke point every mutation
    already calls, so it also pushes a JSON snapshot onto the `history`
    array (`pushHistory`) — no other mutator needs to know about undo.
    `undo()`/`redo()` walk `historyIndex` and restore via `restoreSnapshot()`.
  - **Zoom**: `#canvas`'s `viewBox` stays fixed at `0 0 2400 1600`; zooming
    only changes its CSS `width`/`height` (`applyZoom()`), so the browser
    scales the coordinate system and `toSVGCoords()` (via `getScreenCTM()`)
    keeps working unchanged for every pointer-math function. `export.js`
    strips that inline style before export so exports are always full-res
    regardless of on-screen zoom.
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
  (`loadPatternDefinitions`, awaited before the palette/pattern-picker build
  in `js/app.js`). `PATTERN_FILES` is a hardcoded filename list (no directory
  listing on static hosting). Adding a pattern = add a YAML file here + one
  line in `PATTERN_FILES`. 14 patterns ship today (see `patterns/`); the
  toolbar's Patterns ▾ button (`buildPatternPanel`/`buildPatternThumbnail` in
  `js/app.js`) renders each as a small colored-rect thumbnail generated
  straight from the pattern's node positions — no extra per-pattern asset
  needed.
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
  place — `buildNodeMenuItems`/`buildEdgeMenuItems`/`buildMultiSelectMenuItems`
  in `js/canvas.js` — and are rendered by both the right-click context menu
  and the toolbar's "Edit ▾" button. Extend those functions, not the callers.
- Multi-select: shift-click a node to add/remove it from the selection, or
  drag from empty canvas for a marquee box (shift-drag adds to the existing
  set). ⌘A selects all. Delete/duplicate/copy/layer act on the whole group;
  dragging any selected node moves all of them together.
- Undo/redo (⌘Z / ⌘⇧Z), arrow-key nudge (1px, 10px with Shift), and
  Ctrl/⌘+scroll zoom are all global, not tied to any one element.

## Onboarding surfaces

Three UI surfaces exist purely to help a first-time user, independent of the
diagram data model — worth knowing about before assuming the canvas is the
only thing that needs updating for a UX change:

- **Empty-canvas placeholder** (`#empty-state` in `index.html`, toggled in
  `renderAll()`) — shown whenever `state.nodes` is empty, with quick-start
  buttons for `QUICK_START_PATTERN_IDS` (`js/app.js`).
- **Palette empty-search message** (`#palette-empty`) — toggled in
  `filterPalette()` when a search matches nothing.
- **Help panel** (`?` button, `js/app.js`'s `buildHelpPanel`/`toggleHelpPanel`)
  — a static tips/shortcuts reference, auto-opened once on a visitor's first
  load (`HELP_SEEN_KEY` in `localStorage`), reopenable anytime from the
  toolbar.

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
