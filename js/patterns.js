// Pre-built architecture patterns, loaded from patterns/*.yaml at startup.
// Each file is a small set of nodes (placed at fixed top-left coordinates, in
// the same coordinate space as the canvas) plus numbered edges describing the
// request flow. Loading a pattern clears the canvas, renders a title label
// above the diagram, and auto-starts the flow animation.

// No server-side directory listing on static hosting (GitHub Pages included),
// so the filenames are just listed here — add a line when adding a pattern.
const PATTERN_FILES = [
  '3tier.yaml',
  'microservices.yaml',
  'cache-aside.yaml',
  'ml.yaml',
  'genai.yaml',
  'rag.yaml',
  'event-driven.yaml',
  'job-queue.yaml',
  'serverless.yaml',
  'etl-pipeline.yaml',
  'multi-region-dr.yaml',
  'saga.yaml',
  'multi-agent.yaml',
  'secure-api.yaml',
  // System-design interview classics — the questions that actually get asked,
  // as opposed to the architecture patterns above.
  'url-shortener.yaml',
  'news-feed.yaml',
  'chat.yaml',
  'video-streaming.yaml',
  'ride-hailing.yaml',
  'file-storage.yaml',
  'web-crawler.yaml',
  'notifications.yaml',
  'rate-limiter.yaml',
  'typeahead.yaml',
];

// Cache-busting for the pattern fetches below — keep this in sync with the
// ?v= bumped on index.html's <script>/<link> tags on every deploy.
const ASSET_VERSION = '43';

let PATTERNS = [];

async function loadPatternDefinitions() {
  const loaded = await Promise.all(
    PATTERN_FILES.map(async (file) => {
      try {
        const res = await fetch(`patterns/${file}?v=${ASSET_VERSION}`);
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return parseYAML(await res.text());
      } catch (e) {
        console.error(`Failed to load pattern ${file}:`, e);
        return null;
      }
    })
  );
  PATTERNS = loaded.filter(Boolean);
}

function getPattern(id) {
  return PATTERNS.find((p) => p.id === id);
}

function loadPattern(id) {
  const pattern = getPattern(id);
  if (!pattern) return;
  // Same guard as clearDiagramWithConfirm (app.js) and YAML import
  // (export.js) — picking a pattern replaces the whole canvas, and the
  // empty-canvas quick-start buttons never hit this (state.nodes is always
  // empty there), so this only prompts when it's actually about to discard
  // something. The Patterns ▾ dropdown was the one entry point missing it.
  if (state.nodes.length && !confirm('Replace the current diagram with this pattern? This cannot be undone.')) return;

  const nodes = [];
  const idMap = {};
  let nid = 1;

  if (pattern.title) {
    const def = getComponent('text');
    const minX = Math.min(...pattern.nodes.map((s) => s.x));
    const maxX = Math.max(...pattern.nodes.map((s) => s.x + (s.w || getComponent(s.type).w || DEFAULT_NODE_W)));
    const minY = Math.min(...pattern.nodes.map((s) => s.y));
    const titleW = Math.max(320, pattern.title.length * 11);
    // Just a fixed breathing-room gap above the diagram now — keeping this
    // clear of the toolbar is zoomToFit()'s job (called below), since that
    // applies uniformly any time the view fits, not only right after a
    // pattern loads.
    nodes.push({
      id: nid++,
      type: def.id,
      category: def.category,
      label: pattern.title,
      icon: def.icon,
      container: false,
      textOnly: true,
      x: (minX + maxX) / 2 - titleW / 2,
      y: minY - 90,
      w: titleW,
      h: 40,
    });
  }

  for (const spec of pattern.nodes) {
    const def = getComponent(spec.type);
    const w = spec.w || def.w || DEFAULT_NODE_W;
    const h = spec.h || def.h || DEFAULT_NODE_H;
    const node = {
      id: nid,
      type: def.id,
      category: def.category,
      label: spec.label || def.label,
      icon: def.icon,
      container: !!def.container,
      textOnly: !!def.textOnly,
      imageOnly: !!def.imageOnly,
      x: spec.x,
      y: spec.y,
      w,
      h,
      latencyMs: typeof spec.latencyMs === 'number' ? spec.latencyMs : undefined,
      costPerHour: typeof spec.costPerHour === 'number' ? spec.costPerHour : undefined,
      costPer100Rps: typeof spec.costPer100Rps === 'number' ? spec.costPer100Rps : undefined,
      rps: typeof spec.rps === 'number' ? spec.rps : undefined,
      textStyle: typeof spec.textStyle === 'string' ? spec.textStyle : undefined,
      textColor: typeof spec.textColor === 'string' ? spec.textColor : undefined,
      fontFamily: typeof spec.fontFamily === 'string' ? spec.fontFamily : undefined,
      textAlign: typeof spec.textAlign === 'string' ? spec.textAlign : undefined,
      hideIcon: spec.hideIcon === true ? true : undefined,
      // Lets a pattern pin a box taller than its label needs — otherwise the
      // load-time refitAllNodeHeights() pass would shrink it back.
      manualH: spec.manualH === true ? true : undefined,
      groupId: typeof spec.groupId === 'number' ? spec.groupId : undefined,
    };
    idMap[spec.id] = nid;
    nodes.push(node);
    nid++;
  }

  const edges = pattern.edges.map((e, i) => ({
    id: i + 1,
    from: idMap[e.from],
    to: idMap[e.to],
    number: e.number,
    lineStyle: e.lineStyle || 'solid',
    arrowStyle: e.arrowStyle || 'end',
    curve: typeof e.curve === 'number' ? e.curve : undefined,
    routing: e.routing === 'orthogonal' ? 'orthogonal' : undefined,
    rounded: e.rounded === true ? true : undefined,
    fromAnchor: e.fromAnchor || undefined,
    toAnchor: e.toAnchor || undefined,
    elbowOffset: typeof e.elbowOffset === 'number' ? e.elbowOffset : undefined,
    elbowOffsetEnd: typeof e.elbowOffsetEnd === 'number' ? e.elbowOffsetEnd : undefined,
    waypoints: Array.isArray(e.waypoints) ? e.waypoints.map((wp) => ({ ...wp })) : undefined,
  }));

  // Patterns are authored with their topmost row close to canvas y=0 —
  // zoomToFit() (canvas.js) reserves screen space for the toolbar by
  // scrolling up from the content, but the canvas can't scroll past 0, so
  // with no headroom above the title that reservation silently has nowhere
  // to go and the title ends up under the toolbar anyway. Shifting the
  // whole diagram down first (purely cosmetic — zoomToFit repositions the
  // view regardless) guarantees the room exists. 320 comfortably covers the
  // toolbar's reserved clearance even at the most zoomed-out fit (down to
  // ZOOM_MIN); shifting doesn't change the diagram's own width/height, so
  // it can't affect the fit zoom level zoomToFit ends up choosing.
  const minYAll = Math.min(...nodes.map((n) => n.y));
  const shift = Math.max(0, 320 - minYAll);
  if (shift > 0) {
    for (const n of nodes) n.y += shift;
    for (const e of edges) {
      if (e.waypoints) for (const wp of e.waypoints) wp.y += shift;
    }
  }

  loadDiagram(nodes, edges, nid, edges.length + 1);
  zoomToFit();

  setTimeout(() => playFlow(), 500);
}
