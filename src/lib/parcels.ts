// Plot (title) boundaries.
//
// Primary source: HM Land Registry INSPIRE Index Polygons view service — the
// indicative extent of every registered freehold title in England & Wales.
// The service doesn't send CORS headers, so the browser reaches it through a
// same-origin proxy at /lr (Netlify redirect in production, Vite proxy in dev).
//
// Fallback: the building / land-use outline at the point from OpenStreetMap.
import * as turf from '@turf/turf';
import proj4 from 'proj4';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

const OWS = '/lr/inspire/ows';
const FALLBACK_LAYER = 'inspire:CP.CadastralParcel';

proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
);

export interface Plot {
  geometry: Polygon | MultiPolygon;
  source: 'hmlr' | 'osm';
  inspireId?: string;
  label?: string;
  areaHa: number;
}

let layerPromise: Promise<string> | null = null;

/** Discover the parcel layer name from the service's capabilities (cached). */
export function parcelLayer(): Promise<string> {
  if (!layerPromise) {
    layerPromise = fetch(`${OWS}?service=WMS&version=1.3.0&request=GetCapabilities`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((xml) => {
        const names = Array.from(xml.matchAll(/<Name>([^<]+)<\/Name>/g)).map((m) => m[1].trim());
        return names.find((n) => /cadastral|parcel|cp\./i.test(n)) || FALLBACK_LAYER;
      })
      .catch(() => FALLBACK_LAYER);
  }
  return layerPromise;
}

/** Raster tile URL template (MapLibre fills {bbox-epsg-3857}). */
export function parcelTileUrl(layer: string) {
  return `${location.origin}${OWS}?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=512&height=512&bbox={bbox-epsg-3857}`;
}

// ---------- coordinate handling ----------
const toLngLatFrom3857 = ([x, y]: Position): Position => [(x / 6378137) * (180 / Math.PI), (Math.atan(Math.exp(y / 6378137)) * 2 - Math.PI / 2) * (180 / Math.PI)];
const toLngLatFrom27700 = (p: Position): Position => proj4('EPSG:27700', 'EPSG:4326', [p[0], p[1]]);
const fromLngLatTo3857 = (lng: number, lat: number) => [(lng * Math.PI * 6378137) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137];

/** Work out which CRS a service returned from the size of the numbers. */
function converterFor(sample: Position): ((p: Position) => Position) | null {
  const [a, b] = sample;
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) {
    // lat/lon order for Britain looks like [50..61, -9..2]
    return a > 45 && a < 62 && b > -10 && b < 3 ? ([x, y]) => [y, x] : (p) => p;
  }
  if (b > 3_000_000) return toLngLatFrom3857;
  if (a >= -10_000 && a <= 800_000 && b >= -10_000 && b <= 1_400_000) return toLngLatFrom27700;
  return null;
}

function firstPosition(g: any): Position | undefined {
  let c = g?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) ? (c as Position) : undefined;
}

function toWgs84(g: Polygon | MultiPolygon): Polygon | MultiPolygon | null {
  const s = firstPosition(g);
  const conv = s && converterFor(s);
  if (!conv) return null;
  const ring = (r: Position[]) => r.map(conv);
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(ring) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) };
}

function inspireIdOf(props: Record<string, any> = {}) {
  const k = Object.keys(props).find((x) => /inspire.?id|localid|^id$/i.test(x));
  return k ? String(props[k]) : undefined;
}

/** Pick the smallest polygon that contains the point. */
function pickContaining(features: Feature[], lng: number, lat: number): { geometry: Polygon | MultiPolygon; props: any } | null {
  const pt = turf.point([lng, lat]);
  const cands = features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f) => ({ geometry: toWgs84(f.geometry as Polygon | MultiPolygon), props: f.properties }))
    .filter((c): c is { geometry: Polygon | MultiPolygon; props: any } => !!c.geometry && turf.booleanPointInPolygon(pt, c.geometry as any));
  cands.sort((a, b) => turf.area(a.geometry) - turf.area(b.geometry));
  return cands[0] || null;
}

async function hmlrPlot(lng: number, lat: number, signal?: AbortSignal): Promise<Plot | null> {
  const layer = await parcelLayer();
  const [x, y] = fromLngLatTo3857(lng, lat);
  const d = 25; // metres (EPSG:3857 units)
  const tries = [
    // WFS: full polygons near the point, returned in Web Mercator
    `${OWS}?service=WFS&version=1.1.0&request=GetFeature&typeName=${encodeURIComponent(layer)}&outputFormat=application/json&srsName=EPSG:3857&bbox=${x - d},${y - d},${x + d},${y + d},EPSG:3857`,
    // WMS GetFeatureInfo at the clicked pixel
    `${OWS}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${encodeURIComponent(layer)}&query_layers=${encodeURIComponent(layer)}&styles=&srs=EPSG:3857&bbox=${x - 50},${y - 50},${x + 50},${y + 50}&width=101&height=101&x=50&y=50&info_format=application/json&feature_count=10`,
  ];
  for (const url of tries) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) continue;
      const fc = await r.json();
      const hit = pickContaining(fc.features || [], lng, lat);
      if (hit) return { geometry: hit.geometry, source: 'hmlr', inspireId: inspireIdOf(hit.props), areaHa: turf.area(hit.geometry) / 10000 };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  return null;
}

async function osmPlot(lng: number, lat: number, signal?: AbortSignal): Promise<Plot | null> {
  const q = `[out:json][timeout:15];(way(around:2,${lat},${lng})[building];way(around:2,${lat},${lng})[landuse];way(around:2,${lat},${lng})[amenity];way(around:2,${lat},${lng})[leisure];);out geom 20;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), signal });
    if (!r.ok) return null;
    const j = await r.json();
    const feats: Feature[] = (j.elements || [])
      .filter((e: any) => e.geometry?.length >= 4)
      .map((e: any) => {
        const ring = e.geometry.map((p: any) => [p.lon, p.lat]);
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
        return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: e.tags || {} };
      });
    const hit = pickContaining(feats, lng, lat);
    if (!hit) return null;
    const t = hit.props || {};
    const label = t.name || (t.building ? `Building${t.building !== 'yes' ? ` (${t.building})` : ''}` : t.landuse ? `Land use: ${t.landuse}` : t.amenity || t.leisure);
    return { geometry: hit.geometry, source: 'osm', label, areaHa: turf.area(hit.geometry) / 10000 };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

/** Plot boundary at a point: Land Registry title extent, else OSM outline. */
export async function plotAt(lng: number, lat: number, signal?: AbortSignal): Promise<Plot | null> {
  return (await hmlrPlot(lng, lat, signal)) || (await osmPlot(lng, lat, signal));
}
