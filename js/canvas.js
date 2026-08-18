// Canvas engine: owns diagram state and all SVG rendering / drag-drop /
// selection / editing interactions. Everything lives in one <svg> so export
// (export.js) can serialize the whole diagram directly.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'cad_diagram_v1';

const DEFAULT_NODE_W = 150;
const DEFAULT_NODE_H = 70;

const state = {
  nodes: [], // {id, type, category, label, x, y, w, h, container, icon}
  edges: [], // {id, from, to, number}
  nextNodeId: 1,
  nextEdgeId: 1,
  selected: null, // {kind:'node'|'edge', id}
};

let svg, layerContainers, layerEdges, layerNodes, layerOverlay;
let canvasWrap, canvasScroll, rulerH, rulerV;

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

  canvasWrap.addEventListener('dragover', onCanvasDragOver);
  canvasWrap.addEventListener('drop', onCanvasDrop);
  canvasWrap.addEventListener('click', () => {
    state.selected = null;
    renderAll();
  });
  canvasWrap.addEventListener('contextmenu', onCanvasContextMenu);
  canvasScroll.addEventListener('scroll', updateRulers);
  window.addEventListener('resize', updateRulers);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('click', hideContextMenu);

  loadState();
  loadPrefs();
  applyViewPrefs();
  renderAll();
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
  state.nodes = state.nodes.filter((n) => n.id !== nodeId);
  state.edges = state.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
}

function removeEdge(edgeId) {
  state.edges = state.edges.filter((e) => e.id !== edgeId);
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
  renderAll();
  saveState();
}

// ---------- Persistence ----------

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        nextNodeId: state.nextNodeId,
        nextEdgeId: state.nextEdgeId,
      })
    );
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

// ---------- View preferences (grid background / rulers) ----------

const PREFS_KEY = 'cad_prefs_v1';
let showGrid = true;
let showRulers = false;
let showPalette = true;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.showGrid === 'boolean') showGrid = p.showGrid;
    if (typeof p.showRulers === 'boolean') showRulers = p.showRulers;
    if (typeof p.showPalette === 'boolean') showPalette = p.showPalette;
  } catch (e) {
    /* ignore */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ showGrid, showRulers, showPalette }));
  } catch (e) {
    /* ignore */
  }
}

function applyViewPrefs() {
  canvasWrap.classList.toggle('no-grid', !showGrid);
  canvasWrap.classList.toggle('rulers-on', showRulers);
  const paletteEl = document.getElementById('palette');
  if (paletteEl) paletteEl.classList.toggle('palette-hidden', !showPalette);
  const tabBtn = document.getElementById('btn-palette-tab');
  if (tabBtn) tabBtn.innerHTML = showPalette ? '&laquo;' : '&raquo;';
  updateRulers();
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

function updateRulers() {
  if (!showRulers || !canvasScroll) return;
  const sx = canvasScroll.scrollLeft;
  const sy = canvasScroll.scrollTop;
  const w = canvasScroll.clientWidth;
  const h = canvasScroll.clientHeight;
  const step = 100;

  rulerH.innerHTML = '';
  for (let x = Math.floor(sx / step) * step; x <= sx + w; x += step) {
    const line = domEl('div', 'ruler-tick-line');
    line.style.left = `${x - sx}px`;
    rulerH.appendChild(line);
    const tick = domEl('div', 'ruler-tick');
    tick.style.left = `${x - sx}px`;
    tick.textContent = x;
    rulerH.appendChild(tick);
  }

  rulerV.innerHTML = '';
  for (let y = Math.floor(sy / step) * step; y <= sy + h; y += step) {
    const line = domEl('div', 'ruler-tick-line');
    line.style.top = `${y - sy}px`;
    rulerV.appendChild(line);
    const tick = domEl('div', 'ruler-tick');
    tick.style.top = `${y - sy}px`;
    tick.textContent = y;
    rulerV.appendChild(tick);
  }
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
    if (!n.container) layerNodes.appendChild(renderRegularNode(n));
  }

  updateToolbarState();
}

function updateToolbarState() {
  // Edit ▾ shows a node/edge menu when something's selected, or just Paste
  // when there's clipboard content to offer — disabled only when neither applies.
  setBtnDisabled('btn-edit', !state.selected && !clipboardNode);
}

function setBtnDisabled(id, disabled) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = disabled;
}

function renderContainerNode(n) {
  const g = el('g', { class: 'node container-node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (state.selected && state.selected.kind === 'node' && state.selected.id === n.id) g.classList.add('selected');

  const rect = el('rect', { class: 'container-rect', x: 0, y: 0, width: n.w, height: n.h, rx: 10 });
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
  resize.addEventListener('pointerdown', (ev) => startResizeContainer(ev, n));
  labelHit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openRename(n);
  });
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectItem('node', n.id);
  });
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

function buildMultilineText(cls, cx, lastLineY, lines, lineHeight) {
  const startY = lastLineY - (lines.length - 1) * lineHeight;
  const text = el('text', { class: cls, x: cx, y: startY });
  lines.forEach((line, i) => {
    text.appendChild(el('tspan', { x: cx, dy: i === 0 ? 0 : lineHeight }, textNode(line)));
  });
  return text;
}

function buildRegularLabel(n) {
  const lines = wrapClamped(n.label, n.w - 16, 2, 12, 500);
  return buildMultilineText('node-label', n.w / 2, n.h - 12, lines, 13);
}

function buildTextOnlyLabel(n) {
  const lines = wrapText(n.label, n.w - 16, 16, 600);
  const lineHeight = 20;
  const lastLineY = n.h / 2 + 5 + ((lines.length - 1) * lineHeight) / 2;
  return buildMultilineText('node-label text-node-label', n.w / 2, lastLineY, lines, lineHeight);
}

// Text-only nodes have no manual resize handle, so their box grows to fit
// wrapped content instead — called whenever a text-only node's label changes.
function recomputeTextOnlyHeight(n) {
  if (!n.textOnly) return;
  const lines = wrapText(n.label, n.w - 16, 16, 600);
  n.h = Math.max(44, lines.length * 20 + 20);
}

function renderRegularNode(n) {
  const g = el('g', { class: 'node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (state.selected && state.selected.kind === 'node' && state.selected.id === n.id) g.classList.add('selected');
  if (n.textOnly) g.classList.add('text-node');

  // Note gets its own sticky-note color regardless of category, and Text is
  // a borderless label (invisible hit-area rect kept for drag/select).
  const isNote = n.type === 'note';
  const fill = n.textOnly ? 'transparent' : isNote ? '#fef9c3' : CATEGORY_FILLS[n.category] || '#e2e8f0';
  const stroke = n.textOnly ? 'none' : isNote ? '#ca8a04' : CATEGORY_COLORS[n.category] || '#64748b';

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

  let iconG = null;
  if (!n.textOnly) {
    const iconSize = 26;
    iconG = el('g', { class: 'node-icon', transform: `translate(${n.w / 2 - iconSize / 2},8) scale(${iconSize / 24})` });
    iconG.innerHTML = ICONS[n.icon] || '';
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

  for (const dir of ['n', 'e', 's', 'w']) {
    g.appendChild(makeHandle(n, dir));
  }

  body.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
  labelHit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openRename(n);
  });
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectItem('node', n.id);
  });
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

function handlePos(n, dir) {
  switch (dir) {
    case 'n': return { x: n.w / 2, y: 0 };
    case 's': return { x: n.w / 2, y: n.h };
    case 'e': return { x: n.w, y: n.h / 2 };
    case 'w': return { x: 0, y: n.h / 2 };
  }
}

function makeHandle(n, dir) {
  const p = handlePos(n, dir);
  const h = el('circle', { class: 'handle', cx: p.x, cy: p.y, r: 4.5, 'data-dir': dir });
  h.addEventListener('pointerdown', (ev) => startConnect(ev, n));
  return h;
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
  hit.addEventListener('contextmenu', (ev) => onEdgeContextMenu(ev, e));
  badge.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openBadgeEditor(e, badge);
  });

  g.appendChild(path);
  g.appendChild(hit);
  g.appendChild(badge);

  if (e.protocol) {
    const lp = geo.labelPos;
    const w = Math.max(30, e.protocol.length * 6.5 + 12);
    const chip = el('g', { class: 'edge-protocol', transform: `translate(${lp.x},${lp.y})` });
    chip.appendChild(el('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 4 }));
    chip.appendChild(el('text', { x: 0, y: 1 }, textNode(e.protocol)));
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openProtocolEditor(e, ev.clientX, ev.clientY);
    });
    g.appendChild(chip);
  }

  return g;
}

// A single marker (orient="auto-start-reverse") auto-flips correctly for both
// marker-start and marker-end, so one <marker> def in index.html covers every
// arrowhead combination below.
function applyEdgeStyle(path, e) {
  const dash = { dashed: '9 6', dotted: '2 4' }[e.lineStyle];
  if (dash) path.setAttribute('stroke-dasharray', dash);
  else path.removeAttribute('stroke-dasharray');

  const arrowStyle = e.arrowStyle || 'end';
  path.removeAttribute('marker-start');
  path.removeAttribute('marker-end');
  if (arrowStyle === 'end') path.setAttribute('marker-end', 'url(#arrowhead)');
  else if (arrowStyle === 'both') {
    path.setAttribute('marker-start', 'url(#arrowhead)');
    path.setAttribute('marker-end', 'url(#arrowhead)');
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
  addNode(componentId, x, y);
}

// ---------- Node dragging ----------

let dragCtx = null;

function startDragNode(ev, node) {
  ev.stopPropagation();
  ev.preventDefault();
  selectItem('node', node.id);
  const start = toSVGCoords(ev.clientX, ev.clientY);
  dragCtx = { node, offX: start.x - node.x, offY: start.y - node.y };
  window.addEventListener('pointermove', onDragNodeMove);
  window.addEventListener('pointerup', onDragNodeUp);
}

function onDragNodeMove(ev) {
  if (!dragCtx) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  dragCtx.node.x = p.x - dragCtx.offX;
  dragCtx.node.y = p.y - dragCtx.offY;
  renderAll();
}

function onDragNodeUp() {
  window.removeEventListener('pointermove', onDragNodeMove);
  window.removeEventListener('pointerup', onDragNodeUp);
  if (dragCtx) saveState();
  dragCtx = null;
}

// ---------- Container resizing ----------

let resizeCtx = null;

function startResizeContainer(ev, node) {
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
  resizeCtx.node.w = Math.max(80, p.x + resizeCtx.offW);
  resizeCtx.node.h = Math.max(60, p.y + resizeCtx.offH);
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

function startConnect(ev, sourceNode) {
  ev.stopPropagation();
  ev.preventDefault();
  const start = toSVGCoords(ev.clientX, ev.clientY);
  const line = el('path', { class: 'temp-line', d: `M ${start.x} ${start.y} L ${start.x} ${start.y}` });
  layerOverlay.appendChild(line);
  connectCtx = { sourceNode, line, start };
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
    const edge = {
      id: state.nextEdgeId++,
      from: connectCtx.sourceNode.id,
      to: target.id,
      number: nextEdgeNumber(),
      lineStyle: 'solid',
      arrowStyle: 'end',
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

// ---------- Edge bending (drag anywhere along the line to curve it) ----------
// Grabbing the edge's hit-path and moving the pointer bends the curve so its
// control point tracks the cursor (draw.io-style — no separate fixed handle).
// A short drag threshold tells a genuine bend apart from a plain click, which
// still selects the edge as before.

let edgeBendCtx = null;

function startEdgeBend(ev, edge) {
  ev.stopPropagation();
  if (edge.routing === 'orthogonal') {
    selectItem('edge', edge.id); // orthogonal edges auto-route — nothing to drag
    return;
  }
  edgeBendCtx = { edge, startClient: { x: ev.clientX, y: ev.clientY }, moved: false };
  window.addEventListener('pointermove', onEdgeBendMove);
  window.addEventListener('pointerup', onEdgeBendUp);
}

function onEdgeBendMove(ev) {
  if (!edgeBendCtx) return;
  const dx = ev.clientX - edgeBendCtx.startClient.x;
  const dy = ev.clientY - edgeBendCtx.startClient.y;
  if (!edgeBendCtx.moved && Math.hypot(dx, dy) > 4) edgeBendCtx.moved = true;
  if (!edgeBendCtx.moved) return;
  const p = toSVGCoords(ev.clientX, ev.clientY);
  edgeBendCtx.edge.curve = computeBendFromPoint(edgeBendCtx.edge, state.nodes, p);
  renderAll();
}

function onEdgeBendUp() {
  window.removeEventListener('pointermove', onEdgeBendMove);
  window.removeEventListener('pointerup', onEdgeBendUp);
  if (!edgeBendCtx) return;
  if (edgeBendCtx.moved) {
    saveState();
  } else {
    selectItem('edge', edgeBendCtx.edge.id); // no drag happened — treat as a plain click
  }
  edgeBendCtx = null;
}

// ---------- Selection & deletion ----------

function selectItem(kind, id) {
  state.selected = { kind, id };
  renderAll();
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

function bringToFront(nodeId) {
  const idx = state.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return;
  const [n] = state.nodes.splice(idx, 1);
  state.nodes.push(n);
  renderAll();
  saveState();
}

function sendToBack(nodeId) {
  const idx = state.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return;
  const [n] = state.nodes.splice(idx, 1);
  state.nodes.unshift(n);
  renderAll();
  saveState();
}

// ---------- Copy / paste ----------

let clipboardNode = null;

function copySelectedNode() {
  if (!state.selected || state.selected.kind !== 'node') return;
  const n = nodeById(state.selected.id);
  if (!n) return;
  clipboardNode = { ...n };
  delete clipboardNode.id;
  updateToolbarState();
}

function pasteNode(pos) {
  if (!clipboardNode) return null;
  const w = clipboardNode.w, h = clipboardNode.h;
  const x = pos ? pos.x - w / 2 : clipboardNode.x + 30;
  const y = pos ? pos.y - h / 2 : clipboardNode.y + 30;
  const node = { ...clipboardNode, id: state.nextNodeId++, x, y };
  state.nodes.push(node);
  selectItem('node', node.id);
  saveState();
  return node;
}

function duplicateSelected() {
  copySelectedNode();
  pasteNode();
}

// ---------- Context menus ----------

let contextMenuEl = null;

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function showContextMenu(clientX, clientY, items) {
  hideContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  for (const item of items) {
    if (item === '-') {
      menu.appendChild(document.createElement('div')).className = 'context-menu-sep';
      continue;
    }
    const row = document.createElement('div');
    row.className = 'context-menu-item' + (item.heading ? ' heading' : '');
    row.textContent = item.label;
    if (!item.heading) {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hideContextMenu();
        item.action();
      });
    }
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  contextMenuEl = menu;

  // Keep the menu on-screen near the cursor.
  const rect = menu.getBoundingClientRect();
  let left = clientX, top = clientY;
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function buildNodeMenuItems(n) {
  return [
    { label: 'Rename', action: () => openRename(n) },
    { label: 'Duplicate    ⌘D', action: () => duplicateSelected() },
    { label: 'Copy    ⌘C', action: () => copySelectedNode() },
    '-',
    { label: 'Bring to Front    ]', action: () => bringToFront(n.id) },
    { label: 'Send to Back    [', action: () => sendToBack(n.id) },
    '-',
    { label: 'Delete', action: () => deleteSelected() },
  ];
}

function onNodeContextMenu(ev, n) {
  ev.preventDefault();
  ev.stopPropagation();
  selectItem('node', n.id);
  showContextMenu(ev.clientX, ev.clientY, buildNodeMenuItems(n));
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

function buildEdgeMenuItems(e, menuX, menuY) {
  const items = [{ label: 'Line Style', heading: true }];
  for (const opt of LINE_STYLE_OPTIONS) {
    const active = (e.lineStyle || 'solid') === opt.key;
    items.push({
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.lineStyle = opt.key;
        renderAll();
        saveState();
      },
    });
  }
  items.push('-');
  items.push({ label: 'Routing', heading: true });
  const isOrthogonal = e.routing === 'orthogonal';
  items.push({
    label: (!isOrthogonal ? '✓ ' : '   ') + 'Straight / Curved (drag the line to shape it)',
    action: () => {
      e.routing = undefined;
      renderAll();
      saveState();
    },
  });
  items.push({
    label: (isOrthogonal ? '✓ ' : '   ') + 'Orthogonal',
    action: () => {
      e.routing = 'orthogonal';
      e.curve = undefined;
      renderAll();
      saveState();
    },
  });
  items.push('-');
  items.push({ label: 'Arrowhead', heading: true });
  for (const opt of ARROW_STYLE_OPTIONS) {
    const active = (e.arrowStyle || 'end') === opt.key;
    items.push({
      label: (active ? '✓ ' : '   ') + opt.label,
      action: () => {
        e.arrowStyle = opt.key;
        renderAll();
        saveState();
      },
    });
  }
  items.push('-');
  items.push({ label: 'Protocol Label', heading: true });
  for (const p of PROTOCOL_PRESETS) {
    const active = e.protocol === p;
    items.push({
      label: (active ? '✓ ' : '   ') + p,
      action: () => {
        e.protocol = p;
        renderAll();
        saveState();
      },
    });
  }
  items.push({ label: '   Custom…', action: () => openProtocolEditor(e, menuX, menuY) });
  if (e.protocol) {
    items.push({
      label: '   Clear Label',
      action: () => {
        e.protocol = null;
        renderAll();
        saveState();
      },
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
  if (!clipboardNode) return;
  ev.preventDefault();
  const pos = toSVGCoords(ev.clientX, ev.clientY);
  showContextMenu(ev.clientX, ev.clientY, [{ label: 'Paste', action: () => pasteNode(pos) }]);
}

// ---------- Keyboard shortcuts ----------

function onKeyDown(ev) {
  if (ev.key === 'Escape') hideContextMenu();

  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

  const mod = ev.ctrlKey || ev.metaKey;

  if (mod && ev.key.toLowerCase() === 'c') {
    if (state.selected && state.selected.kind === 'node') {
      ev.preventDefault();
      copySelectedNode();
    }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'v') {
    if (clipboardNode) {
      ev.preventDefault();
      pasteNode();
    }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'd') {
    if (state.selected && state.selected.kind === 'node') {
      ev.preventDefault();
      duplicateSelected();
    }
    return;
  }
  if (ev.key === ']' && state.selected && state.selected.kind === 'node') {
    bringToFront(state.selected.id);
    return;
  }
  if (ev.key === '[' && state.selected && state.selected.kind === 'node') {
    sendToBack(state.selected.id);
    return;
  }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
    ev.preventDefault();
    deleteSelected();
  }
}
