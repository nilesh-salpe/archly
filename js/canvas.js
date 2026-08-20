// Canvas engine: owns diagram state and all SVG rendering / drag-drop /
// selection / editing interactions. Everything lives in one <svg> so export
// (export.js) can serialize the whole diagram directly.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'cad_diagram_v1';

const DEFAULT_NODE_W = 150;
const DEFAULT_NODE_H = 70;
// Generously large but still a bounded, native-scrollbar-panned world (not a
// true unbounded/infinite canvas) — see CLAUDE.md's zoom/pan architecture
// note. No real diagram gets remotely close to filling this.
const CANVAS_W = 20000;
const CANVAS_H = 20000;

const state = {
  nodes: [], // {id, type, category, label, x, y, w, h, container, icon}
  edges: [], // {id, from, to, number}
  nextNodeId: 1,
  nextEdgeId: 1,
  selected: null, // {kind:'node'|'edge', id} — the "primary" selection; null when multiIds holds 0 or 2+ nodes
  multiIds: new Set(), // node ids selected together via shift-click or marquee drag
};

let svg, layerContainers, layerEdges, layerNodes, layerOverlay;
let canvasWrap, canvasScroll, rulerH, rulerV, toolbarBar, brandCorner, zoomBar;

function initCanvas() {
  svg = document.getElementById('canvas');
  layerContainers = document.getElementById('layer-containers');
  layerEdges = document.getElementById('layer-edges');
  layerNodes = document.getElementById('layer-nodes');
  layerOverlay = document.getElementById('layer-overlay');

  canvasWrap = document.getElementById('canvas-wrap');
  canvasScroll = document.getElementById('canvas-scroll');
  rulerH = document.getElementById('ruler-h');
  rulerV = document.getElementById('ruler-v');

  toolbarBar = document.getElementById('toolbar-bar');
  brandCorner = document.getElementById('brand-corner');
  zoomBar = document.querySelector('.tb-zoom');
  window.addEventListener('resize', syncToolbarClearance);

  canvasWrap.addEventListener('dragover', onCanvasDragOver);
  canvasWrap.addEventListener('drop', onCanvasDrop);
  document.getElementById('image-upload-input').addEventListener('change', onImageFileChosen);
  canvasWrap.addEventListener('pointerdown', onCanvasPointerDown);
  canvasWrap.addEventListener('click', onCanvasClick);
  canvasWrap.addEventListener('contextmenu', onCanvasContextMenu);
  canvasScroll.addEventListener('scroll', updateRulers);
  canvasScroll.addEventListener('wheel', onCanvasWheel, { passive: false });
  window.addEventListener('resize', updateRulers);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('click', () => {
    hideContextMenu();
    hidePatternPanel();
    hideHelpPanel();
    hideColorPanel();
  });

  loadState();
  loadPrefs();
  loadSimPrefs();
  applyViewPrefs();
  applyZoom();
  renderAll();
  pushHistory(); // establish the undo floor at the state we just loaded
}

function domEl(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function el(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const k in attrs) node.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function toSVGCoords(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// ---------- Node CRUD ----------

function addNode(componentId, cx, cy) {
  const def = getComponent(componentId);
  if (!def) return;
  const w = def.w || DEFAULT_NODE_W;
  const h = def.h || DEFAULT_NODE_H;
  const node = {
    id: state.nextNodeId++,
    type: def.id,
    category: def.category,
    label: def.label,
    icon: def.icon,
    container: !!def.container,
    textOnly: !!def.textOnly,
    imageOnly: !!def.imageOnly,
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
  };
  state.nodes.push(node);
  renderAll();
  saveState();
  return node;
}

function removeNode(nodeId) {
  const removedEdgeIds = state.edges.filter((e) => e.from === nodeId || e.to === nodeId).map((e) => e.id);
  state.nodes = state.nodes.filter((n) => n.id !== nodeId);
  state.edges = state.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  simFailedNodeIds.delete(nodeId);
  for (const id of removedEdgeIds) simFailedEdgeIds.delete(id);
}

function removeEdge(edgeId) {
  state.edges = state.edges.filter((e) => e.id !== edgeId);
  simFailedEdgeIds.delete(edgeId);
}

// ---------- Image upload ----------
// Uploaded images (the standalone "Image" node's imageOnly picture, and a
// regular component's custom icon override) are stored as data: URLs
// directly on the node — no server, matching the rest of the app's
// no-backend design. That means they travel through undo/redo, autosave,
// and YAML export/import for free (plain JSON fields), but also that a
// large file inflates localStorage/YAML noticeably — MAX_IMAGE_BYTES below
// is a soft guard against that, not a hard technical limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Set right before the hidden #image-upload-input is clicked, read (and
// cleared) by onImageFileChosen once the browser's file picker resolves —
// there's only ever one upload in flight at a time, so a single module-level
// slot is enough (same pattern as dragCtx/resizeCtx for other single-flight
// interactions).
let imageUploadTarget = null;

function promptImageUpload(node, field) {
  imageUploadTarget = { node, field };
  document.getElementById('image-upload-input').click();
}

function onImageFileChosen(ev) {
  const target = imageUploadTarget;
  imageUploadTarget = null;
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // clear so picking the same file again still fires 'change'
  if (!file || !target) return;
  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    alert(`That image is too large (${Math.round(file.size / 1024 / 1024)}MB) — please choose one under ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    target.node[target.field] = reader.result;
    if (target.field === 'imageSrc') recomputeImageNodeSize(target.node, reader.result);
    renderAll();
    saveState();
  };
  reader.onerror = () => alert('Could not read that image file.');
  reader.readAsDataURL(file);
}

// A freshly-placed Image node starts at the palette's generic 220×150
// default, which rarely matches the picked photo's own aspect ratio —
// re-fit its height (width stays put, so it doesn't suddenly outgrow
// wherever the user dropped it) once the actual image dimensions are known.
// Only runs the first time an image is set on a node with no prior image,
// so replacing an existing image never resizes a box the user already
// adjusted by hand.
function recomputeImageNodeSize(node, dataUrl) {
  if (node.imageSizedOnce) return;
  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalWidth > 0) {
      node.h = Math.max(60, Math.round(node.w * (probe.naturalHeight / probe.naturalWidth)));
    }
    node.imageSizedOnce = true;
    renderAll();
    saveState();
  };
  probe.src = dataUrl;
}

function nodeById(id) {
  return state.nodes.find((n) => n.id === id);
}

function clearDiagram() {
  resetFlow();
  state.nodes = [];
  state.edges = [];
  state.nextNodeId = 1;
  state.nextEdgeId = 1;
  state.selected = null;
  state.multiIds.clear();
  simFailedNodeIds.clear(); // ids get reused from 1 in the next diagram — a stale id could collide
  simFailedEdgeIds.clear();
  renderAll();
  saveState();
}

function loadDiagram(nodes, edges, nextNodeId, nextEdgeId) {
  resetFlow();
  state.nodes = nodes;
  state.edges = edges;
  state.nextNodeId = nextNodeId;
  state.nextEdgeId = nextEdgeId;
  state.selected = null;
  state.multiIds.clear();
  simFailedNodeIds.clear(); // ids get reused from 1 in the next diagram — a stale id could collide
  simFailedEdgeIds.clear();
  renderAll();
  saveState();
}

// ---------- Persistence ----------

function diagramSnapshotJSON() {
  return JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    nextNodeId: state.nextNodeId,
    nextEdgeId: state.nextEdgeId,
  });
}

// saveState() is called at every point a diagram edit commits (drag-end,
// rename-commit, menu actions, pattern load, etc.) — never mid-drag — so
// hooking undo history here gives every commit point a history entry for
// free, instead of sprinkling pushHistory() calls through every mutator.
function saveState() {
  const json = diagramSnapshotJSON();
  pushHistory(json);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    /* storage unavailable — ignore */
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.nodes = data.nodes || [];
    state.edges = data.edges || [];
    state.nextNodeId = data.nextNodeId || 1;
    state.nextEdgeId = data.nextEdgeId || 1;
  } catch (e) {
    /* corrupt storage — start fresh */
  }
}

// ---------- Undo / redo ----------
// A linear history of full diagram snapshots (JSON strings, cheap to diff
// with === for the no-op check below). historyIndex points at the entry
// matching the diagram's current on-screen state.

const HISTORY_LIMIT = 100;
let undoHistory = [];
let historyIndex = -1;

function pushHistory(json) {
  const snap = json || diagramSnapshotJSON();
  if (historyIndex >= 0 && undoHistory[historyIndex] === snap) return; // nothing actually changed
  undoHistory = undoHistory.slice(0, historyIndex + 1);
  undoHistory.push(snap);
  if (undoHistory.length > HISTORY_LIMIT) undoHistory.shift();
  historyIndex = undoHistory.length - 1;
  updateUndoRedoButtons();
}

function restoreSnapshot(json) {
  const data = JSON.parse(json);
  resetFlow();
  state.nodes = data.nodes;
  state.edges = data.edges;
  state.nextNodeId = data.nextNodeId;
  state.nextEdgeId = data.nextEdgeId;
  state.selected = null;
  state.multiIds.clear();
  simFailedNodeIds.clear(); // ids can be reassigned across undo/redo steps — a stale id could collide
  simFailedEdgeIds.clear();
  renderAll();
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    /* ignore */
  }
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreSnapshot(undoHistory[historyIndex]);
  updateUndoRedoButtons();
}

function redo() {
  if (historyIndex >= undoHistory.length - 1) return;
  historyIndex++;
  restoreSnapshot(undoHistory[historyIndex]);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  setBtnDisabled('btn-undo', historyIndex <= 0);
  setBtnDisabled('btn-redo', historyIndex >= undoHistory.length - 1);
}

// ---------- View preferences (grid background / rulers) ----------

const PREFS_KEY = 'cad_prefs_v1';
let showGrid = true;
let showRulers = false;
// Both panels are on-demand flyouts (opened from the toolbar's hamburger/
// results icons), not docked-open-by-default drawers — see CLAUDE.md.
let showPalette = false;
let showResultsPanel = false;
let toolbarPosition = 'top'; // 'top' | 'bottom' — flipped via the toolbar's ⇅ button

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.showGrid === 'boolean') showGrid = p.showGrid;
    if (typeof p.showRulers === 'boolean') showRulers = p.showRulers;
    if (typeof p.showPalette === 'boolean') showPalette = p.showPalette;
    if (typeof p.showResultsPanel === 'boolean') showResultsPanel = p.showResultsPanel;
    if (p.toolbarPosition === 'top' || p.toolbarPosition === 'bottom') toolbarPosition = p.toolbarPosition;
  } catch (e) {
    /* ignore */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ showGrid, showRulers, showPalette, showResultsPanel, toolbarPosition }));
  } catch (e) {
    /* ignore */
  }
}

function applyViewPrefs() {
  canvasWrap.classList.toggle('no-grid', !showGrid);
  canvasWrap.classList.toggle('rulers-on', showRulers);
  const paletteEl = document.getElementById('palette');
  if (paletteEl) paletteEl.classList.toggle('palette-hidden', !showPalette);
  const paletteToggleBtn = document.getElementById('btn-palette-toggle');
  if (paletteToggleBtn) paletteToggleBtn.classList.toggle('active', showPalette);
  const resultsEl = document.getElementById('results-panel');
  if (resultsEl) resultsEl.classList.toggle('results-hidden', !showResultsPanel);
  const resultsToggleBtn = document.getElementById('btn-results-toggle');
  if (resultsToggleBtn) resultsToggleBtn.classList.toggle('active', showResultsPanel);
  document.body.setAttribute('data-toolbar-pos', toolbarPosition);
  const posBtn = document.getElementById('btn-bar-position');
  const posLabel = document.getElementById('bar-position-label');
  const movesTo = toolbarPosition === 'top' ? 'bottom' : 'top';
  if (posBtn) posBtn.setAttribute('aria-label', `Move toolbar to ${movesTo}`);
  if (posLabel) posLabel.textContent = movesTo === 'bottom' ? 'Bottom' : 'Top';
  syncToolbarClearance();
  updateRulers();
}

// The toolbar can still be taller than one line's worth on a very narrow
// window (it scrolls horizontally rather than wrapping — see
// flex-wrap:nowrap on .toolbar-bar — but padding/border still contribute),
// so the palette/results panel clearance (--toolbar-clearance etc.,
// styles.css) is measured from the real elements instead of a guessed fixed
// pixel value. The brand corner and zoom strip are fixed to the top-left/
// bottom-left corners independent of the toolbar's own position, so they
// get their own clearance vars rather than folding into --toolbar-clearance.
function syncToolbarClearance() {
  const setClearance = (name, el) => {
    if (!el) return;
    const clearance = Math.ceil(el.getBoundingClientRect().height) + 20;
    document.documentElement.style.setProperty(name, `${clearance}px`);
  };
  setClearance('--toolbar-clearance', toolbarBar);
  setClearance('--brand-clearance', brandCorner);
  setClearance('--zoombar-clearance', zoomBar);
}

function toggleGrid() {
  showGrid = !showGrid;
  applyViewPrefs();
  savePrefs();
}

function toggleRulers() {
  showRulers = !showRulers;
  applyViewPrefs();
  savePrefs();
}

function togglePalette() {
  showPalette = !showPalette;
  applyViewPrefs();
  savePrefs();
}

function toggleResultsPanel() {
  showResultsPanel = !showResultsPanel;
  applyViewPrefs();
  savePrefs();
}

function toggleToolbarPosition() {
  toolbarPosition = toolbarPosition === 'top' ? 'bottom' : 'top';
  applyViewPrefs();
  savePrefs();
}

function updateRulers() {
  if (!showRulers || !canvasScroll) return;
  const sx = canvasScroll.scrollLeft;
  const sy = canvasScroll.scrollTop;
  const w = canvasScroll.clientWidth;
  const h = canvasScroll.clientHeight;
  // Ticks are spaced every 100 *diagram* units, so under zoom the on-screen
  // gap between them shrinks/grows with zoomLevel while the printed number
  // stays the true diagram coordinate.
  const step = 100 * zoomLevel;

  rulerH.innerHTML = '';
  for (let x = Math.floor(sx / step) * step; x <= sx + w; x += step) {
    const line = domEl('div', 'ruler-tick-line');
    line.style.left = `${x - sx}px`;
    rulerH.appendChild(line);
    const tick = domEl('div', 'ruler-tick');
    tick.style.left = `${x - sx}px`;
    tick.textContent = Math.round(x / zoomLevel);
    rulerH.appendChild(tick);
  }

  rulerV.innerHTML = '';
  for (let y = Math.floor(sy / step) * step; y <= sy + h; y += step) {
    const line = domEl('div', 'ruler-tick-line');
    line.style.top = `${y - sy}px`;
    rulerV.appendChild(line);
    const tick = domEl('div', 'ruler-tick');
    tick.style.top = `${y - sy}px`;
    tick.textContent = Math.round(y / zoomLevel);
    rulerV.appendChild(tick);
  }
}

// ---------- Zoom ----------
// The SVG's viewBox stays fixed at "0 0 CANVAS_W CANVAS_H"; zooming changes
// only the element's rendered CSS size, so the browser scales the whole
// coordinate system for us. toSVGCoords() (via getScreenCTM()) already
// accounts for that automatically, so every pointer-math function below
// (drag, connect, resize, bend, marquee) needs no zoom-awareness of its own.

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
let zoomLevel = 1;

function applyZoom() {
  svg.style.width = `${CANVAS_W * zoomLevel}px`;
  svg.style.height = `${CANVAS_H * zoomLevel}px`;
  const label = document.getElementById('zoom-label');
  if (label) label.textContent = `${Math.round(zoomLevel * 100)}%`;
  updateRulers();
}

// Keeps the point under `anchorClient` (or the viewport center, if omitted)
// stable on screen while the zoom level changes, so scroll-to-zoom feels
// anchored at the cursor instead of jumping to the top-left.
function setZoom(z, anchorClient) {
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  if (Math.abs(newZoom - zoomLevel) < 0.001) return;
  const rect = canvasScroll.getBoundingClientRect();
  const cx = anchorClient ? anchorClient.x - rect.left : canvasScroll.clientWidth / 2;
  const cy = anchorClient ? anchorClient.y - rect.top : canvasScroll.clientHeight / 2;
  const svgX = (canvasScroll.scrollLeft + cx) / zoomLevel;
  const svgY = (canvasScroll.scrollTop + cy) / zoomLevel;
  zoomLevel = newZoom;
  applyZoom();
  canvasScroll.scrollLeft = svgX * zoomLevel - cx;
  canvasScroll.scrollTop = svgY * zoomLevel - cy;
}

function zoomIn() { setZoom(zoomLevel + ZOOM_STEP); }
function zoomOut() { setZoom(zoomLevel - ZOOM_STEP); }
function zoomReset() { setZoom(1); }

function zoomToFit() {
  if (!state.nodes.length) { zoomReset(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = 60;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(canvasScroll.clientWidth / w, canvasScroll.clientHeight / h)));
  zoomLevel = z;
  applyZoom();
  canvasScroll.scrollLeft = (minX - pad) * z;
  canvasScroll.scrollTop = (minY - pad) * z;
}

function onCanvasWheel(ev) {
  if (!(ev.ctrlKey || ev.metaKey)) return; // plain scroll/trackpad pan is untouched
  ev.preventDefault();
  setZoom(zoomLevel + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), { x: ev.clientX, y: ev.clientY });
}

// ---------- Rendering ----------

function renderAll() {
  layerContainers.innerHTML = '';
  layerEdges.innerHTML = '';
  layerNodes.innerHTML = '';

  for (const n of state.nodes) {
    if (n.container) layerContainers.appendChild(renderContainerNode(n));
  }
  for (const e of state.edges) {
    const g = renderEdge(e);
    if (g) layerEdges.appendChild(g);
  }
  for (const n of state.nodes) {
    if (n.container) continue;
    layerNodes.appendChild(n.imageOnly ? renderImageNode(n) : renderRegularNode(n));
  }

  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = state.nodes.length === 0 ? 'flex' : 'none';

  renderSimAnnotations();
  renderSimFailures();
  updateSimSummary();
  updateToolbarState();
}

function updateToolbarState() {
  // Edit ▾ shows a node/edge menu when something's selected, or just Paste
  // when there's clipboard content to offer — disabled only when neither applies.
  const hasClipboard = clipboardNodes && clipboardNodes.length > 0;
  setBtnDisabled('btn-edit', !state.selected && !state.multiIds.size && !hasClipboard);
}

function setBtnDisabled(id, disabled) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = disabled;
}

function isNodeSelected(id) {
  return (state.selected && state.selected.kind === 'node' && state.selected.id === id) || state.multiIds.has(id);
}

function renderContainerNode(n) {
  const g = el('g', { class: 'node container-node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (isNodeSelected(n.id)) g.classList.add('selected');

  const rect = el('rect', {
    class: 'container-rect',
    x: 0,
    y: 0,
    width: n.w,
    height: n.h,
    rx: 10,
    fill: n.fillColor || 'rgba(148, 163, 184, 0.06)',
    stroke: n.strokeColor || '#94a3b8',
  });
  const label = el('text', { class: 'container-label', x: 10, y: 20 }, textNode(n.label));
  const labelHit = el('rect', { class: 'label-hit', x: 4, y: 4, width: Math.min(n.w - 8, 220), height: 22 });

  const resize = el('rect', {
    class: 'resize-handle',
    x: n.w - 10,
    y: n.h - 10,
    width: 10,
    height: 10,
  });

  g.appendChild(rect);
  g.appendChild(label);
  g.appendChild(labelHit);
  g.appendChild(resize);

  rect.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
  resize.addEventListener('pointerdown', (ev) => startResizeNode(ev, n));
  labelHit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openRename(n);
  });
  g.addEventListener('click', (ev) => onNodeClick(ev, n));
  g.addEventListener('contextmenu', (ev) => onNodeContextMenu(ev, n));

  return g;
}

// ---------- Label text wrapping ----------
// SVG has no native text-wrap, so labels that don't fit their box are
// word-wrapped (falling back to a hard character break for a single
// over-long word) using a canvas 2D context for accurate width measurement.

let measureCtx = null;

function fontString(fontSize, fontWeight) {
  return `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

// Used to size the edge protocol/label chip to its actual text (labelStyle
// controls make its font size/weight variable, so the old fixed per-char
// estimate no longer holds).
function textWidth(str, fontSize, fontWeight) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontString(fontSize, fontWeight);
  return measureCtx.measureText(str).width;
}

function wrapText(text, maxWidth, fontSize, fontWeight) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontString(fontSize, fontWeight);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current && measureCtx.measureText(word).width > maxWidth) {
      // A single word longer than the box — hard-break it by character.
      let piece = '';
      for (const ch of word) {
        if (piece && measureCtx.measureText(piece + ch).width > maxWidth) {
          lines.push(piece);
          piece = ch;
        } else {
          piece += ch;
        }
      }
      current = piece;
      continue;
    }
    const test = current ? `${current} ${word}` : word;
    if (measureCtx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Wraps then clamps to maxLines, ellipsizing the last visible line — used for
// icon+label cards, which have a fixed height and can't grow with content.
function wrapClamped(text, maxWidth, maxLines, fontSize, fontWeight) {
  const lines = wrapText(text, maxWidth, fontSize, fontWeight);
  if (lines.length <= maxLines) return lines;
  const clamped = lines.slice(0, maxLines);
  let last = clamped[maxLines - 1];
  while (last.length > 0 && measureCtx.measureText(last + '…').width > maxWidth) {
    last = last.slice(0, -1);
  }
  clamped[maxLines - 1] = last + '…';
  return clamped;
}

// Label text style/color (right-click a node → Text Style). Shared by the
// freeform "Text" tool (n.textOnly, always styled) and regular component
// labels (buildRegularLabel — only switches away from the small fixed
// default once textStyle/textColor is actually set, so a diagram that never
// touches this renders identically to before it existed). Applied as an
// inline `style` attribute (not a CSS class) so it wins over the
// .node-label/.text-node-label defaults and — since inline styles travel
// with a cloned element — needs no EXPORT_STYLE changes to render correctly
// in exports.
const TEXT_STYLE_PRESETS = {
  normal: { fontSize: 16, fontWeight: 600, italic: false },
  h1: { fontSize: 28, fontWeight: 700, italic: false },
  h2: { fontSize: 22, fontWeight: 700, italic: false },
  h3: { fontSize: 18, fontWeight: 600, italic: false },
  italic: { fontSize: 16, fontWeight: 600, italic: true },
};
const TEXT_STYLE_LABELS = {
  normal: 'Normal',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  italic: 'Italic',
};
const TEXT_COLOR_SWATCHES = [
  '#1e293b', '#64748b', '#dc2626', '#ea580c', '#d97706',
  '#65a30d', '#059669', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777',
];
// Pastel palette for node box fill (right-click → Box Color… → Fill…) — kept
// visually distinct from TEXT_COLOR_SWATCHES above (those are saturated, for
// readable text; these are light, so a dark label/icon stays legible on top).
const BOX_FILL_SWATCHES = [
  '#e2e8f0', '#fee2e2', '#ffedd5', '#fef3c7', '#ecfccb', '#d9f99d',
  '#d1fae5', '#cffafe', '#dbeafe', '#e0e7ff', '#ede9fe', '#fae8ff',
];
// Saturated palette for node box border and edge/arrow color — same family
// as TEXT_COLOR_SWATCHES so borders/arrows/text share one consistent set of
// pickable colors across the app.
const LINE_COLOR_SWATCHES = TEXT_COLOR_SWATCHES;

function textStylePreset(n) {
  return TEXT_STYLE_PRESETS[n.textStyle] || TEXT_STYLE_PRESETS.normal;
}

function textInlineStyle(n) {
  const preset = textStylePreset(n);
  let style = `font-size:${preset.fontSize}px;font-weight:${preset.fontWeight};`;
  if (preset.italic) style += 'font-style:italic;';
  if (n.textColor) style += `fill:${n.textColor};`;
  return style;
}

function buildMultilineText(cls, cx, lastLineY, lines, lineHeight) {
  const startY = lastLineY - (lines.length - 1) * lineHeight;
  const text = el('text', { class: cls, x: cx, y: startY });
  lines.forEach((line, i) => {
    text.appendChild(el('tspan', { x: cx, dy: i === 0 ? 0 : lineHeight }, textNode(line)));
  });
  return text;
}

function buildRegularLabel(n) {
  // Text Style/Color (right-click → Text Style) reuse the freeform Text
  // tool's textStyle/textColor fields — default font-size/weight (12/500)
  // and fixed 13px line height are unchanged from before this existed, so a
  // node that never touches the feature renders identically.
  const hasTextOverride = !!(n.textStyle || n.textColor);
  const preset = hasTextOverride ? textStylePreset(n) : { fontSize: 12, fontWeight: 500 };
  const lineHeight = hasTextOverride ? Math.round(preset.fontSize * 1.2) : 13;
  const lines = wrapClamped(n.label, n.w - 16, 2, preset.fontSize, preset.fontWeight);
  const textEl = buildMultilineText('node-label', n.w / 2, n.h - 12, lines, lineHeight);
  if (hasTextOverride) textEl.setAttribute('style', textInlineStyle(n));
  return textEl;
}

function buildTextOnlyLabel(n) {
  const preset = textStylePreset(n);
  const lines = wrapText(n.label, n.w - 16, preset.fontSize, preset.fontWeight);
  const lineHeight = Math.round(preset.fontSize * 1.25);
  const lastLineY = n.h / 2 + preset.fontSize * 0.3 + ((lines.length - 1) * lineHeight) / 2;
  const textEl = buildMultilineText('node-label text-node-label', n.w / 2, lastLineY, lines, lineHeight);
  textEl.setAttribute('style', textInlineStyle(n));
  return textEl;
}

// Text-only nodes have no manual resize handle, so their box grows to fit
// wrapped content instead — called whenever a text-only node's label or
// text style changes (font size affects both wrapping and line height).
function recomputeTextOnlyHeight(n) {
  if (!n.textOnly) return;
  const preset = textStylePreset(n);
  const lines = wrapText(n.label, n.w - 16, preset.fontSize, preset.fontWeight);
  const lineHeight = Math.round(preset.fontSize * 1.25);
  n.h = Math.max(44, lines.length * lineHeight + 20);
}

function renderRegularNode(n) {
  const g = el('g', { class: 'node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (isNodeSelected(n.id)) g.classList.add('selected');
  if (n.textOnly) g.classList.add('text-node');

  // Note gets its own sticky-note color regardless of category, and Text is
  // a borderless label (invisible hit-area rect kept for drag/select).
  const isNote = n.type === 'note';
  const fill = n.textOnly ? 'transparent' : n.fillColor || (isNote ? '#fef9c3' : CATEGORY_FILLS[n.category] || '#e2e8f0');
  const stroke = n.textOnly ? 'none' : n.strokeColor || (isNote ? '#ca8a04' : CATEGORY_COLORS[n.category] || '#64748b');

  const body = el('rect', {
    class: 'node-body',
    x: 0,
    y: 0,
    width: n.w,
    height: n.h,
    rx: 10,
    fill,
    stroke,
  });

  // Custom Icon (right-click → Icon → Custom Icon…) swaps the built-in
  // stroke-SVG glyph for an uploaded image in the same slot — a plain <image>
  // sized to the icon box rather than the 24-unit-viewBox scale trick the
  // built-in icons use, since an uploaded image has no fixed internal grid.
  let iconG = null;
  if (!n.textOnly) {
    const iconSize = 26;
    if (n.customIcon) {
      iconG = el('image', {
        class: 'node-custom-icon',
        x: n.w / 2 - iconSize / 2,
        y: 8,
        width: iconSize,
        height: iconSize,
        href: n.customIcon,
        preserveAspectRatio: 'xMidYMid meet',
      });
    } else {
      iconG = el('g', { class: 'node-icon', transform: `translate(${n.w / 2 - iconSize / 2},8) scale(${iconSize / 24})` });
      iconG.innerHTML = ICONS[n.icon] || '';
    }
  }

  const label = n.textOnly ? buildTextOnlyLabel(n) : buildRegularLabel(n);

  // Text hit-testing in SVG only registers clicks on painted glyph ink, not
  // the full label area, so an invisible rect is the reliable click target
  // for rename. It sits in the bottom band for icon+label nodes (leaving the
  // icon/upper body free to drag), or nearly the whole box for text-only
  // nodes (leaving a thin border to grab for dragging).
  const labelHit = n.textOnly
    ? el('rect', { class: 'label-hit', x: 4, y: 4, width: n.w - 8, height: n.h - 8 })
    : el('rect', { class: 'label-hit', x: 2, y: n.h - 24, width: n.w - 4, height: 20 });

  g.appendChild(body);
  if (iconG) g.appendChild(iconG);
  g.appendChild(label);
  g.appendChild(labelHit);

  body.addEventListener('pointerdown', (ev) => startDragOrConnect(ev, n));
  body.addEventListener('pointermove', (ev) => updateBorderCursor(ev, n, body));
  body.addEventListener('pointerleave', () => { body.style.cursor = ''; });
  labelHit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openRename(n);
  });
  g.addEventListener('click', (ev) => onNodeClick(ev, n));
  g.addEventListener('contextmenu', (ev) => onNodeContextMenu(ev, n));

  return g;
}

// The freeform "Image" tool — an uploaded picture (node.imageSrc, a data:
// URL) with no icon/label split, just a frame. `preserveAspectRatio="xMidYMid
// meet"` (contain, not crop) so an arbitrary upload never loses content;
// n.fillColor (Box Color → Fill…, same field regular nodes use) shows as the
// letterbox backdrop when the image's aspect ratio doesn't match the box's.
// Before an image is picked (or after Remove Image) it's a click-to-upload
// placeholder — that state deliberately skips border-drag-to-connect (there's
// nothing yet to connect a flow arrow to) and uses plain node dragging
// instead, same as a container/text-only node.
function renderImageNode(n) {
  const g = el('g', { class: 'node image-node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (isNodeSelected(n.id)) g.classList.add('selected');

  const hasImage = !!n.imageSrc;
  const fill = n.fillColor || CATEGORY_FILLS[n.category] || '#f8fafc';
  const stroke = n.strokeColor || CATEGORY_COLORS[n.category] || '#94a3b8';
  const frame = el('rect', { class: 'image-frame', x: 0, y: 0, width: n.w, height: n.h, rx: 8, fill, stroke });
  g.appendChild(frame);

  if (hasImage) {
    const clipId = `image-clip-${n.id}`;
    const clip = el('clipPath', { id: clipId });
    clip.appendChild(el('rect', { x: 0, y: 0, width: n.w, height: n.h, rx: 8 }));
    g.appendChild(clip);
    // pointer-events: none — the picture sits directly on top of `frame` in
    // paint order, and without this it silently swallows every pointerdown
    // (drag/connect/resize all wired on `frame`, not here) since sibling
    // elements don't bubble into each other. Same reasoning as
    // .node-custom-icon below.
    g.appendChild(el('image', {
      x: 0,
      y: 0,
      width: n.w,
      height: n.h,
      href: n.imageSrc,
      preserveAspectRatio: 'xMidYMid meet',
      'clip-path': `url(#${clipId})`,
      style: 'pointer-events: none;',
    }));
  } else {
    const iconSize = 28;
    const iconG = el('g', { class: 'node-icon', transform: `translate(${n.w / 2 - iconSize / 2},${n.h / 2 - iconSize / 2 - 10}) scale(${iconSize / 24})` });
    iconG.innerHTML = ICONS.image || '';
    g.appendChild(iconG);
    g.appendChild(el('text', { class: 'image-placeholder-label', x: n.w / 2, y: n.h / 2 + 24 }, textNode('Click to add image')));
  }

  const resize = el('rect', { class: 'resize-handle', x: n.w - 10, y: n.h - 10, width: 10, height: 10 });
  g.appendChild(resize);

  if (hasImage) {
    frame.addEventListener('pointerdown', (ev) => startDragOrConnect(ev, n));
    frame.addEventListener('pointermove', (ev) => updateBorderCursor(ev, n, frame));
    frame.addEventListener('pointerleave', () => { frame.style.cursor = ''; });
    frame.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      promptImageUpload(n, 'imageSrc');
    });
  } else {
    frame.style.cursor = 'pointer';
    frame.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
    frame.addEventListener('click', (ev) => {
      ev.stopPropagation();
      promptImageUpload(n, 'imageSrc');
    });
  }
  resize.addEventListener('pointerdown', (ev) => startResizeNode(ev, n));
  g.addEventListener('click', (ev) => onNodeClick(ev, n));
  g.addEventListener('contextmenu', (ev) => onNodeContextMenu(ev, n));

  return g;
}

function openLabelEditor(node, labelEl) {
  const rect = labelEl.getBoundingClientRect();
  const multiline = !!node.textOnly;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.className = 'name-editor' + (multiline ? ' name-editor-multiline' : '');
  input.value = node.label;
  input.style.left = `${rect.left - 6}px`;
  input.style.top = `${rect.top - 4}px`;
  input.style.width = `${Math.max(70, rect.width + 24)}px`;
  if (multiline) input.style.height = `${Math.max(40, rect.height + 16)}px`;
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v) node.label = v;
    recomputeTextOnlyHeight(node);
    input.remove();
    renderAll();
    saveState();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (!multiline || ev.metaKey || ev.ctrlKey)) commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
}

function openProtocolEditor(edge, clientX, clientY) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'name-editor';
  input.placeholder = 'e.g. REST, gRPC';
  input.value = edge.protocol || '';
  input.style.left = `${clientX - 50}px`;
  input.style.top = `${clientY - 11}px`;
  input.style.width = '110px';
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    edge.protocol = v || null;
    input.remove();
    renderAll();
    saveState();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
}

// Shared by openLatencyEditor/openCostEditor below: a numeric override with
// the node's *current effective value* (override or category default,
// from js/simulate.js) prefilled, so nudging it is easy — clearing the
// field back to empty deletes the override and reverts to the default.
function openNodeSimEditor(node, field, clientX, clientY, currentValue) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.className = 'name-editor';
  input.value = String(currentValue);
  input.style.left = `${clientX - 40}px`;
  input.style.top = `${clientY - 11}px`;
  input.style.width = '90px';
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const raw = input.value.trim();
    const v = raw === '' ? NaN : parseFloat(raw);
    node[field] = Number.isFinite(v) ? v : undefined; // empty/invalid clears the override
    input.remove();
    renderAll();
    saveState();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
}

function openLatencyEditor(node, clientX, clientY) {
  openNodeSimEditor(node, 'latencyMs', clientX, clientY, nodeLatencyMs(node));
}

function openCostEditor(node, clientX, clientY) {
  openNodeSimEditor(node, 'costPerHour', clientX, clientY, nodeFixedCostPerHour(node));
}

function openVariableCostEditor(node, clientX, clientY) {
  openNodeSimEditor(node, 'costPer100Rps', clientX, clientY, nodeVariableCostPer100Rps(node));
}

function openRpsEditor(node, clientX, clientY) {
  openNodeSimEditor(node, 'rps', clientX, clientY, typeof node.rps === 'number' ? node.rps : 0);
}

// ---------- Text formatting (node labels: the "Text" tool + regular
// component/container labels) ----------

function setTextStyle(node, style) {
  node.textStyle = style === 'normal' ? undefined : style;
  recomputeTextOnlyHeight(node);
  renderAll();
  saveState();
}

function setTextColor(node, color) {
  node.textColor = color || undefined;
  renderAll();
  saveState();
}

// ---------- Color picker panel ----------
// One small floating swatch-grid + custom-color-input panel, shared by every
// "…Color…" menu action in the app (label text color, node box fill/border,
// edge/arrow color, edge label color) rather than duplicating the same DOM
// four times. `onPick(color)` fires on every swatch click and on every
// native color-input `input` event (live preview); `onPick(null)` fires from
// Reset — callers treat null as "clear the override, fall back to default".

let colorPanelEl = null;

function hideColorPanel() {
  if (colorPanelEl) {
    colorPanelEl.remove();
    colorPanelEl = null;
  }
}

function openColorPanel({ x, y, swatches, current, defaultColor, onPick }) {
  hideColorPanel();
  const panel = document.createElement('div');
  panel.className = 'color-picker-panel';

  for (const color of swatches) {
    const swatch = document.createElement('button');
    swatch.className = 'color-picker-swatch';
    swatch.style.background = color;
    swatch.title = color;
    if (current === color) swatch.classList.add('active');
    swatch.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onPick(color);
      hideColorPanel();
    });
    panel.appendChild(swatch);
  }

  const customLabel = document.createElement('label');
  customLabel.className = 'color-picker-custom';
  customLabel.textContent = 'Custom…';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = current || defaultColor || '#1e293b';
  customInput.addEventListener('input', () => onPick(customInput.value));
  customInput.addEventListener('click', (ev) => ev.stopPropagation());
  customLabel.appendChild(customInput);
  panel.appendChild(customLabel);

  if (current) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'color-picker-reset';
    resetBtn.textContent = 'Reset to default';
    resetBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onPick(null);
      hideColorPanel();
    });
    panel.appendChild(resetBtn);
  }

  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  document.body.appendChild(panel);
  colorPanelEl = panel;
}

function openTextColorPanel(node, x, y) {
  openColorPanel({
    x, y,
    swatches: TEXT_COLOR_SWATCHES,
    current: node.textColor,
    defaultColor: '#1e293b',
    onPick: (color) => setTextColor(node, color),
  });
}

// ---------- Node box color (fill + border) ----------

function setNodeFillColor(node, color) {
  node.fillColor = color || undefined;
  renderAll();
  saveState();
}

function setNodeStrokeColor(node, color) {
  node.strokeColor = color || undefined;
  renderAll();
  saveState();
}

function resetNodeColors(node) {
  node.fillColor = undefined;
  node.strokeColor = undefined;
  renderAll();
  saveState();
}

// Only feeds the color-input picker's starting swatch (an <input type=color>
// needs a #rrggbb value, not the translucent rgba() containers actually
// render with by default) — the real render fallback stays in
// renderContainerNode/renderRegularNode, independent of this.
function defaultNodeFill(node) {
  if (node.type === 'note') return '#fef9c3';
  return node.container ? '#e2e8f0' : CATEGORY_FILLS[node.category] || '#e2e8f0';
}

function defaultNodeStroke(node) {
  if (node.type === 'note') return '#ca8a04';
  return node.container ? '#94a3b8' : CATEGORY_COLORS[node.category] || '#64748b';
}

function openBoxFillColorPanel(node, x, y) {
  openColorPanel({
    x, y,
    swatches: BOX_FILL_SWATCHES,
    current: node.fillColor,
    defaultColor: defaultNodeFill(node),
    onPick: (color) => setNodeFillColor(node, color),
  });
}

function openBoxBorderColorPanel(node, x, y) {
  openColorPanel({
    x, y,
    swatches: LINE_COLOR_SWATCHES,
    current: node.strokeColor,
    defaultColor: defaultNodeStroke(node),
    onPick: (color) => setNodeStrokeColor(node, color),
  });
}

// ---------- Edge/arrow color, edge label color ----------

function setEdgeColor(edge, color) {
  edge.color = color || undefined;
  renderAll();
  saveState();
}

function openEdgeColorPanel(edge, x, y) {
  openColorPanel({
    x, y,
    swatches: LINE_COLOR_SWATCHES,
    current: edge.color,
    defaultColor: '#64748b',
    onPick: (color) => setEdgeColor(edge, color),
  });
}

function setEdgeLabelColor(edge, color) {
  edge.labelColor = color || undefined;
  renderAll();
  saveState();
}

function openEdgeLabelColorPanel(edge, x, y) {
  openColorPanel({
    x, y,
    swatches: TEXT_COLOR_SWATCHES,
    current: edge.labelColor,
    defaultColor: '#475569',
    onPick: (color) => setEdgeLabelColor(edge, color),
  });
}

// A node's whole border (not just fixed handle points) is a connector — drag
// from within CONNECT_BORDER_ZONE of the edge to draw a flow arrow starting
// from that exact spot; drag from the interior to move the node instead.
const CONNECT_BORDER_ZONE = 10;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Nearest border side to a point given as local (node-relative) coordinates,
// expressed as {side, t} — t is the 0..1 fraction along that side — so the
// anchor scales proportionally if the node is later resized.
function borderAnchorFromLocal(n, localX, localY) {
  const distN = localY, distS = n.h - localY, distW = localX, distE = n.w - localX;
  const min = Math.min(distN, distS, distW, distE);
  if (min === distW) return { side: 'w', t: clamp01(localY / n.h) };
  if (min === distE) return { side: 'e', t: clamp01(localY / n.h) };
  if (min === distN) return { side: 'n', t: clamp01(localX / n.w) };
  return { side: 's', t: clamp01(localX / n.w) };
}

function isNearBorder(n, localX, localY) {
  return localX <= CONNECT_BORDER_ZONE || localX >= n.w - CONNECT_BORDER_ZONE || localY <= CONNECT_BORDER_ZONE || localY >= n.h - CONNECT_BORDER_ZONE;
}

function updateBorderCursor(ev, n, body) {
  if (dragCtx || connectCtx || n.textOnly) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  body.style.cursor = isNearBorder(n, p.x - n.x, p.y - n.y) ? 'crosshair' : 'grab';
}

function startDragOrConnect(ev, n) {
  if (n.textOnly || ev.shiftKey) {
    startDragNode(ev, n);
    return;
  }
  const p = toSVGCoords(ev.clientX, ev.clientY);
  const localX = p.x - n.x, localY = p.y - n.y;
  if (isNearBorder(n, localX, localY)) {
    startConnect(ev, n, borderAnchorFromLocal(n, localX, localY));
  } else {
    startDragNode(ev, n);
  }
}

function textNode(str) {
  return document.createTextNode(str);
}

// ---------- Edges ----------

function renderEdge(e) {
  const s = nodeById(e.from);
  const t = nodeById(e.to);
  if (!s || !t) return null;

  const geo = computeEdgeGeometry(e, state.edges, state.nodes);
  if (!geo) return null;

  const g = el('g', { class: 'edge', 'data-edge-id': e.id, id: `edge-${e.id}` });
  if (state.selected && state.selected.kind === 'edge' && state.selected.id === e.id) g.classList.add('selected');

  const path = el('path', { class: 'edge-path', id: `edge-path-${e.id}`, d: geo.d });
  applyEdgeStyle(path, e);
  const hit = el('path', { class: 'edge-hit', d: geo.d });

  const badge = el('g', { class: 'edge-badge', transform: `translate(${geo.badge.x},${geo.badge.y})` });
  badge.appendChild(el('circle', { r: 11 }));
  const numText = el('text', { x: 0, y: 1 }, textNode(String(e.number)));
  badge.appendChild(numText);

  hit.addEventListener('pointerdown', (ev) => startEdgeBend(ev, e));
  hit.addEventListener('dblclick', (ev) => onEdgeDoubleClick(ev, e));
  hit.addEventListener('contextmenu', (ev) => onEdgeContextMenu(ev, e));
  badge.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openBadgeEditor(e, badge);
  });

  g.appendChild(path);
  g.appendChild(hit);

  if (state.selected && state.selected.kind === 'edge' && state.selected.id === e.id) {
    const fromHandle = el('circle', { class: 'edge-endpoint-handle', cx: geo.start.x, cy: geo.start.y, r: 6 });
    const toHandle = el('circle', { class: 'edge-endpoint-handle', cx: geo.end.x, cy: geo.end.y, r: 6 });
    fromHandle.addEventListener('pointerdown', (ev) => startEndpointDrag(ev, e, 'from'));
    toHandle.addEventListener('pointerdown', (ev) => startEndpointDrag(ev, e, 'to'));
    g.appendChild(fromHandle);
    g.appendChild(toHandle);
  }

  g.appendChild(badge);

  if (e.protocol) {
    const lp = geo.labelPos;
    const size = EDGE_LABEL_SIZES[e.labelSize] || EDGE_LABEL_SIZES.normal;
    const weight = e.labelBold ? 700 : 600;
    const h = Math.round(size * 1.8);
    const w = Math.max(30, textWidth(e.protocol, size, weight) + 16);
    const chip = el('g', { class: 'edge-protocol', transform: `translate(${lp.x},${lp.y})` });
    chip.appendChild(el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4 }));
    const labelText = el('text', { x: 0, y: 1 }, textNode(e.protocol));
    let labelStyle = `font-size:${size}px;font-weight:${weight};`;
    if (e.labelItalic) labelStyle += 'font-style:italic;';
    if (e.labelColor) labelStyle += `fill:${e.labelColor};`;
    labelText.setAttribute('style', labelStyle);
    chip.appendChild(labelText);
    chip.addEventListener('pointerdown', (ev) => startLabelDrag(ev, e));
    g.appendChild(chip);
  }

  return g;
}

// The default arrowhead marker (index.html) is shared by every edge and
// colored via the .arrowhead-path CSS class. A per-edge color override
// (edge.color) needs its own marker instance — SVG has no way to recolor a
// referenced marker per-user via CSS alone — so one gets lazily created and
// cached per distinct color the first time it's needed, and reused after
// that by every edge sharing that color.
let edgeDefs = null;
const arrowheadMarkerCache = new Set();

function ensureArrowheadMarker(color) {
  const id = `arrowhead-${color.replace('#', '')}`;
  if (!arrowheadMarkerCache.has(id)) {
    if (!edgeDefs) edgeDefs = svg.querySelector('defs');
    const marker = el('marker', { id, markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: 'auto-start-reverse' });
    marker.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
    edgeDefs.appendChild(marker);
    arrowheadMarkerCache.add(id);
  }
  return id;
}

// A single marker (orient="auto-start-reverse") auto-flips correctly for both
// marker-start and marker-end, so one <marker> def in index.html covers every
// arrowhead combination below (plus a colored one per ensureArrowheadMarker
// above, when the edge overrides its color).
function applyEdgeStyle(path, e) {
  const dash = { dashed: '9 6', dotted: '2 4' }[e.lineStyle];
  if (dash) path.setAttribute('stroke-dasharray', dash);
  else path.removeAttribute('stroke-dasharray');

  // "Animate Flow" (right-click → Arrowhead → Animate Flow) is a persistent
  // continuous dash-marching effect — a plain CSS class/keyframe (see
  // .edge-animated in styles.css), not a JS animation loop, so it costs
  // nothing to have many of these running and needs no per-frame update.
  // Its own stroke-dasharray (a CSS rule) intentionally overrides any dashed
  // /dotted lineStyle attribute above — CSS always wins over a plain
  // attribute — so an animated edge always shows the uniform flow pattern
  // regardless of line style. It always flows start→end, even when
  // arrowStyle is 'both': a true two-way ping-pong effect would need
  // separate keyframe timing per edge for little added clarity, since the
  // motion already reads as "this connection is active" either way.
  path.classList.toggle('edge-animated', !!e.animated);

  // Set as inline `style` (not attributes) so a custom color/thickness wins
  // over the .edge-path class default, while still losing to the
  // selected/flow-active/failure state rules — those use !important
  // specifically so highlighting a custom-colored edge still reads clearly.
  path.style.stroke = e.color || '';
  path.style.strokeWidth = e.strokeWidth ? String(e.strokeWidth) : '';

  const arrowStyle = e.arrowStyle || 'end';
  path.removeAttribute('marker-start');
  path.removeAttribute('marker-end');
  const markerId = e.color ? ensureArrowheadMarker(e.color) : 'arrowhead';
  if (arrowStyle === 'end') path.setAttribute('marker-end', `url(#${markerId})`);
  else if (arrowStyle === 'both') {
    path.setAttribute('marker-start', `url(#${markerId})`);
    path.setAttribute('marker-end', `url(#${markerId})`);
  }
}

function nextEdgeNumber() {
  return state.edges.reduce((max, e) => Math.max(max, e.number), 0) + 1;
}

function openBadgeEditor(edge, badgeGroup) {
  const circle = badgeGroup.querySelector('circle');
  const rect = circle.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'badge-editor';
  input.value = edge.number;
  input.style.left = `${rect.left - 1}px`;
  input.style.top = `${rect.top}px`;
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = parseInt(input.value, 10);
    if (!isNaN(v)) edge.number = v;
    input.remove();
    renderAll();
    saveState();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
}

// ---------- Drag & drop from palette ----------

function onCanvasDragOver(ev) {
  ev.preventDefault();
}

function onCanvasDrop(ev) {
  ev.preventDefault();
  const componentId = ev.dataTransfer.getData('text/component-id');
  if (!componentId) return;
  const { x, y } = toSVGCoords(ev.clientX, ev.clientY);
  const node = addNode(componentId, x, y);
  // Dropping the Image tool is pointless without a picture — go straight to
  // the file picker instead of leaving an empty placeholder the user then
  // has to click separately.
  if (node && node.imageOnly) promptImageUpload(node, 'imageSrc');
}

// ---------- Node dragging (single node, or the whole multi-selection together) ----------

let dragCtx = null;

function startDragNode(ev, node) {
  ev.stopPropagation();
  ev.preventDefault();
  if (ev.shiftKey) return; // shift-click toggles multi-select instead of dragging (see onNodeClick)

  const isGroupDrag = state.multiIds.has(node.id) && state.multiIds.size > 1;
  if (!isGroupDrag) selectItem('node', node.id);
  const groupIds = isGroupDrag ? [...state.multiIds] : [node.id];

  const start = toSVGCoords(ev.clientX, ev.clientY);
  dragCtx = {
    anchorId: node.id,
    offX: start.x - node.x,
    offY: start.y - node.y,
    items: groupIds.map((id) => {
      const nn = nodeById(id);
      return { node: nn, dx: nn.x - node.x, dy: nn.y - node.y };
    }),
  };
  window.addEventListener('pointermove', onDragNodeMove);
  window.addEventListener('pointerup', onDragNodeUp);
}

const GRID_SNAP = 10;
const ALIGN_SNAP_THRESHOLD = 6;

function snapToGrid(v) {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

// Compares the dragged node's edges/center against every other node's, and
// returns a small correction (dx/dy) plus the guide line(s) to draw when a
// coordinate lands within ALIGN_SNAP_THRESHOLD of a match.
function computeAlignmentSnap(anchorRect, excludeIds) {
  const others = state.nodes.filter((n) => !excludeIds.has(n.id));
  const targetsX = [], targetsY = [];
  for (const o of others) {
    targetsX.push(o.x, o.x + o.w / 2, o.x + o.w);
    targetsY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const candidatesX = [anchorRect.x, anchorRect.x + anchorRect.w / 2, anchorRect.x + anchorRect.w];
  const candidatesY = [anchorRect.y, anchorRect.y + anchorRect.h / 2, anchorRect.y + anchorRect.h];

  let bestX = null, bestY = null;
  for (const cx of candidatesX) {
    for (const tx of targetsX) {
      const dist = Math.abs(cx - tx);
      if (dist <= ALIGN_SNAP_THRESHOLD && (!bestX || dist < bestX.dist)) bestX = { dist, delta: tx - cx, pos: tx };
    }
  }
  for (const cy of candidatesY) {
    for (const ty of targetsY) {
      const dist = Math.abs(cy - ty);
      if (dist <= ALIGN_SNAP_THRESHOLD && (!bestY || dist < bestY.dist)) bestY = { dist, delta: ty - cy, pos: ty };
    }
  }
  return {
    dx: bestX ? bestX.delta : 0,
    dy: bestY ? bestY.delta : 0,
    guideX: bestX ? bestX.pos : null,
    guideY: bestY ? bestY.pos : null,
  };
}

let alignGuideEls = [];

function clearAlignGuides() {
  for (const g of alignGuideEls) g.remove();
  alignGuideEls = [];
}

function showAlignGuides(guideX, guideY) {
  clearAlignGuides();
  if (guideX !== null) {
    const line = el('line', { class: 'align-guide', x1: guideX, y1: 0, x2: guideX, y2: CANVAS_H });
    layerOverlay.appendChild(line);
    alignGuideEls.push(line);
  }
  if (guideY !== null) {
    const line = el('line', { class: 'align-guide', x1: 0, y1: guideY, x2: CANVAS_W, y2: guideY });
    layerOverlay.appendChild(line);
    alignGuideEls.push(line);
  }
}

function onDragNodeMove(ev) {
  if (!dragCtx) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  let nx = p.x - dragCtx.offX;
  let ny = p.y - dragCtx.offY;

  // Snapping only applies to a single dragged node — for a group drag the
  // relative layout matters more than any one member aligning, so movement
  // stays free-form (still perfectly usable, just unsnapped).
  if (dragCtx.items.length === 1 && !ev.altKey) {
    const anchor = dragCtx.items[0].node;
    const excludeIds = new Set([anchor.id]);
    const snap = computeAlignmentSnap({ x: nx, y: ny, w: anchor.w, h: anchor.h }, excludeIds);
    if (snap.guideX !== null || snap.guideY !== null) {
      nx += snap.dx;
      ny += snap.dy;
      showAlignGuides(snap.guideX, snap.guideY);
    } else {
      clearAlignGuides();
      nx = snapToGrid(nx);
      ny = snapToGrid(ny);
    }
  }

  for (const item of dragCtx.items) {
    item.node.x = nx + item.dx;
    item.node.y = ny + item.dy;
  }
  renderAll();
}

function onDragNodeUp() {
  window.removeEventListener('pointermove', onDragNodeMove);
  window.removeEventListener('pointerup', onDragNodeUp);
  clearAlignGuides();
  if (dragCtx) saveState();
  dragCtx = null;
}

// ---------- Marquee (rubber-band) multi-select ----------
// A pointerdown that lands on canvas background (nodes/edges stopPropagation
// their own pointerdown, so anything reaching here is background) starts a
// drag-to-select rectangle instead of panning.

let marqueeCtx = null;
let marqueeJustFinished = false;

function onCanvasPointerDown(ev) {
  if (ev.button !== 0) return;
  const start = toSVGCoords(ev.clientX, ev.clientY);
  marqueeCtx = { startClient: { x: ev.clientX, y: ev.clientY }, start, additive: ev.shiftKey, moved: false, rectEl: null, lastRect: null };
  window.addEventListener('pointermove', onMarqueeMove);
  window.addEventListener('pointerup', onMarqueeUp);
}

function onMarqueeMove(ev) {
  if (!marqueeCtx) return;
  const dx = ev.clientX - marqueeCtx.startClient.x;
  const dy = ev.clientY - marqueeCtx.startClient.y;
  if (!marqueeCtx.moved && Math.hypot(dx, dy) > 4) {
    marqueeCtx.moved = true;
    marqueeCtx.rectEl = el('rect', { class: 'marquee-rect' });
    layerOverlay.appendChild(marqueeCtx.rectEl);
  }
  if (!marqueeCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  const x = Math.min(marqueeCtx.start.x, p.x);
  const y = Math.min(marqueeCtx.start.y, p.y);
  const w = Math.abs(p.x - marqueeCtx.start.x);
  const h = Math.abs(p.y - marqueeCtx.start.y);
  marqueeCtx.rectEl.setAttribute('x', x);
  marqueeCtx.rectEl.setAttribute('y', y);
  marqueeCtx.rectEl.setAttribute('width', w);
  marqueeCtx.rectEl.setAttribute('height', h);
  marqueeCtx.lastRect = { x, y, w, h };
}

function onMarqueeUp() {
  window.removeEventListener('pointermove', onMarqueeMove);
  window.removeEventListener('pointerup', onMarqueeUp);
  if (!marqueeCtx) return;
  if (marqueeCtx.moved && marqueeCtx.lastRect) {
    const r = marqueeCtx.lastRect;
    const hits = state.nodes
      .filter((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y)
      .map((n) => n.id);
    if (!marqueeCtx.additive) state.multiIds.clear();
    for (const id of hits) state.multiIds.add(id);
    state.selected = state.multiIds.size === 1 ? { kind: 'node', id: [...state.multiIds][0] } : null;
    if (marqueeCtx.rectEl) marqueeCtx.rectEl.remove();
    marqueeJustFinished = true;
    renderAll();
  }
  marqueeCtx = null;
}

function onCanvasClick() {
  if (marqueeJustFinished) {
    marqueeJustFinished = false;
    return;
  }
  state.selected = null;
  state.multiIds.clear();
  renderAll();
}

// ---------- Manual resize (containers + Image nodes — the only node kinds
// with a drag-resize handle; every other component's box size comes from
// its palette definition) ----------

let resizeCtx = null;

function startResizeNode(ev, node) {
  ev.stopPropagation();
  ev.preventDefault();
  selectItem('node', node.id);
  const start = toSVGCoords(ev.clientX, ev.clientY);
  resizeCtx = { node, offW: node.w - start.x, offH: node.h - start.y };
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeUp);
}

function onResizeMove(ev) {
  if (!resizeCtx) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  let w = Math.max(80, p.x + resizeCtx.offW);
  let h = Math.max(60, p.y + resizeCtx.offH);
  if (!ev.altKey) {
    w = snapToGrid(w);
    h = snapToGrid(h);
  }
  resizeCtx.node.w = w;
  resizeCtx.node.h = h;
  renderAll();
}

function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeUp);
  if (resizeCtx) saveState();
  resizeCtx = null;
}

// ---------- Edge creation via handles ----------

let connectCtx = null;

function startConnect(ev, sourceNode, fromAnchor) {
  ev.stopPropagation();
  ev.preventDefault();
  const start = toSVGCoords(ev.clientX, ev.clientY);
  const line = el('path', { class: 'temp-line', d: `M ${start.x} ${start.y} L ${start.x} ${start.y}` });
  layerOverlay.appendChild(line);
  connectCtx = { sourceNode, line, start, fromAnchor };
  window.addEventListener('pointermove', onConnectMove);
  window.addEventListener('pointerup', onConnectUp);
}

function onConnectMove(ev) {
  if (!connectCtx) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  connectCtx.line.setAttribute('d', `M ${connectCtx.start.x} ${connectCtx.start.y} L ${p.x} ${p.y}`);
}

function onConnectUp(ev) {
  if (!connectCtx) return;
  window.removeEventListener('pointermove', onConnectMove);
  window.removeEventListener('pointerup', onConnectUp);
  connectCtx.line.remove();

  const target = findNodeAtPoint(ev.clientX, ev.clientY, connectCtx.sourceNode.id);
  if (target) {
    const p = toSVGCoords(ev.clientX, ev.clientY);
    const toAnchor = target.textOnly || target.container ? undefined : borderAnchorFromLocal(target, p.x - target.x, p.y - target.y);
    const edge = {
      id: state.nextEdgeId++,
      from: connectCtx.sourceNode.id,
      to: target.id,
      number: nextEdgeNumber(),
      lineStyle: 'solid',
      arrowStyle: 'end',
      fromAnchor: connectCtx.fromAnchor,
      toAnchor,
    };
    state.edges.push(edge);
    renderAll();
    saveState();
    const badgeGroup = document.querySelector(`#edge-${edge.id} .edge-badge`);
    if (badgeGroup) openBadgeEditor(edge, badgeGroup);
  }
  connectCtx = null;
}

function findNodeAtPoint(clientX, clientY, excludeId) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const g = el.closest('[data-node-id]');
    if (g) {
      const id = parseInt(g.getAttribute('data-node-id'), 10);
      if (id !== excludeId) return nodeById(id);
    }
  }
  return null;
}

// ---------- Edge endpoint reconnect ----------
// Selected edges show a small handle at each end (renderEdge below); dragging
// one reuses the same temp-line + drop-on-a-node flow as drawing a brand new
// connection, except it retargets this edge's existing from/to instead of
// creating a new edge. The *other* end's node is excluded as a drop target so
// you can't collapse an edge onto itself.

let endpointDragCtx = null;

function startEndpointDrag(ev, edge, which) {
  ev.stopPropagation();
  ev.preventDefault();
  const geo = computeEdgeGeometry(edge, state.edges, state.nodes);
  if (!geo) return;
  const fixed = which === 'from' ? geo.end : geo.start;
  const line = el('path', { class: 'temp-line', d: `M ${fixed.x} ${fixed.y} L ${fixed.x} ${fixed.y}` });
  layerOverlay.appendChild(line);
  const fixedNodeId = which === 'from' ? edge.to : edge.from;
  endpointDragCtx = { edge, which, line, fixed, fixedNodeId };
  window.addEventListener('pointermove', onEndpointDragMove);
  window.addEventListener('pointerup', onEndpointDragUp);
}

function onEndpointDragMove(ev) {
  if (!endpointDragCtx) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  endpointDragCtx.line.setAttribute('d', `M ${endpointDragCtx.fixed.x} ${endpointDragCtx.fixed.y} L ${p.x} ${p.y}`);
}

function onEndpointDragUp(ev) {
  if (!endpointDragCtx) return;
  window.removeEventListener('pointermove', onEndpointDragMove);
  window.removeEventListener('pointerup', onEndpointDragUp);
  const { edge, which, line, fixedNodeId } = endpointDragCtx;
  line.remove();
  endpointDragCtx = null;

  const target = findNodeAtPoint(ev.clientX, ev.clientY, fixedNodeId);
  if (target) {
    const p = toSVGCoords(ev.clientX, ev.clientY);
    const anchor = target.textOnly || target.container ? undefined : borderAnchorFromLocal(target, p.x - target.x, p.y - target.y);
    if (which === 'from') {
      edge.from = target.id;
      edge.fromAnchor = anchor;
    } else {
      edge.to = target.id;
      edge.toAnchor = anchor;
    }
    saveState();
  }
  renderAll();
}

// ---------- Edge bending ----------
// Three separate, predictable interactions instead of one "drag anywhere
// adds a point" gesture — that felt uncontrollable (every touch added
// another bend) and doesn't match how draw.io/Visio/Lucidchart behave.
//
// - Curve (no routing set): exactly one bend point. Drag anywhere on the
//   line to set/move it (edge.curve); double-click removes it.
// - Orthogonal, no explicit waypoints: the classic auto two-corner "Z" (or
//   straight/"L" when rows or columns align), with each corner independently
//   draggable (edge.elbowOffset near the start, edge.elbowOffsetEnd near the
//   end, picked by proximity) — this only *moves* an existing corner, it
//   never creates a new bend.
// - Orthogonal, with waypoints: an explicit, deliberate escape hatch for
//   routes that need more than the default two corners. You only get here
//   via double-click (never a plain drag); once there, dragging moves an
//   existing waypoint, it does not add another.
//
// All three share the same "moved" threshold so a plain click still just
// selects the edge rather than nudging a bend by a pixel.

const EDGE_POINT_GRAB_RADIUS = 10;

function startEdgeBend(ev, edge) {
  ev.stopPropagation();
  if (edge.routing === 'orthogonal') {
    if (edge.waypoints && edge.waypoints.length) startWaypointDrag(ev, edge);
    else startElbowDrag(ev, edge);
  } else {
    startCurveDrag(ev, edge);
  }
}

// ---- Curve: one bend point ----

let curveDragCtx = null;

function startCurveDrag(ev, edge) {
  curveDragCtx = { edge, startClient: { x: ev.clientX, y: ev.clientY }, moved: false };
  window.addEventListener('pointermove', onCurveDragMove);
  window.addEventListener('pointerup', onCurveDragUp);
}

function onCurveDragMove(ev) {
  if (!curveDragCtx) return;
  const dx = ev.clientX - curveDragCtx.startClient.x;
  const dy = ev.clientY - curveDragCtx.startClient.y;
  if (!curveDragCtx.moved && Math.hypot(dx, dy) > 4) curveDragCtx.moved = true;
  if (!curveDragCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  curveDragCtx.edge.curve = computeBendFromPoint(curveDragCtx.edge, state.nodes, p);
  renderAll();
}

function onCurveDragUp() {
  window.removeEventListener('pointermove', onCurveDragMove);
  window.removeEventListener('pointerup', onCurveDragUp);
  if (!curveDragCtx) return;
  if (curveDragCtx.moved) saveState();
  else selectItem('edge', curveDragCtx.edge.id);
  curveDragCtx = null;
}

// ---- Protocol/label chip: drag to reposition (edge.labelOffset), plain
// click (no movement) opens the label text editor instead ----

let labelDragCtx = null;

function startLabelDrag(ev, edge) {
  ev.stopPropagation();
  labelDragCtx = {
    edge,
    startOffset: edge.labelOffset ? { ...edge.labelOffset } : { dx: 0, dy: 0 },
    startSvg: toSVGCoords(ev.clientX, ev.clientY),
    startClient: { x: ev.clientX, y: ev.clientY },
    moved: false,
  };
  window.addEventListener('pointermove', onLabelDragMove);
  window.addEventListener('pointerup', onLabelDragUp);
}

function onLabelDragMove(ev) {
  if (!labelDragCtx) return;
  const dx = ev.clientX - labelDragCtx.startClient.x;
  const dy = ev.clientY - labelDragCtx.startClient.y;
  if (!labelDragCtx.moved && Math.hypot(dx, dy) > 4) labelDragCtx.moved = true;
  if (!labelDragCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  labelDragCtx.edge.labelOffset = {
    dx: labelDragCtx.startOffset.dx + (p.x - labelDragCtx.startSvg.x),
    dy: labelDragCtx.startOffset.dy + (p.y - labelDragCtx.startSvg.y),
  };
  renderAll();
}

function onLabelDragUp(ev) {
  window.removeEventListener('pointermove', onLabelDragMove);
  window.removeEventListener('pointerup', onLabelDragUp);
  if (!labelDragCtx) return;
  if (labelDragCtx.moved) saveState();
  else openProtocolEditor(labelDragCtx.edge, ev.clientX, ev.clientY);
  labelDragCtx = null;
}

// ---- Orthogonal default: two independent corners ----
// Grabbing near the start-side corner moves only edge.elbowOffset; grabbing
// near the end-side corner moves only edge.elbowOffsetEnd. Which one a
// pointerdown targets is decided once, up front, by proximity — not
// re-evaluated during the drag — so a fast drag past the other corner can't
// flip which field is being edited mid-gesture.

let elbowDragCtx = null;

function startElbowDrag(ev, edge) {
  const info = computeOrthogonalCornerBases(edge, state.nodes);
  if (!info) return;
  const p0 = toSVGCoords(ev.clientX, ev.clientY);
  const d1 = Math.hypot(p0.x - info.c1.x, p0.y - info.c1.y);
  const d2 = Math.hypot(p0.x - info.c2.x, p0.y - info.c2.y);
  const field = d1 <= d2 ? 'elbowOffset' : 'elbowOffsetEnd';
  elbowDragCtx = { edge, axis: info.axis, base: info.base, field, startClient: { x: ev.clientX, y: ev.clientY }, moved: false };
  window.addEventListener('pointermove', onElbowDragMove);
  window.addEventListener('pointerup', onElbowDragUp);
}

function onElbowDragMove(ev) {
  if (!elbowDragCtx) return;
  const dx = ev.clientX - elbowDragCtx.startClient.x;
  const dy = ev.clientY - elbowDragCtx.startClient.y;
  if (!elbowDragCtx.moved && Math.hypot(dx, dy) > 4) elbowDragCtx.moved = true;
  if (!elbowDragCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  elbowDragCtx.edge[elbowDragCtx.field] = (elbowDragCtx.axis === 'x' ? p.x : p.y) - elbowDragCtx.base;
  renderAll();
}

function onElbowDragUp() {
  window.removeEventListener('pointermove', onElbowDragMove);
  window.removeEventListener('pointerup', onElbowDragUp);
  if (!elbowDragCtx) return;
  if (elbowDragCtx.moved) saveState();
  else selectItem('edge', elbowDragCtx.edge.id);
  elbowDragCtx = null;
}

// ---- Orthogonal, waypointed: move an existing point only (adding one is
// a double-click, see onEdgeDoubleClick) ----

let waypointDragCtx = null;

function startWaypointDrag(ev, edge) {
  const geo = computeEdgeGeometry(edge, state.edges, state.nodes);
  if (!geo) return;
  const mid = geo.refs.slice(1, -1);
  const p0 = toSVGCoords(ev.clientX, ev.clientY);
  const { index, dist } = nearestPointIndex(mid, p0);
  waypointDragCtx = {
    edge,
    grabIndex: dist < EDGE_POINT_GRAB_RADIUS ? index : -1, // -1 = not near a point; drag does nothing but a click still selects
    startClient: { x: ev.clientX, y: ev.clientY },
    moved: false,
  };
  window.addEventListener('pointermove', onWaypointDragMove);
  window.addEventListener('pointerup', onWaypointDragUp);
}

function onWaypointDragMove(ev) {
  if (!waypointDragCtx || waypointDragCtx.grabIndex === -1) return;
  const dx = ev.clientX - waypointDragCtx.startClient.x;
  const dy = ev.clientY - waypointDragCtx.startClient.y;
  if (!waypointDragCtx.moved && Math.hypot(dx, dy) > 4) waypointDragCtx.moved = true;
  if (!waypointDragCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  waypointDragCtx.edge.waypoints[waypointDragCtx.grabIndex] = { x: p.x, y: p.y };
  renderAll();
}

function onWaypointDragUp() {
  window.removeEventListener('pointermove', onWaypointDragMove);
  window.removeEventListener('pointerup', onWaypointDragUp);
  if (!waypointDragCtx) return;
  if (waypointDragCtx.moved) saveState();
  else selectItem('edge', waypointDragCtx.edge.id);
  waypointDragCtx = null;
}

// ---- Double-click: the only way to add or remove a bend point beyond an
// orthogonal edge's default two corners; also removes a curve's one bend ----

function onEdgeDoubleClick(ev, edge) {
  ev.stopPropagation();
  const p = toSVGCoords(ev.clientX, ev.clientY);

  if (edge.routing === 'orthogonal') {
    const geo = computeEdgeGeometry(edge, state.edges, state.nodes);
    if (!geo) return;
    const mid = geo.refs.slice(1, -1);
    if (mid.length) {
      const { index, dist } = nearestPointIndex(mid, p);
      if (index >= 0 && dist < EDGE_POINT_GRAB_RADIUS + 2) {
        edge.waypoints.splice(index, 1);
        if (!edge.waypoints.length) edge.waypoints = undefined;
        renderAll();
        saveState();
        return;
      }
    }
    // Not near an existing point — add a new elbow here.
    const { index } = nearestSegmentIndex(geo.refs, p);
    edge.waypoints = mid.length ? [...edge.waypoints] : [];
    edge.waypoints.splice(index, 0, { x: p.x, y: p.y });
    renderAll();
    saveState();
    return;
  }

  if (typeof edge.curve === 'number' && edge.curve !== 0) {
    edge.curve = undefined;
    renderAll();
    saveState();
  }
}

// ---------- Selection & deletion ----------

function selectItem(kind, id) {
  state.selected = { kind, id };
  state.multiIds.clear();
  renderAll();
}

// Shift-click a node to add/remove it from a multi-selection instead of
// replacing the current selection outright.
function toggleMultiSelect(nodeId) {
  if (state.multiIds.has(nodeId)) {
    state.multiIds.delete(nodeId);
  } else {
    // First shift-click after a plain single-select folds that selection in,
    // so shift-clicking a second node grows a 2-item set rather than losing it.
    if (state.multiIds.size === 0 && state.selected && state.selected.kind === 'node') {
      state.multiIds.add(state.selected.id);
    }
    state.multiIds.add(nodeId);
  }
  state.selected = state.multiIds.size === 1 ? { kind: 'node', id: [...state.multiIds][0] } : null;
  renderAll();
}

function onNodeClick(ev, n) {
  ev.stopPropagation();
  if (ev.shiftKey) {
    toggleMultiSelect(n.id);
  } else {
    selectItem('node', n.id);
  }
}

// selectItem() re-renders (destroying the DOM node whose position rename
// positioning needs), so this selects a node and then re-queries its fresh
// label element afterward, and opens the rename editor on that live element.
function openRename(n) {
  selectItem('node', n.id);
  const freshLabel = document.querySelector(
    `[data-node-id="${n.id}"] .node-label, [data-node-id="${n.id}"] .container-label`
  );
  if (freshLabel) openLabelEditor(n, freshLabel);
}

function deleteSelected() {
  if (state.multiIds.size > 0) {
    resetFlow();
    for (const id of state.multiIds) removeNode(id);
    state.multiIds.clear();
    state.selected = null;
    renderAll();
    saveState();
    return;
  }
  if (!state.selected) return;
  resetFlow();
  if (state.selected.kind === 'node') removeNode(state.selected.id);
  else removeEdge(state.selected.id);
  state.selected = null;
  renderAll();
  saveState();
}

// ---------- Layering ----------
// SVG paints in document order, and renderAll() iterates state.nodes filtered
// by container/regular while preserving relative order — so moving a node to
// either end of the shared array is enough to re-layer it within its group.

function bringToFrontSilent(nodeId) {
  const idx = state.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return;
  const [n] = state.nodes.splice(idx, 1);
  state.nodes.push(n);
}

function bringToFront(nodeId) {
  bringToFrontSilent(nodeId);
  renderAll();
  saveState();
}

function sendToBackSilent(nodeId) {
  const idx = state.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return;
  const [n] = state.nodes.splice(idx, 1);
  state.nodes.unshift(n);
}

function sendToBack(nodeId) {
  sendToBackSilent(nodeId);
  renderAll();
  saveState();
}

// ---------- Copy / paste ----------
// clipboardNodes holds one or more node snapshots (ids stripped) so a
// multi-selection copies/duplicates as a group, preserving relative layout.

let clipboardNodes = null;

function copySelectedNode() {
  const ids = state.multiIds.size > 0
    ? [...state.multiIds]
    : state.selected && state.selected.kind === 'node' ? [state.selected.id] : [];
  if (!ids.length) return;
  clipboardNodes = ids.map((id) => {
    const c = { ...nodeById(id) };
    delete c.id;
    return c;
  });
  updateToolbarState();
}

function pasteNode(pos) {
  if (!clipboardNodes || !clipboardNodes.length) return null;
  const minX = Math.min(...clipboardNodes.map((c) => c.x));
  const minY = Math.min(...clipboardNodes.map((c) => c.y));
  const maxX = Math.max(...clipboardNodes.map((c) => c.x + c.w));
  const maxY = Math.max(...clipboardNodes.map((c) => c.y + c.h));
  const anchorX = pos ? pos.x - (maxX - minX) / 2 : minX + 30;
  const anchorY = pos ? pos.y - (maxY - minY) / 2 : minY + 30;

  const newIds = [];
  for (const c of clipboardNodes) {
    const node = { ...c, id: state.nextNodeId++, x: anchorX + (c.x - minX), y: anchorY + (c.y - minY) };
    state.nodes.push(node);
    newIds.push(node.id);
  }

  if (newIds.length === 1) {
    state.selected = { kind: 'node', id: newIds[0] };
    state.multiIds.clear();
  } else {
    state.selected = null;
    state.multiIds = new Set(newIds);
  }
  renderAll();
  saveState();
  return nodeById(newIds[0]);
}

function duplicateSelected() {
  copySelectedNode();
  pasteNode();
}

// ---------- Context menus ----------
//
// Items are {label, action}, {label, heading:true} (non-clickable section
// label), {label, submenu:[...items]} (a flyout — see below), or the string
// '-' (separator). submenu lets a group of related rows (Text Style, Box
// Color, Simulation, …) collapse into one row instead of sitting flat in an
// already-long menu; buildMenuEl is shared by the top-level menu and every
// nested flyout so they look and behave identically. All open menu/flyout
// elements are tracked in openMenuEls so hideContextMenu() (called globally
// on any outside click — see window 'click' in initCanvas) tears the whole
// stack down at once, not just the top-level one.

let contextMenuEl = null;
let openMenuEls = [];

function hideContextMenu() {
  for (const el of openMenuEls) el.remove();
  openMenuEls = [];
  contextMenuEl = null;
}

// Positions `el` on-screen near (x, y), preferring to grow right/down but
// flipping to stay within the viewport — shared by the top-level menu
// (anchored to the cursor or a toolbar button) and submenus (anchored to
// their parent row).
function positionFloatingEl(el, x, y) {
  const rect = el.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
  el.style.left = `${Math.max(4, left)}px`;
  el.style.top = `${Math.max(4, top)}px`;
}

function buildMenuEl(items) {
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  for (const item of items) {
    if (item === '-') {
      menu.appendChild(document.createElement('div')).className = 'context-menu-sep';
      continue;
    }
    const row = document.createElement('div');
    row.className = 'context-menu-item' + (item.heading ? ' heading' : '') + (item.submenu ? ' has-submenu' : '');
    const label = document.createElement('span');
    label.textContent = item.label;
    row.appendChild(label);

    if (item.submenu) {
      const chevron = document.createElement('span');
      chevron.className = 'context-menu-chevron';
      chevron.textContent = '›';
      row.appendChild(chevron);

      let submenuEl = null;
      const openSubmenu = () => {
        // Only one flyout open per parent menu at a time.
        for (const sib of menu.querySelectorAll('.context-menu-item.open')) sib.classList.remove('open');
        if (submenuEl) return;
        row.classList.add('open');
        submenuEl = buildMenuEl(item.submenu);
        document.body.appendChild(submenuEl);
        openMenuEls.push(submenuEl);
        const r = row.getBoundingClientRect();
        positionFloatingEl(submenuEl, r.right + 2, r.top - 4);
      };
      row.addEventListener('mouseenter', openSubmenu);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openSubmenu();
      });
    } else if (!item.heading) {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hideContextMenu();
        item.action();
      });
    }
    menu.appendChild(row);
  }

  return menu;
}

function showContextMenu(clientX, clientY, items) {
  hideContextMenu();
  const menu = buildMenuEl(items);
  document.body.appendChild(menu);
  openMenuEls.push(menu);
  contextMenuEl = menu;
  positionFloatingEl(menu, clientX, clientY);
}

function buildNodeMenuItems(n, menuX, menuY) {
  const items = [
    { label: 'Duplicate    ⌘D', action: () => duplicateSelected() },
    { label: 'Copy    ⌘C', action: () => copySelectedNode() },
  ];
  // Image nodes have no on-canvas label element for openRename to attach an
  // inline editor to (renderImageNode deliberately doesn't render label text
  // over the picture) — so Rename would silently no-op there.
  if (!n.imageOnly) items.unshift({ label: 'Rename', action: () => openRename(n) });
  if (n.imageOnly) {
    items.push('-');
    items.push({ label: 'Image', heading: true });
    items.push({ label: n.imageSrc ? '   Replace Image…' : '   Upload Image…', action: () => promptImageUpload(n, 'imageSrc') });
    if (n.imageSrc) {
      items.push({
        label: '   Remove Image',
        action: () => {
          n.imageSrc = undefined;
          renderAll();
          saveState();
        },
      });
    }
  }
  // Icon / Text Style / Box Color / Simulation each collapse into one row
  // with a flyout (see submenu support in showContextMenu) instead of
  // sitting flat in an already-long menu — the group's own name is enough
  // context once it's nested, so the items inside drop the indentation
  // spaces the old flat layout used to fake grouping.
  if (!n.textOnly && !n.container && !n.imageOnly) {
    const iconItems = [{ label: n.customIcon ? 'Replace Icon…' : 'Custom Icon…', action: () => promptImageUpload(n, 'customIcon') }];
    if (n.customIcon) {
      iconItems.push({
        label: 'Reset to Default Icon',
        action: () => {
          n.customIcon = undefined;
          renderAll();
          saveState();
        },
      });
    }
    items.push('-');
    items.push({ label: 'Icon', submenu: iconItems });
  }
  if (!n.container && !n.imageOnly) {
    const textStyleItems = Object.keys(TEXT_STYLE_LABELS).map((style) => {
      const active = (n.textStyle || 'normal') === style;
      return {
        label: (active ? '✓ ' : '   ') + TEXT_STYLE_LABELS[style],
        action: () => setTextStyle(n, style),
      };
    });
    textStyleItems.push('-');
    textStyleItems.push({ label: 'Text Color…', action: () => openTextColorPanel(n, menuX, menuY) });
    items.push('-');
    items.push({ label: 'Text Style', submenu: textStyleItems });
  }
  if (!n.textOnly) {
    const boxColorItems = [
      { label: 'Fill…', action: () => openBoxFillColorPanel(n, menuX, menuY) },
      { label: 'Border…', action: () => openBoxBorderColorPanel(n, menuX, menuY) },
    ];
    if (n.fillColor || n.strokeColor) {
      boxColorItems.push({ label: 'Reset Colors', action: () => resetNodeColors(n) });
    }
    items.push('-');
    items.push({ label: 'Box Color', submenu: boxColorItems });
  }
  if (!n.container && !n.textOnly && !n.imageOnly) {
    const simItems = [];
    if (computeOrigins().some((o) => o.id === n.id)) {
      simItems.push({
        label: `RPS: ${typeof n.rps === 'number' ? formatRps(n.rps) : '— (unset)'}`,
        action: () => openRpsEditor(n, menuX, menuY),
      });
    }
    simItems.push({
      label: `Latency: ${formatLatency(nodeLatencyMs(n))}${typeof n.latencyMs === 'number' ? '' : ' (default)'}`,
      action: () => openLatencyEditor(n, menuX, menuY),
    });
    simItems.push({
      label: `Cost: ${formatCost(nodeFixedCostPerHour(n))}${typeof n.costPerHour === 'number' ? '' : ' (default)'}`,
      action: () => openCostEditor(n, menuX, menuY),
    });
    simItems.push({
      label: `Variable Cost: ${formatCostPer100Rps(nodeVariableCostPer100Rps(n))}${typeof n.costPer100Rps === 'number' ? '' : ' (default)'}`,
      action: () => openVariableCostEditor(n, menuX, menuY),
    });
    // Only offered while the Latency & Cost view is on, so with it off the
    // diagram is guaranteed to render exactly as if chaos didn't exist.
    if (showSimAnnotations) {
      const isFailed = simFailedNodeIds.has(n.id);
      simItems.push({
        label: (isFailed ? '✓ ' : '   ') + 'Simulate Failure',
        action: () => toggleNodeFailure(n.id),
      });
    }
    items.push('-');
    items.push({ label: 'Simulation', submenu: simItems });
  }
  items.push('-');
  items.push({ label: 'Bring to Front    ]', action: () => bringToFront(n.id) });
  items.push({ label: 'Send to Back    [', action: () => sendToBack(n.id) });
  items.push('-');
  items.push({ label: 'Delete', action: () => deleteSelected() });
  return items;
}

function buildMultiSelectMenuItems() {
  const count = state.multiIds.size;
  return [
    { label: `${count} selected`, heading: true },
    { label: 'Duplicate    ⌘D', action: () => duplicateSelected() },
    { label: 'Copy    ⌘C', action: () => copySelectedNode() },
    '-',
    {
      label: 'Bring to Front    ]',
      action: () => {
        for (const id of state.multiIds) bringToFrontSilent(id);
        renderAll();
        saveState();
      },
    },
    {
      label: 'Send to Back    [',
      action: () => {
        for (const id of state.multiIds) sendToBackSilent(id);
        renderAll();
        saveState();
      },
    },
    '-',
    { label: 'Delete', action: () => deleteSelected() },
  ];
}

function onNodeContextMenu(ev, n) {
  ev.preventDefault();
  ev.stopPropagation();
  if (state.multiIds.size > 1 && state.multiIds.has(n.id)) {
    showContextMenu(ev.clientX, ev.clientY, buildMultiSelectMenuItems());
    return;
  }
  selectItem('node', n.id);
  showContextMenu(ev.clientX, ev.clientY, buildNodeMenuItems(n, ev.clientX, ev.clientY));
}

const LINE_STYLE_OPTIONS = [
  { key: 'solid', label: 'Solid' },
  { key: 'dashed', label: 'Dashed' },
  { key: 'dotted', label: 'Dotted' },
];
const ARROW_STYLE_OPTIONS = [
  { key: 'end', label: 'Forward' },
  { key: 'both', label: 'Both Ends' },
  { key: 'none', label: 'No Arrowhead' },
];
const PROTOCOL_PRESETS = ['REST', 'gRPC', 'GraphQL', 'Async'];
const THICKNESS_OPTIONS = [
  { key: 1.5, label: 'Thin' },
  { key: 2, label: 'Normal' },
  { key: 3, label: 'Thick' },
  { key: 4, label: 'Extra Thick' },
];
// Font sizes for the edge protocol/label chip (right-click → Label Style) —
// 'normal' (11) is close to, but not identical to, the pre-existing fixed
// 10px .edge-protocol CSS default, since these are also used to size the
// chip's rect via textWidth() and 11 measures a touch more comfortably.
const EDGE_LABEL_SIZES = { small: 9, normal: 11, large: 14 };
const LABEL_SIZE_OPTIONS = [
  { key: 'small', label: 'Small' },
  { key: 'normal', label: 'Normal' },
  { key: 'large', label: 'Large' },
];

function buildEdgeMenuItems(e, menuX, menuY) {
  // Each group collapses into one row with a flyout (see submenu support in
  // showContextMenu) instead of sitting flat — this menu has the most
  // groups of any in the app, so it benefits the most.
  const lineStyleItems = LINE_STYLE_OPTIONS.map((opt) => {
    const active = (e.lineStyle || 'solid') === opt.key;
    return {
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.lineStyle = opt.key;
        renderAll();
        saveState();
      },
    };
  });

  const isOrthogonal = e.routing === 'orthogonal';
  const routingItems = [
    { label: 'Drag the line to move its bend', heading: true },
    {
      label: (!isOrthogonal ? '✓ ' : '   ') + 'Straight / Curved',
      action: () => {
        e.routing = undefined;
        renderAll();
        saveState();
      },
    },
    {
      label: (isOrthogonal ? '✓ ' : '   ') + 'Orthogonal',
      action: () => {
        e.routing = 'orthogonal';
        e.curve = undefined;
        renderAll();
        saveState();
      },
    },
  ];
  const hasElbowOffset = (typeof e.elbowOffset === 'number' && e.elbowOffset !== 0) || (typeof e.elbowOffsetEnd === 'number' && e.elbowOffsetEnd !== 0);
  if (e.curve || hasElbowOffset || (e.waypoints && e.waypoints.length)) {
    routingItems.push({
      label: 'Straighten (clear bend points)',
      action: () => {
        e.curve = undefined;
        e.elbowOffset = undefined;
        e.elbowOffsetEnd = undefined;
        e.waypoints = undefined;
        renderAll();
        saveState();
      },
    });
  }

  const arrowheadItems = ARROW_STYLE_OPTIONS.map((opt) => {
    const active = (e.arrowStyle || 'end') === opt.key;
    return {
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.arrowStyle = opt.key;
        renderAll();
        saveState();
      },
    };
  });
  arrowheadItems.push('-');
  arrowheadItems.push({
    label: (e.animated ? '✓ ' : '   ') + 'Animate Flow',
    action: () => {
      e.animated = !e.animated;
      renderAll();
      saveState();
    },
  });

  const thicknessItems = THICKNESS_OPTIONS.map((opt) => {
    const active = (e.strokeWidth || 2) === opt.key;
    return {
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.strokeWidth = opt.key === 2 ? undefined : opt.key;
        renderAll();
        saveState();
      },
    };
  });
  thicknessItems.push('-');
  thicknessItems.push({ label: 'Color…', action: () => openEdgeColorPanel(e, menuX, menuY) });
  if (e.color) {
    thicknessItems.push({
      label: 'Reset Color',
      action: () => {
        e.color = undefined;
        renderAll();
        saveState();
      },
    });
  }

  const protocolItems = PROTOCOL_PRESETS.map((p) => {
    const active = e.protocol === p;
    return {
      label: (active ? '✓ ' : '   ') + p,
      action: () => {
        e.protocol = p;
        renderAll();
        saveState();
      },
    };
  });
  protocolItems.push({ label: 'Custom…', action: () => openProtocolEditor(e, menuX, menuY) });
  if (e.protocol) {
    protocolItems.push({
      label: 'Clear Label',
      action: () => {
        e.protocol = null;
        renderAll();
        saveState();
      },
    });
  }

  const labelStyleItems = [{ label: 'Drag the label to reposition', heading: true }];
  for (const opt of LABEL_SIZE_OPTIONS) {
    const active = (e.labelSize || 'normal') === opt.key;
    labelStyleItems.push({
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.labelSize = opt.key === 'normal' ? undefined : opt.key;
        renderAll();
        saveState();
      },
    });
  }
  labelStyleItems.push({
    label: (e.labelBold ? '✓ ' : '   ') + 'Bold',
    action: () => {
      e.labelBold = !e.labelBold;
      renderAll();
      saveState();
    },
  });
  labelStyleItems.push({
    label: (e.labelItalic ? '✓ ' : '   ') + 'Italic',
    action: () => {
      e.labelItalic = !e.labelItalic;
      renderAll();
      saveState();
    },
  });
  labelStyleItems.push({ label: 'Color…', action: () => openEdgeLabelColorPanel(e, menuX, menuY) });
  if (e.labelOffset) {
    labelStyleItems.push({
      label: 'Reset Label Position',
      action: () => {
        e.labelOffset = undefined;
        renderAll();
        saveState();
      },
    });
  }

  const items = [
    { label: 'Line Style', submenu: lineStyleItems },
    { label: 'Routing', submenu: routingItems },
    { label: 'Arrowhead', submenu: arrowheadItems },
    { label: 'Thickness & Color', submenu: thicknessItems },
    { label: 'Protocol Label', submenu: protocolItems },
    { label: 'Label Style', submenu: labelStyleItems },
  ];
  // Only offered while the Latency & Cost view is on, so with it off the
  // diagram is guaranteed to render exactly as if chaos didn't exist. A
  // *connection* failure — the link is down but both endpoints are
  // healthy — is distinct from failing a node itself (see canvas.js's
  // buildNodeMenuItems).
  if (showSimAnnotations) {
    items.push('-');
    items.push({ label: 'Simulation', heading: true });
    const isFailed = simFailedEdgeIds.has(e.id);
    items.push({
      label: (isFailed ? '✓ ' : '   ') + 'Simulate Connection Failure',
      action: () => toggleEdgeFailure(e.id),
    });
  }
  items.push('-');
  items.push({ label: 'Delete', action: () => deleteSelected() });

  return items;
}

function onEdgeContextMenu(ev, e) {
  ev.preventDefault();
  ev.stopPropagation();
  selectItem('edge', e.id);
  showContextMenu(ev.clientX, ev.clientY, buildEdgeMenuItems(e, ev.clientX, ev.clientY));
}

function onCanvasContextMenu(ev) {
  if (!clipboardNodes || !clipboardNodes.length) return;
  ev.preventDefault();
  const pos = toSVGCoords(ev.clientX, ev.clientY);
  showContextMenu(ev.clientX, ev.clientY, [{ label: 'Paste', action: () => pasteNode(pos) }]);
}

// ---------- Keyboard shortcuts ----------

const NUDGE_KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
let nudgeSaveTimer = null;

// Nudging repeats fast on key-repeat; debounce the commit (localStorage +
// undo entry) so a long arrow-key hold doesn't flood the history stack.
function nudgeSaveDebounced() {
  clearTimeout(nudgeSaveTimer);
  nudgeSaveTimer = setTimeout(saveState, 400);
}

function hasNodeSelection() {
  return state.multiIds.size > 0 || (state.selected && state.selected.kind === 'node');
}

function selectedNodeIds() {
  if (state.multiIds.size > 0) return [...state.multiIds];
  if (state.selected && state.selected.kind === 'node') return [state.selected.id];
  return [];
}

function onKeyDown(ev) {
  if (ev.key === 'Escape') {
    hideContextMenu();
    hidePatternPanel();
    hideHelpPanel();
    hideColorPanel();
  }

  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

  const mod = ev.ctrlKey || ev.metaKey;

  if (ev.key === 'Escape' && (state.selected || state.multiIds.size)) {
    state.selected = null;
    state.multiIds.clear();
    renderAll();
    return;
  }

  if (mod && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    redo();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    if (!state.nodes.length) return;
    state.multiIds = new Set(state.nodes.map((n) => n.id));
    state.selected = state.multiIds.size === 1 ? { kind: 'node', id: state.nodes[0].id } : null;
    renderAll();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'c') {
    if (hasNodeSelection()) {
      ev.preventDefault();
      copySelectedNode();
    }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'v') {
    if (clipboardNodes && clipboardNodes.length) {
      ev.preventDefault();
      pasteNode();
    }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'd') {
    if (hasNodeSelection()) {
      ev.preventDefault();
      duplicateSelected();
    }
    return;
  }
  if (NUDGE_KEYS[ev.key] && hasNodeSelection()) {
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1;
    const [dx, dy] = NUDGE_KEYS[ev.key];
    for (const id of selectedNodeIds()) {
      const n = nodeById(id);
      if (n) {
        n.x += dx * step;
        n.y += dy * step;
      }
    }
    renderAll();
    nudgeSaveDebounced();
    return;
  }
  if (ev.key === ']' && hasNodeSelection()) {
    const ids = selectedNodeIds();
    for (const id of ids) bringToFrontSilent(id);
    renderAll();
    saveState();
    return;
  }
  if (ev.key === '[' && hasNodeSelection()) {
    const ids = selectedNodeIds();
    for (const id of ids) sendToBackSilent(id);
    renderAll();
    saveState();
    return;
  }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && (state.selected || state.multiIds.size)) {
    ev.preventDefault();
    deleteSelected();
  }
}
