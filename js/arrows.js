// Edge path/geometry math: clips a straight (or curved) line to each node's
// rectangle border, or — when a node end has an explicit `fromAnchor`/
// `toAnchor` (see startConnect in canvas.js) — starts exactly at that fixed
// border point instead of the dynamic "closest point to the other node's
// center" default.
//
// Bend points, in both routing modes:
//
// A direct edge with no explicit bends is a straight line, or a single
// quadratic arc when `edge.curve` (a signed perpendicular offset from the
// midpoint) is set by dragging the line. An orthogonal one defaults to the
// classic two-corner "Z" (or straight/"L" when rows or columns already
// align), each corner independently adjustable — `edge.elbowOffset` near the
// start, `edge.elbowOffsetEnd` near the end — so dragging near a corner
// *moves* that corner only; when the two diverge, an extra connecting jog
// keeps the route orthogonal.
//
// Beyond that, either mode can carry an ordered `edge.waypoints` list and the
// route passes through all of them in order. Adding one is always a
// deliberate gesture — drag a virtual handle, or double-click the line (see
// canvas.js) — never a side effect of dragging, which only ever *moves* what
// is already there. That distinction is the whole design: an early version
// added a bend on every drag, and diagrams accumulated them unpredictably,
// unlike draw.io/Visio/Lucidchart.
//
// `edge.rounded` softens every corner of whichever route results.

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

// ---------- Path building ----------

// Every route — orthogonal or direct — ends up as an ordered point list, so
// one builder turns any of them into a `d` string. `rounded` (edge.rounded,
// right-click → Routing → Rounded Corners) is draw.io's `rounded=1`: each
// interior corner is cut back along both of its segments and bridged with a
// quadratic, which reads as a soft elbow on an orthogonal route and as a
// smoothed bend on a direct multi-point one.
const CORNER_RADIUS = 10;

function pointTowards(from, to, dist) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(1, dist / len);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function pathFromPoints(points, rounded) {
  if (points.length < 3 || !rounded) {
    return `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    // Never cut back more than half of either neighbouring segment, or two
    // corners on a short segment would overlap and the path would fold.
    const r = Math.min(
      CORNER_RADIUS,
      Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2,
      Math.hypot(next.x - cur.x, next.y - cur.y) / 2
    );
    const a = pointTowards(cur, prev, r);
    const b = pointTowards(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

// Candidate positions for canvas.js's "virtual" handles — the faint dots a
// drag turns into a real bend point. Every route reports its own, because
// where they belong depends on the shape: a polyline puts one at each
// segment's midpoint, while a quadratic arc's midpoint isn't on any segment
// at all (see the curved branch of computeEdgeGeometry). Segments too short
// to hold a legible dot are skipped rather than crowding the line.
const VIRTUAL_HANDLE_MIN_SEG = 26;

function segmentMidpoints(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < VIRTUAL_HANDLE_MIN_SEG) continue;
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

// ---------- Direct routing with explicit waypoints ----------
// The same `edge.waypoints` list the orthogonal mode uses, applied to a
// direct (non-right-angled) route: the line runs start → every waypoint →
// end as a plain polyline. Unanchored ends aim at the nearest waypoint
// rather than at the other node's center, so the first/last hop leaves the
// box pointing the way the route actually goes.
function computeDirectWaypointed(edge, allNodes, waypoints) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;

  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
  const start = edge.fromAnchor
    ? anchorAbsolutePoint(s, edge.fromAnchor)
    : clipPointOnRect(scx, scy, first.x, first.y, { x: s.x, y: s.y, w: s.w, h: s.h });
  const end = edge.toAnchor
    ? anchorAbsolutePoint(t, edge.toAnchor)
    : clipPointOnRect(tcx, tcy, last.x, last.y, { x: t.x, y: t.y, w: t.w, h: t.h });
  return [start, ...waypoints, end];
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

// Right-click an edge's protocol/label chip → drag it — canvas.js's
// startLabelDrag stores the drag as a plain signed offset from whatever the
// label's default (unoffset) position would be, so it stays put relative to
// the line as the line itself moves/re-routes.
function applyLabelOffset(labelPos, edge) {
  if (edge.labelOffset) {
    labelPos.x += edge.labelOffset.dx;
    labelPos.y += edge.labelOffset.dy;
  }
  return labelPos;
}

function computeEdgeGeometry(edge, allEdges, allNodes) {
  if (edge.routing === 'orthogonal') {
    const points = computeOrthogonalPoints(edge, allNodes);
    if (!points) return null;
    const d = pathFromPoints(points, edge.rounded);
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
    const labelPos = applyLabelOffset({ x: badge.x, y: badge.y - 20 }, edge);
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
    return { start: points[0], end: points[points.length - 1], d, badge, labelPos, points, refs, virtuals: segmentMidpoints(points) };
  }

  // Direct routing with explicit bend points — the multi-bend counterpart of
  // the single `edge.curve` arc below. Every point in `refs` is real and
  // editable here (no synthetic corners), so canvas.js's handles map 1:1.
  const directWaypoints = Array.isArray(edge.waypoints) ? edge.waypoints : [];
  if (directWaypoints.length) {
    const points = computeDirectWaypointed(edge, allNodes, directWaypoints);
    if (!points) return null;
    const badge = pointAtPolylineFraction(points, 0.5);
    return {
      start: points[0],
      end: points[points.length - 1],
      d: pathFromPoints(points, edge.rounded),
      badge,
      labelPos: applyLabelOffset({ x: badge.x, y: badge.y - 20 }, edge),
      points,
      refs: points,
      virtuals: segmentMidpoints(points),
    };
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

  const labelPos = applyLabelOffset({ x: badge.x + nx * 20, y: badge.y + ny * 20 }, edge);
  const points = bend === 0 ? [start, end] : [start, { x: badge.x, y: badge.y }, end];
  // `refs` is the *editable* point list, and a curve has no editable interior
  // point: its bend is `edge.curve`, a number, and the point in `points` is
  // just the quadratic's control point (which doesn't even sit on the drawn
  // curve). Reporting it as a ref would make canvas.js hang a bend handle on
  // it and then try to splice it out of a waypoint list that doesn't exist.
  // One virtual handle goes at the curve's true midpoint instead, so dragging
  // it converts the arc into an explicit bend point right where it looked.
  // Two of them, at a quarter and three quarters along, rather than one at
  // the midpoint: the midpoint is where the step-number badge sits, and the
  // badge paints over the handle and swallows the pointerdown. On a curve
  // these are points on the actual quadratic (B(t) with t = 0.25 / 0.75), not
  // on the chord, so they land where the line is drawn.
  const quad = (t) => ({
    x: (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * badge.x + t * t * end.x,
    y: (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * badge.y + t * t * end.y,
  });
  const lerp = (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  const at = bend === 0 ? lerp : quad;
  const virtuals = Math.hypot(end.x - start.x, end.y - start.y) < VIRTUAL_HANDLE_MIN_SEG * 2
    ? []
    : [at(0.25), at(0.75)];
  return { start, end, d, badge, labelPos, points, refs: [start, end], virtuals };
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
