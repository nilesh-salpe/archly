// Edge path/geometry math: clips a straight (or curved) line to each node's
// rectangle border, or — when a node end has an explicit `fromAnchor`/
// `toAnchor` (see startConnect in canvas.js) — starts exactly at that fixed
// border point instead of the dynamic "closest point to the other node's
// center" default. Curvature comes from `edge.curvePoints`, an ordered list
// of absolute control points a user drags into place (draw.io-style: drag
// anywhere on the line to add a point, drag an existing point to move it,
// double-click a point to remove it); a lone legacy `edge.curve` (a signed
// perpendicular offset, pre-multi-point-editing) is still honored for
// diagrams/patterns that only ever had one bend. `edge.waypoints` plays the
// same role for `routing: 'orthogonal'` edges, except each hop between
// consecutive points is forced into a right-angle jog rather than a smooth
// curve. Either way, computeEdgeGeometry() also returns the full ordered
// point list (`points`) so canvas.js's drag/insert/remove interaction can
// hit-test against exactly what's on screen without recomputing it.

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

// Clips an axis-aligned segment (p0 -> p1, where p0 is inside/at the rect)
// to where it crosses the rect's boundary — used to trim the first/last hop
// of an orthogonal route back to the node's edge when that end has no
// explicit anchor (so it starts from the center like before, then gets cut
// short at the border).
function clipAxisSegmentToRect(p0, p1, rect) {
  if (p0.y === p1.y) {
    const goingRight = p1.x >= p0.x;
    return { x: goingRight ? rect.x + rect.w : rect.x, y: p0.y };
  }
  const goingDown = p1.y >= p0.y;
  return { x: p0.x, y: goingDown ? rect.y + rect.h : rect.y };
}

// One right-angle jog between two points, entering horizontally-then-vertically
// or vertically-then-horizontally per `horizFirst` — a fixed choice shared by
// every hop in the route (see computeOrthogonalPoints) so consecutive jogs
// never land on the same corner and retrace themselves.
function orthogonalJog(a, b, horizFirst) {
  if (horizFirst) return [{ x: b.x, y: a.y }];
  return [{ x: a.x, y: b.y }];
}

// Builds a fully axis-aligned polyline from source to target, passing
// through every waypoint in order. Every hop uses the same horizontal-first-
// or vertical-first choice (decided once from the overall start→end
// direction) so a multi-waypoint route staircases cleanly instead of any
// hop's corner coinciding with its neighbor's and retracing. With no
// waypoints and no anchors this reduces to exactly the original
// single-elbow behavior (each end starts at its node's center, and
// clipAxisSegmentToRect trims that first/last hop back to the border) —
// anchors just replace the center starting point on whichever end has one.
function computeOrthogonalPoints(edge, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;

  const waypoints = Array.isArray(edge.waypoints) ? edge.waypoints : [];
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
    const badge = pointAtPolylineFraction(points, 0.5);
    const labelPos = { x: badge.x, y: badge.y - 20 };
    // `points` is the fully-jogged render path — each hop between real
    // points (start/waypoint/end) inserts its own right-angle corner, so
    // those corners are NOT 1:1 with edge.waypoints. `refs` is the actual
    // editable point list canvas.js's drag/insert/remove logic should use.
    const refs = [points[0], ...(Array.isArray(edge.waypoints) ? edge.waypoints : []), points[points.length - 1]];
    return { start: points[0], end: points[points.length - 1], d, badge, labelPos, points, refs };
  }

  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return null;
  const { start, end } = ep;

  // Multi-point curves take priority; a lone legacy `curve` (a signed
  // perpendicular offset from the straight-line midpoint, pre-dating
  // multi-point editing) still renders exactly as before when present alone.
  // With neither, parallel same-pair edges still auto-separate so they don't
  // overlap — same as before multi-point editing existed.
  let curvePoints = Array.isArray(edge.curvePoints) ? edge.curvePoints : null;
  if (!curvePoints) {
    let bend = typeof edge.curve === 'number' ? edge.curve : 0;
    if (bend === 0) {
      const group = allEdges.filter((e) => pairKey(e.from, e.to) === pairKey(edge.from, edge.to));
      if (group.length > 1) {
        const idx = group.findIndex((e) => e.id === edge.id);
        const mid = (group.length - 1) / 2;
        bend = (idx - mid) * 28;
      }
    }
    if (bend !== 0) {
      const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
      const { nx, ny } = edgeNormal(start, end);
      curvePoints = [{ x: mx + nx * bend, y: my + ny * bend }];
    }
  }

  const points = [start, ...(curvePoints || []), end];

  let d, badge;
  if (!curvePoints || curvePoints.length === 0) {
    d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    badge = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  } else if (curvePoints.length === 1) {
    const c = curvePoints[0];
    d = `M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`;
    badge = { x: c.x, y: c.y };
  } else {
    // Smooth multi-point curve: quadratic-through-midpoints, a standard trick
    // for turning N control points into a smooth path — each control point
    // pulls the curve toward it without a hard corner at the joins.
    let dParts = [`M ${start.x} ${start.y}`];
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const c = curvePoints[i];
      const nextC = curvePoints[i + 1];
      const joint = { x: (c.x + nextC.x) / 2, y: (c.y + nextC.y) / 2 };
      dParts.push(`Q ${c.x} ${c.y} ${joint.x} ${joint.y}`);
    }
    const last = curvePoints[curvePoints.length - 1];
    dParts.push(`Q ${last.x} ${last.y} ${end.x} ${end.y}`);
    d = dParts.join(' ');
    const sumX = curvePoints.reduce((s, p) => s + p.x, 0);
    const sumY = curvePoints.reduce((s, p) => s + p.y, 0);
    badge = { x: sumX / curvePoints.length, y: sumY / curvePoints.length };
  }

  // Where an optional protocol label (e.g. "REST", "gRPC") sits — offset from
  // the badge along the local curve normal so it clears the number badge.
  const { nx, ny } = edgeNormal(start, end);
  const labelPos = { x: badge.x + nx * 20, y: badge.y + ny * 20 };

  // Curves have no synthetic corners — every interior point in `points` is a
  // real curvePoints entry — so `refs` is just `points` itself.
  return { start, end, d, badge, labelPos, points, refs: points };
}

// Given a point the user dragged to, returns the perpendicular signed
// distance from the edge's straight-line midpoint — used only to seed a
// freshly-migrated legacy `curve` number; new drags work directly in
// absolute coordinates (see startEdgeBend in canvas.js).
function computeBendFromPoint(edge, allNodes, point) {
  const ep = computeStraightEndpoints(edge, allNodes);
  if (!ep) return 0;
  const { start, end } = ep;
  const { nx, ny } = edgeNormal(start, end);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  return (point.x - mx) * nx + (point.y - my) * ny;
}

// ---------- Shared hit-testing for the drag-to-add/move/remove-a-point
// interaction (curvePoints and waypoints alike) ----------

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// Nearest of a flat list of points (the edge's own bend points) — used to
// decide whether a drag/double-click grabs an existing point.
function nearestPointIndex(points, p) {
  let best = -1, bestDist = Infinity;
  points.forEach((cp, i) => {
    const d = Math.hypot(cp.x - p.x, cp.y - p.y);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return { index: best, dist: bestDist };
}

// Nearest segment of the full ordered [start, ...mid, end] list — the
// returned index doubles as the correct splice() position within the edge's
// own mid-points array (see arrows.js header comment).
function nearestSegmentIndex(fullPoints, p) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < fullPoints.length - 1; i++) {
    const d = distToSegment(p, fullPoints[i], fullPoints[i + 1]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return { index: best, dist: bestDist };
}
