// Pre-built architecture patterns: each is a small set of nodes (placed at
// fixed top-left coordinates, in the same coordinate space as the canvas)
// plus numbered edges describing the request flow. Loading a pattern clears
// the canvas, renders it, and auto-starts the flow animation.

const PATTERNS = [
  {
    id: '3tier',
    name: '3-Tier Web App',
    nodes: [
      { id: 'az', type: 'az', x: 270, y: 280, w: 730, h: 140, label: 'Availability Zone' },
      { id: 'user', type: 'user', x: 60, y: 260 },
      { id: 'dns', type: 'dns', x: 300, y: 120 },
      { id: 'elb', type: 'elb', x: 300, y: 320 },
      { id: 'instance', type: 'instance', x: 560, y: 320 },
      { id: 'rds', type: 'rds', x: 820, y: 320 },
    ],
    edges: [
      { from: 'user', to: 'dns', number: 1 },
      { from: 'user', to: 'elb', number: 2 },
      { from: 'elb', to: 'instance', number: 3 },
      { from: 'instance', to: 'rds', number: 4 },
    ],
  },
  {
    id: 'microservices',
    name: 'Microservices + API Gateway',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 300 },
      { id: 'apigw', type: 'apigw', x: 300, y: 300 },
      { id: 'svcA', type: 'instance', x: 620, y: 100, label: 'Orders Service' },
      { id: 'svcB', type: 'instance', x: 620, y: 300, label: 'Catalog Service' },
      { id: 'svcC', type: 'instance', x: 620, y: 500, label: 'Search Service' },
      { id: 'mongo', type: 'mongodb', x: 920, y: 100 },
      { id: 'cassandra', type: 'cassandra', x: 920, y: 300 },
      { id: 'vectordb', type: 'vectordb', x: 920, y: 500 },
    ],
    edges: [
      { from: 'user', to: 'apigw', number: 1 },
      { from: 'apigw', to: 'svcA', number: 2 },
      { from: 'apigw', to: 'svcB', number: 3 },
      { from: 'apigw', to: 'svcC', number: 4 },
      { from: 'svcA', to: 'mongo', number: 5 },
      { from: 'svcB', to: 'cassandra', number: 6 },
      { from: 'svcC', to: 'vectordb', number: 7 },
    ],
  },
  {
    id: 'cache-aside',
    name: 'Cache-Aside',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 300 },
      { id: 'elb', type: 'elb', x: 300, y: 300 },
      { id: 'instance', type: 'instance', x: 560, y: 300 },
      { id: 'redis', type: 'redis', x: 560, y: 100, label: 'Redis Cache' },
      { id: 'rds', type: 'rds', x: 560, y: 500, label: 'RDS (SQL)' },
    ],
    edges: [
      { from: 'user', to: 'elb', number: 1 },
      { from: 'elb', to: 'instance', number: 2 },
      { from: 'instance', to: 'redis', number: 3 },
      { from: 'instance', to: 'rds', number: 4 },
    ],
  },
  {
    id: 'ml',
    name: 'Machine Learning',
    nodes: [
      { id: 'dataset', type: 'dataset', x: 60, y: 120 },
      { id: 'gpucluster', type: 'gpucluster', x: 320, y: 120 },
      { id: 'model', type: 'model', x: 580, y: 120 },
      { id: 'modelregistry', type: 'modelregistry', x: 840, y: 120 },
      { id: 'user', type: 'user', x: 60, y: 400 },
      { id: 'elb', type: 'elb', x: 320, y: 400 },
      { id: 'instance', type: 'instance', x: 580, y: 400, label: 'Inference Service' },
      { id: 'featurestore', type: 'featurestore', x: 840, y: 400 },
    ],
    edges: [
      { from: 'dataset', to: 'gpucluster', number: 1 },
      { from: 'gpucluster', to: 'model', number: 2 },
      { from: 'model', to: 'modelregistry', number: 3 },
      { from: 'user', to: 'elb', number: 4 },
      { from: 'elb', to: 'instance', number: 5 },
      { from: 'instance', to: 'featurestore', number: 6 },
      { from: 'instance', to: 'modelregistry', number: 7 },
    ],
  },
  {
    id: 'genai',
    name: 'GenAI Application',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 300 },
      { id: 'webapp', type: 'webapp', x: 300, y: 300 },
      { id: 'llmgateway', type: 'llmgateway', x: 540, y: 300 },
      { id: 'guardrails', type: 'guardrails', x: 780, y: 300 },
      { id: 'modelprovider', type: 'modelprovider', x: 1020, y: 300, label: 'Foundational Model Provider' },
    ],
    edges: [
      { from: 'user', to: 'webapp', number: 1 },
      { from: 'webapp', to: 'llmgateway', number: 2 },
      { from: 'llmgateway', to: 'guardrails', number: 3 },
      { from: 'guardrails', to: 'modelprovider', number: 4 },
    ],
  },
  {
    id: 'rag',
    name: 'RAG Pipeline',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 300 },
      { id: 'apigw', type: 'apigw', x: 290, y: 300 },
      { id: 'agent', type: 'agent', x: 530, y: 300, label: 'Orchestrator' },
      { id: 'embeddingmodel', type: 'embeddingmodel', x: 780, y: 140 },
      { id: 'vectordb', type: 'vectordb', x: 1020, y: 140 },
      { id: 'modelprovider', type: 'modelprovider', x: 780, y: 460, label: 'Foundational Model Provider' },
    ],
    edges: [
      { from: 'user', to: 'apigw', number: 1 },
      { from: 'apigw', to: 'agent', number: 2 },
      { from: 'agent', to: 'embeddingmodel', number: 3 },
      { from: 'embeddingmodel', to: 'vectordb', number: 4 },
      { from: 'vectordb', to: 'agent', number: 5 },
      { from: 'agent', to: 'modelprovider', number: 6 },
    ],
  },
];

function getPattern(id) {
  return PATTERNS.find((p) => p.id === id);
}

function loadPattern(id) {
  const pattern = getPattern(id);
  if (!pattern) return;

  const nodes = [];
  const idMap = {};
  let nid = 1;
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
    lineStyle: 'solid',
    arrowStyle: 'end',
  }));

  loadDiagram(nodes, edges, nid, edges.length + 1);

  setTimeout(() => playFlow(), 500);
}
