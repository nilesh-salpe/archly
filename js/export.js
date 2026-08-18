// Exports the diagram by cloning the live SVG, trimming it to the content's
// bounding box (with padding) and a solid background, then either downloading
// it directly as .svg or rasterizing it to a PNG via an offscreen canvas.

function computeContentBBox() {
  const pad = 40;
  if (state.nodes.length === 0) return { x: 0, y: 0, w: 500, h: 350 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

// The exported file is a standalone SVG document with no access to
// styles.css, so every rule an exported element depends on (edges, arrow
// markers, icons, badges, container boxes) must be inlined here — anything
// left to the external stylesheet falls back to SVG defaults (black fill).
const EXPORT_STYLE = `
  .node-icon { stroke: #1e293b; stroke-width: 1.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .node-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: #1e293b; text-anchor: middle; font-weight: 500; }
  .text-node-label { font-size: 16px; font-weight: 600; }
  .container-rect { fill: rgba(148, 163, 184, 0.08); stroke: #94a3b8; stroke-width: 1.5; stroke-dasharray: 6 4; }
  .container-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; fill: #64748b; }
  .edge-path { fill: none; stroke: #64748b; stroke-width: 2; }
  .arrowhead-path { fill: #64748b; }
  .edge-badge circle { fill: #ffffff; stroke: #64748b; stroke-width: 1.5; }
  .edge-badge text { fill: #334155; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
  .edge-protocol rect { fill: #ffffff; stroke: #94a3b8; stroke-width: 1; }
  .edge-protocol text { fill: #475569; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; text-anchor: middle; dominant-baseline: central; }
`;

function buildExportSVG() {
  const bbox = computeContentBBox();
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.no-export, .handle, .resize-handle, .label-hit, .edge-hit').forEach((elx) => elx.remove());
  clone.querySelectorAll('.selected').forEach((elx) => elx.classList.remove('selected'));
  clone.querySelectorAll('.flow-active').forEach((elx) => elx.classList.remove('flow-active'));

  clone.setAttribute('width', bbox.w);
  clone.setAttribute('height', bbox.h);
  clone.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = EXPORT_STYLE;
  clone.insertBefore(style, clone.firstChild);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', bbox.x);
  bg.setAttribute('y', bbox.y);
  bg.setAttribute('width', bbox.w);
  bg.setAttribute('height', bbox.h);
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  return { svgEl: clone, bbox };
}

function serializeSVG(svgEl) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  return `<?xml version="1.0" standalone="no"?>\r\n${xml}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSVGFile() {
  const { svgEl } = buildExportSVG();
  const xml = serializeSVG(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  downloadBlob(blob, 'architecture-diagram.svg');
}

function exportPNGFile() {
  const { svgEl, bbox } = buildExportSVG();
  const scale = 2; // export at 2x for crisper output

  // Set the SVG's own width/height (not just the canvas) to the 2x target so
  // the browser's SVG rasterizer renders at full resolution natively. Doing
  // the upscale via ctx.scale() instead — rasterizing once at 1x, then
  // stretching — produced visible anti-aliasing artifacts (a solid dark fill
  // between two closely-spaced parallel curves) that aren't in the source
  // SVG at all; this keeps the rasterizer's own anti-aliasing math correct.
  svgEl.setAttribute('width', bbox.w * scale);
  svgEl.setAttribute('height', bbox.h * scale);

  const xml = serializeSVG(svgEl);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const dataUrl = 'data:image/svg+xml;base64,' + svg64;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = bbox.w * scale;
    canvas.height = bbox.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => downloadBlob(blob, 'architecture-diagram.png'), 'image/png');
  };
  img.src = dataUrl;
}

// ---------- YAML export / import ----------
// A human-readable, hand-editable alternative to PNG/SVG: the diagram's raw
// node/edge data rather than a rendering of it. `category`/`icon`/`container`/
// `textOnly` are never written — they're always re-derived from `type` via
// getComponent() on import, exactly like loading a built-in pattern does.

function diagramToYAMLObject() {
  return {
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      x: Math.round(n.x),
      y: Math.round(n.y),
      w: Math.round(n.w),
      h: Math.round(n.h),
    })),
    edges: state.edges.map((e) => {
      const obj = { from: e.from, to: e.to, number: e.number };
      if (e.lineStyle && e.lineStyle !== 'solid') obj.lineStyle = e.lineStyle;
      if (e.arrowStyle && e.arrowStyle !== 'end') obj.arrowStyle = e.arrowStyle;
      if (e.protocol) obj.protocol = e.protocol;
      return obj;
    }),
  };
}

function exportYAMLFile() {
  const yaml = stringifyYAML(diagramToYAMLObject());
  const blob = new Blob([yaml], { type: 'application/x-yaml' });
  downloadBlob(blob, 'architecture-diagram.yaml');
}

function importYAMLFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = parseYAML(reader.result);
    } catch (e) {
      alert('Could not read this file as YAML: ' + e.message);
      return;
    }
    if (!data || !Array.isArray(data.nodes)) {
      alert('This doesn’t look like an Archly diagram (no "nodes" list found).');
      return;
    }

    const idMap = {};
    const nodes = [];
    let nid = 1;
    for (const spec of data.nodes) {
      const def = getComponent(spec.type);
      if (!def) continue; // unknown component type — skip rather than fail the whole import
      const w = spec.w || def.w || DEFAULT_NODE_W;
      const h = spec.h || def.h || DEFAULT_NODE_H;
      const node = {
        id: nid,
        type: def.id,
        category: def.category,
        label: spec.label || def.label,
        icon: def.icon,
        container: !!def.container,
        textOnly: !!def.textOnly,
        x: spec.x || 0,
        y: spec.y || 0,
        w,
        h,
      };
      idMap[spec.id] = nid;
      nodes.push(node);
      nid++;
    }

    const edges = (data.edges || [])
      .filter((e) => idMap[e.from] !== undefined && idMap[e.to] !== undefined)
      .map((e, i) => ({
        id: i + 1,
        from: idMap[e.from],
        to: idMap[e.to],
        number: e.number || i + 1,
        lineStyle: e.lineStyle || 'solid',
        arrowStyle: e.arrowStyle || 'end',
        protocol: e.protocol || null,
      }));

    if (state.nodes.length && !confirm('Replace the current diagram with the imported one? This cannot be undone.')) return;
    loadDiagram(nodes, edges, nid, edges.length + 1);
  };
  reader.onerror = () => alert('Could not read the selected file.');
  reader.readAsText(file);
}
