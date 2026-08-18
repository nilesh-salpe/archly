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
`;

function buildExportSVG() {
  const bbox = computeContentBBox();
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.no-export, .handle, .resize-handle, .label-hit').forEach((elx) => elx.remove());
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
  const xml = serializeSVG(svgEl);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const dataUrl = 'data:image/svg+xml;base64,' + svg64;

  const img = new Image();
  img.onload = () => {
    const scale = 2; // export at 2x for crisper output
    const canvas = document.createElement('canvas');
    canvas.width = bbox.w * scale;
    canvas.height = bbox.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, 'architecture-diagram.png'), 'image/png');
  };
  img.src = dataUrl;
}
