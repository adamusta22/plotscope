// Plot (title) boundaries.
//
// Primary source: HM Land Registry INSPIRE Index Polygons view service — the
// indicative extent of every registered freehold title in England & Wales.
// (Traced from the service's boundary image; see hmlrPlot.)
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
  return `${location.origin}${OWS}?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=1024&height=1024&bbox={bbox-epsg-3857}`;
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

// The service has WFS disabled and its parcel layer isn't queryable, so it
// can't tell us which polygon is at a point. Instead we fetch the boundary
// image around the click and flood-fill the clicked plot, exactly as you'd
// see it on screen, then trace that region into a polygon.
const IMG = 1024; // px
const WATERMARK_ROWS = 72; // licence notice is drawn along the bottom-left of every image

export async function fetchBoundaryImage(layer: string, x: number, y: number, half: number, signal?: AbortSignal): Promise<ImageData | null> {
  const url = `${OWS}?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=${IMG}&height=${IMG}&bbox=${x - half},${y - half},${x + half},${y + half}`;
  const r = await fetch(url, { signal });
  if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
  const bmp = await createImageBitmap(await r.blob());
  const canvas = document.createElement('canvas');
  canvas.width = IMG;
  canvas.height = IMG;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, IMG, IMG);
}

/**
 * Boundary pixels, with the plot ID labels removed: labels are small compact
 * groups of dark pixels, while boundary lines join up into large networks.
 */
function boundaryPixels(img: ImageData): Uint8Array {
  const W = img.width, H = img.height, a = img.data;
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < solid.length; i++) solid[i] = a[i * 4 + 3] >= 96 ? 1 : 0;
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const comp: number[] = [];
  for (let s = 0; s < solid.length; s++) {
    if (!solid[s] || seen[s]) continue;
    let sp = 0, minX = W, maxX = 0, minY = H, maxY = 0;
    comp.length = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const i = stack[--sp];
      comp.push(i);
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (solid[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    // a digit, or a whole label written horizontally or vertically
    const textLike = Math.max(w, h) <= 80 && Math.min(w, h) <= 16;
    if (textLike) for (const i of comp) solid[i] = 0;
  }
  return solid;
}

/** Flood-fill the open region containing the centre pixel. */
export function fillFromCentre(img: ImageData): { mask: Uint8Array; touchesEdge: boolean; count: number } | null {
  const W = img.width, H = img.height;
  const wall = boundaryPixels(img);
  let seed = -1;
  const cx = W >> 1, cy = H >> 1;
  // if the click landed on a line, use the nearest open pixel
  for (let r = 0; r <= 6 && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = (cy + dy) * W + (cx + dx);
      if (!wall[i]) { seed = i; break; }
    }
  }
  if (seed < 0) return null;
  const mask = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0, count = 0, touchesEdge = false;
  stack[sp++] = seed;
  mask[seed] = 1;
  while (sp) {
    const i = stack[--sp];
    count++;
    const x = i % W, y = (i / W) | 0;
    if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2 - WATERMARK_ROWS) touchesEdge = true;
    if (x > 0 && !mask[i - 1] && !wall[i - 1]) { mask[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < W - 1 && !mask[i + 1] && !wall[i + 1]) { mask[i + 1] = 1; stack[sp++] = i + 1; }
    if (y > 0 && !mask[i - W] && !wall[i - W]) { mask[i - W] = 1; stack[sp++] = i - W; }
    if (y < H - 1 && !mask[i + W] && !wall[i + W]) { mask[i + W] = 1; stack[sp++] = i + W; }
  }
  return { mask, touchesEdge, count };
}

/** Grow the region by `r` px so its edge sits on the middle of the boundary line (and swallows labels). */
function dilate(mask: Uint8Array, W: number, H: number, r: number) {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = cur.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!cur[i] && (cur[i - 1] || cur[i + 1] || cur[i - W] || cur[i + W])) next[i] = 1;
    }
    cur = next;
  }
  return cur;
}

/** Fill interior holes (e.g. where the plot's ID label was printed). */
function fillHoles(mask: Uint8Array, W: number, H: number) {
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Moore-neighbour tracing of the region's outer boundary (pixel coords). */
function traceOutline(mask: Uint8Array, W: number, H: number): number[][] | null {
  let start = -1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return null;
  const D = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  let cx = start % W, cy = (start / W) | 0;
  const sx = cx, sy = cy;
  let back = 0; // we arrived from the west
  const pts: number[][] = [[cx, cy]];
  for (let guard = 0; guard < W * H; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + D[d][0], ny = cy + D[d][1];
      if (on(nx, ny)) {
        const p = D[(d + 7) % 8];
        const px = cx + p[0] - nx, py = cy + p[1] - ny;
        back = D.findIndex(([ax, ay]) => ax === px && ay === py);
        cx = nx; cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved || (cx === sx && cy === sy)) break;
    pts.push([cx, cy]);
  }
  return pts.length >= 4 ? pts : null;
}

export async function hmlrPlot(lng: number, lat: number, signal?: AbortSignal): Promise<Plot | null> {
  const layer = await parcelLayer();
  const [x, y] = fromLngLatTo3857(lng, lat);
  // Start tight (~0.25 m/px at 52°N) and zoom out when the plot runs off the image
  for (const half of [160, 640, 2560]) {
    const img = await fetchBoundaryImage(layer, x, y, half, signal);
    if (!img) return null;
    const fill = fillFromCentre(img);
    if (!fill) return null;
    if (fill.touchesEdge) continue;
    if (fill.count < 30) return null; // a sliver between lines, not a plot
    const region = fillHoles(dilate(fill.mask, IMG, IMG, 2), IMG, IMG);
    const ring = traceOutline(region, IMG, IMG);
    if (!ring) return null;
    const res = (2 * half) / IMG;
    const toLngLat = ([px, py]: number[]) => toLngLatFrom3857([x - half + (px + 0.5) * res, y + half - (py + 0.5) * res]);
    const closed = [...ring, ring[0]];
    const simplified = turf.simplify(turf.polygon([closed]), { tolerance: 0.9, highQuality: true });
    const coords = simplified.geometry.coordinates[0].map(toLngLat);
    if (coords.length < 4) return null;
    const geometry: Polygon = { type: 'Polygon', coordinates: [coords] };
    return { geometry, source: 'hmlr', areaHa: turf.area(geometry) / 10000 };
  }
  return null; // unregistered land (roads, rivers) or a very large holding
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
