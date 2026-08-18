// Pre-built architecture patterns: each is a small set of nodes (placed at
// fixed top-left coordinates, in the same coordinate space as the canvas)
// plus numbered edges describing the request flow. Loading a pattern clears
// the canvas, renders a title label above the diagram, and auto-starts the
// flow animation.

const PATTERNS = [
  {
    id: '3tier',
    name: '3-Tier Web App',
    title: '3-Tier Web Application',
    nodes: [
      { id: 'az', type: 'az', x: 270, y: 320, w: 970, h: 160, label: 'Availability Zone' },
      { id: 'user', type: 'user', x: 60, y: 330 },
      { id: 'dns', type: 'dns', x: 60, y: 130 },
      { id: 'cdn', type: 'cdn', x: 300, y: 130 },
      { id: 'waf', type: 'waf', x: 300, y: 360 },
      { id: 'elb', type: 'elb', x: 540, y: 360 },
      { id: 'instance', type: 'instance', x: 780, y: 360 },
      { id: 'cache', type: 'cache', x: 780, y: 160, label: 'Session Cache' },
      { id: 'sqldb', type: 'sqldb', x: 1020, y: 360 },
      { id: 'readreplica', type: 'readreplica', x: 1020, y: 560 },
    ],
    edges: [
      { from: 'user', to: 'dns', number: 1 },
      { from: 'user', to: 'cdn', number: 2 },
      { from: 'user', to: 'waf', number: 3 },
      { from: 'waf', to: 'elb', number: 4 },
      { from: 'elb', to: 'instance', number: 5 },
      { from: 'instance', to: 'cache', number: 6 },
      { from: 'instance', to: 'sqldb', number: 7 },
      { from: 'sqldb', to: 'readreplica', number: 8, lineStyle: 'dashed' },
    ],
  },
  {
    id: 'microservices',
    name: 'Microservices + API Gateway',
    title: 'Microservices with API Gateway',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 340 },
      { id: 'apigw', type: 'apigw', x: 300, y: 340 },
      { id: 'auth', type: 'auth', x: 300, y: 130 },
      { id: 'ratelimiter', type: 'ratelimiter', x: 300, y: 560, label: 'Rate Limiter' },
      { id: 'svcA', type: 'instance', x: 620, y: 100, label: 'Orders Service' },
      { id: 'svcB', type: 'instance', x: 620, y: 340, label: 'Catalog Service' },
      { id: 'svcC', type: 'instance', x: 620, y: 580, label: 'Search Service' },
      { id: 'mongo', type: 'mongodb', x: 920, y: 100 },
      { id: 'cassandra', type: 'cassandra', x: 920, y: 340 },
      { id: 'vectordb', type: 'vectordb', x: 920, y: 580 },
      { id: 'eventbus', type: 'eventbus', x: 1180, y: 100, label: 'Order Events' },
      { id: 'metrics', type: 'metrics', x: 60, y: 130 },
    ],
    edges: [
      { from: 'user', to: 'apigw', number: 1 },
      { from: 'apigw', to: 'auth', number: 2 },
      { from: 'apigw', to: 'ratelimiter', number: 3 },
      { from: 'apigw', to: 'svcA', number: 4 },
      { from: 'apigw', to: 'svcB', number: 5 },
      { from: 'apigw', to: 'svcC', number: 6 },
      { from: 'svcA', to: 'mongo', number: 7 },
      { from: 'svcB', to: 'cassandra', number: 8 },
      { from: 'svcC', to: 'vectordb', number: 9 },
      { from: 'svcA', to: 'eventbus', number: 10, lineStyle: 'dashed' },
      { from: 'apigw', to: 'metrics', number: 11, lineStyle: 'dotted', arrowStyle: 'none' },
    ],
  },
  {
    id: 'cache-aside',
    name: 'Cache-Aside',
    title: 'Cache-Aside with Resilience',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 340 },
      { id: 'elb', type: 'elb', x: 300, y: 340 },
      { id: 'ratelimiter', type: 'ratelimiter', x: 300, y: 130, label: 'Rate Limiter' },
      { id: 'instance', type: 'instance', x: 560, y: 340 },
      { id: 'redis', type: 'redis', x: 560, y: 130 },
      { id: 'circuitbreaker', type: 'circuitbreaker', x: 820, y: 340, label: 'Circuit Breaker' },
      { id: 'sqldb', type: 'sqldb', x: 1060, y: 340 },
      { id: 'readreplica', type: 'readreplica', x: 1060, y: 540 },
    ],
    edges: [
      { from: 'user', to: 'elb', number: 1 },
      { from: 'elb', to: 'ratelimiter', number: 2 },
      { from: 'ratelimiter', to: 'instance', number: 3 },
      { from: 'instance', to: 'redis', number: 4 },
      { from: 'instance', to: 'circuitbreaker', number: 5 },
      { from: 'circuitbreaker', to: 'sqldb', number: 6 },
      { from: 'sqldb', to: 'readreplica', number: 7, lineStyle: 'dashed' },
    ],
  },
  {
    id: 'ml',
    name: 'Machine Learning',
    title: 'Machine Learning: Training & Serving',
    nodes: [
      { id: 'dataset', type: 'dataset', x: 60, y: 120 },
      { id: 'workflow', type: 'workflow', x: 320, y: 120, label: 'Training Pipeline' },
      { id: 'gpucluster', type: 'gpucluster', x: 580, y: 120 },
      { id: 'modelregistry', type: 'modelregistry', x: 840, y: 120 },
      { id: 'user', type: 'user', x: 60, y: 420 },
      { id: 'elb', type: 'elb', x: 320, y: 420 },
      { id: 'instance', type: 'instance', x: 580, y: 420, label: 'Inference Service' },
      { id: 'featurestore', type: 'featurestore', x: 840, y: 420 },
      { id: 'metrics', type: 'metrics', x: 1100, y: 420, label: 'Model Monitoring' },
    ],
    edges: [
      { from: 'dataset', to: 'workflow', number: 1 },
      { from: 'workflow', to: 'gpucluster', number: 2 },
      { from: 'gpucluster', to: 'modelregistry', number: 3 },
      { from: 'user', to: 'elb', number: 4 },
      { from: 'elb', to: 'instance', number: 5 },
      { from: 'instance', to: 'featurestore', number: 6 },
      { from: 'instance', to: 'modelregistry', number: 7 },
      { from: 'instance', to: 'metrics', number: 8, lineStyle: 'dotted', arrowStyle: 'none' },
    ],
  },
  {
    id: 'genai',
    name: 'GenAI Application',
    title: 'GenAI Application',
    nodes: [
      { id: 'user', type: 'user', x: 60, y: 320 },
      { id: 'webapp', type: 'webapp', x: 280, y: 320 },
      { id: 'auth', type: 'auth', x: 280, y: 110 },
      { id: 'memory', type: 'memory', x: 500, y: 110, label: 'Conversation Memory' },
      { id: 'prompttemplate', type: 'prompttemplate', x: 500, y: 320, label: 'Prompt' },
      { id: 'llmgateway', type: 'llmgateway', x: 720, y: 320 },
      { id: 'ratelimiter', type: 'ratelimiter', x: 720, y: 110, label: 'Rate Limiter' },
      { id: 'guardrails', type: 'guardrails', x: 940, y: 320 },
      { id: 'modelprovider', type: 'modelprovider', x: 1160, y: 320, label: 'External LLM' },
      { id: 'metrics', type: 'metrics', x: 1160, y: 110, label: 'Token / Cost Metrics' },
    ],
    edges: [
      { from: 'user', to: 'webapp', number: 1 },
      { from: 'webapp', to: 'auth', number: 2 },
      { from: 'webapp', to: 'memory', number: 3 },
      { from: 'webapp', to: 'prompttemplate', number: 4 },
      { from: 'prompttemplate', to: 'llmgateway', number: 5 },
      { from: 'llmgateway', to: 'ratelimiter', number: 6 },
      { from: 'ratelimiter', to: 'guardrails', number: 7 },
      { from: 'guardrails', to: 'modelprovider', number: 8 },
      { from: 'modelprovider', to: 'metrics', number: 9, lineStyle: 'dotted', arrowStyle: 'none' },
    ],
  },
  {
    id: 'rag',
    name: 'RAG Pipeline',
    title: 'RAG Pipeline: Ingestion & Query',
    nodes: [
      // Ingestion (offline) pipeline — top row
      { id: 'documentstore', type: 'documentstore', x: 60, y: 100 },
      { id: 'parser', type: 'parser', x: 300, y: 100 },
      { id: 'chunker', type: 'chunker', x: 540, y: 100 },
      // Shared indexing/retrieval components — middle
      { id: 'embeddingmodel', type: 'embeddingmodel', x: 780, y: 320, label: 'Embedding' },
      { id: 'vectordb', type: 'vectordb', x: 1020, y: 320 },
      // Query (online) pipeline — bottom row
      { id: 'user', type: 'user', x: 60, y: 540 },
      { id: 'apigw', type: 'apigw', x: 300, y: 540 },
      { id: 'agent', type: 'agent', x: 540, y: 540, label: 'Orchestrator' },
      { id: 'reranker', type: 'reranker', x: 1020, y: 540 },
      { id: 'contextbuilder', type: 'contextbuilder', x: 1260, y: 540, label: 'Context Builder' },
      { id: 'modelprovider', type: 'modelprovider', x: 1500, y: 540, label: 'External LLM' },
    ],
    edges: [
      { from: 'documentstore', to: 'parser', number: 1 },
      { from: 'parser', to: 'chunker', number: 2 },
      { from: 'chunker', to: 'embeddingmodel', number: 3 },
      { from: 'embeddingmodel', to: 'vectordb', number: 4, lineStyle: 'dashed' },
      { from: 'user', to: 'apigw', number: 5 },
      { from: 'apigw', to: 'agent', number: 6 },
      { from: 'agent', to: 'embeddingmodel', number: 7 },
      { from: 'embeddingmodel', to: 'vectordb', number: 8 },
      { from: 'vectordb', to: 'reranker', number: 9 },
      { from: 'reranker', to: 'contextbuilder', number: 10 },
      { from: 'contextbuilder', to: 'modelprovider', number: 11 },
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
  }));

  loadDiagram(nodes, edges, nid, edges.length + 1);

  setTimeout(() => playFlow(), 500);
}
