// Edge path/geometry math: clips a straight (or curved) line to each node's
// rectangle border, or — when a node end has an explicit `fromAnchor`/
// `toAnchor` (see startConnect in canvas.js) — starts exactly at that fixed
// border point instead of the dynamic "closest point to the other node's
// center" default.
//
// Curves get exactly one bend point (`edge.curve`, a signed perpendicular
// offset from the straight-line midpoint) — draw.io-style: drag anywhere on
// the line to set it, no more. Orthogonal edges default to the classic
// two-corner "Z" (or straight/"L" when rows or columns already align), with
// each corner independently adjustable (`edge.elbowOffset` near the start,
// `edge.elbowOffsetEnd` near the end) — dragging near either corner *moves*
// that corner only; when they diverge, one extra connecting jog keeps the
// route orthogonal. Dragging never creates a brand-new bend beyond that
// pair. An explicit, deliberate action (double-click — see canvas.js) can
// add real extra bend points (`edge.waypoints`) beyond that pair for edges
// that genuinely need to route around something; once any exist, the route
// passes through all of them in order instead of using the default Z.
// (An earlier version let every drag add a new curve/waypoint; useful in
// isolation, but a diagram builds up bends fast and unpredictably compared
// to how draw.io/Visio/Lucidchart behave, so it's gone.)

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

// Converts a {side, t} anchor (t = 0..1 fraction along that side) into an
// absolute point on the node's current border — recomputed from the node's
// live x/y/w/h every render, so anchors stay put (proportionally) through
// moves and resizes without needing to be migrated.
function anchorAbsolutePoint(node, anchor) {
  const t = Math.max(0, Math.min(1, anchor.t));
  switch (anchor.side) {
    case 'n': return { x: node.x + t * node.w, y: node.y };
    case 's': return { x: node.x + t * node.w, y: node.y + node.h };
    case 'w': return { x: node.x, y: node.y + t * node.h };
    default: return { x: node.x + node.w, y: node.y + t * node.h };
  }
}

// The straight-line endpoints — a fixed anchor point if the edge end was
// drawn from/to a specific border point, otherwise the node-rect border
// point closest to the other node's center (the original dynamic default).
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
    start: edge.fromAnchor ? anchorAbsolutePoint(s, edge.fromAnchor) : clipPointOnRect(scx, scy, tcx, tcy, sRect),
    end: edge.toAnchor ? anchorAbsolutePoint(t, edge.toAnchor) : clipPointOnRect(tcx, tcy, scx, scy, tRect),
  };
}

function edgeNormal(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

// ---------- Orthogonal routing ----------

// The border exit/entry points and the default (unshifted) middle-segment
// position for the classic two-corner "Z" — shared by the actual path
// builder below and by canvas.js's elbow-drag (which needs the same base
// value to compute a new edge.elbowOffset from the cursor).
function orthogonalDefaultBase(edge, s, t) {
  const scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
  const dx = tcx - scx, dy = tcy - scy;
  const horiz = Math.abs(dx) >= Math.abs(dy);

  let start, end;
  if (horiz) {
    const sx = dx >= 0 ? s.x + s.w : s.x;
    const ex = dx >= 0 ? t.x : t.x + t.w;
    start = edge.fromAnchor ? anchorAbsolutePoint(s, edge.fromAnchor) : { x: sx, y: scy };
    end = edge.toAnchor ? anchorAbsolutePoint(t, edge.toAnchor) : { x: ex, y: tcy };
  } else {
    const sy = dy >= 0 ? s.y + s.h : s.y;
    const ey = dy >= 0 ? t.y : t.y + t.h;
    start = edge.fromAnchor ? anchorAbsolutePoint(s, edge.fromAnchor) : { x: scx, y: sy };
    end = edge.toAnchor ? anchorAbsolutePoint(t, edge.toAnchor) : { x: tcx, y: ey };
  }
  return { horiz, start, end, mid: horiz ? (start.x + end.x) / 2 : (start.y + end.y) / 2 };
}

// The default "Z" has two corners, each independently draggable
// (edge.elbowOffset near the start, edge.elbowOffsetEnd near the end) —
// dragging one moves only that corner, matching how the rest of the app's
// bend gestures work (a drag moves an existing point, never adds one).
// When both corners land on the same coordinate it's the classic single-jog
// Z; when they differ, one extra connecting jog (at the start/end midpoint
// on the cross axis) keeps the route fully orthogonal — the same shape a
// waypoint would produce, just derived from two numbers instead of an
// explicit point list.
function computeOrthogonalDefault(edge, s, t) {
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  const m1 = mid + (typeof edge.elbowOffset === 'number' ? edge.elbowOffset : 0);
  const m2 = mid + (typeof edge.elbowOffsetEnd === 'number' ? edge.elbowOffsetEnd : 0);
  if (m1 === m2) {
    if (horiz) return [start, { x: m1, y: start.y }, { x: m1, y: end.y }, end];
    return [start, { x: start.x, y: m1 }, { x: end.x, y: m1 }, end];
  }
  if (horiz) {
    const cross = (start.y + end.y) / 2;
    return [start, { x: m1, y: start.y }, { x: m1, y: cross }, { x: m2, y: cross }, { x: m2, y: end.y }, end];
  }
  const cross = (start.x + end.x) / 2;
  return [start, { x: start.x, y: m1 }, { x: cross, y: m1 }, { x: cross, y: m2 }, { x: end.x, y: m2 }, end];
}

// canvas.js calls this to turn a drag position directly into a new
// edge.elbowOffset/elbowOffsetEnd (absolute, not incremental) — {axis, base}
// says which screen coordinate to read off the cursor and what to subtract
// from it; c1/c2 are the two corners' current positions, so canvas.js can
// tell which one a pointerdown landed nearest to.
function computeOrthogonalCornerBases(edge, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  const m1 = mid + (typeof edge.elbowOffset === 'number' ? edge.elbowOffset : 0);
  const m2 = mid + (typeof edge.elbowOffsetEnd === 'number' ? edge.elbowOffsetEnd : 0);
  const c1 = horiz ? { x: m1, y: start.y } : { x: start.x, y: m1 };
  const c2 = horiz ? { x: m2, y: end.y } : { x: end.x, y: m2 };
  return { axis: horiz ? 'x' : 'y', base: mid, c1, c2 };
}

// Clips an axis-aligned segment (p0 -> p1, where p0 is inside/at the rect)
// to where it crosses the rect's boundary — used to trim the first/last hop
// of a waypointed route back to the node's edge when that end has no
// explicit anchor.
function clipAxisSegmentToRect(p0, p1, rect) {
  if (p0.y === p1.y) {
    const goingRight = p1.x >= p0.x;
    return { x: goingRight ? rect.x + rect.w : rect.x, y: p0.y };
  }
  const goingDown = p1.y >= p0.y;
  return { x: p0.x, y: goingDown ? rect.y + rect.h : rect.y };
}

// One right-angle jog between two points, entering horizontally-then-
// vertically or vertically-then-horizontally per `horizFirst` — a fixed
// choice shared by every hop in a waypointed route (see below) so
// consecutive jogs never land on the same corner and retrace themselves.
function orthogonalJog(a, b, horizFirst) {
  if (horizFirst) return [{ x: b.x, y: a.y }];
  return [{ x: a.x, y: b.y }];
}

// The "advanced" route for an edge with explicit waypoints (added via
// double-click — see canvas.js): a fully axis-aligned polyline passing
// through every one of them in order, all hops sharing one orientation
// (decided once from the overall start→end direction) so the path
// staircases cleanly.
function computeOrthogonalWaypointed(edge, s, t, waypoints) {
  const startRef = edge.fromAnchor ? anchorAbsolutePoint(s, edge.fromAnchor) : { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  const endRef = edge.toAnchor ? anchorAbsolutePoint(t, edge.toAnchor) : { x: t.x + t.w / 2, y: t.y + t.h / 2 };

  const refs = [startRef, ...waypoints, endRef];
  const horizFirst = Math.abs(endRef.x - startRef.x) >= Math.abs(endRef.y - startRef.y);
  const points = [refs[0]];
  for (let i = 0; i < refs.length - 1; i++) {
    points.push(...orthogonalJog(refs[i], refs[i + 1], horizFirst));
    points.push(refs[i + 1]);
  }

  if (!edge.fromAnchor) {
    points[0] = clipAxisSegmentToRect(points[0], points[1], { x: s.x, y: s.y, w: s.w, h: s.h });
  }
  if (!edge.toAnchor) {
    const n = points.length;
    points[n - 1] = clipAxisSegmentToRect(points[n - 1], points[n - 2], { x: t.x, y: t.y, w: t.w, h: t.h });
  }
  return points;
}

function computeOrthogonalPoints(edge, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;
  const waypoints = Array.isArray(edge.waypoints) ? edge.waypoints : [];
  return waypoints.length ? computeOrthogonalWaypointed(edge, s, t, waypoints) : computeOrthogonalDefault(edge, s, t);
}

function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

function pointAtPolylineFraction(points, frac) {
  const total = polylineLength(points);
  if (total === 0) return points[0];
  let target = total * frac;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (target <= segLen || i === points.length - 1) {
      const t = segLen === 0 ? 0 : target / segLen;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    target -= segLen;
  }
  return points[points.length - 1];
}

function computeEdgeGeometry(edge, allEdges, allNodes) {
  if (edge.routing === 'orthogonal') {
    const points = computeOrthogonalPoints(edge, allNodes);
    if (!points) return null;
    const d = `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`;
    const waypointed = Array.isArray(edge.waypoints) && edge.waypoints.length > 0;
    // The default two-corner Z (both elbow offsets equal) always has exactly
    // 4 points; matching the original single-elbow badge placement (midpoint
    // between the corners) keeps it stable under the elbow drag. Once the two
    // corners diverge (independent per-end offsets) or the route is
    // waypointed, the point count varies, so the badge sits at the route's
    // midpoint by arc length instead.
    const badge = !waypointed && points.length === 4
      ? { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 }
      : pointAtPolylineFraction(points, 0.5);
    const labelPos = { x: badge.x, y: badge.y - 20 };
    // `refs` is the real editable point list — [start, ...waypoints, end] —
    // with the jog algorithm's synthetic corners stripped out, since those
    // aren't 1:1 with edge.waypoints. Only meaningful (and only used by
    // canvas.js) once a route is waypointed; harmless otherwise.
    // In default (non-waypointed) mode there are no real editable interior
    // points — the two corners are synthetic, computed fresh from
    // elbowOffset every render — so refs is just the endpoints, giving
    // canvas.js's nearestPointIndex(refs.slice(1,-1), ...) an empty list to
    // search rather than mistaking those corners for real bend points.
    const refs = waypointed ? [points[0], ...edge.waypoints, points[points.length - 1]] : [points[0], points[points.length - 1]];
    return { start: points[0], end: points[points.length - 1], d, badge, labelPos, points, refs };
  }

  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return null;
  const { start, end } = ep;

  // Parallel same-pair edges auto-separate unless a real bend is set.
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

  const labelPos = { x: badge.x + nx * 20, y: badge.y + ny * 20 };
  const points = bend === 0 ? [start, end] : [start, { x: badge.x, y: badge.y }, end];
  return { start, end, d, badge, labelPos, points, refs: points };
}

// Given a point the user dragged to, returns the perpendicular signed
// distance from the edge's straight-line midpoint — this directly becomes
// the new edge.curve.
function computeBendFromPoint(edge, allNodes, point) {
  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return 0;
  const { start, end } = ep;
  const { nx, ny } = edgeNormal(start, end);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  return (point.x - mx) * nx + (point.y - my) * ny;
}

// ---------- Shared hit-testing for waypointed orthogonal routes ----------
// (Curves have only one bend point, so they don't need this.)

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// Nearest of a flat list of points (an edge's own bend points) — used to
// decide whether a drag/double-click targets an existing point.
function nearestPointIndex(points, p) {
  let best = -1, bestDist = Infinity;
  points.forEach((cp, i) => {
    const d = Math.hypot(cp.x - p.x, cp.y - p.y);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return { index: best, dist: bestDist };
}

// Nearest segment of the full ordered [start, ...mid, end] list — the
// returned index doubles as the correct splice() position within
// edge.waypoints.
function nearestSegmentIndex(fullPoints, p) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < fullPoints.length - 1; i++) {
    const d = distToSegment(p, fullPoints[i], fullPoints[i + 1]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return { index: best, dist: bestDist };
}
