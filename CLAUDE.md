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
    already calls, so it also pushes a JSON snapshot onto the `undoHistory`
    array (`pushHistory`) — no other mutator needs to know about undo.
    `undo()`/`redo()` walk `historyIndex` and restore via `restoreSnapshot()`.
    (Named `undoHistory`, not `history`, to avoid shadowing `window.history`.)
  - **Zoom**: `#canvas`'s `viewBox` stays fixed at `0 0 2400 1600`; zooming
    only changes its CSS `width`/`height` (`applyZoom()`), so the browser
    scales the coordinate system and `toSVGCoords()` (via `getScreenCTM()`)
    keeps working unchanged for every pointer-math function. `export.js`
    strips that inline style before export so exports are always full-res
    regardless of on-screen zoom.
- **`js/arrows.js`** — pure geometry, no DOM/state mutation. `computeEdgeGeometry(edge, allEdges, allNodes)`
  is the single entry point; it returns `{start, end, d, badge, labelPos, points, refs}`.
  - **Endpoints**: `computeStraightEndpoints`/`computeOrthogonalPoints` use
    `edge.fromAnchor`/`edge.toAnchor` (`{side: 'n'|'e'|'s'|'w', t: 0..1}`,
    `anchorAbsolutePoint()`) when present — set the moment a connection is
    drawn from/to a specific border point (see "free-point connections"
    below) — otherwise fall back to the original dynamic default: whichever
    border point is closest to the other node's center (`clipPointOnRect`).
    Anchors are node-relative fractions, so they track a node through
    move/resize with no extra bookkeeping.
  - **Curved routing** (`edge.routing` unset): `edge.curvePoints`, an ordered
    list of absolute `{x,y}` control points, renders as a quadratic-through-
    midpoints smooth curve (0 points = straight line, 1 = the classic single
    `Q` bend, 2+ = a multi-point curve). A lone legacy `edge.curve` (a signed
    perpendicular offset from the midpoint, pre-dating multi-point editing —
    still what `js/patterns.js`/pattern YAML mostly use) renders identically
    to a single-item `curvePoints`, and parallel same-pair edges still
    auto-separate when neither is set.
  - **Orthogonal routing** (`edge.routing === 'orthogonal'`): `edge.waypoints`
    (same shape as `curvePoints`) are the real points a right-angle route
    must pass through; `computeOrthogonalPoints` jogs between every
    consecutive pair using **one orientation decided from the overall
    start→end direction**, applied to every hop — critical: deciding
    orientation per-hop (the first attempt at this) let two adjacent jogs
    land on the same corner and made the path double back on itself.
  - **`points` vs `refs`**: `points` is the *fully rendered* polyline (used
    for the `d` string) — for orthogonal routes this includes a synthetic
    corner per hop that isn't a real waypoint. `refs` is `[start, ...editable
    points..., end]` with those synthetic corners stripped out; canvas.js's
    drag/insert/remove interaction must hit-test against `refs`, never
    `points` — using `points` there was the bug above.
  - `nearestPointIndex`/`nearestSegmentIndex` are the shared hit-testing
    helpers `startEdgeBend`/`removeNearestEdgePoint` (canvas.js) use for both
    curve and orthogonal editing — a segment's index in `refs` doubles as the
    correct `splice()` position in `edge.curvePoints`/`edge.waypoints`.
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
- **`js/export.js`** — PNG/SVG/animated-SVG/YAML export + YAML import.
  `EXPORT_STYLE` is a hand-inlined copy of every CSS rule an exported element
  depends on, because the exported file is a **standalone SVG with no access
  to `styles.css`** — anything not in `EXPORT_STYLE` silently falls back to
  SVG defaults (usually black fill). If you add a new visual element class to
  the live canvas (badges, chips, icons, whatever), it needs a matching rule
  in `EXPORT_STYLE` or it'll render wrong (or invisible) in exports
  specifically. Same reasoning for `computeContentBBox()`: it must account
  for anything that can render outside the nodes' own bounding box — it now
  widens the box using every point in `geo.points` (not just the badge), so a
  curve/orthogonal bend dragged far from either node doesn't get clipped —
  this class of bug has bitten us more than once, see the git history.
  - **Animated SVG export** (`buildAnimatedExportSVG`/`exportAnimatedSVGFile`):
    a standalone SVG that plays the same request-flow animation as the Play
    button, using native SMIL (`<animate>`/`<animateMotion>`) instead of
    `animate.js`'s `requestAnimationFrame` loop, timed from `getStepGroups()`
    (animate.js) and the current `playState.speedMs` — so it plays with zero
    JS the moment the file is opened directly in a browser tab. Plays once,
    same as Play does live; doesn't loop (looping many independently-timed
    SMIL elements in sync is a lot more machinery for little payoff here).
    SMIL (like CSS animation) doesn't run when an SVG is embedded via
    `<img>`, only when it's the top-level document or an `<object>`/`<iframe>`.
- **`js/app.js`** — palette build (+ search/filter, + collapsible category
  sections, all default-collapsed) and toolbar wiring.

## Editing model quick reference

- Node label: click the label text to rename inline (single-line `<input>`,
  or a `<textarea>` for the textOnly "Text" tool). Body/icon drag to move.
- **Free-point connections**: a node's whole border is a connector, not just
  fixed dots — `CONNECT_BORDER_ZONE` (canvas.js) decides "near enough to the
  edge to start a connection" vs "interior, so move the node" in
  `startDragOrConnect`. `borderAnchorFromLocal()` converts the exact
  pointerdown/pointerup position into a `{side, t}` anchor stored on the new
  edge (`fromAnchor`/`toAnchor`), so the arrow stays attached to that precise
  spot (see arrows.js). Containers and text-only nodes are excluded (no
  border-drag source) — connecting *to* a container/text node still works,
  it just doesn't get a fixed anchor, matching the pre-anchor dynamic default.
- Edge: drag anywhere along the line to add a bend point (curved or
  orthogonal, one or many — see `startEdgeBend`/`onEdgeBendMove` and the
  arrows.js section above), drag an existing point to move it, double-click
  a point to remove it (`removeNearestEdgePoint`). A plain click (no
  movement) selects it; right-click for the full menu (line style, routing,
  arrowhead, protocol label, "Straighten" to clear all bend points, delete).
  The numbered badge itself is click-to-edit-number only, unrelated to
  bending.
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
