// Edge path/geometry math: clips a straight (or gently curved, when parallel
// edges share the same pair of nodes) line to each node's rectangle border,
// and returns the midpoint used for the numbered badge.

function clipPointOnRect(cx, cy, tx, ty, rect) {
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function computeEdgeGeometry(edge, allEdges, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;

  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;

  const sRect = { x: s.x, y: s.y, w: s.w, h: s.h };
  const tRect = { x: t.x, y: t.y, w: t.w, h: t.h };
  const scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;

  const start = clipPointOnRect(scx, scy, tcx, tcy, sRect);
  const end = clipPointOnRect(tcx, tcy, scx, scy, tRect);

  // Separate parallel edges between the same pair of nodes so they don't overlap.
  const group = allEdges.filter((e) => pairKey(e.from, e.to) === pairKey(edge.from, edge.to));
  const idx = group.findIndex((e) => e.id === edge.id);
  const mid = (group.length - 1) / 2;
  const bend = group.length > 1 ? (idx - mid) * 28 : 0;

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;

  let d, badge;
  if (bend === 0) {
    d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    badge = { x: mx, y: my };
  } else {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const cx = mx + nx * bend;
    const cy = my + ny * bend;
    d = `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
    badge = { x: cx, y: cy };
  }

  return { start, end, d, badge };
}
