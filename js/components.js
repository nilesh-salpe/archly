// Palette catalog: every component the user can drag onto the canvas.
// Icons are small hand-built SVG fragments in a 24x24 box (no external
// assets, no copied provider icons) so the whole diagram stays pure SVG.
//
// Categories follow a system-design-role taxonomy (Client, Edge, Services,
// Communication, Reliability, Observability, ML, GenAI, RAG, External, ...)
// rather than any one cloud vendor's primitives, so diagrams can describe
// distributed systems, ML systems, GenAI/RAG applications, and microservices
// without being tied to AWS/GCP/Azure naming.

const CATEGORY_COLORS = {
  client: '#8b5cf6',
  edge: '#3b82f6',
  netbound: '#64748b',
  services: '#f97316',
  compute: '#fb923c',
  communication: '#ec4899',
  cache: '#f43f5e',
  data: '#10b981',
  processing: '#84cc16',
  reliability: '#eab308',
  security: '#ef4444',
  observability: '#06b6d4',
  ml: '#0d9488',
  genai: '#7c3aed',
  rag: '#a855f7',
  external: '#78716c',
  general: '#94a3b8',
};

// Node cards stay light-pastel regardless of page theme (like cards on a
// canvas), so fills never need to change when the OS theme flips.
const CATEGORY_FILLS = {
  client: '#ede9fe',
  edge: '#dbeafe',
  netbound: '#f1f5f9',
  services: '#ffedd5',
  compute: '#ffe4c7',
  communication: '#fce7f3',
  cache: '#ffe4e6',
  data: '#d1fae5',
  processing: '#ecfccb',
  reliability: '#fef9c3',
  security: '#fee2e2',
  observability: '#cffafe',
  ml: '#ccfbf1',
  genai: '#f3e8ff',
  rag: '#fae8ff',
  external: '#f5f5f4',
  general: '#f8fafc',
};

const CATEGORY_LABELS = {
  client: 'Client',
  edge: 'Edge',
  netbound: 'Network & Boundary',
  services: 'Services',
  compute: 'Compute',
  communication: 'Communication',
  cache: 'Cache',
  data: 'Data',
  processing: 'Processing',
  reliability: 'Reliability',
  security: 'Security',
  observability: 'Observability',
  ml: 'ML',
  genai: 'GenAI',
  rag: 'RAG',
  external: 'External',
  general: 'General',
};

// Icon fragments, viewBox-local coordinates 0..24. Kept intentionally simple
// (circles/rects/paths) so they read clearly at small node size.
const ICONS = {
  // Client
  user: `<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1-4.2 4-6.2 7.5-6.2s6.5 2 7.5 6.2"/>`,
  webapp: `<rect x="3.5" y="4.5" width="17" height="14" rx="1.5"/><path d="M3.5 8.3h17"/><circle cx="6" cy="6.4" r="0.7" fill="currentColor" stroke="none"/>`,
  mobileapp: `<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 19h3" />`,
  extclient: `<circle cx="12" cy="9" r="3.4"/><path d="M6 20c1-3.6 3.4-5.4 6-5.4s5 1.8 6 5.4"/><path d="M3 5v4M3 5h4M21 5v4M21 5h-4" fill="none"/>`,
  // Edge
  dns: `<circle cx="12" cy="12" r="7.5"/><path d="M4.5 12h15M12 4.5c2.5 2 2.5 13 0 15M12 4.5c-2.5 2-2.5 13 0 15" fill="none"/>`,
  cdn: `<circle cx="7" cy="8" r="2.6"/><circle cx="17" cy="8" r="2.6"/><circle cx="12" cy="17" r="2.6"/><path d="M9 9.5l1.6 5M15 9.5l-1.6 5M9.4 8h5.2"/>`,
  waf: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><path d="M9 12l2 2 4-4" fill="none"/>`,
  elb: `<circle cx="12" cy="6" r="2.4"/><path d="M12 8.4v3M12 11.4H6v3M12 11.4h6v3"/><circle cx="6" cy="17" r="2.4"/><circle cx="18" cy="17" r="2.4"/>`,
  apigw: `<rect x="4" y="7" width="16" height="10" rx="1.5"/><path d="M9 10v4M15 10l-2 2 2 2" fill="none"/>`,
  // Network & Boundary
  region: `<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2"/><path d="M12 4v16"/>`,
  az: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M4 10h16M4 14h16"/>`,
  vpc: `<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2"/>`,
  subnet: `<rect x="5" y="5" width="14" height="14" rx="1.5" stroke-dasharray="2 2"/>`,
  igw: `<circle cx="12" cy="12" r="7.5"/><path d="M9 9l6 6M15 9l-6 6"/>`,
  nat: `<circle cx="12" cy="12" r="7.5"/><path d="M8 12h8M13 9l3 3-3 3"/>`,
  // Services
  apiservice: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2" fill="none"/>`,
  microservice: `<path d="M12 3l7 4v10l-7 4-7-4V7z"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>`,
  worker: `<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" fill="none"/>`,
  scheduler: `<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M4 9.5h16M8 3v4M16 3v4"/><path d="M12 13v3l2 1" fill="none"/>`,
  // Compute
  instance: `<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M7 9h2M7 12h6M7 15h4"/>`,
  container: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16"/>`,
  lambda: `<path d="M8 4.5h3l6 15h-3l-2.2-5.6L9.5 20H6.5l4.3-8-2.8-7z" fill-rule="evenodd"/>`,
  // Communication
  queue: `<rect x="2" y="9" width="5" height="6" rx="1"/><rect x="9.5" y="9" width="5" height="6" rx="1"/><rect x="17" y="9" width="5" height="6" rx="1"/><path d="M7 12h2.5M14.5 12H17" fill="none"/>`,
  kafka: `<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="17" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.6" fill="currentColor" stroke="none"/>`,
  eventbus: `<path d="M2 12h20"/><circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M6 12V6M12 12V6M18 12V6" fill="none"/>`,
  websocket: `<path d="M4 8l4-4 4 4M8 4v9" fill="none"/><path d="M20 16l-4 4-4-4M16 20v-9" fill="none"/>`,
  rabbitmq: `<circle cx="12" cy="14" r="6"/><path d="M8 8l-1-5 4 3M16 8l1-5-4 3" fill="none"/>`,
  // Cache
  cache: `<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M13 7l-4 6h3l-1 4 5-7h-3z" fill="currentColor" stroke="none"/>`,
  redis: `<ellipse cx="12" cy="7" rx="7.5" ry="2.8"/><path d="M4.5 7v10c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V7"/><path d="M8 12.3l2.4 1.3 2.4-1.3" fill="none"/>`,
  // Data
  sqldb: `<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M8 11h8M8 14h8" fill="none"/>`,
  nosqldb: `<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M10 10.5c-1 0-1 1-1 1.5s0 1.5 1 1.5M14 10.5c1 0 1 1 1 1.5s0 1.5-1 1.5" fill="none"/>`,
  readreplica: `<ellipse cx="9" cy="7" rx="5.5" ry="2.2"/><path d="M3.5 7v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V7"/><path d="M16 9l4 3-4 3" fill="none"/>`,
  search: `<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20" fill="none"/><path d="M7.5 10h5M10 7.5v5" fill="none"/>`,
  timeseriesdb: `<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M6.5 15l2.5-3 2 2 3.5-4.5 2.5 3" fill="none"/>`,
  datalake: `<path d="M3 6h18v6H3z"/><path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none"/><path d="M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none"/>`,
  lakehouse: `<path d="M4 11l8-6 8 6" fill="none"/><path d="M6 11v8h12v-8" fill="none"/><path d="M8 15c1.3-1 2.7-1 4 0s2.7 1 4 0" fill="none"/>`,
  rds: `<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>`,
  cassandra: `<ellipse cx="12" cy="5.5" rx="7.5" ry="2.6"/><path d="M4.5 5.5v13c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6v-13"/><path d="M4.5 10.2c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6M4.5 14.8c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6"/>`,
  mongodb: `<path d="M12 3c3 3.5 4.5 7 4.5 10.2 0 3.6-2 6-4.5 7.3-2.5-1.3-4.5-3.7-4.5-7.3C7.5 10 9 6.5 12 3z"/><path d="M12 13v7.5" fill="none"/>`,
  neo4j: `<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="7" r="2.3"/><circle cx="12" cy="18" r="2.3"/><path d="M7.8 8.3L10.5 16.2M16.2 8.3L13.5 16.2M8.3 7h7.4" fill="none"/>`,
  s3: `<path d="M5 7l7-3.5L19 7v10l-7 3.5L5 17z"/><path d="M5 7l7 3.5M12 10.5L19 7M12 10.5v10"/>`,
  // Processing
  batch: `<rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/>`,
  streamprocessor: `<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M6 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" fill="none"/>`,
  workflow: `<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M7 11l10-4M7 13l10 4" fill="none"/>`,
  // Reliability
  ratelimiter: `<path d="M4 16a8 8 0 0 1 16 0" fill="none"/><path d="M12 16l4-5" fill="none"/><circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none"/>`,
  circuitbreaker: `<path d="M3 12h6" fill="none"/><path d="M15 12h6" fill="none"/><path d="M9 12l3-4 3 8" fill="none"/>`,
  retry: `<path d="M5 12a7 7 0 1 1 2 4.9" fill="none"/><path d="M4 17v-4h4" fill="none"/>`,
  asg: `<rect x="6" y="7" width="14" height="10" rx="1.3" opacity="0.55"/><rect x="4" y="9" width="14" height="10" rx="1.3" opacity="0.8"/><rect x="2" y="11" width="14" height="10" rx="1.3"/>`,
  // Security
  auth: `<rect x="6" y="10" width="12" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none"/><path d="M9.5 15l2 2 3.5-4" fill="none"/>`,
  iam: `<circle cx="9" cy="9" r="4.2"/><path d="M12.1 11.9L20 19.8M16.5 15.3l2.3-2.3M19 17.8l2.3-2.3" fill="none"/>`,
  secrets: `<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 10v2l1.5 1" fill="none"/>`,
  encryption: `<rect x="6" y="10" width="12" height="9" rx="1.5"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" fill="none"/><circle cx="10.2" cy="14.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="13.8" cy="14.5" r="0.8" fill="currentColor" stroke="none"/>`,
  secgroup: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><circle cx="12" cy="11" r="2.2"/><path d="M12 13.2v3" fill="none"/>`,
  // Observability
  logs: `<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M6 9h9M6 12.5h12M6 16h7" fill="none"/>`,
  metrics: `<path d="M4 20V10M10 20V4M16 20v-7M4 20h16" fill="none"/>`,
  traces: `<rect x="3" y="5" width="14" height="3" rx="1"/><rect x="7" y="10.5" width="10" height="3" rx="1"/><rect x="10" y="16" width="8" height="3" rx="1"/>`,
  alerts: `<path d="M12 4a5 5 0 0 0-5 5v3.5L5 16h14l-2-3.5V9a5 5 0 0 0-5-5z" fill="none"/><path d="M10 19a2 2 0 0 0 4 0" fill="none"/><circle cx="17.5" cy="6.5" r="2" fill="currentColor" stroke="none"/>`,
  // ML
  model: `<circle cx="5" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="17" r="1.6" fill="currentColor" stroke="none"/><path d="M5 7l7 5M5 17l7-5M12 12l7-5M12 12l7 5" fill="none"/>`,
  training: `<path d="M4 12a8 8 0 1 1 3 6.2" fill="none"/><path d="M4 12l3-2v4z" fill="currentColor" stroke="none"/>`,
  modelregistry: `<rect x="4" y="7" width="14" height="13" rx="1.5"/><path d="M4 11h14"/><path d="M14 3.5l5 5-2.5 2.5-5-5z"/><circle cx="17.3" cy="5.3" r="0.9" fill="currentColor" stroke="none"/>`,
  modelserver: `<rect x="4" y="4" width="16" height="6" rx="1.3"/><rect x="4" y="14" width="16" height="6" rx="1.3"/><circle cx="7" cy="7" r="0.9" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="0.9" fill="currentColor" stroke="none"/>`,
  inference: `<circle cx="12" cy="12" r="8"/><path d="M13 7l-4 6h3l-1 4 5-7h-3z" fill="currentColor" stroke="none"/>`,
  featurestore: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16"/><circle cx="6.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="7" r="1" fill="currentColor" stroke="none"/>`,
  dataset: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 8.8h16M4 12h16M4 15.2h16"/>`,
  gpucluster: `<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 7V4M12 7V4M15 7V4M9 20v-3M12 20v-3M15 20v-3M7 9H4M7 12H4M7 15H4M20 9h-3M20 12h-3M20 15h-3" fill="none"/>`,
  // GenAI
  llm: `<path d="M4 5h16v10H9l-4 4v-4H4z"/><path d="M12 8v2M10.5 9.5h3" fill="none"/>`,
  llmgateway: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M9 9.5v5l4-2.5z" fill="currentColor" stroke="none"/><path d="M18 3.5v3M16.5 5h3" fill="none"/>`,
  prompttemplate: `<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 11h5"/><path d="M9 15.3c-1 0-1 0.9-1 1.2 0 0.3 0 1.2 1 1.2M15 15.3c1 0 1 0.9 1 1.2 0 0.3 0 1.2-1 1.2" fill="none"/>`,
  memory: `<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 8 17h1M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8A3 3 0 0 1 16 17h-1M9 4v13M15 4v13" fill="none"/>`,
  agent: `<rect x="5" y="7" width="14" height="11" rx="2.5"/><circle cx="9.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><path d="M12 7V4M9.5 4h5" fill="none"/>`,
  tool: `<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3 3-2-2z" fill="none"/>`,
  guardrails: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><path d="M7.8 10.6h8.4M7.8 13.6h8.4" fill="none"/>`,
  // RAG
  documentstore: `<path d="M6 3h9l4 4v14H6z" opacity="0.6"/><path d="M4 5h9l4 4v14H4z"/><path d="M13 5v4h4" fill="none"/>`,
  parser: `<rect x="4" y="3" width="12" height="16" rx="1.3"/><path d="M7 7h6M7 10.5h6" fill="none"/><path d="M18 12l3 3-3 3M21 15h-6" fill="none"/>`,
  chunker: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v5.3M14.7 14.7V20" fill="none"/>`,
  embeddingmodel: `<path d="M7 4H5v16h2M17 4h2v16h-2" fill="none"/><circle cx="9.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
  vectordb: `<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="17" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
  retriever: `<rect x="3" y="4" width="10" height="13" rx="1.3"/><path d="M6 7.5h4M6 10.5h4" fill="none"/><circle cx="16.5" cy="15.5" r="3.5" fill="none"/><path d="M19 18l2.5 2.5" fill="none"/>`,
  reranker: `<path d="M5 6h14M5 12h14M5 18h9" fill="none"/><path d="M20 15l-2 3-2-3M18 18v-5" fill="none"/>`,
  contextbuilder: `<path d="M4 4h6v3a1.5 1.5 0 0 0 3 0V4h6v6h-3a1.5 1.5 0 0 0 0 3h3v6h-6v-3a1.5 1.5 0 0 0-3 0v3H4v-6h3a1.5 1.5 0 0 0 0-3H4z" fill="none"/>`,
  // External
  externalapi: `<circle cx="10" cy="12" r="7"/><path d="M10 5c2.5 2 2.5 12 0 14M10 5c-2.5 2-2.5 12 0 14M3 12h14" fill="none"/><path d="M17 8l4 4-4 4" fill="none"/>`,
  payment: `<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 10.5h18" fill="none"/><path d="M6 15h4" fill="none"/>`,
  email: `<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3.5 6l8.5 7 8.5-7" fill="none"/>`,
  idprovider: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><circle cx="12" cy="10" r="2"/><path d="M8.5 16c1-2 2-2.8 3.5-2.8s2.5 0.8 3.5 2.8" fill="none"/>`,
  modelprovider: `<path d="M6.5 17a3.5 3.5 0 0 1-.4-6.98 4.5 4.5 0 0 1 8.6-2.02A4 4 0 0 1 18.5 12a3.5 3.5 0 0 1-.3 7z"/><circle cx="11.5" cy="13.2" r="1.3" fill="currentColor" stroke="none"/>`,
  // General / freeform toolbox
  box: `<rect x="4" y="4" width="16" height="16" rx="1.5"/>`,
  group: `<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2"/>`,
  note: `<path d="M5 3.5h11l3 3v14H5z"/><path d="M16 3.5v3h3" fill="none"/><path d="M8 10h8M8 13h8M8 16h5"/>`,
  text: `<path d="M5 5h14M12 5v14M9 19h6" fill="none"/>`,
};

// Component catalog. `container: true` marks the boundary/grouping shapes
// (Region, AZ, VPC, Subnet, Group) which render as large background rects.
const COMPONENTS = [
  // Client
  { id: 'user', category: 'client', label: 'User / Client', icon: 'user' },
  { id: 'webapp', category: 'client', label: 'Web', icon: 'webapp' },
  { id: 'mobileapp', category: 'client', label: 'Mobile', icon: 'mobileapp' },
  { id: 'extclient', category: 'client', label: 'External Client', icon: 'extclient' },
  // Edge
  { id: 'dns', category: 'edge', label: 'DNS', icon: 'dns' },
  { id: 'cdn', category: 'edge', label: 'CDN', icon: 'cdn' },
  { id: 'waf', category: 'edge', label: 'WAF', icon: 'waf' },
  { id: 'elb', category: 'edge', label: 'Load Balancer', icon: 'elb' },
  { id: 'apigw', category: 'edge', label: 'API Gateway', icon: 'apigw' },
  // Network & Boundary
  { id: 'region', category: 'netbound', label: 'Region', icon: 'region', container: true, w: 480, h: 340 },
  { id: 'az', category: 'netbound', label: 'Availability Zone', icon: 'az', container: true, w: 360, h: 260 },
  { id: 'vpc', category: 'netbound', label: 'VPC', icon: 'vpc', container: true, w: 300, h: 220 },
  { id: 'subnet', category: 'netbound', label: 'Subnet', icon: 'subnet', container: true, w: 220, h: 160 },
  { id: 'igw', category: 'netbound', label: 'Internet Gateway', icon: 'igw' },
  { id: 'nat', category: 'netbound', label: 'NAT Gateway', icon: 'nat' },
  // Services
  { id: 'apiservice', category: 'services', label: 'API Service', icon: 'apiservice' },
  { id: 'microservice', category: 'services', label: 'Microservice', icon: 'microservice' },
  { id: 'worker', category: 'services', label: 'Worker', icon: 'worker' },
  { id: 'scheduler', category: 'services', label: 'Scheduler', icon: 'scheduler' },
  // Compute
  { id: 'instance', category: 'compute', label: 'Service Instance', icon: 'instance' },
  { id: 'container', category: 'compute', label: 'Container', icon: 'container' },
  { id: 'lambda', category: 'compute', label: 'Lambda / Serverless', icon: 'lambda' },
  // Communication
  { id: 'queue', category: 'communication', label: 'Queue', icon: 'queue' },
  { id: 'kafka', category: 'communication', label: 'Kafka', icon: 'kafka' },
  { id: 'eventbus', category: 'communication', label: 'Event Bus', icon: 'eventbus' },
  { id: 'websocket', category: 'communication', label: 'WebSocket', icon: 'websocket' },
  { id: 'rabbitmq', category: 'communication', label: 'RabbitMQ', icon: 'rabbitmq' },
  // Cache
  { id: 'cache', category: 'cache', label: 'Cache', icon: 'cache' },
  { id: 'redis', category: 'cache', label: 'Redis', icon: 'redis' },
  // Data
  { id: 'sqldb', category: 'data', label: 'SQL DB', icon: 'sqldb' },
  { id: 'nosqldb', category: 'data', label: 'NoSQL DB', icon: 'nosqldb' },
  { id: 'readreplica', category: 'data', label: 'Read Replica', icon: 'readreplica' },
  { id: 's3', category: 'data', label: 'Object Storage', icon: 's3' },
  { id: 'search', category: 'data', label: 'Search', icon: 'search' },
  { id: 'timeseriesdb', category: 'data', label: 'Time Series DB', icon: 'timeseriesdb' },
  { id: 'datalake', category: 'data', label: 'Data Lake', icon: 'datalake' },
  { id: 'lakehouse', category: 'data', label: 'Lakehouse', icon: 'lakehouse' },
  { id: 'rds', category: 'data', label: 'RDS (SQL)', icon: 'rds' },
  { id: 'cassandra', category: 'data', label: 'Cassandra', icon: 'cassandra' },
  { id: 'mongodb', category: 'data', label: 'MongoDB', icon: 'mongodb' },
  { id: 'neo4j', category: 'data', label: 'Neo4j', icon: 'neo4j' },
  // Processing
  { id: 'batch', category: 'processing', label: 'Batch', icon: 'batch' },
  { id: 'streamprocessor', category: 'processing', label: 'Stream Processor', icon: 'streamprocessor' },
  { id: 'workflow', category: 'processing', label: 'Workflow', icon: 'workflow' },
  // Reliability
  { id: 'ratelimiter', category: 'reliability', label: 'Rate Limiter', icon: 'ratelimiter' },
  { id: 'circuitbreaker', category: 'reliability', label: 'Circuit Breaker', icon: 'circuitbreaker' },
  { id: 'retry', category: 'reliability', label: 'Retry', icon: 'retry' },
  { id: 'asg', category: 'reliability', label: 'Auto Scaler', icon: 'asg' },
  // Security
  { id: 'auth', category: 'security', label: 'Auth', icon: 'auth' },
  { id: 'iam', category: 'security', label: 'IAM', icon: 'iam' },
  { id: 'secrets', category: 'security', label: 'Secrets', icon: 'secrets' },
  { id: 'encryption', category: 'security', label: 'Encryption', icon: 'encryption' },
  { id: 'secgroup', category: 'security', label: 'Security Group', icon: 'secgroup' },
  // Observability
  { id: 'logs', category: 'observability', label: 'Logs', icon: 'logs' },
  { id: 'metrics', category: 'observability', label: 'Metrics', icon: 'metrics' },
  { id: 'traces', category: 'observability', label: 'Traces', icon: 'traces' },
  { id: 'alerts', category: 'observability', label: 'Alerts', icon: 'alerts' },
  // ML
  { id: 'featurestore', category: 'ml', label: 'Feature Store', icon: 'featurestore' },
  { id: 'training', category: 'ml', label: 'Training', icon: 'training' },
  { id: 'modelregistry', category: 'ml', label: 'Model Registry', icon: 'modelregistry' },
  { id: 'modelserver', category: 'ml', label: 'Model Server', icon: 'modelserver' },
  { id: 'inference', category: 'ml', label: 'Inference', icon: 'inference' },
  { id: 'model', category: 'ml', label: 'Model', icon: 'model' },
  { id: 'dataset', category: 'ml', label: 'Training Dataset', icon: 'dataset' },
  { id: 'gpucluster', category: 'ml', label: 'GPU / Training Cluster', icon: 'gpucluster' },
  // GenAI
  { id: 'llm', category: 'genai', label: 'LLM', icon: 'llm' },
  { id: 'llmgateway', category: 'genai', label: 'LLM Gateway', icon: 'llmgateway' },
  { id: 'prompttemplate', category: 'genai', label: 'Prompt', icon: 'prompttemplate' },
  { id: 'memory', category: 'genai', label: 'Memory', icon: 'memory' },
  { id: 'agent', category: 'genai', label: 'Agent', icon: 'agent' },
  { id: 'tool', category: 'genai', label: 'Tool', icon: 'tool' },
  { id: 'guardrails', category: 'genai', label: 'Guardrails', icon: 'guardrails' },
  // RAG
  { id: 'documentstore', category: 'rag', label: 'Document Store', icon: 'documentstore' },
  { id: 'parser', category: 'rag', label: 'Parser', icon: 'parser' },
  { id: 'chunker', category: 'rag', label: 'Chunker', icon: 'chunker' },
  { id: 'embeddingmodel', category: 'rag', label: 'Embedding', icon: 'embeddingmodel' },
  { id: 'vectordb', category: 'rag', label: 'Vector DB', icon: 'vectordb' },
  { id: 'retriever', category: 'rag', label: 'Retriever', icon: 'retriever' },
  { id: 'reranker', category: 'rag', label: 'Reranker', icon: 'reranker' },
  { id: 'contextbuilder', category: 'rag', label: 'Context Builder', icon: 'contextbuilder' },
  // External
  { id: 'externalapi', category: 'external', label: 'External API', icon: 'externalapi' },
  { id: 'payment', category: 'external', label: 'Payment', icon: 'payment' },
  { id: 'email', category: 'external', label: 'Email', icon: 'email' },
  { id: 'idprovider', category: 'external', label: 'Identity Provider', icon: 'idprovider' },
  { id: 'modelprovider', category: 'external', label: 'External LLM', icon: 'modelprovider' },
  // General / freeform toolbox — plain shapes you name yourself
  { id: 'box', category: 'general', label: 'Box', icon: 'box' },
  { id: 'group', category: 'general', label: 'Group', icon: 'group', container: true, w: 260, h: 180 },
  { id: 'note', category: 'general', label: 'Note', icon: 'note' },
  { id: 'text', category: 'general', label: 'Text', icon: 'text', textOnly: true, w: 140, h: 44 },
];

function getComponent(id) {
  return COMPONENTS.find((c) => c.id === id);
}
