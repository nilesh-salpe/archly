// Request-flow animation: plays the numbered edges in order, pulsing the
// source/target nodes and moving a dot along the (possibly curved) edge path.
// Pause takes effect at the next step boundary rather than interrupting a
// hop mid-flight, which keeps the motion readable.

const playState = {
  playing: false,
  index: 0,
  speedMs: 900,
  raf: null,
  timeoutId: null,
};

let flowDotEl = null;

function ensureFlowDot() {
  if (!flowDotEl) {
    flowDotEl = el('circle', { r: 6, class: 'flow-dot' });
    layerOverlay.appendChild(flowDotEl);
  } else if (!flowDotEl.parentNode) {
    layerOverlay.appendChild(flowDotEl);
  }
}

function getSortedEdges() {
  return [...state.edges].sort((a, b) => a.number - b.number || a.id - b.id);
}

function clearHighlights() {
  document.querySelectorAll('.node.flow-active').forEach((n) => n.classList.remove('flow-active'));
  document.querySelectorAll('.edge.flow-active').forEach((n) => n.classList.remove('flow-active'));
  if (flowDotEl) flowDotEl.classList.remove('visible');
}

function playFlow() {
  if (playState.playing) return;
  const order = getSortedEdges();
  if (order.length === 0) return;
  if (playState.index >= order.length) playState.index = 0;
  playState.playing = true;
  stepFlow();
}

function pauseFlow() {
  playState.playing = false;
}

function resetFlow() {
  playState.playing = false;
  playState.index = 0;
  if (playState.raf) cancelAnimationFrame(playState.raf);
  if (playState.timeoutId) clearTimeout(playState.timeoutId);
  clearHighlights();
}

function stepFlow() {
  if (!playState.playing) return;
  const order = getSortedEdges();
  if (playState.index >= order.length) {
    playState.playing = false;
    playState.index = 0;
    clearHighlights();
    return;
  }
  const edge = order[playState.index];
  animateEdgeStep(edge, () => {
    playState.index++;
    stepFlow();
  });
}

function animateEdgeStep(edge, onDone) {
  const sourceEl = document.querySelector(`.node[data-node-id="${edge.from}"]`);
  const targetEl = document.querySelector(`.node[data-node-id="${edge.to}"]`);
  const edgeGroup = document.getElementById(`edge-${edge.id}`);
  const path = document.getElementById(`edge-path-${edge.id}`);

  clearHighlights();
  if (sourceEl) sourceEl.classList.add('flow-active');
  if (targetEl) targetEl.classList.add('flow-active');
  if (edgeGroup) edgeGroup.classList.add('flow-active');

  if (!path) {
    if (flowDotEl) flowDotEl.classList.remove('visible');
    onDone();
    return;
  }

  const len = path.getTotalLength();
  ensureFlowDot();
  flowDotEl.classList.add('visible');

  const duration = playState.speedMs;
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const pt = path.getPointAtLength(t * len);
    flowDotEl.setAttribute('cx', pt.x);
    flowDotEl.setAttribute('cy', pt.y);
    if (t < 1) {
      playState.raf = requestAnimationFrame(frame);
    } else {
      playState.timeoutId = setTimeout(() => {
        flowDotEl.classList.remove('visible');
        onDone();
      }, 250);
    }
  }
  playState.raf = requestAnimationFrame(frame);
}
