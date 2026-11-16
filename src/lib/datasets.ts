// Planning & environmental constraint layers, all from the open
// planning.data.gov.uk platform (England). Severity drives the site score.

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface DatasetDef {
  id: string;
  name: string;
  group: 'Environment' | 'Heritage' | 'Planning' | 'Opportunities' | 'Boundaries';
  color: string;
  severity: Severity;
  kind: 'polygon' | 'point';
  minZoom: number;
  desc: string;
}

export const DATASETS: DatasetDef[] = [
  // Environment
  { id: 'green-belt', name: 'Green Belt', group: 'Environment', color: '#2f9e44', severity: 'high', kind: 'polygon', minZoom: 9, desc: 'Strong presumption against inappropriate development (grey belt exceptions apply).' },
  { id: 'flood-risk-zone', name: 'Flood zones 2 & 3', group: 'Environment', color: '#1c7ed6', severity: 'high', kind: 'polygon', minZoom: 11, desc: 'Environment Agency fluvial / tidal flood risk. Sequential test likely.' },
  { id: 'site-of-special-scientific-interest', name: 'SSSI', group: 'Environment', color: '#e8590c', severity: 'high', kind: 'polygon', minZoom: 9, desc: 'Site of Special Scientific Interest.' },
  { id: 'ancient-woodland', name: 'Ancient woodland', group: 'Environment', color: '#5c940d', severity: 'high', kind: 'polygon', minZoom: 10, desc: 'Irreplaceable habitat; 15m buffer typically required.' },
  { id: 'special-area-of-conservation', name: 'Special Area of Conservation', group: 'Environment', color: '#0ca678', severity: 'high', kind: 'polygon', minZoom: 9, desc: 'Habitats Regulations designation.' },
  { id: 'special-protection-area', name: 'Special Protection Area', group: 'Environment', color: '#099268', severity: 'high', kind: 'polygon', minZoom: 9, desc: 'Protected bird habitat.' },
  { id: 'ramsar', name: 'Ramsar wetland', group: 'Environment', color: '#15aabf', severity: 'high', kind: 'polygon', minZoom: 9, desc: 'Internationally important wetland.' },
  { id: 'area-of-outstanding-natural-beauty', name: 'National Landscape (AONB)', group: 'Environment', color: '#74b816', severity: 'medium', kind: 'polygon', minZoom: 8, desc: 'Great weight given to conserving landscape and scenic beauty.' },
  { id: 'national-park', name: 'National Park', group: 'Environment', color: '#40c057', severity: 'medium', kind: 'polygon', minZoom: 8, desc: 'National Park authority is the LPA.' },
  { id: 'local-nature-reserve', name: 'Local Nature Reserve', group: 'Environment', color: '#94d82d', severity: 'medium', kind: 'polygon', minZoom: 10, desc: 'Locally designated nature reserve.' },
  // Heritage
  { id: 'conservation-area', name: 'Conservation area', group: 'Heritage', color: '#ae3ec9', severity: 'medium', kind: 'polygon', minZoom: 10, desc: 'Development must preserve or enhance character. PD rights restricted.' },
  { id: 'listed-building', name: 'Listed buildings', group: 'Heritage', color: '#e64980', severity: 'medium', kind: 'point', minZoom: 13, desc: 'Listed building consent needed; setting is a consideration.' },
  { id: 'scheduled-monument', name: 'Scheduled monument', group: 'Heritage', color: '#c2255c', severity: 'high', kind: 'polygon', minZoom: 10, desc: 'Scheduled monument consent required.' },
  { id: 'world-heritage-site', name: 'World Heritage Site', group: 'Heritage', color: '#862e9c', severity: 'high', kind: 'polygon', minZoom: 8, desc: 'UNESCO World Heritage Site.' },
  { id: 'park-and-garden', name: 'Historic park & garden', group: 'Heritage', color: '#da77f2', severity: 'medium', kind: 'polygon', minZoom: 10, desc: 'Registered historic park or garden.' },
  { id: 'battlefield', name: 'Registered battlefield', group: 'Heritage', color: '#a61e4d', severity: 'medium', kind: 'polygon', minZoom: 10, desc: 'Registered historic battlefield.' },
  // Planning
  { id: 'article-4-direction-area', name: 'Article 4 directions', group: 'Planning', color: '#f59f00', severity: 'medium', kind: 'polygon', minZoom: 11, desc: 'Permitted development rights removed (e.g. HMO, Class MA).' },
  { id: 'tree-preservation-zone', name: 'TPO areas', group: 'Planning', color: '#37b24d', severity: 'medium', kind: 'polygon', minZoom: 13, desc: 'Tree Preservation Order area.' },
  { id: 'tree', name: 'TPO trees', group: 'Planning', color: '#2b8a3e', severity: 'low', kind: 'point', minZoom: 14, desc: 'Individually protected trees.' },
  { id: 'planning-application', name: 'Planning applications', group: 'Planning', color: '#4dabf7', severity: 'info', kind: 'point', minZoom: 14, desc: 'Applications published to the national platform (coverage varies by council).' },
  // Opportunities
  { id: 'brownfield-land', name: 'Brownfield register', group: 'Opportunities', color: '#ff6b35', severity: 'info', kind: 'point', minZoom: 10, desc: 'Council brownfield registers: sites suitable for housing.' },
  // Boundaries
  { id: 'local-authority-district', name: 'Local authorities', group: 'Boundaries', color: '#868e96', severity: 'info', kind: 'polygon', minZoom: 7, desc: 'Local planning authority boundaries.' },
];

export const DATASET_BY_ID = Object.fromEntries(DATASETS.map((d) => [d.id, d])) as Record<string, DatasetDef>;

/** Datasets checked when we run a constraints report on a site. */
export const CONSTRAINT_IDS = DATASETS.filter((d) => d.group !== 'Boundaries').map((d) => d.id);

export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 30, medium: 12, low: 4, info: 0 };

export const BASEMAPS = [
  { id: 'streets', name: 'Streets', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`), attribution: '© OpenStreetMap contributors © CARTO' },
  { id: 'light', name: 'Light', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`), attribution: '© OpenStreetMap contributors © CARTO' },
  { id: 'dark', name: 'Dark', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`), attribution: '© OpenStreetMap contributors © CARTO' },
  { id: 'satellite', name: 'Satellite', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  { id: 'osm', name: 'OSM', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors' },
] as const;

export type BasemapId = (typeof BASEMAPS)[number]['id'];
