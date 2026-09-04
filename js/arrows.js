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
//
// Defaults are also routed around obstacles: a route the user hasn't bent by
// hand avoids crossing other nodes, and orthogonal runs sharing a corridor
// step apart instead of stacking. See "Automatic avoidance" below — all of it
// switches off the moment an edge carries a bend of its own.

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

function nodesByIdMap(allNodes) {
  const byId = {};
  for (const n of allNodes) byId[n.id] = n;
  return byId;
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

// ---------- Automatic avoidance ----------
// Applies only to a route the user hasn't bent by hand: the moment an edge
// carries its own curve/waypoints/elbow offsets, those win outright and none
// of this runs. So it improves defaults without ever fighting a deliberate
// layout.

const AVOID_MARGIN = 14; // clearance kept around an obstacle box
const CHANNEL_STEP = 16; // spacing between orthogonal runs sharing a corridor

// Containers are backdrops meant to be crossed, and text/notes aren't solid
// objects — routing around either would push arrows into odd detours around
// things nobody reads as obstacles.
function isRouteObstacle(n) {
  return !n.container && !n.textOnly;
}

function rectOf(n, m) {
  return { x: n.x - m, y: n.y - m, w: n.w + 2 * m, h: n.h + 2 * m };
}

// Liang–Barsky: does segment a→b touch the rect at all?
function segmentHitsRect(a, b, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel to this slab and outside it
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

function polylineHitsRect(points, r) {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsRect(points[i], points[i + 1], r)) return true;
  }
  return false;
}

// Every node that isn't one of this edge's own endpoints. `near` (a
// {x,y,w,h} box) narrows that to the route's own neighbourhood: a box the
// route can't come near can't block it, and skipping the rest keeps the
// per-edge search proportional to local density rather than to diagram size.
function routeObstacles(edge, allNodes, near) {
  return allNodes.filter((n) => {
    if (n.id === edge.from || n.id === edge.to || !isRouteObstacle(n)) return false;
    if (!near) return true;
    return n.x < near.x + near.w && n.x + n.w > near.x && n.y < near.y + near.h && n.y + n.h > near.y;
  });
}

// The area a route between these two points can reach, with room for the
// detour it might take.
function routeBounds(a, b, pad) {
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  return { x, y, w: Math.abs(a.x - b.x) + pad * 2, h: Math.abs(a.y - b.y) + pad * 2 };
}

// Samples a quadratic so the curve can be tested (and hit-tested) as a
// polyline — the control point is off-curve, so testing the control polygon
// would be both wrong and pessimistic.
function sampleQuadratic(start, ctrl, end, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y,
    });
  }
  return pts;
}

// How far to bow a direct edge so it clears whatever it would otherwise run
// through. Returns a control-point offset along the line's normal (0 = leave
// it straight): the curve's own deviation peaks at half that, so the needed
// clearance is doubled, then verified against the real sampled curve and
// widened if a box near an endpoint still catches it.
function autoAvoidCurveBend(edge, start, end, allNodes) {
  // A generous pad here, unlike the orthogonal search: a bowed curve leaves
  // the end-to-end box, so a box just outside it can still be in the way.
  const blocking = routeObstacles(edge, allNodes, routeBounds(start, end, 140))
    .filter((n) => segmentHitsRect(start, end, rectOf(n, AVOID_MARGIN)));
  if (!blocking.length) return 0;

  const { nx, ny } = edgeNormal(start, end);
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  let pos = 0, neg = 0;
  for (const n of blocking) {
    const r = rectOf(n, AVOID_MARGIN);
    for (const c of [
      { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h },
    ]) {
      const d = (c.x - mx) * nx + (c.y - my) * ny;
      if (d > pos) pos = d;
      if (d < neg) neg = d;
    }
  }
  // Go around whichever side needs the smaller detour.
  let bend = (Math.abs(pos) <= Math.abs(neg) ? pos : neg) * 2;

  const rects = blocking.map((n) => rectOf(n, 4));
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = { x: mx + nx * bend, y: my + ny * bend };
    const curve = sampleQuadratic(start, ctrl, end, 16);
    if (!rects.some((r) => polylineHitsRect(curve, r))) break;
    bend *= 1.5;
  }
  return bend;
}

// The elbow shift that gets an orthogonal route out of every box it would
// otherwise cross. Candidates are the obstacles' own edges (just outside
// them), tried nearest-first, so the detour is the smallest one that works.
function autoAvoidElbowOffset(edge, s, t, allNodes) {
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  // A default Z never leaves the box spanned by its two ends, so obstacles
  // outside it (plus a margin) can't matter.
  const obstacles = routeObstacles(edge, allNodes, routeBounds(start, end, AVOID_MARGIN));
  if (!obstacles.length) return 0;
  const rects = obstacles.map((n) => rectOf(n, 4));

  const pathFor = (m) => (horiz
    ? [start, { x: m, y: start.y }, { x: m, y: end.y }, end]
    : [start, { x: start.x, y: m }, { x: end.x, y: m }, end]);
  const clear = (m) => !rects.some((r) => polylineHitsRect(pathFor(m), r));

  if (clear(mid)) return 0;

  const candidates = [];
  for (const n of obstacles) {
    const r = rectOf(n, AVOID_MARGIN);
    candidates.push(horiz ? r.x : r.y, horiz ? r.x + r.w : r.y + r.h);
  }
  candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  for (const c of candidates) {
    if (clear(c)) return c - mid;
  }
  return 0; // nothing clears it — leave the honest default rather than a wild detour
}

// Two orthogonal runs sitting at the same coordinate with overlapping spans
// draw right on top of each other. Each edge counts the *earlier* edges (by
// id — a fixed order, so the result is stable and never depends on render
// order) that claim the same channel and steps aside by that many
// CHANNEL_STEPs. Other edges' channels are read without their own avoidance
// detour applied: an approximation, but it keeps this O(edges²) pass cheap
// enough to run on every drag frame.
function orthogonalChannel(edge, allNodes, useAvoid, lookup) {
  if (edge.routing !== 'orthogonal') return null;
  if (Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
  // The caller passes its node lookup in: this runs once per edge *pair*, and
  // rebuilding the map here made the pass O(edges² × nodes).
  const nodesById = lookup || nodesByIdMap(allNodes);
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  const manual = typeof edge.elbowOffset === 'number' || typeof edge.elbowOffsetEnd === 'number';
  const auto = manual || !useAvoid ? 0 : autoAvoidElbowOffset(edge, s, t, allNodes);
  const m1 = mid + (typeof edge.elbowOffset === 'number' ? edge.elbowOffset : auto);
  const m2 = mid + (typeof edge.elbowOffsetEnd === 'number' ? edge.elbowOffsetEnd : auto);
  if (m1 !== m2) return null; // the two corners have been pulled apart: no single shared run
  const span = horiz
    ? [Math.min(start.y, end.y), Math.max(start.y, end.y)]
    : [Math.min(start.x, end.x), Math.max(start.x, end.x)];
  return { horiz, m: m1, span };
}

function orthogonalSeparationShift(edge, allEdges, allNodes) {
  if (typeof edge.elbowOffset === 'number' || typeof edge.elbowOffsetEnd === 'number') return 0;
  const lookup = nodesByIdMap(allNodes);
  const mine = orthogonalChannel(edge, allNodes, true, lookup);
  if (!mine) return 0;
  let count = 0;
  for (const other of allEdges) {
    if (other.id >= edge.id) continue;
    const oc = orthogonalChannel(other, allNodes, false, lookup);
    if (!oc || oc.horiz !== mine.horiz) continue;
    if (Math.abs(oc.m - mine.m) > CHANNEL_STEP / 2) continue;
    if (mine.span[1] < oc.span[0] || oc.span[1] < mine.span[0]) continue;
    count++;
  }
  return count * CHANNEL_STEP;
}

// When no elbow position clears the obstacles — the classic case being a box
// sitting directly between two nodes on the same row, where every "Z" is the
// same straight line through it — the route has to leave the row entirely.
//
// The good version of that leaves each box through the face pointing at the
// detour (over the top, say) rather than out the side and along the row: an
// arrow that exits sideways runs straight down the same corridor as the row's
// other arrows and lands on top of them, which is exactly what this is
// supposed to prevent. Corners are expressed in (along, cross) coordinates so
// one body of code covers both orientations.
function orthogonalDetourPath(edge, s, t, allNodes) {
  const { horiz, start, end } = orthogonalDefaultBase(edge, s, t);
  // A detour deliberately leaves the end-to-end box on the cross axis, so it
  // needs a wider net than the Z's own bounds.
  const obstacles = routeObstacles(edge, allNodes, routeBounds(start, end, 400));
  if (!obstacles.length) return null;

  const P = (u, v) => (horiz ? { x: u, y: v } : { x: v, y: u });
  const uOf = (p) => (horiz ? p.x : p.y);
  const vOf = (p) => (horiz ? p.y : p.x);
  const uCenter = (n) => (horiz ? n.x + n.w / 2 : n.y + n.h / 2);
  const vLowOf = (n) => (horiz ? n.y : n.x);
  const vHighOf = (n) => (horiz ? n.y + n.h : n.x + n.w);

  const u0 = uOf(start), u1 = uOf(end);
  const v0 = vOf(start), v1 = vOf(end);
  const uMin = Math.min(u0, u1), uMax = Math.max(u0, u1);
  const vMin = Math.min(v0, v1), vMax = Math.max(v0, v1);

  // Only boxes actually in the corridor between the two ends matter.
  const spans = obstacles
    .map((n) => rectOf(n, AVOID_MARGIN))
    .map((r) => (horiz
      ? { u0: r.x, u1: r.x + r.w, v0: r.y, v1: r.y + r.h }
      : { u0: r.y, u1: r.y + r.h, v0: r.x, v1: r.x + r.w }))
    .filter((b) => b.u1 > uMin && b.u0 < uMax && b.v1 > vMin - 1 && b.v0 < vMax + 1);
  if (!spans.length) return null;

  const rects = obstacles.map((n) => rectOf(n, 4));
  const lowSide = Math.min(...spans.map((b) => b.v0));
  const highSide = Math.max(...spans.map((b) => b.v1));
  // Go around whichever way is shorter.
  const order = Math.abs(lowSide - v0) <= Math.abs(highSide - v0) ? [true, false] : [false, true];

  for (const goLow of order) {
    // Clear the blockers *and* both endpoint boxes, so the crossing leg can't
    // clip a tall source or target on its way past.
    const cv = goLow
      ? Math.min(lowSide, vLowOf(s) - AVOID_MARGIN, vLowOf(t) - AVOID_MARGIN)
      : Math.max(highSide, vHighOf(s) + AVOID_MARGIN, vHighOf(t) + AVOID_MARGIN);
    // A hand-placed anchor is a deliberate choice about where the arrow
    // leaves the box, so it's kept; otherwise exit through the face the
    // detour is on.
    const sPoint = edge.fromAnchor
      ? anchorAbsolutePoint(s, edge.fromAnchor)
      : P(uCenter(s), goLow ? vLowOf(s) : vHighOf(s));
    const tPoint = edge.toAnchor
      ? anchorAbsolutePoint(t, edge.toAnchor)
      : P(uCenter(t), goLow ? vLowOf(t) : vHighOf(t));
    const path = [sPoint, P(uOf(sPoint), cv), P(uOf(tPoint), cv), tPoint];
    if (!rects.some((r) => polylineHitsRect(path, r))) return path;
  }
  return null;
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
function computeOrthogonalDefault(edge, s, t, allEdges, allNodes) {
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  // The default jog position, nudged out of any box it would cross and off
  // any corridor an earlier edge already occupies. Both are pure defaults:
  // an edge with its own elbow offset uses that and nothing else.
  const auto = defaultElbowAuto(edge, s, t, allEdges, allNodes);
  // A jog shift can't help when the obstacle sits on the row/column the two
  // nodes share — every Z is then the same straight line through it — so fall
  // back to a detour that leaves the row. Dragging a corner afterwards sets
  // an explicit elbow offset, which takes over and restores the plain Z.
  if (auto === 0 && allNodes && typeof edge.elbowOffset !== 'number' && typeof edge.elbowOffsetEnd !== 'number') {
    const straight = horiz
      ? [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]
      : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
    const blocked = routeObstacles(edge, allNodes, routeBounds(start, end, AVOID_MARGIN))
      .some((n) => polylineHitsRect(straight, rectOf(n, 4)));
    if (blocked) {
      const detour = orthogonalDetourPath(edge, s, t, allNodes);
      if (detour) return detour;
    }
  }
  const m1 = mid + (typeof edge.elbowOffset === 'number' ? edge.elbowOffset : auto);
  const m2 = mid + (typeof edge.elbowOffsetEnd === 'number' ? edge.elbowOffsetEnd : auto);
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

// The automatic part of a default elbow position — obstacle detour plus
// corridor separation — shared by the path builder and by the corner-base
// reporter below so a drag starts from exactly where the corner is drawn.
function defaultElbowAuto(edge, s, t, allEdges, allNodes) {
  if (typeof edge.elbowOffset === 'number' || typeof edge.elbowOffsetEnd === 'number') return 0;
  if (!allNodes) return 0;
  const avoid = autoAvoidElbowOffset(edge, s, t, allNodes);
  const separate = allEdges ? orthogonalSeparationShift(edge, allEdges, allNodes) : 0;
  return avoid + separate;
}

// canvas.js calls this to turn a drag position directly into a new
// edge.elbowOffset/elbowOffsetEnd (absolute, not incremental) — {axis, base}
// says which screen coordinate to read off the cursor and what to subtract
// from it; c1/c2 are the two corners' current positions, so canvas.js can
// tell which one a pointerdown landed nearest to.
function computeOrthogonalCornerBases(edge, allNodes, allEdges) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;
  const { horiz, start, end, mid } = orthogonalDefaultBase(edge, s, t);
  const auto = defaultElbowAuto(edge, s, t, allEdges, allNodes);
  const m1 = mid + (typeof edge.elbowOffset === 'number' ? edge.elbowOffset : auto);
  const m2 = mid + (typeof edge.elbowOffsetEnd === 'number' ? edge.elbowOffsetEnd : auto);
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

function computeOrthogonalPoints(edge, allEdges, allNodes) {
  const nodesById = {};
  for (const n of allNodes) nodesById[n.id] = n;
  const s = nodesById[edge.from];
  const t = nodesById[edge.to];
  if (!s || !t) return null;
  const waypoints = Array.isArray(edge.waypoints) ? edge.waypoints : [];
  return waypoints.length
    ? computeOrthogonalWaypointed(edge, s, t, waypoints)
    : computeOrthogonalDefault(edge, s, t, allEdges, allNodes);
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
    const points = computeOrthogonalPoints(edge, allEdges, allNodes);
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
    return { kind: 'polyline', start: points[0], end: points[points.length - 1], d, badge, labelPos, points, refs, samples: points };
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
      kind: 'polyline',
      start: points[0],
      end: points[points.length - 1],
      d: pathFromPoints(points, edge.rounded),
      badge,
      labelPos: applyLabelOffset({ x: badge.x, y: badge.y - 20 }, edge),
      points,
      refs: points,
      samples: points,
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
  // Priority: the user's own bend, then the fan-out separation that keeps
  // same-pair arrows apart, and only then the obstacle detour — a separated
  // pair is already off the direct line, so bowing it again would double up.
  const bend = typeof edge.curve === 'number'
    ? edge.curve
    : autoBend || autoAvoidCurveBend(edge, start, end, allNodes);

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
  // `samples` has to follow the *drawn* path, and a quadratic's control point
  // isn't on its own curve — so the arc is sampled rather than reported as
  // the [start, control, end] triangle that `points` is.
  const samples = bend === 0 ? [start, end] : sampleQuadratic(start, badge, end, 16);
  // `refs` is the *editable* point list, and a curve has no editable interior
  // point: its bend is `edge.curve`, a number, and the point in `points` is
  // just that control point. Reporting it as a ref would make canvas.js hang
  // a bend handle on it and then try to splice it out of a waypoint list that
  // doesn't exist.
  return { kind: bend === 0 ? 'straight' : 'curve', start, end, d, badge, labelPos, points, refs: [start, end], samples };
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

// Closest point on a polyline to p, with its distance — canvas.js positions
// the single hover handle with this, so the dot sits exactly on the line
// under the pointer instead of at a fixed spot.
function closestPointOnPolyline(points, p) {
  let best = points[0], bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestDist) { bestDist = d; best = q; }
  }
  return { point: best, dist: bestDist };
}

// Where the "add a bend here" dot belongs for a pointer at p: the midpoint of
// the drawn segment under the pointer — deliberately *not* under the pointer
// itself, because the pointer is where a press lands and a press on the line
// drags the segment. The dot has to be a target you aim at, not something
// parked under every press.
//
// A single-span route (straight or curved) already has its step badge at that
// midpoint, so it offers the quarter point on the pointer's own side instead.
function bendCandidatePoint(geo, p) {
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (geo.kind === 'polyline') {
    const { index } = nearestSegmentIndex(geo.points, p);
    const a = geo.points[index], b = geo.points[index + 1];
    const mid = lerp(a, b, 0.5);
    if (Math.hypot(mid.x - geo.badge.x, mid.y - geo.badge.y) >= 16) return mid;
    const nearA = Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y);
    return lerp(a, b, nearA ? 0.25 : 0.75);
  }
  const nearStart = Math.hypot(p.x - geo.start.x, p.y - geo.start.y)
    <= Math.hypot(p.x - geo.end.x, p.y - geo.end.y);
  return pointAtPolylineFraction(geo.samples, nearStart ? 0.25 : 0.75);
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
