import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, Point } from 'geojson';

const PD = 'https://www.planning.data.gov.uk';

// ---------- geometry helpers ----------
const ring = (r: number[][]) => '(' + r.map((c) => `${c[0].toFixed(6)} ${c[1].toFixed(6)}`).join(',') + ')';

export function toWKT(g: Geometry): string {
  if (g.type === 'Point') return `POINT(${g.coordinates[0]} ${g.coordinates[1]})`;
  if (g.type === 'Polygon') return `POLYGON(${(g as Polygon).coordinates.map(ring).join(',')})`;
  if (g.type === 'MultiPolygon') return `MULTIPOLYGON(${(g as MultiPolygon).coordinates.map((p) => '(' + p.map(ring).join(',') + ')').join(',')})`;
  if (g.type === 'LineString') return `LINESTRING${ring(g.coordinates)}`;
  throw new Error('Unsupported geometry ' + g.type);
}

export function bboxWKT(w: number, s: number, e: number, n: number) {
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

/** Small square around a point (metres) so point-based layers can be hit-tested. */
export function squareAround(lng: number, lat: number, metres: number): Polygon {
  const dLat = metres / 111320;
  const dLng = metres / (111320 * Math.cos((lat * Math.PI) / 180));
  return { type: 'Polygon', coordinates: [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]] };
}

// ---------- planning.data.gov.uk ----------
export async function fetchEntities(opts: { datasets: string[]; geometry?: Geometry; wkt?: string; limit?: number; offset?: number; signal?: AbortSignal }): Promise<FeatureCollection> {
  const p = new URLSearchParams();
  opts.datasets.forEach((d) => p.append('dataset', d));
  const wkt = opts.wkt ?? (opts.geometry ? toWKT(opts.geometry) : undefined);
  if (wkt) {
    p.set('geometry', wkt);
    p.set('geometry_relation', 'intersects');
  }
  p.set('limit', String(opts.limit ?? 500));
  if (opts.offset) p.set('offset', String(opts.offset));
  const r = await fetch(`${PD}/entity.geojson?${p}`, { signal: opts.signal });
  if (!r.ok) throw new Error(`Planning data ${r.status}`);
  const fc = (await r.json()) as FeatureCollection;
  fc.features = (fc.features || []).filter((f) => f.geometry);
  return fc;
}

/** Read a property from a planning.data entity, tolerating nested `json` blobs. */
export function prop(f: Feature | { properties?: any }, key: string): any {
  const p: any = f.properties || {};
  if (p[key] != null && p[key] !== '') return p[key];
  const alt = key.replace(/-/g, '_');
  if (p[alt] != null && p[alt] !== '') return p[alt];
  let j = p.json;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch { j = null; }
  }
  return j?.[key] ?? j?.[alt];
}

export function entityUrl(f: Feature) {
  const e = prop(f, 'entity');
  return e ? `${PD}/entity/${e}` : undefined;
}

// ---------- geocoding ----------
export interface Place { label: string; sub?: string; lng: number; lat: number; bbox?: [number, number, number, number] }

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export async function geocode(q: string, signal?: AbortSignal): Promise<Place[]> {
  q = q.trim();
  if (!q) return [];
  const ll = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (ll) {
    const a = +ll[1], b = +ll[2];
    const [lat, lng] = Math.abs(a) > 40 ? [a, b] : [b, a];
    return [{ label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, sub: 'Coordinates', lat, lng }];
  }
  const out: Place[] = [];
  if (POSTCODE_RE.test(q)) {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`, { signal });
    if (r.ok) {
      const { result: x } = await r.json();
      out.push({ label: x.postcode, sub: [x.admin_ward, x.admin_district].filter(Boolean).join(', '), lat: x.latitude, lng: x.longitude });
    }
  } else if (OUTCODE_RE.test(q)) {
    const r = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`, { signal });
    if (r.ok) {
      const { result: x } = await r.json();
      out.push({ label: x.outcode, sub: (x.admin_district || []).join(', '), lat: x.latitude, lng: x.longitude });
    }
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=gb&limit=6&q=${encodeURIComponent(q)}`, { signal, headers: { Accept: 'application/json' } });
    if (r.ok) {
      const rows = await r.json();
      for (const x of rows) {
        const [first, ...rest] = String(x.display_name).split(', ');
        const bb = x.boundingbox?.map(Number);
        out.push({ label: first, sub: rest.slice(0, 3).join(', '), lat: +x.lat, lng: +x.lon, bbox: bb ? [bb[2], bb[0], bb[3], bb[1]] : undefined });
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  return out;
}

export interface PostcodeInfo {
  postcode: string; admin_district?: string; admin_ward?: string; parish?: string; parliamentary_constituency?: string;
  region?: string; lsoa?: string; msoa?: string; rural_urban?: string; distance?: number; latitude: number; longitude: number;
  codes?: { admin_district?: string };
}

export async function nearestPostcodes(lng: number, lat: number, limit = 10, radius = 800): Promise<PostcodeInfo[]> {
  const r = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=${limit}&radius=${radius}`);
  if (!r.ok) throw new Error('postcodes.io ' + r.status);
  const j = await r.json();
  return j.result || [];
}

// ---------- HM Land Registry Price Paid (SPARQL) ----------
export interface Sale { address: string; postcode: string; price: number; date: string; type: string; newBuild: boolean; tenure: string }

export async function pricePaid(postcodes: string[], sinceYear = new Date().getFullYear() - 5): Promise<Sale[]> {
  if (!postcodes.length) return [];
  const values = postcodes.map((p) => `"${p.replace(/"/g, '')}"^^xsd:string`).join(' ');
  const query = `
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?paon ?saon ?street ?town ?postcode ?amount ?date ?ptype ?newbuild ?tenure WHERE {
  VALUES ?postcode { ${values} }
  ?addr lrcommon:postcode ?postcode .
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date .
  OPTIONAL { ?tx lrppi:propertyType/skos:prefLabel ?ptype }
  OPTIONAL { ?tx lrppi:newBuild ?newbuild }
  OPTIONAL { ?tx lrppi:estateType/skos:prefLabel ?tenure }
  OPTIONAL { ?addr lrcommon:paon ?paon } OPTIONAL { ?addr lrcommon:saon ?saon }
  OPTIONAL { ?addr lrcommon:street ?street } OPTIONAL { ?addr lrcommon:town ?town }
  FILTER (?date >= "${sinceYear}-01-01"^^xsd:date)
} ORDER BY DESC(?date) LIMIT 300`;
  const r = await fetch(`https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(query)}&output=json`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!r.ok) throw new Error('Land Registry ' + r.status);
  const j = await r.json();
  const v = (b: any, k: string) => b[k]?.value ?? '';
  return j.results.bindings.map((b: any) => ({
    address: [v(b, 'saon'), v(b, 'paon'), v(b, 'street'), v(b, 'town')].filter(Boolean).join(', ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()),
    postcode: v(b, 'postcode'),
    price: +v(b, 'amount'),
    date: v(b, 'date'),
    type: v(b, 'ptype'),
    newBuild: v(b, 'newbuild') === 'true',
    tenure: v(b, 'tenure'),
  }));
}

export type { Feature, FeatureCollection, Geometry, Polygon, Point };
