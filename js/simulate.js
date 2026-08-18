// Simulation: rough latency/cost/RPS estimates overlaid on the same canvas,
// toggled from View ▾ — not a separate mode, no separate screen. Numbers
// come from the CATEGORY_DEFAULT_* tables (components.js) unless a node has
// its own latencyMs/costPerHour/costPer100Rps/rps override (right-click a
// node → Simulation).
//
// ---------- Origins ----------
// An "origin" is where a flow starts: a node with no incoming edges (a
// client, a cron trigger, an event source), or a node whose *only* incoming
// edges are fire-and-forget (arrowStyle: 'none', the convention several
// patterns already use for metrics/logging side-edges) — structurally
// downstream, but logically the start of its own async flow, since nothing
// upstream is waiting on it. Nodes with no outgoing edges at all don't
// count (a stray unconnected node isn't the start of a flow). RPS and
// per-origin latency both key off this same list.
//
// ---------- Latency ----------
// Computed once per origin, not as one global number — a diagram can have
// several unrelated flows (e.g. a client-facing path and a separate
// event-driven one), and an async continuation genuinely has its own
// completion time the caller isn't waiting on. Each origin's figure reuses
// the exact step-groups animate.js already builds for Play (edges sharing
// a number run concurrently): sequential steps add, concurrent steps
// within one number take the max of their branches — the same thing you'd
// see timing a Play run, just computed instead of animated, and scoped to
// whatever that origin can actually reach (stopping at the boundary into
// another origin's async territory).
//
// ---------- RPS ----------
// Only origin nodes get an RPS field — everyone else's RPS is derived by
// propagation: a node's RPS is the sum of what arrives on its incoming
// edges (so fan-in from multiple origins adds up), while fan-out broadcasts
// the same RPS to every outgoing edge (no traffic-splitting weights yet).
// Inert — contributes nothing — until at least one node has an RPS set.
//
// ---------- Cost ----------
// Fixed (costPerHour, independent of traffic — "what's running") plus
// variable (costPer100Rps — the hourly cost of an extra 100 req/s at that
// node), summed across every non-container, non-text node. With no RPS
// configured the variable term is always 0, so this reduces exactly to a
// fixed-only total.

let showSimAnnotations = false;

const SIM_PREFS_KEY = 'cad_sim_prefs_v1';

function loadSimPrefs() {
  try {
    const raw = localStorage.getItem(SIM_PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.showSimAnnotations === 'boolean') showSimAnnotations = p.showSimAnnotations;
  } catch (e) {
    /* ignore */
  }
}

function saveSimPrefs() {
  try {
    localStorage.setItem(SIM_PREFS_KEY, JSON.stringify({ showSimAnnotations }));
  } catch (e) {
    /* ignore */
  }
}

function toggleSimAnnotations() {
  showSimAnnotations = !showSimAnnotations;
  saveSimPrefs();
  renderAll();
}

// ---------- Per-node effective values (override or category default) ----------

function nodeLatencyMs(n) {
  if (typeof n.latencyMs === 'number') return n.latencyMs;
  return CATEGORY_DEFAULT_LATENCY_MS[n.category] || 0;
}

function nodeFixedCostPerHour(n) {
  if (typeof n.costPerHour === 'number') return n.costPerHour;
  return CATEGORY_DEFAULT_COST_PER_HOUR[n.category] || 0;
}

function nodeVariableCostPer100Rps(n) {
  if (typeof n.costPer100Rps === 'number') return n.costPer100Rps;
  return CATEGORY_DEFAULT_COST_PER_100RPS[n.category] || 0;
}

// rpsMap is optional — pass a precomputed one (computeNodeRps()) when
// calling this in a loop over many nodes; omit it for a one-off call.
function nodeCostPerHour(n, rpsMap) {
  const fixed = nodeFixedCostPerHour(n);
  const variableRate = nodeVariableCostPer100Rps(n);
  if (!variableRate) return fixed;
  const rps = (rpsMap || computeNodeRps()).get(n.id) || 0;
  return fixed + (rps / 100) * variableRate;
}

// ---------- Origins ----------

function computeOrigins() {
  const incomingByNode = new Map();
  const hasOutgoing = new Set();
  for (const n of state.nodes) incomingByNode.set(n.id, []);
  for (const e of state.edges) {
    if (incomingByNode.has(e.to)) incomingByNode.get(e.to).push(e);
    hasOutgoing.add(e.from);
  }
  const origins = [];
  for (const n of state.nodes) {
    if (n.container || n.textOnly) continue;
    if (!hasOutgoing.has(n.id)) continue; // dead-end / unconnected — not the start of a flow
    const incoming = incomingByNode.get(n.id) || [];
    if (incoming.length === 0 || incoming.every((e) => e.arrowStyle === 'none')) {
      origins.push(n);
    }
  }
  return origins;
}

function isRpsSimActive() {
  return state.nodes.some((n) => typeof n.rps === 'number');
}

// ---------- RPS propagation ----------

function computeNodeRps() {
  const rpsByNode = new Map();
  for (const n of state.nodes) {
    if (typeof n.rps === 'number') rpsByNode.set(n.id, n.rps);
  }
  const sortedEdges = state.edges.slice().sort((a, b) => a.number - b.number);
  for (const e of sortedEdges) {
    const sourceRps = rpsByNode.get(e.from);
    if (typeof sourceRps !== 'number') continue;
    const targetNode = nodeById(e.to);
    if (targetNode && typeof targetNode.rps === 'number') continue; // explicit override on the target wins
    if (e.arrowStyle === 'none') {
      // Async continuation: seed the target's RPS from here only if nothing
      // else has claimed it yet (an explicit override, or an earlier edge).
      if (!rpsByNode.has(e.to)) rpsByNode.set(e.to, sourceRps);
    } else {
      rpsByNode.set(e.to, (rpsByNode.get(e.to) || 0) + sourceRps);
    }
  }
  return rpsByNode;
}

// ---------- Per-origin latency ----------

// Nodes reachable forward from `originId`, stopping at (not crossing) a
// fire-and-forget edge — crossing one enters a different origin's flow,
// already accounted for separately.
function reachableNodeIds(originId) {
  const visited = new Set([originId]);
  const queue = [originId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of state.edges) {
      if (e.from !== cur || e.arrowStyle === 'none') continue;
      if (!visited.has(e.to)) {
        visited.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return visited;
}

function computeOriginLatencyMs(origin, groups) {
  const reachable = reachableNodeIds(origin.id);
  let total = 0;
  for (const group of groups) {
    let stepMax = 0;
    for (const edge of group.edges) {
      if (edge.arrowStyle === 'none' || !reachable.has(edge.from)) continue;
      const target = nodeById(edge.to);
      if (!target) continue;
      const hop = nodeLatencyMs(target);
      if (hop > stepMax) stepMax = hop;
    }
    total += stepMax;
  }
  return total;
}

function computeOriginLatencies() {
  const groups = getStepGroups();
  return computeOrigins().map((node) => ({ node, latencyMs: computeOriginLatencyMs(node, groups) }));
}

// ---------- Totals ----------

function computeTotalCostPerHour(rpsMap) {
  const map = rpsMap || computeNodeRps();
  let total = 0;
  for (const n of state.nodes) {
    if (n.container || n.textOnly) continue;
    total += nodeCostPerHour(n, map);
  }
  return total;
}

// ---------- Formatting ----------

function formatLatency(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatCost(perHour) {
  if (perHour === 0) return '$0/hr';
  if (perHour < 0.01) return '<$0.01/hr';
  return `$${perHour.toFixed(2)}/hr`;
}

function formatCostPer100Rps(rate) {
  return `${formatCost(rate)} per 100 rps`;
}

function formatRps(rps) {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k rps`;
  return `${Math.round(rps * 10) / 10} rps`;
}

// ---------- Rendering ----------

function renderSimAnnotations() {
  const layer = document.getElementById('layer-sim');
  if (!layer) return;
  layer.innerHTML = '';
  if (!showSimAnnotations) return;

  const rpsActive = isRpsSimActive();
  const rpsMap = rpsActive ? computeNodeRps() : null;

  for (const n of state.nodes) {
    if (n.container || n.textOnly) continue;
    let text = `${formatLatency(nodeLatencyMs(n))} · ${formatCost(nodeCostPerHour(n, rpsMap))}`;
    if (rpsActive) text += ` · ${formatRps(rpsMap.get(n.id) || 0)}`;
    const badge = el('g', { class: 'sim-badge', transform: `translate(${n.x + n.w / 2},${n.y + n.h + 13})` });
    badge.appendChild(el('text', { x: 0, y: 0 }, textNode(text)));
    layer.appendChild(badge);
  }
}

function updateSimSummary() {
  const summaryEl = document.getElementById('sim-summary');
  if (!summaryEl) return;
  if (!showSimAnnotations || !state.nodes.length) {
    summaryEl.style.display = 'none';
    return;
  }

  const origins = computeOriginLatencies();
  const rpsSuffix = (node) => (typeof node.rps === 'number' ? ` @ ${formatRps(node.rps)}` : '');

  let lines;
  if (origins.length <= 1) {
    const only = origins[0];
    lines = [`E2E Latency ${formatLatency(only ? only.latencyMs : 0)}${only ? rpsSuffix(only.node) : ''}`];
  } else {
    lines = origins.map(({ node, latencyMs }) => `${node.label}: ${formatLatency(latencyMs)}${rpsSuffix(node)}`);
  }
  lines.push(`Cost ${formatCost(computeTotalCostPerHour())}`);

  summaryEl.textContent = lines.join('\n');
  summaryEl.style.display = 'block';
}
