// Wires up the palette, toolbar, and app init. All diagram logic lives in
// canvas.js / arrows.js / animate.js / patterns.js / export.js.

function buildPaletteIconSVG(comp) {
  const svgEl = document.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('viewBox', '0 0 24 24');
  svgEl.setAttribute('width', 22);
  svgEl.setAttribute('height', 22);
  svgEl.setAttribute('fill', 'none');
  svgEl.setAttribute('stroke', CATEGORY_COLORS[comp.category] || '#64748b');
  svgEl.setAttribute('stroke-width', '1.4');
  svgEl.setAttribute('stroke-linecap', 'round');
  svgEl.setAttribute('stroke-linejoin', 'round');
  svgEl.innerHTML = ICONS[comp.icon] || '';
  return svgEl;
}

let paletteEntries = []; // {comp, itemEl, sectionEl} — built once, used by filterPalette()

function buildPalette() {
  const paletteEl = document.getElementById('palette');
  const byCategory = {};
  for (const comp of COMPONENTS) {
    (byCategory[comp.category] = byCategory[comp.category] || []).push(comp);
  }

  paletteEntries = [];

  for (const cat of Object.keys(CATEGORY_LABELS)) {
    const items = byCategory[cat];
    if (!items) continue;

    const section = document.createElement('div');
    section.className = 'palette-category collapsed'; // groups start minimized

    const heading = document.createElement('h3');
    heading.innerHTML = `<span class="cat-chevron">&#9662;</span>${CATEGORY_LABELS[cat]}`;
    heading.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'palette-items';

    for (const comp of items) {
      const item = document.createElement('div');
      item.className = 'palette-item' + (comp.container ? ' is-container' : '');
      item.draggable = true;
      item.title = comp.label;

      item.appendChild(buildPaletteIconSVG(comp));
      const label = document.createElement('span');
      label.textContent = comp.label;
      item.appendChild(label);

      item.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/component-id', comp.id);
        ev.dataTransfer.effectAllowed = 'copy';
      });

      list.appendChild(item);
      paletteEntries.push({ comp, itemEl: item, sectionEl: section });
    }

    section.appendChild(list);
    paletteEl.appendChild(section);
  }
}

// Search filters items by label; a category auto-expands if it has a match
// and hides entirely if it has none, collapsing back to the default
// (all-minimized) state once the search box is cleared.
function filterPalette(query) {
  const q = query.trim().toLowerCase();
  const sectionsSeen = new Set();
  const emptyEl = document.getElementById('palette-empty');

  if (q === '') {
    if (emptyEl) emptyEl.style.display = 'none';
    for (const { itemEl, sectionEl } of paletteEntries) {
      itemEl.style.display = '';
      sectionEl.style.display = '';
      sectionEl.classList.add('collapsed');
    }
    return;
  }

  const sectionsWithMatch = new Set();
  for (const { comp, itemEl, sectionEl } of paletteEntries) {
    sectionsSeen.add(sectionEl);
    const match = comp.label.toLowerCase().includes(q);
    itemEl.style.display = match ? '' : 'none';
    if (match) sectionsWithMatch.add(sectionEl);
  }

  for (const sectionEl of sectionsSeen) {
    if (sectionsWithMatch.has(sectionEl)) {
      sectionEl.style.display = '';
      sectionEl.classList.remove('collapsed');
    } else {
      sectionEl.style.display = 'none';
    }
  }

  if (emptyEl) {
    emptyEl.style.display = sectionsWithMatch.size === 0 ? 'block' : 'none';
    emptyEl.textContent = `No components match "${query.trim()}"`;
  }
}

// ---------- Pattern picker (thumbnail dropdown) ----------
// A small silhouette SVG per pattern — just colored rects at each node's
// position/size, no icons or labels — so the list is scannable at a glance
// without re-rendering full nodes for every entry.

function buildPatternThumbnail(pattern) {
  const nodes = pattern.nodes;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + (n.w || (getComponent(n.type) || {}).w || DEFAULT_NODE_W)));
  const maxY = Math.max(...nodes.map((n) => n.y + (n.h || (getComponent(n.type) || {}).h || DEFAULT_NODE_H)));
  const svgEl = document.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${maxX - minX} ${maxY - minY}`);
  svgEl.setAttribute('class', 'pattern-thumb');
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  for (const n of nodes) {
    const def = getComponent(n.type);
    if (!def) continue;
    const nw = n.w || def.w || DEFAULT_NODE_W;
    const nh = n.h || def.h || DEFAULT_NODE_H;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', n.x - minX);
    rect.setAttribute('y', n.y - minY);
    rect.setAttribute('width', nw);
    rect.setAttribute('height', nh);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', def.container ? 'none' : CATEGORY_FILLS[def.category] || '#e2e8f0');
    rect.setAttribute('stroke', CATEGORY_COLORS[def.category] || '#94a3b8');
    rect.setAttribute('stroke-width', def.container ? 2 : 1);
    if (def.container) rect.setAttribute('stroke-dasharray', '4 3');
    svgEl.appendChild(rect);
  }
  return svgEl;
}

let patternPanelEl = null;

function hidePatternPanel() {
  if (patternPanelEl) {
    patternPanelEl.remove();
    patternPanelEl = null;
  }
}

function buildPatternPanel() {
  const panel = document.createElement('div');
  panel.className = 'pattern-panel';
  for (const p of PATTERNS) {
    const row = document.createElement('div');
    row.className = 'pattern-panel-item';
    row.appendChild(buildPatternThumbnail(p));
    const label = document.createElement('span');
    label.textContent = p.name;
    row.appendChild(label);
    row.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hidePatternPanel();
      loadPattern(p.id);
    });
    panel.appendChild(row);
  }
  return panel;
}

function togglePatternPanel(ev) {
  ev.stopPropagation();
  if (patternPanelEl) {
    hidePatternPanel();
    return;
  }
  hideContextMenu();
  hideHelpPanel();
  const rect = ev.currentTarget.getBoundingClientRect();
  const panel = buildPatternPanel();
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(panel);
  patternPanelEl = panel;
}

// A handful of quick-start shortcuts shown on the empty canvas — the most
// commonly reached-for patterns, not the full library (that's what the
// Patterns ▾ dropdown is for).
const QUICK_START_PATTERN_IDS = ['3tier', 'microservices', 'rag'];

function buildEmptyStateShortcuts() {
  const wrap = document.getElementById('empty-state-patterns');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const id of QUICK_START_PATTERN_IDS) {
    const p = getPattern(id);
    if (!p) continue;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = p.name;
    btn.addEventListener('click', () => loadPattern(p.id));
    wrap.appendChild(btn);
  }
}

// ---------- Help / tips panel ----------

let helpPanelEl = null;

function hideHelpPanel() {
  if (helpPanelEl) {
    helpPanelEl.remove();
    helpPanelEl = null;
  }
}

function buildHelpPanel() {
  const panel = document.createElement('div');
  panel.className = 'help-panel';
  panel.innerHTML = `
    <h4>Canvas</h4>
    <dl>
      <dt>drag</dt><dd>Move a node, or resize a container from its corner handle</dd>
      <dt>drag near an edge</dt><dd>Draw a flow arrow from that exact point — any point on the border, not fixed dots</dd>
      <dt>drag a line</dt><dd>Move its bend — a curve's one bend point, or an orthogonal arrow's middle segment</dd>
      <dt>double-click a line</dt><dd>Orthogonal: add an extra elbow there. Curve: remove its bend</dd>
      <dt>double-click a bend point</dt><dd>Remove it</dd>
      <dt>shift-click</dt><dd>Add/remove a node from a multi-selection</dd>
      <dt>drag empty canvas</dt><dd>Rubber-band select multiple nodes</dd>
      <dt>right-click</dt><dd>Full menu for the node/arrow under the cursor</dd>
    </dl>
    <h4>Keyboard</h4>
    <dl>
      <dt>⌘Z / ⌘⇧Z</dt><dd>Undo / redo</dd>
      <dt>⌘C / ⌘V / ⌘D</dt><dd>Copy / paste / duplicate selection</dd>
      <dt>⌘A</dt><dd>Select all nodes</dd>
      <dt>Arrow keys</dt><dd>Nudge selection 1px (10px with Shift)</dd>
      <dt>[ / ]</dt><dd>Send to back / bring to front</dd>
      <dt>Delete</dt><dd>Remove selection</dd>
      <dt>Alt-drag</dt><dd>Move/resize without grid or alignment snapping</dd>
    </dl>
    <h4>View</h4>
    <dl>
      <dt>Ctrl/⌘+scroll</dt><dd>Zoom in/out under the cursor</dd>
      <dt>Fit</dt><dd>Zoom to fit the whole diagram in view</dd>
    </dl>
  `;
  return panel;
}

function toggleHelpPanel(ev) {
  if (ev) ev.stopPropagation();
  if (helpPanelEl) {
    hideHelpPanel();
    return;
  }
  hideContextMenu();
  hidePatternPanel();
  const btn = document.getElementById('btn-help');
  const rect = btn.getBoundingClientRect();
  const panel = buildHelpPanel();
  panel.style.right = `${window.innerWidth - rect.right}px`;
  panel.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(panel);
  helpPanelEl = panel;
}

function wireToolbar() {
  document.getElementById('btn-new').addEventListener('click', () => {
    if (state.nodes.length && !confirm('Clear the entire diagram? This cannot be undone.')) return;
    resetFlow();
    clearDiagram();
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  document.getElementById('btn-pattern').addEventListener('click', togglePatternPanel);
  document.getElementById('btn-help').addEventListener('click', toggleHelpPanel);

  document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
  document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
  document.getElementById('zoom-label').addEventListener('click', zoomReset);
  document.getElementById('btn-zoom-fit').addEventListener('click', zoomToFit);

  document.getElementById('btn-palette-tab').addEventListener('click', togglePalette);
  document.getElementById('btn-results-tab').addEventListener('click', toggleResultsPanel);

  document.getElementById('btn-view').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    const items = [
      { label: (showGrid ? '✓ ' : '   ') + 'Grid Background', action: toggleGrid },
      { label: (showRulers ? '✓ ' : '   ') + 'Rulers', action: toggleRulers },
      { label: (showPalette ? '✓ ' : '   ') + 'Palette', action: togglePalette },
      '-',
      { label: (showSimAnnotations ? '✓ ' : '   ') + 'Latency & Cost (simulated)', action: toggleSimAnnotations },
    ];
    if (hasSimFailures()) {
      items.push({ label: `   Clear Failures (${simFailedNodeIds.size + simFailedEdgeIds.size})`, action: clearSimFailures });
    }
    showContextMenu(rect.left, rect.bottom + 4, items);
  });

  document.getElementById('btn-play').addEventListener('click', playFlow);
  document.getElementById('btn-pause').addEventListener('click', pauseFlow);
  document.getElementById('btn-reset').addEventListener('click', resetFlow);

  document.getElementById('speed-select').addEventListener('change', (ev) => {
    playState.speedMs = parseInt(ev.target.value, 10);
  });

  // Edit ▾ is context-sensitive: it shows exactly what right-clicking the
  // current selection would show (same buildNodeMenuItems/buildEdgeMenuItems
  // used by the canvas context menus), or just Paste if nothing's selected.
  document.getElementById('btn-edit').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom + 4;
    if (state.multiIds.size > 1) {
      showContextMenu(x, y, buildMultiSelectMenuItems());
      return;
    }
    if (state.selected && state.selected.kind === 'node') {
      const node = nodeById(state.selected.id);
      if (node) showContextMenu(x, y, buildNodeMenuItems(node, x, y));
      return;
    }
    if (state.selected && state.selected.kind === 'edge') {
      const edge = state.edges.find((e) => e.id === state.selected.id);
      if (edge) showContextMenu(x, y, buildEdgeMenuItems(edge, x, y));
      return;
    }
    if (clipboardNodes && clipboardNodes.length) showContextMenu(x, y, [{ label: 'Paste', action: () => pasteNode() }]);
  });

  document.getElementById('btn-file').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, [
      { label: 'Export', heading: true },
      { label: '   PNG Image', action: exportPNGFile },
      { label: '   SVG Image', action: exportSVGFile },
      { label: '   Animated SVG (plays the flow)', action: exportAnimatedSVGFile },
      { label: '   YAML', action: exportYAMLFile },
      '-',
      { label: 'Import YAML…', action: () => document.getElementById('import-yaml-input').click() },
    ]);
  });

  const importInput = document.getElementById('import-yaml-input');
  importInput.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) importYAMLFile(file);
    ev.target.value = '';
  });

  document.getElementById('palette-search').addEventListener('input', (ev) => {
    filterPalette(ev.target.value);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPatternDefinitions();
  buildPalette();
  buildEmptyStateShortcuts();
  wireToolbar();
  initCanvas();
});
