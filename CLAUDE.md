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
  of `{id, category, label, icon, container?, textOnly?, imageOnly?, w?, h?}`.
  `CATEGORY_COLORS`/`CATEGORY_FILLS`/`CATEGORY_LABELS` key the 17 categories
  (Client, Edge, Network & Boundary, Services, Compute, Communication, Cache,
  Data, Processing, Reliability, Security, Observability, ML, GenAI, RAG,
  External, General). `container: true` marks boundary/grouping shapes
  (Region, AZ, VPC, Subnet, Group) that render as large dashed background
  rects. `textOnly: true` marks the freeform text tools — "Text", "Note", and
  "Paragraph" (transparent body, word-wrapped, auto-grows height — see
  `recomputeTextOnlyHeight` in `js/canvas.js`). "Paragraph" is the long-form
  one: left-aligned by default (`nodeTextAlign`), and the one whose wrap
  width is most worth setting by hand (every node is drag-resizable — see
  **Resizing** below). `defaultLabel`
  (optional) lets a component's short palette name differ from the
  placeholder text the dropped node starts with. `imageOnly: true` marks
  the freeform "Image" tool — see **Uploaded images** below.
  - **Uploaded images**: two independent features, both storing the picked
    file as a `data:` URL directly on the node (no server — same
    no-backend approach as everything else, so it's just a JSON field that
    rides along through undo/redo, autosave, and YAML export/import for
    free; the tradeoff is a large upload noticeably inflates both).
    `promptImageUpload(node, field)`/`onImageFileChosen` (canvas.js) are
    the shared plumbing for both — they set `imageUploadTarget = {node,
    field}`, then click the hidden `#image-upload-input` (index.html); its
    `change` handler reads the chosen file via `FileReader`, guarded by
    `MAX_IMAGE_BYTES` (a soft size cap, not a hard limit) and a
    `file.type.startsWith('image/')` check.
    1. **The "Image" node** (`node.imageOnly` + `node.imageSrc`) — a
       freeform picture with no icon/label split, rendered by
       `renderImageNode` as a `<clipPath>`-rounded `<image>` at
       `preserveAspectRatio="xMidYMid meet"` (contain, never crops) over an
       `.image-frame` that reuses the regular Box Color fields
       (`fillColor`/`strokeColor`) as its letterbox backdrop/border.
       Dropping the Image palette tool immediately opens the file picker
       (`onCanvasDrop`); before a file is chosen (or after right-click →
       Remove Image) it's a click-to-upload placeholder that drags as a
       plain node (no border-connect — nothing to connect yet). Once an
       image is set it behaves like a regular node: full border
       drag-to-connect via `startDragOrConnect`, double-click to replace,
       and the same eight resize handles as everything else (Shift on a
       corner keeps its proportions — it's the node type where an arbitrary
       aspect ratio matters most). `recomputeImageNodeSize` auto-fits the box's
       height to the picked image's real aspect ratio exactly once, the
       first time an image lands on a given node (`node.imageSizedOnce`),
       so replacing an image later never yanks a box the user already
       resized by hand back to a different aspect ratio.
    2. **Custom Icon** (right-click a regular component → Icon → Custom
       Icon…; the same submenu's **Hide Icon** sets `node.hideIcon`, which
       drops the glyph entirely and centers the label in the box, for
       components used as plain labelled shapes) — `node.customIcon` overrides the built-in `ICONS[n.icon]`
       stroke-SVG glyph in `renderRegularNode`'s icon slot with an
       `<image>` at the same position/size instead; everything else about
       the node (box, label, category color) is unchanged. Reset to
       Default Icon clears it.
- **`js/canvas.js`** — owns `state` (`{nodes, edges, selected, multiIds}`) and
  all rendering/interaction: drag-drop from palette, node drag/resize/rename,
  edge creation via connector handles, the right-click context menu builders
  (`buildNodeMenuItems`/`buildEdgeMenuItems`/`buildMultiSelectMenuItems` —
  also reused by the toolbar's "Edit ▾" dropdown so both stay in sync),
  copy/paste (single or multi-node, via `clipboardNodes` +
  `clipboardEdges` — the arrows whose *both* ends are in the selection ride
  along, addressed by index into `clipboardNodes` since the pasted nodes get
  fresh ids; `cloneEdgeData` deep-copies their nested waypoints/anchors/label
  offset, and paste shifts the waypoints, which are absolute coordinates,
  by the same delta as the nodes), layering
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
    section. Hold Alt to bypass both. Group drags and resizes are
    grid-snapped only (no alignment guides).
  - **Resizing**: every node kind is drag-resizable from an eight-handle
    frame (four corners + four side midpoints — `RESIZE_DIRS`/
    `appendResizeHandles`), rendered only while the node is the *single*
    selection. Handles are pushed *outward* along each side's normal
    (`resizeHandleOffset`), not centered on the outline — the border is also
    the connect surface (`CONNECT_BORDER_ZONE`, a 10px band inside the edge),
    and handles straddling the edge covered most of that band: on a stock
    150×70 node roughly 60% of the left and right edges, so nearly every
    attempt to drag out a flow arrow grabbed a resize handle instead. With
    the offset, the whole band is connect-first and the handles live in the
    halo just outside it (selection-gating keeps unselected nodes clear
    either way). If you change `RESIZE_HIT_SIZE`, re-check that: sample
    points a few px inside the border and confirm they still hit
    `.node-body`, not `.resize-hit`. `startResizeNode(ev, node,
    dir)` records the box as it was at pointerdown and recomputes from that
    origin every step (never incrementally, so snapping can't drift); `dir`
    decides which edges move, so a side handle changes one dimension only.
    Alt bypasses grid snapping, Shift on a corner locks the aspect ratio.
    Handles are marked `no-export`, so export.js's existing strip keeps them
    out of PNG/SVG output. Touch (`isCoarsePointer()`) gets the four corners
    only, at a bigger size — eight finger-sized targets would blanket the
    border, which is also the connect surface. Right-click → **Reset Size**
    (`resetNodeSize`, `*Silent` variant for multi-select) restores the
    palette default. Resizing a multi-selection as a group is deliberately
    not supported — it needs a different transform model.
    - **Manual vs. auto height**: a resize that moved the height sets
      `node.manualH`, which flips `applyFittedHeight` from "assign the
      auto-fit height" to "use the user's height, floored by what the
      wrapped text actually needs". So a hand-sized box survives later label
      and font edits (it grows rather than resetting), can go below the
      component's default height, and still can't clip its own label. Nodes
      that were never height-resized behave exactly as they did before this
      existed. `manualH` has to round-trip through YAML export/import and
      pattern files, or the load-time `refitAllNodeHeights()` pass would
      undo the sizing on the next load.
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
  - **Multi-line labels**: every node's label can hold newlines, and every
    label editor is a `<textarea>` (containers excepted — their label is one
    plain `<text>`, never wrapped). Enter's meaning differs by node family:
    on a text-first node (Text/Note/Paragraph) it inserts a line and
    Cmd/Ctrl+Enter commits; on a regular component label Enter commits and
    Shift+Enter inserts a line. Regular labels are no longer clamped and
    ellipsized at two lines — `recomputeRegularNodeHeight` grows the box
    downward to fit instead (never below the component's default height, so
    one- and two-line labels size exactly as they always did — unless the box
    was hand-resized, see **Resizing**'s `manualH` note).
    `recomputeNodeHeight` is the dispatching entry point both families share;
    `refitAllNodeHeights` runs it over a whole diagram on load, since a saved
    or hand-edited file can carry a height that no longer fits its text.
  - **Text formatting** (the `textOnly` text tools *and* regular
    component/container labels — not containers' own `container-label`):
    `TEXT_STYLE_PRESETS` (`normal`/`h1`/`h2`/`h3`/`italic`, each a
    `{fontSize, fontWeight, italic}`), `node.fontFamily`
    (`sans`/`serif`/`mono`, keys into `FONT_STACKS` — a key rather than a raw
    CSS stack, so nothing arbitrary lands in the inline style), and
    `node.textAlign` (`left`/`center`/`right`, defaulting per
    `nodeTextAlign`), plus an optional `node.textColor` hex string.
    `text-anchor` has to ride in that same inline `style`, not as a
    presentation attribute — `.node-label`'s own `text-anchor: middle` is a
    CSS rule, and a CSS rule beats a presentation attribute.
    Right-click → Text Style's radio options, Font, Align, and "Text Color…"
    (`openTextColorPanel`) set these via `setTextStyle`/`setFontFamily`/
    `setTextAlign`/`setTextColor`. `textInlineStyle(n)` renders these as an
    inline SVG `style` attribute (wins over the CSS class defaults, and
    survives `svg.cloneNode(true)` on export with no `EXPORT_STYLE` changes
    needed) — consumed by `buildTextOnlyLabel`/`recomputeTextOnlyHeight` and
    by `buildRegularLabel` (which only switches away from its small fixed
    12px/500-weight default once one of those fields is actually set, so
    a node that never touches this renders exactly as before the feature
    existed). Both fields round-trip through YAML export/import and pattern
    files.
  - **Box color**: `node.fillColor`/`node.strokeColor` (optional hex
    overrides, any node type except `textOnly`) win over the category-based
    defaults in `renderRegularNode`/`renderContainerNode` — set via
    right-click → Box Color → Fill…/Border… (`openBoxFillColorPanel`/
    `openBoxBorderColorPanel`/`setNodeFillColor`/`setNodeStrokeColor`).
    Plain SVG *attributes*, not inline `style`, deliberately — so the
    `.node.selected`/`.node.flow-active`/`.node.sim-failed` CSS class rules
    (which target `stroke`) still win over a custom color, same as the
    pre-existing category-color attributes did. `renderContainerNode` moved
    its fill/stroke off the `.container-rect` CSS class and onto the same
    per-node attribute pattern to make this possible (the class now only
    owns stroke-width/dasharray/rx).
  - **Color picker panel**: `openColorPanel({x, y, swatches, current,
    defaultColor, onPick})` is the one floating swatch-grid + custom-color
    picker shared by every "…Color…" menu action in the app (label text
    color, box fill/border, edge/arrow color, edge label color) — see
    `.color-picker-panel` in styles.css. `onPick(null)` means "clear the
    override."
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
  - **Reconnecting an endpoint** (canvas.js): a selected edge renders a small
    `.edge-endpoint-handle` circle at `geo.start`/`geo.end` (in `renderEdge`).
    Dragging one reuses the same temp-line + drop-on-a-node flow as drawing a
    brand new connection (`startEndpointDrag`/`onEndpointDragMove`/
    `onEndpointDragUp`, `findNodeAtPoint`) except it retargets this edge's
    existing `from`/`to` and re-derives `fromAnchor`/`toAnchor` from the exact
    drop point instead of creating a new edge. The *other* end's node is
    excluded as a drop target so you can't collapse an edge onto itself;
    dropping on empty space or an invalid target leaves the edge unchanged.
  - **Direct routing** (`edge.routing` unset): with no explicit bends it's a
    straight line, or a single quadratic arc when `edge.curve` (a signed
    perpendicular offset from the straight-line midpoint) is set by dragging
    the line (`computeBendFromPoint`); double-click removes it. Parallel
    same-pair edges auto-separate when `edge.curve` isn't set. Beyond that it
    takes the same ordered `edge.waypoints` list the orthogonal mode uses
    (`computeDirectWaypointed`) and runs start → every waypoint → end as a
    polyline; unanchored ends then aim at the nearest waypoint rather than at
    the other node's center. `edge.curve` and a waypoint list say the same
    thing two ways, so adding the first waypoint clears the arc.
    (Unlimited bends were tried once before and reverted, because back then
    *every drag* added one. What makes them workable now is that adding a
    bend is its own gesture — a virtual handle or a double-click — while a
    drag still only moves what's already there.)
  - **Automatic avoidance** (arrows.js, `AVOID_MARGIN`/`CHANNEL_STEP`): only
    ever applies to a route the user hasn't bent by hand — the moment an edge
    has its own `curve`/`waypoints`/elbow offsets those win outright and none
    of it runs, so it improves defaults without fighting a deliberate layout.
    Three parts:
    - *A direct edge* bows around any box it would cross
      (`autoAvoidCurveBend`): the needed clearance is doubled, since a
      quadratic's deviation peaks at half its control offset, then verified
      against the sampled curve and widened if a box near an endpoint still
      catches it. The existing same-pair fan-out separation takes priority —
      a separated arrow is already off the direct line.
    - *An orthogonal edge* first tries shifting its jog
      (`autoAvoidElbowOffset`, candidates being the obstacles' own edges,
      nearest first). When no shift can work — the classic case is a box
      sitting on the row the two nodes share, where every "Z" is the same
      straight line through it — `orthogonalDetourPath` leaves the row
      instead, exiting each box through the face pointing at the detour.
      That last part matters: an arrow that exits sideways and runs along the
      row lands on top of the row's other arrows, which is the thing being
      avoided. Dragging a corner sets an explicit elbow offset, which takes
      over and restores the plain Z.
    - *Orthogonal runs sharing a corridor* step apart by `CHANNEL_STEP`
      (`orthogonalSeparationShift`) — each edge counts the earlier edges (by
      id, a fixed order, so it never depends on render order) whose jog sits
      at the same coordinate with an overlapping span. Other edges' channels
      are read without their own detour applied: an approximation that keeps
      this pass cheap enough for drag frames. `routeObstacles` also takes a
      neighbourhood box (`routeBounds`) so each edge only tests nodes it could
      actually reach — that, not the O(edges²) corridor pass, is what keeps
      the cost flat as a diagram grows. Measured: ~2ms per full render on the
      busiest shipped pattern, ~9ms on a deliberately pathological 40-node /
      60-edge grid (6ms of which is the render itself).
    Containers and text/notes are never obstacles (`isRouteObstacle`) —
    containers are backdrops meant to be crossed, and routing around a note
    would push arrows into detours around something nobody reads as solid.
  - **Rounded corners** (`edge.rounded`, right-click → Routing): draw.io's
    `rounded=1`. `pathFromPoints` is the single `d`-string builder for every
    route, so this applies to orthogonal elbows and direct multi-bend
    polylines alike — each interior corner is cut back along both of its
    segments (never more than half of either, or two corners on a short
    segment would overlap and fold the path) and bridged with a quadratic.
  - **Orthogonal routing** (`edge.routing === 'orthogonal'`) has two modes:
    - **Default** (no `edge.waypoints`): the classic auto two-corner "Z" (or
      straight/"L" when rows or columns already align) — `computeOrthogonalDefault`,
      built on `orthogonalDefaultBase` (shared with canvas.js's elbow-drag so
      both compute the exact same base position). Each corner is
      independently adjustable — `edge.elbowOffset` near the start,
      `edge.elbowOffsetEnd` near the end (`computeOrthogonalCornerBases`
      gives canvas.js both corners' live positions so a pointerdown can pick
      whichever one it landed nearest to — `startElbowDrag` in canvas.js).
      When the two offsets are equal it's the classic single-jog Z; when they
      differ, one extra connecting jog (at the start/end midpoint on the
      cross axis) keeps the route fully orthogonal. Dragging only **moves**
      an existing corner, it never creates a new one — that still requires
      the double-click escape hatch below.
    - **Waypointed** (`edge.waypoints` non-empty): an explicit, deliberate
      escape hatch — reached only via double-click, never a plain drag — for
      routes that need more than the default pair of corners.
      `computeOrthogonalWaypointed` jogs between every consecutive pair
      using **one orientation decided from the overall start→end
      direction**, applied to every hop — important: deciding orientation
      per-hop (the first attempt at this) let two adjacent jogs land on the
      same corner and made the path double back on itself.
  - **`points` vs `refs`**: `points` is the *fully rendered* polyline (used
    for the `d` string) — for a waypointed orthogonal route this includes a
    synthetic corner per hop that isn't a real waypoint, and for the default
    Z it's 4 (or 6, once the two corners diverge) points that aren't editable
    via `edge.waypoints` at all — they come from `elbowOffset`/
    `elbowOffsetEnd` instead. `refs` is the real editable
    point list (`[start, end]` for a curve or a default-mode Z — i.e.
    nothing draggable in between; `[start, ...waypoints, end]` once
    waypointed) with those synthetic points stripped out. canvas.js's
    drag/add/remove interaction must hit-test against `refs`, never
    `points` — using `points` (or including the Z's synthetic corners in
    `refs`) was the source of two separate bugs during development.
  - `nearestPointIndex`/`nearestSegmentIndex` are the shared hit-testing
    helpers `startWaypointDrag`/`onEdgeDoubleClick` (canvas.js) use for
    waypointed-orthogonal editing — a segment's index in `refs` doubles as
    the correct `splice()` position in `edge.waypoints`.
- **`js/animate.js`** — the "Play" flow animation. Edges are grouped by
  `number`; same-numbered edges animate **concurrently** (each gets its own
  dot via `getFlowDotFor`), and the engine waits for a whole group before
  advancing — this is what lets you show fan-out/parallel steps.
- **`js/patterns.js`** — fetches and parses `patterns/*.yaml` at startup
  (`loadPatternDefinitions`, awaited before the palette/pattern-picker build
  in `js/app.js`). `PATTERN_FILES` is a hardcoded filename list (no directory
  listing on static hosting). Adding a pattern = add a YAML file here + one
  line in `PATTERN_FILES`. 24 patterns ship today (see `patterns/`), in two
  sets: the reusable architecture patterns, and the ten system-design
  interview classics (URL shortener, news feed, chat, video streaming, ride
  hailing, file storage, web crawler, notifications, rate limiter,
  typeahead) whose ids are listed in `INTERVIEW_PATTERN_IDS` (`js/app.js`) so
  the picker can group them under their own heading — with 24 entries a flat
  list buried both halves.
  - **Layout convention** (every pattern follows it, and
    `node tools/check-patterns.js` enforces it): columns at x = 60, 320, 580,
    840, 1100, 1360…, rows at y = 130, 340, 550…, everything on the canvas's
    own 10px grid. The checker reuses `yaml.js` + `arrows.js`, so it measures
    the route the canvas actually draws, and reports nodes off-grid, boxes
    that nearly-but-don't align, boxes closer than 20px, arrows crossing a
    box, and arrows crossing each other. All 24 patterns are clean; keep them
    that way rather than eyeballing a new one. Note the title label a pattern
    renders sits at `minY - 90`, so leave the band just above the first row
    free — a feedback-loop arrow routed up there collides with it (the web
    crawler's does exactly that if you hand-place waypoints instead of
    letting the auto-router handle it).
  The toolbar's Patterns ▾ button (`buildPatternPanel`/`buildPatternThumbnail` in
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
- **`js/simulate.js`** — rough latency/cost/RPS estimates, toggled from
  View ▾ ("Latency & Cost") — an optional annotation layer on the canvas
  (`#layer-sim`, `no-export` so it never shows up in exports) plus a
  structured results panel on the right (`#results-panel`/
  `#results-panel-content`, `updateSimSummary()`) — a collapsible sidebar
  mirroring the palette's own toggle pattern (`showResultsPanel` alongside
  `showPalette` in canvas.js's view-prefs bundle; `btn-results-tab`), not a
  separate mode. Turning Latency & Cost on auto-reveals the panel if it was
  collapsed; turning it off leaves the panel's own shown/hidden state alone.
  The panel is built via DOM construction (`domEl`/`buildResultRow`), not
  `innerHTML` string interpolation — node labels are free text the user
  controls, so this follows the same safe pattern as the rest of the app's
  label rendering (`textContent`/`el()`, never `innerHTML` with data baked
  in). Per-node numbers come from the `CATEGORY_DEFAULT_*` tables
  (components.js, per-category — not per-component-type, to keep ~90
  components maintainable) unless a node has its own override — right-click
  → Simulation → RPS/Latency/Cost/Variable Cost
  (`openRpsEditor`/`openLatencyEditor`/`openCostEditor`/`openVariableCostEditor`
  in canvas.js, all the same floating-`<input>` pattern as
  `openProtocolEditor`; clearing a field deletes the override). All four
  fields (`rps`/`latencyMs`/`costPerHour`/`costPer100Rps`) round-trip
  through YAML export/import and pattern files.
  - **Origins**: `computeOrigins()` — a node with no incoming edges (a
    client, cron, event source), or one whose *only* incoming edges are
    fire-and-forget (`arrowStyle: 'none'`, the convention several patterns
    use for metrics/logging side edges) — structurally downstream, but
    logically the start of its own flow since nothing upstream is waiting
    on it. Nodes with no outgoing edges don't count (not the start of
    anything). RPS and latency both key off this list — computed fresh each
    time rather than cached, since it's one pass over the graph and cheap
    at diagram scale.
  - **Latency**: `computeOriginLatencies()` — one figure **per origin**, not
    a single global number, since unrelated flows (or an async
    continuation) genuinely complete at different times. Each reuses
    `getStepGroups()` (animate.js) — the exact grouping Play uses, so
    sequential numbered steps add and concurrent (same-numbered) steps take
    the max of their branches — scoped to `reachableNodeIds(origin)`, a
    forward walk that stops at (doesn't cross) a fire-and-forget edge,
    since crossing one enters a different origin's territory. Collapses to
    a single unlabeled line in the summary when there's only one origin
    (the common case, unchanged from before this existed).
  - **RPS**: `computeNodeRps()` — only origin nodes get an RPS field;
    everyone else's is derived by walking edges in ascending `number` order
    (so upstream values are known first) and summing at fan-in points while
    broadcasting the full value to every branch of a fan-out (no
    traffic-split weights). An explicit override always wins over
    propagation. Inert (contributes nothing) until at least one node has
    RPS set — `isRpsSimActive()` gates the badge/summary RPS display.
  - **Cost**: `nodeCostPerHour(n, rpsMap)` = fixed (`nodeFixedCostPerHour`)
    + variable (`nodeVariableCostPer100Rps(n) × rps/100`). With no RPS
    configured this is exactly the fixed-only total from before RPS
    existed — strictly additive, no behavior change for diagrams that don't
    use it. `computeTotalCostPerHour()` sums every non-container, non-text
    node — independent of the flow, since cost is "what's running."
  - **Chaos/failure**: two independent, transient Sets — `simFailedNodeIds`
    (component down) and `simFailedEdgeIds` (this specific connection is
    down, both endpoints otherwise healthy — a network partition/timeout,
    not an outage). Neither is a field on the node/edge object, so neither
    ever touches saved diagram state, undo history, or YAML export, and
    both reset on reload same as Play's animation state. Both are gated
    behind `showSimAnnotations` at every entry point (the right-click menu
    items in canvas.js's `buildNodeMenuItems`/`buildEdgeMenuItems`, and
    `renderSimFailures()`) — with Latency & Cost off, the canvas is
    guaranteed to render exactly as if chaos didn't exist.
    `reachableNodeIds`/`computeOriginLatencyMs` both take these two sets as
    optional params (a node/edge simply isn't traversed), so redundancy —
    two paths in, only one cut — falls out of the ordinary graph walk with
    no bespoke "is this redundant" logic. `computeUnreachableIds()` is the
    resulting collateral-damage set (still up, nothing reaches it) that
    `renderSimFailures()` dims — kept visually distinct from a direct
    failure (solid red border/line + a red X mark, via `buildFailureMark()`)
    so cause and effect read differently at a glance. `clearDiagram()`/
    `loadDiagram()`/`restoreSnapshot()` (canvas.js) all clear both sets —
    node/edge ids get reassigned from 1 in a freshly loaded diagram, so a
    stale id could otherwise collide with an unrelated node in the new one
    (this happened during development: a stale id from a previous pattern
    landed on an unrelated node after switching patterns).

- Node label: click the label text to rename inline (single-line `<input>`,
  or a `<textarea>` for the textOnly "Text" tool). Body/icon drag to move.
  Text-first nodes (Text/Note/Paragraph) are the exception: their rename hit
  box is nearly the whole node, so the first click only *selects* — the
  editor opens on a second click (or the second half of a double-click).
  Without that, the editor's textarea covered the box the moment you clicked
  it and there was no way to grab a resize handle.
- **Free-point connections**: a node's whole border is a connector, not just
  fixed dots — `CONNECT_BORDER_ZONE` (canvas.js) decides "near enough to the
  edge to start a connection" vs "interior, so move the node" in
  `startDragOrConnect`. `borderAnchorFromLocal()` converts the exact
  pointerdown/pointerup position into a `{side, t}` anchor stored on the new
  edge (`fromAnchor`/`toAnchor`), so the arrow stays attached to that precise
  spot (see arrows.js). Containers and text-only nodes are excluded (no
  border-drag source) — connecting *to* a container/text node still works,
  it just doesn't get a fixed anchor, matching the pre-anchor dynamic default.
- Edge: dragging the line body (`startEdgeBend`, canvas.js) dispatches by
  mode to one of three handlers — bent, either routing (`startSegmentDrag`),
  default orthogonal (`startElbowDrag`, slides the Z's corners), or plain
  direct (`startCurveDrag`, bows the arc to follow the cursor). All three
  move the line under the cursor; none of them adds a bend.
  - **`startSegmentDrag`** moves the whole segment you grabbed: both of its
    ends travel together, constrained to the segment's own perpendicular on
    an orthogonal route (or the route would stop being orthogonal) and free
    on a direct one. A grab within `EDGE_POINT_GRAB_RADIUS` of a bend point
    moves just that point instead. An end segment terminates at a node, which
    can't travel, so a bend point is planted at that end first and moves in
    its place — same as draw.io dragging a connector's end segment — and a
    click that never moves takes that planted point back out, so clicking a
    line to select it can't reshape it. This replaced a version that moved
    *the nearest bend point, if the grab was within 10px of one, and did
    nothing at all otherwise*: the cursor over a line is a hand, so most of a
    bent line promised a drag and delivered nothing.
  A plain click (no movement) selects the edge; right-click for the full menu
  (line style, routing, rounded corners, arrowhead, animate flow,
  thickness/color, protocol label, label style, "Straighten" to clear every
  bend point, delete). The numbered badge itself is click-to-edit-number only,
  unrelated to bending.
  - **Handles on the selected edge** (`appendEdgeHandles`) are how bends are
    added and removed, mirroring draw.io: an endpoint handle at each end
    (retarget the edge), a solid `.edge-waypoint-handle` on every real bend
    (drag to move, double-click to remove), and a faint
    `.edge-virtual-handle` "add a bend here" dot — *one* per edge, hidden
    until the pointer comes within `EDGE_ADD_HOVER_RADIUS` of the line
    (measured against `geo.samples`, the polyline that follows the *drawn*
    path — a quadratic's control point isn't on its own curve, so the arc is
    sampled). It parks at the midpoint of the hovered segment
    (`bendCandidatePoint` in arrows.js), deliberately *not* under the pointer:
    the pointer is where a press lands, and a press on the line drags the
    segment, so a dot tracking the cursor would intercept every one of those
    presses. A single-span route has its step badge at that midpoint, so it
    offers the quarter point on the pointer's side instead. Dragging the dot
    inserts a real bend there and drags it from the first pixel
    (`startNewWaypointDrag`); a dot that's only *clicked* takes its
    speculative point back out, so a stray click never leaves a bend behind.
    One hover dot rather than a fixed dot per segment is deliberate: a
    three-bend route showed nine dots, all of them things to avoid grabbing
    by accident. The hover listeners sit on the whole edge `<g>`, not on the
    line's hit path — the dot lives inside that group, so moving onto the dot
    doesn't count as leaving the edge and can't start a show/hide flicker
    loop. It hides near a bend handle or the step badge, which paint over it.
    All the handles are `no-export`.
  - `onEdgeDoubleClick` does the same add/remove on the line itself, in both
    routing modes: on an existing bend it removes it, otherwise it adds one
    there (a direct edge's single arc is cleared first, since that's the only
    way to clear it — it has no handle of its own).
  - **Animate Flow**: `edge.animated` (bool, right-click → Arrowhead →
    Animate Flow) is a persistent marching-dash effect — pure CSS
    (`.edge-path.edge-animated` + `@keyframes edge-flow` in styles.css,
    mirrored in export.js's `EXPORT_STYLE` so it keeps animating in an
    exported standalone SVG opened in a browser), not a JS animation loop,
    so any number of edges can have it on with zero runtime cost. This is
    unrelated to the Play button's one-shot per-step dot (above) — both can
    be on at once. Always flows start→end even when `arrowStyle` is `'both'`
    (a true two-way effect needs per-edge keyframe timing for little added
    clarity — the motion already reads as "active" either way). Its
    stroke-dasharray is a CSS rule, so it deliberately overrides a
    dashed/dotted `lineStyle` (set as a plain attribute) while animated.
  - **Thickness/color**: `edge.strokeWidth` (px) and `edge.color` (hex) are
    set as inline `style.stroke`/`style.strokeWidth` on the path in
    `applyEdgeStyle` (canvas.js) — inline `style`, not an attribute, so it
    beats the `.edge-path` class default while still losing to the
    `.edge.selected`/`.edge.flow-active`/`.edge.sim-failed-edge`/
    `.edge.sim-unreachable` state rules, which use `!important` in
    styles.css specifically so highlighting still reads clearly over a
    custom color. A colored arrowhead needs its own `<marker>` (SVG can't
    recolor a shared referenced marker per-edge via CSS) — `ensureArrowheadMarker(color)`
    lazily creates and caches one per distinct color in `<defs>`, reused by
    every edge sharing that color; uncolored edges keep using the single
    shared `#arrowhead` from index.html.
  - **Label style + position**: the protocol/label chip's font size
    (`edge.labelSize`: `small`/`normal`/`large`, via `EDGE_LABEL_SIZES`),
    weight/italic (`edge.labelBold`/`edge.labelItalic`), and text color
    (`edge.labelColor`) are set via right-click → Label Style and rendered
    as an inline `style` on the chip's `<text>`; `textWidth()` (canvas.js,
    reusing the same canvas-2D measurement `wrapText` uses) sizes the chip
    rect to the actual rendered text since the font size is no longer fixed.
    Dragging the chip itself (`startLabelDrag`/`onLabelDragMove`/
    `onLabelDragUp`) repositions it by setting `edge.labelOffset {dx, dy}`,
    a signed offset applied on top of whichever default position
    `computeEdgeGeometry` would've picked (`applyLabelOffset` in arrows.js)
    — a plain click with no movement still opens the label text editor
    instead. All five fields round-trip through YAML export/import.
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
  — a static tips/shortcuts reference, click-to-open only. It used to
  auto-open once on a visitor's first load; removed deliberately (a forced
  first-visit popup is more interruption than help) in favor of the button
  always being visible plus the footer being available for the simulation
  summary instead (see `js/simulate.js` below) — `index.html`'s `<footer>`
  no longer carries static instructional text at all.

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
