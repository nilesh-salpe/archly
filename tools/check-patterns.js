// Audits every file in patterns/ the way the canvas would render it, so a
// pattern can't quietly drift out of alignment. Dev-only: plain node, no
// dependencies, nothing the app itself loads.
//
//   node tools/check-patterns.js            # all patterns
//   node tools/check-patterns.js 3tier.yaml # just one
//
// It flags: nodes off the 10px grid, near-miss alignment (two boxes that
// were plainly meant to share a column/row but sit a few px apart), boxes
// with less than 20px between them, arrows crossing a box that isn't their
// own endpoint, and arrows crossing each other. It reuses the app's own
// yaml.js and arrows.js, so what it measures is what the canvas draws.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const geval = eval; // indirect eval so the files' declarations land as globals
// Top-level `const X =` in an indirect eval stays scoped to that eval, so
// hoist those bindings onto globalThis; function declarations carry over as-is.
const load = (f) => geval(
  fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/^const ([A-Za-z_$][\w$]*)\s*=/gm, 'globalThis.$1 =')
    .replace(/^let ([A-Za-z_$][\w$]*)\s*=/gm, 'globalThis.$1 =')
);
global.window = {};
load('js/components.js');
load('js/yaml.js');
load('js/arrows.js');

const DEFAULT_NODE_W = 150, DEFAULT_NODE_H = 70;
const getComponent = (id) => COMPONENTS.find((c) => c.id === id);

function buildPattern(file) {
  const p = parseYAML(fs.readFileSync(path.join(ROOT, 'patterns', file), 'utf8'));
  const idMap = {}; let nid = 1; const nodes = [];
  for (const spec of p.nodes) {
    const def = getComponent(spec.type);
    if (!def) { console.log(`  !! unknown component type: ${spec.type}`); continue; }
    nodes.push({
      id: nid, type: def.id, category: def.category, label: spec.label || def.label,
      container: !!def.container, textOnly: !!def.textOnly, imageOnly: !!def.imageOnly,
      x: spec.x, y: spec.y, w: spec.w || def.w || DEFAULT_NODE_W, h: spec.h || def.h || DEFAULT_NODE_H,
    });
    idMap[spec.id] = nid; nid++;
  }
  const edges = (p.edges || []).map((e, i) => ({
    id: i + 1, from: idMap[e.from], to: idMap[e.to], number: e.number,
    lineStyle: e.lineStyle || 'solid', arrowStyle: e.arrowStyle || 'end',
    curve: typeof e.curve === 'number' ? e.curve : undefined,
    routing: e.routing === 'orthogonal' ? 'orthogonal' : undefined,
    waypoints: Array.isArray(e.waypoints) ? e.waypoints : undefined,
    protocol: e.protocol,
  }));
  return { meta: p, nodes, edges };
}

const isSolid = (n) => !n.container && !n.textOnly;

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 6;
  if (near(a, c) || near(a, d) || near(b, c) || near(b, d)) return false; // shared endpoint
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function audit(file) {
  const { meta, nodes, edges } = buildPattern(file);
  const problems = [];

  // The canvas snaps to 10px, so that's the grid that matters.
  const offGrid = nodes.filter((n) => n.x % 10 !== 0 || n.y % 10 !== 0);
  if (offGrid.length) problems.push(`${offGrid.length} node(s) off the 10px grid: ` + offGrid.map((n) => `${n.label}(${n.x},${n.y})`).join(', '));

  // Near-misses read as sloppiness far more than an absolute grid does: two
  // boxes 8px apart in x were plainly meant to share a column.
  // Containers are backdrops sized to wrap their contents, so their edges
  // lining up "almost" with a node's is meaningless.
  const alignable = nodes.filter((n) => !n.container);
  const nearMiss = (axis, sizeKey) => {
    const seen = [];
    for (const a of alignable) {
      for (const b of alignable) {
        if (a === b) continue;
        for (const [pa, pb, what] of [
          [a[axis], b[axis], 'edge'],
          [a[axis] + a[sizeKey] / 2, b[axis] + b[sizeKey] / 2, 'center'],
        ]) {
          const d = Math.abs(pa - pb);
          if (d > 0 && d < 20) {
            const key = [a.label, b.label, what].sort().join('|');
            if (!seen.includes(key)) { seen.push(key); problems.push(`${axis} ${what}s almost aligned (${d}px apart): ${a.label} & ${b.label}`); }
          }
        }
      }
    }
  };
  nearMiss('x', 'w');
  nearMiss('y', 'h');

  // boxes overlapping each other
  const solids = nodes.filter(isSolid);
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (a.x < b.x + b.w + 20 && a.x + a.w + 20 > b.x && a.y < b.y + b.h + 20 && a.y + a.h + 20 > b.y) {
        problems.push(`boxes too close/overlapping: ${a.label} & ${b.label}`);
      }
    }
  }

  const geos = edges.map((e) => ({ e, geo: computeEdgeGeometry(e, edges, nodes) }));
  for (const { e, geo } of geos) {
    if (!geo) { problems.push(`edge ${e.id} has no geometry`); continue; }
    const pts = geo.samples || geo.points;
    for (const n of nodes) {
      if (n.id === e.from || n.id === e.to || !isSolid(n)) continue;
      if (polylineHitsRect(pts, { x: n.x, y: n.y, w: n.w, h: n.h })) {
        problems.push(`arrow ${e.number} (${nodes.find(x=>x.id===e.from).label} → ${nodes.find(x=>x.id===e.to).label}) crosses box ${n.label}`);
      }
    }
  }

  // arrow-vs-arrow crossings
  let crossings = 0;
  for (let i = 0; i < geos.length; i++) {
    for (let j = i + 1; j < geos.length; j++) {
      const A = geos[i].geo, B = geos[j].geo;
      if (!A || !B) continue;
      const pa = A.samples || A.points, pb = B.samples || B.points;
      let hit = false;
      for (let x = 0; x < pa.length - 1 && !hit; x++) {
        for (let y = 0; y < pb.length - 1 && !hit; y++) {
          if (segIntersect(pa[x], pa[x + 1], pb[y], pb[y + 1])) hit = true;
        }
      }
      if (hit) { crossings++; problems.push(`arrows ${geos[i].e.number} and ${geos[j].e.number} cross`); }
    }
  }

  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const w = Math.max(...nodes.map((n) => n.x + n.w)) - Math.min(...xs);
  const h = Math.max(...nodes.map((n) => n.y + n.h)) - Math.min(...ys);
  return { id: meta.id, name: meta.name, nodes: nodes.length, edges: edges.length, size: `${w}x${h}`, problems };
}

const files = process.argv[2] ? [process.argv[2]] : fs.readdirSync(path.join(ROOT, 'patterns')).filter((f) => f.endsWith('.yaml'));
let bad = 0;
for (const f of files.sort()) {
  const r = audit(f);
  const tag = r.problems.length ? `${r.problems.length} issue(s)` : 'clean';
  console.log(`${f.padEnd(24)} ${String(r.nodes).padStart(2)}n ${String(r.edges).padStart(2)}e  ${r.size.padStart(10)}  ${tag}`);
  for (const p of r.problems) console.log(`    - ${p}`);
  if (r.problems.length) bad++;
}
console.log(`\n${files.length - bad}/${files.length} patterns clean`);
