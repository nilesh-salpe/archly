// Edge path/geometry math: clips a straight (or curved) line to each node's
// rectangle border. Curvature comes from one of two sources — parallel edges
// between the same pair of nodes auto-bend apart so they don't overlap, or a
// user-set `edge.curve` (dragged by hand, see startEdgeBend in canvas.js)
// overrides that. Either way, the midpoint used for the numbered badge is
// wherever the curve's control point lands.

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

// The straight-line endpoints (clipped to each node's border), ignoring any
// curve — the stable reference frame that both rendering and the drag-to-bend
// interaction measure against.
function computeStraightEndpoints(edge, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;

  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;

  const sRect = { x: s.x, y: s.y, w: s.w, h: s.h };
  const tRect = { x: t.x, y: t.y, w: t.w, h: t.h };
  const scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;

  return {
    start: clipPointOnRect(scx, scy, tcx, tcy, sRect),
    end: clipPointOnRect(tcx, tcy, scx, scy, tRect),
  };
}

function edgeNormal(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

// A right-angle "elbow" path between two node rects, entering/exiting from
// whichever side each node faces the other — one bend if they're offset on
// the cross-axis, a straight line if they're already aligned.
function computeOrthogonalPath(edge, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;

  const scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
  const dx = tcx - scx, dy = tcy - scy;

  let points;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? s.x + s.w : s.x;
    const ex = dx >= 0 ? t.x : t.x + t.w;
    const start = { x: sx, y: scy };
    const end = { x: ex, y: tcy };
    const midX = (sx + ex) / 2;
    points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  } else {
    const sy = dy >= 0 ? s.y + s.h : s.y;
    const ey = dy >= 0 ? t.y : t.y + t.h;
    const start = { x: scx, y: sy };
    const end = { x: tcx, y: ey };
    const midY = (sy + ey) / 2;
    points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  return points;
}

function computeEdgeGeometry(edge, allEdges, allNodes) {
  if (edge.routing === 'orthogonal') {
    const points = computeOrthogonalPath(edge, allNodes);
    if (!points) return null;
    const d = `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`;
    const badge = { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 };
    const labelPos = { x: badge.x, y: badge.y - 20 };
    return { start: points[0], end: points[points.length - 1], d, badge, labelPos };
  }

  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return null;
  const { start, end } = ep;

  // Separate parallel edges between the same pair of nodes so they don't
  // overlap — unless the user has manually curved this edge, which wins.
  const group = allEdges.filter((e) => pairKey(e.from, e.to) === pairKey(edge.from, edge.to));
  const idx = group.findIndex((e) => e.id === edge.id);
  const mid = (group.length - 1) / 2;
  const autoBend = group.length > 1 ? (idx - mid) * 28 : 0;
  const bend = typeof edge.curve === 'number' ? edge.curve : autoBend;

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const { nx, ny } = edgeNormal(start, end);

  let d, badge;
  if (bend === 0) {
    d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    badge = { x: mx, y: my };
  } else {
    const cx = mx + nx * bend;
    const cy = my + ny * bend;
    d = `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
    badge = { x: cx, y: cy };
  }

  // Where an optional protocol label (e.g. "REST", "gRPC") sits — further out
  // along the same perpendicular as the badge, so it clears the number badge.
  const labelPos = { x: badge.x + nx * 20, y: badge.y + ny * 20 };

  return { start, end, d, badge, labelPos };
}

// Given a point the user dragged to (in SVG coords), returns the perpendicular
// signed distance from the edge's straight-line midpoint — i.e. the new
// edge.curve value that makes the curve's control point track the cursor.
function computeBendFromPoint(edge, allNodes, point) {
  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return 0;
  const { start, end } = ep;
  const { nx, ny } = edgeNormal(start, end);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  return (point.x - mx) * nx + (point.y - my) * ny;
}
