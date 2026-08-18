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
];

// Cache-busting for the pattern fetches below — keep this in sync with the
// ?v= bumped on index.html's <script>/<link> tags on every deploy.
const ASSET_VERSION = '16';

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

  const nodes = [];
  const idMap = {};
  let nid = 1;

  if (pattern.title) {
    const def = getComponent('text');
    const minX = Math.min(...pattern.nodes.map((s) => s.x));
    const maxX = Math.max(...pattern.nodes.map((s) => s.x + (s.w || getComponent(s.type).w || DEFAULT_NODE_W)));
    const minY = Math.min(...pattern.nodes.map((s) => s.y));
    const titleW = Math.max(320, pattern.title.length * 11);
    nodes.push({
      id: nid++,
      type: def.id,
      category: def.category,
      label: pattern.title,
      icon: def.icon,
      container: false,
      textOnly: true,
      x: (minX + maxX) / 2 - titleW / 2,
      y: minY - 76,
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
    fromAnchor: e.fromAnchor || undefined,
    toAnchor: e.toAnchor || undefined,
    elbowOffset: typeof e.elbowOffset === 'number' ? e.elbowOffset : undefined,
    elbowOffsetEnd: typeof e.elbowOffsetEnd === 'number' ? e.elbowOffsetEnd : undefined,
    waypoints: Array.isArray(e.waypoints) ? e.waypoints : undefined,
  }));

  loadDiagram(nodes, edges, nid, edges.length + 1);

  setTimeout(() => playFlow(), 500);
}
