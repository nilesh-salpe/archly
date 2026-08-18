// Simulation: rough latency/cost estimates overlaid on the same canvas,
// toggled from View ▾ — not a separate mode, no separate screen. Numbers
// come from CATEGORY_DEFAULT_LATENCY_MS/CATEGORY_DEFAULT_COST_PER_HOUR
// (components.js) unless a node has its own latencyMs/costPerHour (no
// editor for that yet — this is the first, simplest pass).
//
// E2E latency reuses the exact step-groups animate.js already builds for
// Play (edges sharing a number run concurrently): sequential steps add,
// concurrent steps within one number take the max of their branches — the
// same thing you'd see timing a Play run, just computed instead of
// animated. Edges explicitly styled with no arrowhead (the fire-and-forget
// convention several patterns already use for metrics/logging side-edges)
// are treated as non-blocking and excluded.
//
// Cost is independent of the flow: every non-container, non-text node's
// hourly cost, summed.

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

function nodeLatencyMs(n) {
  if (typeof n.latencyMs === 'number') return n.latencyMs;
  return CATEGORY_DEFAULT_LATENCY_MS[n.category] || 0;
}

function nodeCostPerHour(n) {
  if (typeof n.costPerHour === 'number') return n.costPerHour;
  return CATEGORY_DEFAULT_COST_PER_HOUR[n.category] || 0;
}

function computeE2ELatencyMs() {
  const groups = getStepGroups();
  let total = 0;
  for (const group of groups) {
    let stepMax = 0;
    for (const edge of group.edges) {
      if (edge.arrowStyle === 'none') continue; // fire-and-forget — doesn't block the flow
      const target = nodeById(edge.to);
      if (!target) continue;
      const hop = nodeLatencyMs(target);
      if (hop > stepMax) stepMax = hop;
    }
    total += stepMax;
  }
  return total;
}

function computeTotalCostPerHour() {
  let total = 0;
  for (const n of state.nodes) {
    if (n.container || n.textOnly) continue;
    total += nodeCostPerHour(n);
  }
  return total;
}

function formatLatency(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatCost(perHour) {
  if (perHour === 0) return '$0/hr';
  if (perHour < 0.01) return '<$0.01/hr';
  return `$${perHour.toFixed(2)}/hr`;
}

function renderSimAnnotations() {
  const layer = document.getElementById('layer-sim');
  if (!layer) return;
  layer.innerHTML = '';
  if (!showSimAnnotations) return;

  for (const n of state.nodes) {
    if (n.container || n.textOnly) continue;
    const text = `${formatLatency(nodeLatencyMs(n))} · ${formatCost(nodeCostPerHour(n))}`;
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
  const latency = computeE2ELatencyMs();
  const cost = computeTotalCostPerHour();
  summaryEl.textContent = `E2E Latency ${formatLatency(latency)}  ·  Cost ${formatCost(cost)}`;
  summaryEl.style.display = 'block';
}
