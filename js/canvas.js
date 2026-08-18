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

function initCanvas() {
  svg = document.getElementById('canvas');
  layerContainers = document.getElementById('layer-containers');
  layerEdges = document.getElementById('layer-edges');
  layerNodes = document.getElementById('layer-nodes');
  layerOverlay = document.getElementById('layer-overlay');

  const wrap = document.getElementById('canvas-wrap');
  wrap.addEventListener('dragover', onCanvasDragOver);
  wrap.addEventListener('drop', onCanvasDrop);
  wrap.addEventListener('click', () => {
    state.selected = null;
    renderAll();
  });

  window.addEventListener('keydown', onKeyDown);

  loadState();
  renderAll();
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

  ensureFlowDot();
}

function renderContainerNode(n) {
  const g = el('g', { class: 'node container-node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (state.selected && state.selected.kind === 'node' && state.selected.id === n.id) g.classList.add('selected');

  const rect = el('rect', { class: 'container-rect', x: 0, y: 0, width: n.w, height: n.h, rx: 10 });
  const label = el('text', { class: 'container-label', x: 10, y: 20 }, textNode(n.label));

  const resize = el('rect', {
    class: 'resize-handle',
    x: n.w - 10,
    y: n.h - 10,
    width: 10,
    height: 10,
  });

  g.appendChild(rect);
  g.appendChild(label);
  g.appendChild(resize);

  rect.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
  label.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
  resize.addEventListener('pointerdown', (ev) => startResizeContainer(ev, n));
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectItem('node', n.id);
  });

  return g;
}

function renderRegularNode(n) {
  const g = el('g', { class: 'node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
  if (state.selected && state.selected.kind === 'node' && state.selected.id === n.id) g.classList.add('selected');

  const fill = CATEGORY_FILLS[n.category] || '#e2e8f0';
  const stroke = CATEGORY_COLORS[n.category] || '#64748b';

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

  const iconSize = 26;
  const iconG = el(
    'g',
    { class: 'node-icon', transform: `translate(${n.w / 2 - iconSize / 2},8) scale(${iconSize / 24})` }
  );
  iconG.innerHTML = ICONS[n.icon] || '';

  const label = el('text', { class: 'node-label', x: n.w / 2, y: n.h - 12 }, textNode(n.label));

  g.appendChild(body);
  g.appendChild(iconG);
  g.appendChild(label);

  for (const dir of ['n', 'e', 's', 'w']) {
    g.appendChild(makeHandle(n, dir));
  }

  body.addEventListener('pointerdown', (ev) => startDragNode(ev, n));
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectItem('node', n.id);
  });

  return g;
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
  const hit = el('path', { class: 'edge-hit', d: geo.d });

  const badge = el('g', { class: 'edge-badge', transform: `translate(${geo.badge.x},${geo.badge.y})` });
  badge.appendChild(el('circle', { r: 11 }));
  const numText = el('text', { x: 0, y: 1 }, textNode(String(e.number)));
  badge.appendChild(numText);

  hit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectItem('edge', e.id);
  });
  badge.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openBadgeEditor(e, badge);
  });

  g.appendChild(path);
  g.appendChild(hit);
  g.appendChild(badge);
  return g;
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

// ---------- Selection & deletion ----------

function selectItem(kind, id) {
  state.selected = { kind, id };
  renderAll();
}

function onKeyDown(ev) {
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    ev.preventDefault();
    resetFlow();
    if (state.selected.kind === 'node') removeNode(state.selected.id);
    else removeEdge(state.selected.id);
    state.selected = null;
    renderAll();
    saveState();
  }
}
