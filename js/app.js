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

function buildPalette() {
  const paletteEl = document.getElementById('palette');
  const byCategory = {};
  for (const comp of COMPONENTS) {
    (byCategory[comp.category] = byCategory[comp.category] || []).push(comp);
  }

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
    }

    section.appendChild(list);
    paletteEl.appendChild(section);
  }
}

function buildPatternSelect() {
  const select = document.getElementById('pattern-select');
  for (const p of PATTERNS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    if (select.value) loadPattern(select.value);
    select.value = '';
  });
}

function wireToolbar() {
  document.getElementById('btn-new').addEventListener('click', () => {
    if (state.nodes.length && !confirm('Clear the entire diagram? This cannot be undone.')) return;
    resetFlow();
    clearDiagram();
  });

  document.getElementById('btn-palette-tab').addEventListener('click', togglePalette);

  document.getElementById('btn-view').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, [
      { label: (showGrid ? '✓ ' : '   ') + 'Grid Background', action: toggleGrid },
      { label: (showRulers ? '✓ ' : '   ') + 'Rulers', action: toggleRulers },
      { label: (showPalette ? '✓ ' : '   ') + 'Palette', action: togglePalette },
    ]);
  });

  document.getElementById('btn-play').addEventListener('click', playFlow);
  document.getElementById('btn-pause').addEventListener('click', pauseFlow);
  document.getElementById('btn-reset').addEventListener('click', resetFlow);

  document.getElementById('speed-select').addEventListener('change', (ev) => {
    playState.speedMs = parseInt(ev.target.value, 10);
  });

  document.getElementById('btn-copy').addEventListener('click', copySelectedNode);
  document.getElementById('btn-paste').addEventListener('click', () => pasteNode());
  document.getElementById('btn-duplicate').addEventListener('click', duplicateSelected);
  document.getElementById('btn-front').addEventListener('click', () => {
    if (state.selected && state.selected.kind === 'node') bringToFront(state.selected.id);
  });
  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.selected && state.selected.kind === 'node') sendToBack(state.selected.id);
  });
  document.getElementById('btn-delete').addEventListener('click', deleteSelected);

  document.getElementById('btn-linestyle').addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!state.selected || state.selected.kind !== 'edge') return;
    const edge = state.edges.find((e) => e.id === state.selected.id);
    if (!edge) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    showContextMenu(
      rect.left,
      rect.bottom + 4,
      LINE_STYLE_OPTIONS.map((opt) => ({
        label: ((edge.lineStyle || 'solid') === opt.key ? '✓ ' : '   ') + opt.label,
        action: () => {
          edge.lineStyle = opt.key;
          renderAll();
          saveState();
        },
      }))
    );
  });

  document.getElementById('btn-arrowstyle').addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!state.selected || state.selected.kind !== 'edge') return;
    const edge = state.edges.find((e) => e.id === state.selected.id);
    if (!edge) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    showContextMenu(
      rect.left,
      rect.bottom + 4,
      ARROW_STYLE_OPTIONS.map((opt) => ({
        label: ((edge.arrowStyle || 'end') === opt.key ? '✓ ' : '   ') + opt.label,
        action: () => {
          edge.arrowStyle = opt.key;
          renderAll();
          saveState();
        },
      }))
    );
  });

  document.getElementById('btn-export-png').addEventListener('click', exportPNGFile);
  document.getElementById('btn-export-svg').addEventListener('click', exportSVGFile);
  document.getElementById('btn-export-yaml').addEventListener('click', exportYAMLFile);

  const importInput = document.getElementById('import-yaml-input');
  document.getElementById('btn-import-yaml').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) importYAMLFile(file);
    ev.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPatternDefinitions();
  buildPalette();
  buildPatternSelect();
  wireToolbar();
  initCanvas();
});
