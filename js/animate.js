// Request-flow animation: edges are grouped by number into steps — all edges
// sharing a number play concurrently (each gets its own dot), and the engine
// waits for the whole step to finish before advancing to the next number.
// Pause takes effect at the next step boundary rather than interrupting a
// hop mid-flight, which keeps the motion readable.

const playState = {
  playing: false,
  index: 0, // index into step groups, not individual edges
  speedMs: 900,
  activeRafs: new Map(), // edge id -> current raf id (one in-flight raf per edge)
  activeTimeouts: new Set(),
};

const flowDots = new Map(); // edge id -> <circle> dot element

function getFlowDotFor(edgeId) {
  let dot = flowDots.get(edgeId);
  if (!dot || !dot.parentNode) {
    dot = el('circle', { r: 6, class: 'flow-dot' });
    layerOverlay.appendChild(dot);
    flowDots.set(edgeId, dot);
  }
  return dot;
}

// Edges are sorted by number, then grouped so consecutive same-number edges
// (a "step") animate together — this is what lets parallel/fan-out steps
// (e.g. two edges both numbered 3) play at the same time instead of one after
// another.
function getStepGroups() {
  const sorted = [...state.edges].sort((a, b) => a.number - b.number || a.id - b.id);
  const groups = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.number === e.number) last.edges.push(e);
    else groups.push({ number: e.number, edges: [e] });
  }
  return groups;
}

function clearHighlights() {
  document.querySelectorAll('.node.flow-active').forEach((n) => n.classList.remove('flow-active'));
  document.querySelectorAll('.edge.flow-active').forEach((n) => n.classList.remove('flow-active'));
  flowDots.forEach((dot) => dot.classList.remove('visible'));
}

function playFlow() {
  if (playState.playing) return;
  const groups = getStepGroups();
  if (groups.length === 0) return;
  if (playState.index >= groups.length) playState.index = 0;
  playState.playing = true;
  stepFlow();
}

function pauseFlow() {
  playState.playing = false;
}

function resetFlow() {
  playState.playing = false;
  playState.index = 0;
  playState.activeRafs.forEach((id) => cancelAnimationFrame(id));
  playState.activeRafs.clear();
  playState.activeTimeouts.forEach((id) => clearTimeout(id));
  playState.activeTimeouts.clear();
  clearHighlights();
}

function stepFlow() {
  if (!playState.playing) return;
  const groups = getStepGroups();
  if (playState.index >= groups.length) {
    playState.playing = false;
    playState.index = 0;
    clearHighlights();
    return;
  }
  const group = groups[playState.index];
  animateStepGroup(group, () => {
    playState.index++;
    stepFlow();
  });
}

function animateStepGroup(group, onDone) {
  clearHighlights();
  let remaining = group.edges.length;
  const onEdgeDone = () => {
    remaining--;
    if (remaining === 0) onDone();
  };
  for (const edge of group.edges) {
    animateSingleEdge(edge, onEdgeDone);
  }
}

function animateSingleEdge(edge, onDone) {
  const sourceEl = document.querySelector(`.node[data-node-id="${edge.from}"]`);
  const targetEl = document.querySelector(`.node[data-node-id="${edge.to}"]`);
  const edgeGroup = document.getElementById(`edge-${edge.id}`);
  const path = document.getElementById(`edge-path-${edge.id}`);

  if (sourceEl) sourceEl.classList.add('flow-active');
  if (targetEl) targetEl.classList.add('flow-active');
  if (edgeGroup) edgeGroup.classList.add('flow-active');

  if (!path) {
    onDone();
    return;
  }

  const len = path.getTotalLength();
  const dot = getFlowDotFor(edge.id);
  dot.classList.add('visible');

  const duration = playState.speedMs;
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const pt = path.getPointAtLength(t * len);
    dot.setAttribute('cx', pt.x);
    dot.setAttribute('cy', pt.y);
    if (t < 1) {
      playState.activeRafs.set(edge.id, requestAnimationFrame(frame));
    } else {
      playState.activeRafs.delete(edge.id);
      const to = setTimeout(() => {
        playState.activeTimeouts.delete(to);
        dot.classList.remove('visible');
        onDone();
      }, 250);
      playState.activeTimeouts.add(to);
    }
  }
  playState.activeRafs.set(edge.id, requestAnimationFrame(frame));
}
