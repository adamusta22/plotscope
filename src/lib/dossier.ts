// Site dossier: everything a developer or architect needs about one plot,
// gathered from open data in one go. Rendered by dossierHtml.ts.
import * as turf from '@turf/turf';
import proj4 from 'proj4';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { fetchEntities, nearestPostcodes, PostcodeInfo, pricePaid, prop, Sale } from './api';
import { CONSTRAINT_IDS, DATASET_BY_ID, SEVERITY_WEIGHT, Severity } from './datasets';
import { localPlanFor, LocalPlanResult } from './localplan';
import { NPPF, PolicyTopic, topicsForDatasets } from './policy';

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

// ---------- types ----------
export interface DossierInput {
  geometry: Polygon | MultiPolygon;
  name?: string;
  source?: 'hmlr' | 'osm' | 'drawn' | 'saved';
  askingPrice?: number;
}

export interface Constraint { dataset: string; name: string; severity: Severity; color: string; coverage?: number; records: { name: string; detail?: string; url?: string }[]; desc: string }
export interface Amenity { kind: string; label: string; name: string; metres: number; walkMin: number }
export interface Building { footprint: number; levels?: number; heightM?: number; use?: string; name?: string; geom: Position[][] }
export interface Road { name: string; ref?: string; type: string; geom: Position[] }
export interface Frontage { road: string; type: string; metres: number }
export interface SunDay { label: string; date: string; sunrise: string; sunset: string; daylightHrs: number; noonAltitude: number; sunriseAz: number; sunsetAz: number; path: { hour: number; alt: number; az: number }[] }
export interface Scenario { name: string; basis: string; units: number; gia: number; storeys: number; note: string }
export interface Survey { name: string; why: string; when: 'Before purchase' | 'Pre-application' | 'With application'; priority: 'Essential' | 'Likely' | 'Consider' }
export interface Finding { tone: 'good' | 'risk' | 'note'; text: string }

export interface Dossier {
  generatedAt: string;
  name: string;
  source: DossierInput['source'];
  geometry: Polygon | MultiPolygon;
  centroid: [number, number];
  gridRef: string;
  easting: number;
  northing: number;
  areaM2: number;
  perimeterM: number;
  dims: { long: number; short: number; bearing: number; facing: [string, string] };
  frontage: Frontage[];
  location: PostcodeInfo | null;
  lpa?: string;
  constraints: Constraint[];
  floodZone: string;
  score: number;
  nearbyHeritage: { name: string; grade?: string; metres: number; url?: string }[];
  planningApps: { reference: string; description: string; decision?: string; date?: string; url?: string }[];
  brownfield: { name: string; hectares?: string; permission?: string; dwellings?: string } | null;
  buildingsOnSite: Building[];
  coverage: { footprint: number; pct: number; existingGia: number; giaEstimated: boolean };
  context: { buildings: Building[]; count: number; medianLevels?: number; maxLevels?: number; taggedPct: number; roads: Road[] };
  amenities: Amenity[];
  busStops400: number;
  walkScore: number;
  power: { substationM?: number; lineM?: number };
  sun: SunDay[];
  sales: Sale[];
  salesSummary: { count: number; median: number; flats: number; terraced: number; houses: number; byType: { type: string; count: number; median: number }[]; byYear: { year: string; median: number; count: number }[] };
  capacity: { netArea: number; constrainedPct: number; scenarios: Scenario[] };
  policy: { nppf: typeof NPPF; topics: PolicyTopic[]; local: LocalPlanResult | null };
  surveys: Survey[];
  findings: Finding[];
  errors: string[];
}

export type Progress = (step: string, done: boolean) => void;

// ---------- geometry helpers ----------
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export function osGridRef(lng: number, lat: number) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lng, lat]);
  const e100k = Math.floor(e / 100000), n100k = Math.floor(n / 100000);
  if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return { ref: '—', e, n };
  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = ((19 - n100k) * 5) % 25 + (e100k % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  const letters = String.fromCharCode(l1 + 65) + String.fromCharCode(l2 + 65);
  const pad = (v: number) => String(Math.floor(v % 100000)).padStart(5, '0');
  return { ref: `${letters} ${pad(e)} ${pad(n)}`, e, n };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** Minimum-area bounding rectangle: the plot's length, width and the bearing of its long side. */
function minRect(g: Polygon | MultiPolygon) {
  const c = turf.centroid(g as any).geometry.coordinates;
  const k = Math.cos((c[1] * Math.PI) / 180);
  const toXY = (p: Position) => [(p[0] - c[0]) * 111320 * k, (p[1] - c[1]) * 110540];
  const hull = turf.convex(g as any);
  const pts = (hull?.geometry.coordinates[0] || []).map(toXY);
  let best = { area: Infinity, long: 0, short: 0, bearing: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const ang = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    const w = maxX - minX, h = maxY - minY;
    if (w * h < best.area) {
      const longAlongEdge = w >= h;
      const longAng = longAlongEdge ? ang : ang + Math.PI / 2;
      // bearing from north, clockwise, folded to 0-180
      const bearing = (((90 - (longAng * 180) / Math.PI) % 180) + 180) % 180;
      best = { area: w * h, long: Math.max(w, h), short: Math.min(w, h), bearing };
    }
  }
  const f1 = (best.bearing + 90) % 360, f2 = (best.bearing + 270) % 360;
  return { long: best.long, short: best.short, bearing: best.bearing, facing: [compass(f1), compass(f2)] as [string, string] };
}

// ---------- sun ----------
function solar(lat: number, lng: number, date: Date): SunDay['path'] & { meta?: never } {
  const out: SunDay['path'] = [];
  for (let h = 4; h <= 22; h += 0.25) out.push({ hour: h, ...sunPos(lat, lng, date, h) });
  return out;
}

function sunPos(lat: number, lng: number, date: Date, utcHour: number) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const N = Math.floor((date.getTime() - start) / 864e5);
  const g = ((2 * Math.PI) / 365) * (N - 1 + (utcHour - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = utcHour * 60 + eqt + 4 * lng;
  const ha = ((tst / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * 180) / Math.PI + 180;
  az = ((az % 360) + 360) % 360;
  return { alt: 90 - (zen * 180) / Math.PI, az };
}

function sunDays(lat: number, lng: number): SunDay[] {
  const y = new Date().getUTCFullYear();
  const days: [string, Date, number][] = [
    ['Midsummer', new Date(Date.UTC(y, 5, 21)), 1],
    ['Equinox', new Date(Date.UTC(y, 2, 20)), 0],
    ['Midwinter', new Date(Date.UTC(y, 11, 21)), 0],
  ];
  return days.map(([label, d, bst]) => {
    const path = solar(lat, lng, d);
    const up = path.filter((p) => p.alt > -0.833);
    const fmt = (h: number) => {
      const t = h + bst;
      return `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
    };
    const rise = up[0], set = up[up.length - 1];
    return {
      label,
      date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      sunrise: rise ? fmt(rise.hour) : '—',
      sunset: set ? fmt(set.hour) : '—',
      daylightHrs: rise && set ? set.hour - rise.hour : 0,
      noonAltitude: Math.max(...path.map((p) => p.alt)),
      sunriseAz: rise?.az ?? 0,
      sunsetAz: set?.az ?? 0,
      path: up.filter((p) => Number.isInteger(p.hour) || p === rise || p === set),
    };
  });
}

// ---------- OpenStreetMap context ----------
const AMENITY_QUERIES: { kind: string; label: string; filter: string; radius: number }[] = [
  { kind: 'rail', label: 'Railway station', filter: 'nwr[railway=station]', radius: 3000 },
  { kind: 'metro', label: 'Tram / underground', filter: 'nwr[station~"^(subway|light_rail)$"]', radius: 2000 },
  { kind: 'bus', label: 'Bus stop', filter: 'node[highway=bus_stop]', radius: 800 },
  { kind: 'primary', label: 'Primary school', filter: 'nwr[amenity=school][~"^(isced:level|school:level|school)$"~"primary|1"]', radius: 2500 },
  { kind: 'school', label: 'School (any)', filter: 'nwr[amenity=school]', radius: 2500 },
  { kind: 'nursery', label: 'Nursery', filter: 'nwr[amenity=kindergarten]', radius: 2000 },
  { kind: 'gp', label: 'GP surgery', filter: 'nwr[amenity=doctors]', radius: 2500 },
  { kind: 'pharmacy', label: 'Pharmacy', filter: 'nwr[amenity=pharmacy]', radius: 2000 },
  { kind: 'hospital', label: 'Hospital', filter: 'nwr[amenity=hospital]', radius: 6000 },
  { kind: 'supermarket', label: 'Supermarket', filter: 'nwr[shop=supermarket]', radius: 2500 },
  { kind: 'convenience', label: 'Convenience shop', filter: 'nwr[shop=convenience]', radius: 1500 },
  { kind: 'park', label: 'Park / green space', filter: 'nwr[leisure~"^(park|recreation_ground)$"]', radius: 1500 },
  { kind: 'play', label: 'Playground', filter: 'nwr[leisure=playground]', radius: 1500 },
  { kind: 'ev', label: 'EV charge point', filter: 'nwr[amenity=charging_station]', radius: 3000 },
];

// The main Overpass server is busy at times; fall back to public mirrors.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(q: string) {
  let last: unknown;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(45000) });
      if (r.ok) return (await r.json()).elements as any[];
      last = new Error(`OpenStreetMap ${r.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`OpenStreetMap servers unavailable${last instanceof Error ? ` (${last.message})` : ''}`);
}

const levelsOf = (t: any) => {
  const l = parseFloat(t?.['building:levels']);
  if (isFinite(l) && l > 0) return l + (parseFloat(t?.['roof:levels']) > 0 ? 0.5 : 0);
  const h = parseFloat(t?.height);
  return isFinite(h) && h > 0 ? Math.max(1, Math.round(h / 3)) : undefined;
};

function wayToPolygon(e: any): Polygon | null {
  if (!e.geometry || e.geometry.length < 4) return null;
  const ring = e.geometry.map((p: any) => [p.lon, p.lat]);
  const a = ring[0], b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
  return { type: 'Polygon', coordinates: [ring] };
}

// ---------- main ----------
export async function buildDossier(input: DossierInput, progress: Progress = () => {}): Promise<Dossier> {
  const g = input.geometry;
  const [lng, lat] = turf.centroid(g as any).geometry.coordinates as [number, number];
  const areaM2 = turf.area(g);
  const errors: string[] = [];
  const grid = osGridRef(lng, lat);
  const site = turf.feature(g);
  const step = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    progress(label, false);
    try {
      const v = await fn();
      progress(label, true);
      return v;
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message || 'unavailable'}`);
      progress(label, true);
      return fallback;
    }
  };

  const around = (m: number) => `around:${m},${lat},${lng}`;
  const [constraintFc, bufferFc, location, osmContext, osmAmenities] = await Promise.all([
    step('Planning constraints', () => fetchEntities({ datasets: [...CONSTRAINT_IDS, 'local-authority-district'], geometry: g, limit: 500 }), { type: 'FeatureCollection', features: [] } as any),
    step('Heritage setting & planning history', () => fetchEntities({ datasets: ['listed-building', 'scheduled-monument', 'planning-application'], geometry: turf.buffer(site, 75, { units: 'meters' })!.geometry as any, limit: 200 }), { type: 'FeatureCollection', features: [] } as any),
    step('Location', async () => (await nearestPostcodes(lng, lat, 1, 2000))[0] || null, null),
    step('Buildings & streets', () => overpass(`[out:json][timeout:25];(way(${around(130)})[building];)->.b;(way(${around(80)})[highway][highway!~"^(footway|path|steps|cycleway|bridleway|corridor|elevator|platform)$"];)->.r;(nwr(${around(1200)})[power=substation];way(${around(600)})[power~"^(line|minor_line|cable)$"];)->.p;.b out geom;.r out geom;.p out center tags;`), []),
    step('Local services & transport', () => overpass(`[out:json][timeout:25];(${AMENITY_QUERIES.map((a) => a.filter.replace(/^(\w+)/, `$1(${around(a.radius)})`) + ';').join('')});out center tags;`), []),
  ]);

  // ----- constraints -----
  const byDs: Record<string, Feature[]> = {};
  for (const f of constraintFc.features) (byDs[prop(f, 'dataset')] ||= []).push(f);
  const lpa = byDs['local-authority-district']?.map((f) => prop(f, 'name')).join(' / ') || location?.admin_district;
  delete byDs['local-authority-district'];
  const constraints: Constraint[] = Object.entries(byDs).map(([ds, feats]) => {
    const d = DATASET_BY_ID[ds];
    let coverage: number | undefined;
    const polys = feats.filter((f) => f.geometry.type.includes('Polygon')) as Feature<Polygon>[];
    if (polys.length) {
      try {
        const u = polys.length > 1 ? turf.union(turf.featureCollection(polys)) : polys[0];
        const i = u && turf.intersect(turf.featureCollection([site as any, u as any]));
        coverage = i ? Math.min(1, turf.area(i) / areaM2) : 0;
      } catch { /* leave undefined */ }
    }
    return {
      dataset: ds, name: d?.name || ds, severity: d?.severity || 'info', color: d?.color || '#888', coverage, desc: d?.desc || '',
      records: feats.slice(0, 12).map((f) => ({
        name: String(prop(f, 'name') || prop(f, 'site-address') || prop(f, 'reference') || 'Unnamed'),
        detail: [prop(f, 'listed-building-grade') && `Grade ${prop(f, 'listed-building-grade')}`, prop(f, 'flood-risk-level') && `Zone ${prop(f, 'flood-risk-level')}`, prop(f, 'hectares') && `${prop(f, 'hectares')} ha`].filter(Boolean).join(' · ') || undefined,
        url: prop(f, 'entity') ? `https://www.planning.data.gov.uk/entity/${prop(f, 'entity')}` : undefined,
      })),
    };
  });
  const order: Severity[] = ['high', 'medium', 'low', 'info'];
  constraints.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const floodLevels = (byDs['flood-risk-zone'] || []).map((f) => String(prop(f, 'flood-risk-level') || ''));
  const floodZone = floodLevels.includes('3') ? 'Flood Zone 3 (high probability)' : floodLevels.includes('2') ? 'Flood Zone 2 (medium probability)' : 'Flood Zone 1 (low probability)';
  let score = 100;
  for (const c of constraints) {
    const w = SEVERITY_WEIGHT[c.severity];
    score -= c.coverage != null ? w * Math.max(0.35, c.coverage) : w;
    if (c.dataset === 'brownfield-land') score += 8;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  // ----- heritage setting & planning history -----
  const cen = turf.point([lng, lat]);
  const nearbyHeritage = bufferFc.features
    .filter((f: Feature) => ['listed-building', 'scheduled-monument'].includes(prop(f, 'dataset')))
    .map((f: Feature) => ({ name: String(prop(f, 'name') || 'Listed building'), grade: prop(f, 'listed-building-grade'), metres: Math.round(turf.distance(cen, turf.centroid(f as any), { units: 'meters' })), url: prop(f, 'entity') ? `https://www.planning.data.gov.uk/entity/${prop(f, 'entity')}` : undefined }))
    .sort((a: any, b: any) => a.metres - b.metres)
    .slice(0, 10);
  const planningApps = bufferFc.features
    .filter((f: Feature) => prop(f, 'dataset') === 'planning-application')
    .map((f: Feature) => ({ reference: String(prop(f, 'reference') || ''), description: String(prop(f, 'description') || prop(f, 'name') || ''), decision: prop(f, 'planning-decision') || prop(f, 'decision'), date: prop(f, 'decision-date') || prop(f, 'start-date'), url: prop(f, 'documentation-url') }))
    .slice(0, 15);
  const bf = byDs['brownfield-land']?.[0];
  const brownfield = bf ? { name: String(prop(bf, 'site-address') || prop(bf, 'name') || ''), hectares: prop(bf, 'hectares'), permission: prop(bf, 'planning-permission-status'), dwellings: [prop(bf, 'minimum-net-dwellings'), prop(bf, 'maximum-net-dwellings')].filter(Boolean).join('–') } : null;

  // ----- buildings & roads -----
  const buildingsOnSite: Building[] = [];
  const contextBuildings: Building[] = [];
  const roads: Road[] = [];
  let substationM: number | undefined, lineM: number | undefined;
  for (const e of osmContext) {
    const t = e.tags || {};
    if (t.building && e.type === 'way') {
      const poly = wayToPolygon(e);
      if (!poly) continue;
      let footprint = turf.area(poly);
      let onSite = false;
      try {
        const i = turf.intersect(turf.featureCollection([site as any, turf.feature(poly)]));
        const ia = i ? turf.area(i) : 0;
        if (ia > footprint * 0.5) { onSite = true; footprint = ia; }
      } catch { /* ignore */ }
      const b: Building = { footprint, levels: levelsOf(t), heightM: parseFloat(t.height) || undefined, use: t.building !== 'yes' ? t.building : undefined, name: t.name, geom: poly.coordinates };
      (onSite ? buildingsOnSite : contextBuildings).push(b);
    } else if (t.highway && e.geometry) {
      roads.push({ name: t.name || t.ref || '', ref: t.ref, type: t.highway, geom: e.geometry.map((p: any) => [p.lon, p.lat]) });
    } else if (t.power) {
      const p = e.center ? turf.point([e.center.lon, e.center.lat]) : null;
      if (!p) continue;
      const d = Math.round(turf.distance(cen, p, { units: 'meters' }));
      if (t.power === 'substation') substationM = Math.min(substationM ?? Infinity, d);
      else lineM = Math.min(lineM ?? Infinity, d);
    }
  }
  const footprint = buildingsOnSite.reduce((a, b) => a + b.footprint, 0);
  const giaEstimated = buildingsOnSite.some((b) => b.levels == null);
  const existingGia = buildingsOnSite.reduce((a, b) => a + b.footprint * (b.levels ?? 2) * 0.85, 0);
  const tagged = contextBuildings.filter((b) => b.levels != null).map((b) => b.levels!);

  // frontage: boundary edges running alongside a named street
  const frontageMap: Record<string, Frontage> = {};
  const ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]) as Position[];
  const namedRoads = roads.filter((r) => r.geom.length > 1 && !['service', 'track'].includes(r.type) && r.name);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const len = turf.distance(a, b, { units: 'meters' });
    if (len < 1) continue;
    const mid = turf.midpoint(a, b);
    const segBearing = turf.bearing(a, b);
    let best: { r: Road; d: number } | null = null;
    for (const r of namedRoads) {
      const line = turf.lineString(r.geom);
      const d = turf.pointToLineDistance(mid, line, { units: 'meters' });
      if (d > 16 || (best && d >= best.d)) continue;
      const near = turf.nearestPointOnLine(line, mid);
      const idx = Math.min(near.properties.index ?? 0, r.geom.length - 2);
      const rb = turf.bearing(r.geom[idx], r.geom[idx + 1]);
      const diff = Math.abs(((segBearing - rb + 540) % 180) - 90); // 90 = parallel
      if (diff > 60) best = { r, d };
    }
    if (best) {
      const key = best.r.name;
      frontageMap[key] ||= { road: key, type: best.r.type, metres: 0 };
      frontageMap[key].metres += len;
    }
  }
  const frontage = Object.values(frontageMap).filter((f) => f.metres >= 3).sort((a, b) => b.metres - a.metres);

  // ----- amenities -----
  const nearest: Record<string, Amenity> = {};
  let busStops400 = 0;
  for (const e of osmAmenities) {
    const t = e.tags || {};
    const c = e.type === 'node' ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null;
    if (!c) continue;
    const m = turf.distance(cen, turf.point(c), { units: 'meters' });
    const kinds = AMENITY_QUERIES.filter((q) => matches(q.kind, t));
    for (const q of kinds) {
      if (q.kind === 'bus' && m <= 400) busStops400++;
      if (!nearest[q.kind] || m < nearest[q.kind].metres) nearest[q.kind] = { kind: q.kind, label: q.label, name: t.name || t.operator || q.label, metres: Math.round(m), walkMin: Math.max(1, Math.round((m * 1.3) / 80)) };
    }
  }
  const amenities = AMENITY_QUERIES.map((q) => nearest[q.kind]).filter(Boolean);
  // indicative walkability: key daily services within a 10–20 minute walk
  const key = ['bus', 'primary', 'gp', 'supermarket', 'convenience', 'park', 'pharmacy', 'rail'];
  const walkScore = Math.round((key.reduce((s, k) => {
    const a = nearest[k] || (k === 'primary' ? nearest.school : undefined);
    if (!a) return s;
    return s + (a.walkMin <= 5 ? 1 : a.walkMin <= 10 ? 0.8 : a.walkMin <= 20 ? 0.45 : 0.1);
  }, 0) / key.length) * 100);

  // ----- market -----
  const sales: Sale[] = await step<Sale[]>('Sold prices', async () => {
    const pcs = await nearestPostcodes(lng, lat, 30, 600);
    const codes = pcs.map((p) => p.postcode);
    return pricePaid(codes).catch(async () => {
      const r = await fetch(`/api/price-paid?postcodes=${encodeURIComponent(codes.join(','))}`);
      if (!r.ok) throw new Error('Land Registry unavailable');
      return r.json();
    });
  }, [] as Sale[]);
  const byType: Record<string, number[]> = {}, byYear: Record<string, number[]> = {};
  for (const s of sales) {
    (byType[s.type || 'Other'] ||= []).push(s.price);
    (byYear[s.date.slice(0, 4)] ||= []).push(s.price);
  }

  // ----- policy -----
  const local = lpa ? await step('Local plan & SPDs', () => localPlanFor(lpa), null) : null;
  const topics = topicsForDatasets(constraints.map((c) => c.dataset));

  // ----- capacity -----
  const blocking = constraints.filter((c) => c.severity === 'high' && c.coverage != null).map((c) => c.coverage!);
  const constrainedPct = Math.min(1, blocking.reduce((a, b) => Math.max(a, b), 0));
  const netArea = areaM2 * (1 - constrainedPct);
  const ctxLevels = tagged.length >= 3 ? median(tagged) : undefined;
  const urban = (nearest.bus?.metres ?? 9999) < 300 && (nearest.convenience?.metres ?? 9999) < 600;
  const scenarios = capacityScenarios(netArea, ctxLevels, urban);

  // ----- surveys & findings -----
  const has = (ds: string) => constraints.some((c) => c.dataset === ds);
  const surveys = surveyList({ has, areaM2, buildings: buildingsOnSite.length, nearbyHeritage: nearbyHeritage.length, roads, units: Math.max(...scenarios.map((s) => s.units), 0), contextLevels: ctxLevels });
  const dims = minRect(g);
  const sun = sunDays(lat, lng);
  const osmOk = !errors.some((e) => e.startsWith('Buildings & streets'));
  const servicesOk = !errors.some((e) => e.startsWith('Local services'));
  const findings = summarise({ osmOk, servicesOk, constraints, floodZone, nearbyHeritage, brownfield, frontage, walkScore, amenities: nearest, dims, areaM2, score, lpa });

  progress('Done', true);
  return {
    generatedAt: new Date().toISOString(),
    name: input.name || (frontage[0] ? `Land at ${frontage[0].road}${lpa ? `, ${lpa}` : ''}` : location?.postcode ? `Land near ${location.postcode}` : 'Site dossier'),
    source: input.source,
    geometry: g,
    centroid: [lng, lat],
    gridRef: grid.ref,
    easting: Math.round(grid.e),
    northing: Math.round(grid.n),
    areaM2,
    perimeterM: turf.length(turf.polygonToLine(g as any) as any, { units: 'meters' }),
    dims,
    frontage,
    location,
    lpa,
    constraints,
    floodZone,
    score,
    nearbyHeritage,
    planningApps,
    brownfield,
    buildingsOnSite,
    coverage: { footprint, pct: footprint / areaM2, existingGia, giaEstimated },
    context: { buildings: contextBuildings, count: contextBuildings.length, medianLevels: ctxLevels, maxLevels: tagged.length ? Math.max(...tagged) : undefined, taggedPct: contextBuildings.length ? tagged.length / contextBuildings.length : 0, roads },
    amenities,
    busStops400,
    walkScore,
    power: { substationM, lineM },
    sun,
    sales,
    salesSummary: {
      count: sales.length,
      median: median(sales.map((s: Sale) => s.price)),
      byType: Object.entries(byType).map(([type, a]) => ({ type: type.charAt(0).toUpperCase() + type.slice(1), count: a.length, median: median(a) })).sort((a, b) => b.count - a.count),
      flats: median(sales.filter((x) => /flat|maisonette/i.test(x.type)).map((x) => x.price)),
      terraced: median(sales.filter((x) => /terrace/i.test(x.type)).map((x) => x.price)),
      houses: median(sales.filter((x) => /detached/i.test(x.type)).map((x) => x.price)),
      byYear: Object.entries(byYear).map(([year, a]) => ({ year, median: median(a), count: a.length })).sort((a, b) => a.year.localeCompare(b.year)),
    },
    capacity: { netArea, constrainedPct, scenarios },
    policy: { nppf: NPPF, topics, local },
    surveys,
    findings,
    errors,
  };
}

function matches(kind: string, t: any) {
  switch (kind) {
    case 'rail': return t.railway === 'station' && t.station !== 'subway' && t.station !== 'light_rail';
    case 'metro': return t.station === 'subway' || t.station === 'light_rail';
    case 'bus': return t.highway === 'bus_stop';
    case 'primary': return t.amenity === 'school' && /primary|infant|junior|^1$/i.test([t['isced:level'], t['school:level'], t.school, t.name].join(' '));
    case 'school': return t.amenity === 'school';
    case 'nursery': return t.amenity === 'kindergarten';
    case 'gp': return t.amenity === 'doctors';
    case 'pharmacy': return t.amenity === 'pharmacy';
    case 'hospital': return t.amenity === 'hospital';
    case 'supermarket': return t.shop === 'supermarket';
    case 'convenience': return t.shop === 'convenience';
    case 'park': return t.leisure === 'park' || t.leisure === 'recreation_ground';
    case 'play': return t.leisure === 'playground';
    case 'ev': return t.amenity === 'charging_station';
  }
  return false;
}

export function capacityScenarios(netArea: number, ctxLevels: number | undefined, urban: boolean): Scenario[] {
  const ha = netArea / 10000;
  const ctx = Math.max(2, Math.round(ctxLevels ?? (urban ? 3 : 2)));
  const out: Scenario[] = [];
  if (ha < 0.04) {
    out.push({ name: 'Single dwelling / replacement', basis: 'Plot too small for a multi-unit layout', units: 1, gia: Math.round(netArea * 0.45 * Math.min(ctx, 2)), storeys: Math.min(ctx, 2), note: 'Extension, replacement dwelling or conversion is the likely route.' });
    out.push({ name: 'Flats conversion / small block', basis: `${ctx} storeys at 60% coverage`, units: Math.max(1, Math.floor((netArea * 0.6 * ctx * 0.8) / 60)), gia: Math.round(netArea * 0.6 * ctx), storeys: ctx, note: 'Depends on space standards, amenity and parking policy.' });
    return out;
  }
  const add = (name: string, dph: number, storeys: number, unitSize: number, note: string) => {
    const units = Math.max(1, Math.round(ha * dph));
    out.push({ name, basis: `${dph} dwellings per hectare`, units, gia: Math.round(units * unitSize), storeys, note });
  };
  add('Houses (suburban)', 30, 2, 95, 'Detached/semi-detached with gardens and on-plot parking.');
  add('Terraced / town houses', 50, Math.max(2, Math.min(ctx, 3)), 85, 'Typical of established urban streets; reduced parking.');
  add(urban ? 'Apartments (urban)' : 'Apartments (low-rise)', urban ? 120 : 75, Math.max(3, ctx + (urban ? 1 : 0)), 65, urban ? 'Well-connected location suits higher density; check daylight and amenity.' : 'Low-rise flats; scale should respect context.');
  return out;
}

export function surveyList(o: { has: (d: string) => boolean; areaM2: number; buildings: number; nearbyHeritage: number; roads: Road[]; units: number; contextLevels?: number }): Survey[] {
  const s: Survey[] = [
    { name: 'Topographical & measured survey', why: 'Levels, boundaries, trees and features for design and the title-plan check.', when: 'Before purchase', priority: 'Essential' },
    { name: 'Title & legal review', why: 'The Land Registry outline is indicative; confirm title, rights of way, covenants and access.', when: 'Before purchase', priority: 'Essential' },
    { name: 'Utilities search', why: 'Locate services, sewers and capacity for new connections.', when: 'Before purchase', priority: 'Essential' },
    { name: 'Preliminary ecological appraisal & BNG baseline', why: 'Biodiversity net gain (10% minimum) applies to most schemes; habitats and protected species.', when: 'Pre-application', priority: 'Essential' },
  ];
  if (o.buildings) s.push({ name: 'Measured building & condition survey', why: 'Existing buildings on site: floor areas for conversion, demolition and CIL credit.', when: 'Before purchase', priority: 'Essential' });
  if (o.buildings) s.push({ name: 'Bat & asbestos surveys', why: 'Usually needed before demolition or roof works.', when: 'Pre-application', priority: 'Likely' });
  if (o.has('flood-risk-zone') || o.areaM2 >= 10000) s.push({ name: 'Flood risk assessment & drainage strategy', why: o.has('flood-risk-zone') ? 'Site lies in Flood Zone 2/3: sequential test and FRA required.' : 'Sites over 1 ha need an FRA even in Flood Zone 1.', when: 'Pre-application', priority: 'Essential' });
  else s.push({ name: 'Drainage strategy (SuDS)', why: 'Surface water strategy is normally required for new build.', when: 'With application', priority: 'Likely' });
  if (o.has('conservation-area') || o.has('listed-building') || o.nearbyHeritage || o.has('scheduled-monument')) s.push({ name: 'Heritage statement', why: 'Designated heritage assets on or near the site; assess significance and setting.', when: 'Pre-application', priority: 'Essential' });
  if (o.has('tree-preservation-zone') || o.has('tree') || o.has('conservation-area') || o.has('ancient-woodland')) s.push({ name: 'Arboricultural survey (BS5837)', why: 'Protected trees or trees in a conservation area constrain layout.', when: 'Pre-application', priority: 'Essential' });
  else s.push({ name: 'Tree survey (BS5837)', why: 'Any trees on or overhanging the site affect layout.', when: 'Pre-application', priority: 'Consider' });
  if (o.has('brownfield-land') || o.buildings) s.push({ name: 'Phase 1 contamination (desk study)', why: 'Previously developed land; check historic uses.', when: 'Before purchase', priority: 'Likely' });
  if (o.roads.some((r) => ['primary', 'trunk', 'motorway', 'secondary'].includes(r.type))) s.push({ name: 'Noise & air quality assessment', why: 'Busy road next to the site.', when: 'Pre-application', priority: 'Likely' });
  if (o.units >= 10) s.push({ name: 'Transport statement & parking', why: '10+ homes usually needs a transport statement or assessment.', when: 'With application', priority: 'Likely' });
  if ((o.contextLevels ?? 0) >= 3 || o.units >= 10) s.push({ name: 'Daylight & sunlight study', why: 'Taller or denser schemes affect neighbours (BRE guidance).', when: 'Pre-application', priority: 'Consider' });
  if (o.has('site-of-special-scientific-interest') || o.has('special-area-of-conservation') || o.has('special-protection-area') || o.has('ramsar')) s.push({ name: 'Habitats Regulations screening', why: 'Protected habitat designations nearby.', when: 'Pre-application', priority: 'Essential' });
  s.push({ name: 'Pre-application advice', why: "Test the scheme and the council's view before committing.", when: 'Pre-application', priority: 'Likely' });
  const rank = { 'Before purchase': 0, 'Pre-application': 1, 'With application': 2 };
  return s.sort((a, b) => rank[a.when] - rank[b.when]);
}

export function summarise(o: { osmOk: boolean; servicesOk: boolean; constraints: Constraint[]; floodZone: string; nearbyHeritage: any[]; brownfield: any; frontage: Frontage[]; walkScore: number; amenities: Record<string, Amenity>; dims: Dossier['dims']; areaM2: number; score: number; lpa?: string }): Finding[] {
  const f: Finding[] = [];
  const high = o.constraints.filter((c) => c.severity === 'high');
  const med = o.constraints.filter((c) => c.severity === 'medium');
  if (!high.length && !med.length) f.push({ tone: 'good', text: 'No national planning designations on the site.' });
  for (const c of high) f.push({ tone: 'risk', text: `${c.name}${c.coverage != null ? ` covers ${Math.round(c.coverage * 100)}% of the site` : ' affects the site'}.` });
  for (const c of med) {
    const first = c.desc.replace(/\s*\([^)]*\)/g, '').split(/\.(?:\s|$)/)[0];
    f.push({ tone: 'risk', text: `${c.name}${c.coverage != null ? ` (${Math.round(c.coverage * 100)}% of site)` : ''}: ${first.charAt(0).toLowerCase() + first.slice(1)}.` });
  }
  f.push({ tone: o.floodZone.includes('Zone 1') ? 'good' : 'risk', text: `${o.floodZone}.` });
  if (o.nearbyHeritage.length) f.push({ tone: 'note', text: `${o.nearbyHeritage.length} listed building${o.nearbyHeritage.length > 1 ? 's' : ''} within 75 m; design must respect their setting.` });
  if (o.brownfield) f.push({ tone: 'good', text: 'On the council brownfield register (judged suitable for housing).' });
  if (!o.osmOk) { /* street frontage unknown */ } else if (o.frontage.length) f.push({ tone: 'good', text: `Street frontage: ${o.frontage.map((x) => `${Math.round(x.metres)} m to ${x.road}`).join(', ')}.` });
  else f.push({ tone: 'note', text: 'No street frontage detected; confirm vehicular and pedestrian access.' });
  if (!o.servicesOk) { /* services unknown */ } else if (o.walkScore >= 70) f.push({ tone: 'good', text: `Very walkable: everyday services within a short walk (score ${o.walkScore}).` });
  else if (o.walkScore < 40) f.push({ tone: 'note', text: `Car-dependent location (walkability ${o.walkScore}).` });
  const st = o.amenities.rail;
  if (st && st.metres < 1200) f.push({ tone: 'good', text: `${st.name} station ${st.walkMin} min walk.` });
  return f;
}
