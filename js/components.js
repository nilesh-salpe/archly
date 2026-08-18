// Palette catalog: every component the user can drag onto the canvas.
// Icons are small hand-built SVG fragments in a 24x24 box (no external
// assets, no copied provider icons) so the whole diagram stays pure SVG.

const CATEGORY_COLORS = {
  network: '#3b82f6',
  compute: '#f97316',
  storage: '#10b981',
  client: '#8b5cf6',
  security: '#ef4444',
  ai: '#0d9488',
  general: '#64748b',
};

// Node cards stay light-pastel regardless of page theme (like cards on a
// canvas), so fills never need to change when the OS theme flips.
const CATEGORY_FILLS = {
  network: '#dbeafe',
  compute: '#ffedd5',
  storage: '#d1fae5',
  client: '#ede9fe',
  security: '#fee2e2',
  ai: '#ccfbf1',
  general: '#f1f5f9',
};

const CATEGORY_LABELS = {
  network: 'Network & Edge',
  compute: 'Compute',
  storage: 'Storage & Data',
  client: 'Client',
  security: 'Security',
  ai: 'AI / ML',
  general: 'General',
};

// Icon fragments, viewBox-local coordinates 0..24. Kept intentionally simple
// (circles/rects/paths) so they read clearly at small node size.
const ICONS = {
  region: `<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2"/><path d="M12 4v16"/>`,
  az: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M4 10h16M4 14h16"/>`,
  vpc: `<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2"/>`,
  subnet: `<rect x="5" y="5" width="14" height="14" rx="1.5" stroke-dasharray="2 2"/>`,
  igw: `<circle cx="12" cy="12" r="7.5"/><path d="M9 9l6 6M15 9l-6 6"/>`,
  nat: `<circle cx="12" cy="12" r="7.5"/><path d="M8 12h8M13 9l3 3-3 3"/>`,
  dns: `<circle cx="12" cy="12" r="7.5"/><path d="M4.5 12h15M12 4.5c2.5 2 2.5 13 0 15M12 4.5c-2.5 2-2.5 13 0 15" fill="none"/>`,
  cdn: `<circle cx="7" cy="8" r="2.6"/><circle cx="17" cy="8" r="2.6"/><circle cx="12" cy="17" r="2.6"/><path d="M9 9.5l1.6 5M15 9.5l-1.6 5M9.4 8h5.2"/>`,
  elb: `<circle cx="12" cy="6" r="2.4"/><path d="M12 8.4v3M12 11.4H6v3M12 11.4h6v3"/><circle cx="6" cy="17" r="2.4"/><circle cx="18" cy="17" r="2.4"/>`,
  apigw: `<rect x="4" y="7" width="16" height="10" rx="1.5"/><path d="M9 10v4M15 10l-2 2 2 2" fill="none"/>`,
  waf: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><path d="M9 12l2 2 4-4" fill="none"/>`,
  instance: `<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M7 9h2M7 12h6M7 15h4"/>`,
  container: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16"/>`,
  lambda: `<path d="M8 4.5h3l6 15h-3l-2.2-5.6L9.5 20H6.5l4.3-8-2.8-7z" fill-rule="evenodd"/>`,
  asg: `<rect x="6" y="7" width="14" height="10" rx="1.3" opacity="0.55"/><rect x="4" y="9" width="14" height="10" rx="1.3" opacity="0.8"/><rect x="2" y="11" width="14" height="10" rx="1.3"/>`,
  rds: `<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>`,
  cassandra: `<ellipse cx="12" cy="5.5" rx="7.5" ry="2.6"/><path d="M4.5 5.5v13c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6v-13"/><path d="M4.5 10.2c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6M4.5 14.8c0 1.4 3.4 2.6 7.5 2.6s7.5-1.2 7.5-2.6"/>`,
  mongodb: `<path d="M12 3c3 3.5 4.5 7 4.5 10.2 0 3.6-2 6-4.5 7.3-2.5-1.3-4.5-3.7-4.5-7.3C7.5 10 9 6.5 12 3z"/><path d="M12 13v7.5" fill="none"/>`,
  neo4j: `<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="7" r="2.3"/><circle cx="12" cy="18" r="2.3"/><path d="M7.8 8.3L10.5 16.2M16.2 8.3L13.5 16.2M8.3 7h7.4" fill="none"/>`,
  vectordb: `<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="17" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
  s3: `<path d="M5 7l7-3.5L19 7v10l-7 3.5L5 17z"/><path d="M5 7l7 3.5M12 10.5L19 7M12 10.5v10"/>`,
  redis: `<ellipse cx="12" cy="7" rx="7.5" ry="2.8"/><path d="M4.5 7v10c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V7"/><path d="M8 12.3l2.4 1.3 2.4-1.3" fill="none"/>`,
  kafka: `<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="17" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.6" fill="currentColor" stroke="none"/>`,
  user: `<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1-4.2 4-6.2 7.5-6.2s6.5 2 7.5 6.2"/>`,
  webapp: `<rect x="3.5" y="4.5" width="17" height="14" rx="1.5"/><path d="M3.5 8.3h17"/><circle cx="6" cy="6.4" r="0.7" fill="currentColor" stroke="none"/>`,
  mobileapp: `<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 19h3" />`,
  iam: `<circle cx="9" cy="9" r="4.2"/><path d="M12.1 11.9L20 19.8M16.5 15.3l2.3-2.3M19 17.8l2.3-2.3" fill="none"/>`,
  secgroup: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><circle cx="12" cy="11" r="2.2"/><path d="M12 13.2v3" fill="none"/>`,
  // AI / ML
  llmgateway: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M9 9.5v5l4-2.5z" fill="currentColor" stroke="none"/><path d="M18 3.5v3M16.5 5h3" fill="none"/>`,
  modelprovider: `<path d="M6.5 17a3.5 3.5 0 0 1-.4-6.98 4.5 4.5 0 0 1 8.6-2.02A4 4 0 0 1 18.5 12a3.5 3.5 0 0 1-.3 7z"/><circle cx="11.5" cy="13.2" r="1.3" fill="currentColor" stroke="none"/>`,
  model: `<circle cx="5" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="17" r="1.6" fill="currentColor" stroke="none"/><path d="M5 7l7 5M5 17l7-5M12 12l7-5M12 12l7 5" fill="none"/>`,
  embeddingmodel: `<path d="M7 4H5v16h2M17 4h2v16h-2" fill="none"/><circle cx="9.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
  agent: `<rect x="5" y="7" width="14" height="11" rx="2.5"/><circle cx="9.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><path d="M12 7V4M9.5 4h5" fill="none"/>`,
  prompttemplate: `<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 11h5"/><path d="M9 15.3c-1 0-1 0.9-1 1.2 0 0.3 0 1.2 1 1.2M15 15.3c1 0 1 0.9 1 1.2 0 0.3 0 1.2-1 1.2" fill="none"/>`,
  guardrails: `<path d="M12 3.5l7 2.6v6c0 4.6-3 7.6-7 8.4-4-0.8-7-3.8-7-8.4v-6z"/><path d="M7.8 10.6h8.4M7.8 13.6h8.4" fill="none"/>`,
  dataset: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 8.8h16M4 12h16M4 15.2h16"/>`,
  featurestore: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16"/><circle cx="6.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="7" r="1" fill="currentColor" stroke="none"/>`,
  modelregistry: `<rect x="4" y="7" width="14" height="13" rx="1.5"/><path d="M4 11h14"/><path d="M14 3.5l5 5-2.5 2.5-5-5z"/><circle cx="17.3" cy="5.3" r="0.9" fill="currentColor" stroke="none"/>`,
  gpucluster: `<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 7V4M12 7V4M15 7V4M9 20v-3M12 20v-3M15 20v-3M7 9H4M7 12H4M7 15H4M20 9h-3M20 12h-3M20 15h-3" fill="none"/>`,
  // General / freeform toolbox
  box: `<rect x="4" y="4" width="16" height="16" rx="1.5"/>`,
  group: `<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2"/>`,
  note: `<path d="M5 3.5h11l3 3v14H5z"/><path d="M16 3.5v3h3" fill="none"/><path d="M8 10h8M8 13h8M8 16h5"/>`,
  text: `<path d="M5 5h14M12 5v14M9 19h6" fill="none"/>`,
};

// Component catalog. `container: true` marks the boundary/grouping shapes
// (Region, AZ, VPC, Subnet) which render as large background rects.
const COMPONENTS = [
  // Network & Edge
  { id: 'region', category: 'network', label: 'Region', icon: 'region', container: true, w: 480, h: 340 },
  { id: 'az', category: 'network', label: 'Availability Zone', icon: 'az', container: true, w: 360, h: 260 },
  { id: 'vpc', category: 'network', label: 'VPC', icon: 'vpc', container: true, w: 300, h: 220 },
  { id: 'subnet', category: 'network', label: 'Subnet', icon: 'subnet', container: true, w: 220, h: 160 },
  { id: 'igw', category: 'network', label: 'Internet Gateway', icon: 'igw' },
  { id: 'nat', category: 'network', label: 'NAT Gateway', icon: 'nat' },
  { id: 'dns', category: 'network', label: 'DNS', icon: 'dns' },
  { id: 'cdn', category: 'network', label: 'CDN', icon: 'cdn' },
  { id: 'elb', category: 'network', label: 'Load Balancer', icon: 'elb' },
  { id: 'apigw', category: 'network', label: 'API Gateway', icon: 'apigw' },
  { id: 'waf', category: 'network', label: 'WAF', icon: 'waf' },
  // Compute
  { id: 'instance', category: 'compute', label: 'Service Instance', icon: 'instance' },
  { id: 'container', category: 'compute', label: 'Container', icon: 'container' },
  { id: 'lambda', category: 'compute', label: 'Lambda / Serverless', icon: 'lambda' },
  { id: 'asg', category: 'compute', label: 'Auto Scaling Group', icon: 'asg' },
  // Storage & Data
  { id: 'rds', category: 'storage', label: 'RDS (SQL)', icon: 'rds' },
  { id: 'cassandra', category: 'storage', label: 'Cassandra', icon: 'cassandra' },
  { id: 'mongodb', category: 'storage', label: 'MongoDB', icon: 'mongodb' },
  { id: 'neo4j', category: 'storage', label: 'Neo4j', icon: 'neo4j' },
  { id: 'vectordb', category: 'storage', label: 'Vector DB', icon: 'vectordb' },
  { id: 's3', category: 'storage', label: 'Object Storage', icon: 's3' },
  { id: 'redis', category: 'storage', label: 'Redis / Cache', icon: 'redis' },
  { id: 'kafka', category: 'storage', label: 'Queue / Kafka', icon: 'kafka' },
  // Client
  { id: 'user', category: 'client', label: 'User / Client', icon: 'user' },
  { id: 'webapp', category: 'client', label: 'Web App', icon: 'webapp' },
  { id: 'mobileapp', category: 'client', label: 'Mobile App', icon: 'mobileapp' },
  // Security
  { id: 'iam', category: 'security', label: 'IAM', icon: 'iam' },
  { id: 'secgroup', category: 'security', label: 'Security Group', icon: 'secgroup' },
  // AI / ML
  { id: 'llmgateway', category: 'ai', label: 'LLM Gateway', icon: 'llmgateway' },
  { id: 'modelprovider', category: 'ai', label: 'Foundational Model Provider', icon: 'modelprovider' },
  { id: 'model', category: 'ai', label: 'Model', icon: 'model' },
  { id: 'embeddingmodel', category: 'ai', label: 'Embedding Model', icon: 'embeddingmodel' },
  { id: 'agent', category: 'ai', label: 'Agent / Orchestrator', icon: 'agent' },
  { id: 'prompttemplate', category: 'ai', label: 'Prompt Template', icon: 'prompttemplate' },
  { id: 'guardrails', category: 'ai', label: 'Guardrails', icon: 'guardrails' },
  { id: 'dataset', category: 'ai', label: 'Training Dataset', icon: 'dataset' },
  { id: 'featurestore', category: 'ai', label: 'Feature Store', icon: 'featurestore' },
  { id: 'modelregistry', category: 'ai', label: 'Model Registry', icon: 'modelregistry' },
  { id: 'gpucluster', category: 'ai', label: 'GPU / Training Cluster', icon: 'gpucluster' },
  // General / freeform toolbox — plain shapes you name yourself
  { id: 'box', category: 'general', label: 'Box', icon: 'box' },
  { id: 'group', category: 'general', label: 'Group', icon: 'group', container: true, w: 260, h: 180 },
  { id: 'note', category: 'general', label: 'Note', icon: 'note' },
  { id: 'text', category: 'general', label: 'Text', icon: 'text', textOnly: true, w: 140, h: 44 },
];

function getComponent(id) {
  return COMPONENTS.find((c) => c.id === id);
}
