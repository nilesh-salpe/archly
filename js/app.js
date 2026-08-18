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

  if (q === '') {
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

  // Edit ▾ is context-sensitive: it shows exactly what right-clicking the
  // current selection would show (same buildNodeMenuItems/buildEdgeMenuItems
  // used by the canvas context menus), or just Paste if nothing's selected.
  document.getElementById('btn-edit').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom + 4;
    if (state.selected && state.selected.kind === 'node') {
      const node = nodeById(state.selected.id);
      if (node) showContextMenu(x, y, buildNodeMenuItems(node));
      return;
    }
    if (state.selected && state.selected.kind === 'edge') {
      const edge = state.edges.find((e) => e.id === state.selected.id);
      if (edge) showContextMenu(x, y, buildEdgeMenuItems(edge, x, y));
      return;
    }
    if (clipboardNode) showContextMenu(x, y, [{ label: 'Paste', action: () => pasteNode() }]);
  });

  document.getElementById('btn-file').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const rect = ev.currentTarget.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, [
      { label: 'Export', heading: true },
      { label: '   PNG Image', action: exportPNGFile },
      { label: '   SVG Image', action: exportSVGFile },
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
  buildPatternSelect();
  wireToolbar();
  initCanvas();
});
