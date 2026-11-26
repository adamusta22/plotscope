import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { BASEMAPS, BasemapId, cartoTiles, DATASETS, DATASET_BY_ID } from '../lib/datasets';
import { bboxWKT, fetchEntities, prop } from '../lib/api';
import { Site, STAGE_COLORS } from '../lib/store';
import { parcelLayer, parcelTileUrl } from '../lib/parcels';

export type DrawMode = 'polygon' | 'measure' | null;
export type LayerStatus = { state: 'off' | 'zoom' | 'loading' | 'ok' | 'error'; count?: number };

export interface MapClick {
  lng: number;
  lat: number;
  features: Feature[];
  siteId?: string;
  shift: boolean;
}

interface Props {
  basemap: BasemapId;
  enabled: string[];
  opacity: number;
  sites: Site[];
  selectedSiteId?: string;
  selection?: Geometry | null;
  highlight?: Feature | null;
  sourcing?: FeatureCollection | null;
  drawMode: DrawMode;
  showPlots: boolean;
  pending?: [number, number] | null;
  onDrawProgress: (text: string) => void;
  onDrawComplete: (g: Geometry, mode: DrawMode) => void;
  onClick: (c: MapClick) => void;
  onStatus: (s: Record<string, LayerStatus>) => void;
  onReady: (m: MLMap) => void;
}

// Captured once: React's dev double-mount removes the first map, which clears the hash
const INITIAL_HASH = typeof location !== 'undefined' ? location.hash : '';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const OVERLAY_INTERACTIVE = new Set<string>();

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const P = useRef(props);
  P.current = props;
  const loaded = useRef(false);
  const fetched = useRef<Record<string, { bbox: number[]; zoom: number }>>({});
  const aborts = useRef<Record<string, AbortController>>({});
  const status = useRef<Record<string, LayerStatus>>({});
  const verts = useRef<number[][]>([]);
  const cursor = useRef<number[] | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const pendingMarker = useRef<maplibregl.Marker | null>(null);
  const anim = useRef<number>(0);

  // ---------- init ----------
  useEffect(() => {
    const sources: Record<string, any> = {};
    const layers: any[] = [];
    for (const b of BASEMAPS) {
      sources['bm-' + b.id] = { type: 'raster', tiles: [...b.tiles], tileSize: 256, attribution: b.attribution, maxzoom: 19 };
      layers.push({ id: 'bm-' + b.id, type: 'raster', source: 'bm-' + b.id, layout: { visibility: b.id === props.basemap ? 'visible' : 'none' } });
    }
    sources['bm-labels'] = { type: 'raster', tiles: cartoTiles('dark_only_labels'), tileSize: 256 };
    layers.push({ id: 'bm-labels', type: 'raster', source: 'bm-labels', layout: { visibility: props.basemap === 'satellite' ? 'visible' : 'none' } });

    // Restore the view from the URL (#map=zoom/lat/lng[/bearing/pitch]) so links and reloads keep their place
    const h = (location.hash.includes('map=') ? location.hash : INITIAL_HASH).match(/map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)(?:\/(-?[\d.]+))?(?:\/([\d.]+))?/);
    const m = new maplibregl.Map({
      container: el.current!,
      style: { version: 8, sources, layers },
      center: h ? [+h[3], +h[2]] : [-1.6, 52.6],
      zoom: h ? +h[1] : 6,
      bearing: h?.[4] ? +h[4] : 0,
      pitch: h?.[5] ? +h[5] : 0,
      boxZoom: false, // shift-click is used to merge plots
      hash: 'map',
      maxPitch: 70,
      attributionControl: { compact: true },
      fadeDuration: 150,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 16 } }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    m.on('load', () => {
      // HM Land Registry title plot outlines (raster WMS via the /lr proxy), below all overlays
      parcelLayer().then((layer) => {
        if (!map.current || m.getSource('plots')) return;
        m.addSource('plots', { type: 'raster', tiles: [parcelTileUrl(layer)], tileSize: 1024, minzoom: 15, attribution: 'Title extents © Crown copyright, HM Land Registry' });
        const before = m.getStyle().layers.find((l) => l.id.startsWith('ds-'))?.id;
        m.addLayer({ id: 'plots', type: 'raster', source: 'plots', minzoom: 15, paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 200 } }, before);
        syncPlots();
      });

      // Constraint overlays (polygons below points)
      const ordered = [...DATASETS].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'polygon' ? -1 : 1));
      for (const d of ordered) {
        m.addSource('ds-' + d.id, { type: 'geojson', data: EMPTY, promoteId: 'entity' });
        if (d.kind === 'polygon') {
          const isBoundary = d.group === 'Boundaries';
          m.addLayer({ id: `ds-${d.id}-fill`, type: 'fill', source: 'ds-' + d.id, layout: { visibility: 'none' }, paint: { 'fill-color': d.color, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], isBoundary ? 0.08 : 0.4, isBoundary ? 0 : 0.2] } });
          m.addLayer({ id: `ds-${d.id}-line`, type: 'line', source: 'ds-' + d.id, layout: { visibility: 'none' }, paint: { 'line-color': d.color, 'line-width': isBoundary ? 2 : 1.4, 'line-dasharray': isBoundary ? [3, 2] : [1, 0] } });
          OVERLAY_INTERACTIVE.add(`ds-${d.id}-fill`);
        } else {
          m.addLayer({ id: `ds-${d.id}-pt`, type: 'circle', source: 'ds-' + d.id, layout: { visibility: 'none' }, paint: { 'circle-color': d.color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2, 'circle-opacity': 0.9 } });
          // non-point geometries in "point" datasets (e.g. brownfield polygons)
          m.addLayer({ id: `ds-${d.id}-ptfill`, type: 'fill', source: 'ds-' + d.id, filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' }, paint: { 'fill-color': d.color, 'fill-opacity': 0.3, 'fill-outline-color': d.color } });
          OVERLAY_INTERACTIVE.add(`ds-${d.id}-pt`).add(`ds-${d.id}-ptfill`);
        }
      }

      // Sourcing results
      m.addSource('sourcing', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'sourcing-halo', type: 'circle', source: 'sourcing', paint: { 'circle-color': '#ff6b35', 'circle-opacity': 0.18, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 16, 22] } });
      m.addLayer({ id: 'sourcing-pt', type: 'circle', source: 'sourcing', paint: { 'circle-color': '#ff6b35', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 9], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

      // Saved sites
      m.addSource('sites', { type: 'geojson', data: EMPTY, promoteId: 'id' });
      m.addLayer({ id: 'sites-fill', type: 'fill', source: 'sites', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.45, 0.28] } });
      m.addLayer({ id: 'sites-line', type: 'line', source: 'sites', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } });
      m.addLayer({ id: 'sites-selected', type: 'line', source: 'sites', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-blur': 1, 'line-opacity': 0.9 } });
      m.moveLayer('sites-line');

      // Selection / highlight
      m.addSource('selection', { type: 'geojson', data: EMPTY });
      const polyOnly: any = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
      m.addLayer({ id: 'selection-fill', type: 'fill', source: 'selection', filter: polyOnly, paint: { 'fill-color': SEL, 'fill-opacity': 0.16 } });
      m.addLayer({ id: 'selection-glow', type: 'line', source: 'selection', paint: { 'line-color': SEL, 'line-width': 12, 'line-blur': 8, 'line-opacity': 0.45 } });
      m.addLayer({ id: 'selection-casing', type: 'line', source: 'selection', paint: { 'line-color': '#ffffff', 'line-width': 5 } });
      m.addLayer({ id: 'selection-line', type: 'line', source: 'selection', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': SEL, 'line-width': 3, 'line-dasharray': DASH[0] } });
      m.addSource('highlight', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'highlight-line', type: 'line', source: 'highlight', paint: { 'line-color': '#ffd43b', 'line-width': 4 } });
      m.addLayer({ id: 'highlight-pt', type: 'circle', source: 'highlight', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ffd43b', 'circle-radius': 12, 'circle-opacity': 0.5, 'circle-stroke-color': '#ffd43b', 'circle-stroke-width': 2 } });

      // Drawing
      m.addSource('draw', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#fab005', 'fill-opacity': 0.2 } });
      m.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#fab005', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'draw-pt', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#fff', 'circle-radius': 5, 'circle-stroke-color': '#fab005', 'circle-stroke-width': 2.5 } });

      loaded.current = true;
      syncAll();
      P.current.onReady(m);
    });

    // ---------- interaction ----------
    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'hover-pop', offset: 12, maxWidth: '280px' });
    let hovered: { source: string; id: any } | null = null;

    m.on('mousemove', (e: MapMouseEvent) => {
      if (P.current.drawMode) {
        cursor.current = [e.lngLat.lng, e.lngLat.lat];
        renderDraw();
        return;
      }
      const layers = interactiveLayers();
      const f = layers.length ? m.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      if (hovered) m.setFeatureState(hovered, { hover: false });
      hovered = null;
      if (!f) {
        m.getCanvas().style.cursor = '';
        hover.remove();
        return;
      }
      m.getCanvas().style.cursor = 'pointer';
      if (f.id != null) {
        hovered = { source: f.source, id: f.id };
        m.setFeatureState(hovered, { hover: true });
      }
      const isSite = f.source === 'sites';
      const sourcing = f.source === 'sourcing';
      const ds = DATASET_BY_ID[String(f.source).replace('ds-', '')];
      const title = isSite ? f.properties?.name : prop(f, 'name') || prop(f, 'site-address') || prop(f, 'reference') || 'Unnamed';
      const sub = isSite ? `Pipeline · ${f.properties?.stage}` : sourcing ? 'Brownfield opportunity' : ds?.name;
      const color = isSite ? f.properties?.color : sourcing ? '#ff6b35' : ds?.color;
      hover
        .setLngLat(e.lngLat)
        .setHTML(`<div class="hp"><i style="background:${color}"></i><div><b>${escapeHtml(String(title))}</b><span>${escapeHtml(sub || '')}</span></div></div>`)
        .addTo(m);
    });
    m.on('mouseout', () => hover.remove());

    m.on('click', (e) => {
      const mode = P.current.drawMode;
      if (mode) {
        verts.current.push([e.lngLat.lng, e.lngLat.lat]);
        renderDraw();
        return;
      }
      const layers = interactiveLayers();
      const feats = layers.length ? m.queryRenderedFeatures([[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]], { layers }) : [];
      const site = feats.find((f) => f.source === 'sites');
      P.current.onClick({
        shift: !!(e.originalEvent as MouseEvent).shiftKey,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        siteId: site?.properties?.id,
        features: feats.filter((f) => f.source !== 'sites').map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties, dataset: f.properties?.dataset || String(f.source).replace('ds-', '') } }) as Feature),
      });
    });

    m.on('dblclick', (e) => {
      if (P.current.drawMode) {
        e.preventDefault();
        finishDraw();
      }
    });

    let t: any;
    m.on('moveend', () => {
      clearTimeout(t);
      t = setTimeout(refreshData, 250);
    });

    const onKey = (e: KeyboardEvent) => {
      if (!P.current.drawMode) return;
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'Enter') finishDraw();
      if (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) {
        verts.current.pop();
        renderDraw();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- helpers ----------
  function interactiveLayers() {
    const m = map.current!;
    return ['sites-fill', 'sourcing-pt', ...OVERLAY_INTERACTIVE].filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
  }

  function setData(src: string, data: any) {
    (map.current?.getSource(src) as GeoJSONSource | undefined)?.setData(data);
  }

  function pushStatus(id: string, s: LayerStatus) {
    status.current = { ...status.current, [id]: s };
    P.current.onStatus(status.current);
  }

  async function refreshData() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const z = m.getZoom();
    const b = m.getBounds();
    const pad = 0.25;
    const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
    const dx = (e - w) * pad, dy = (n - s) * pad;
    const view = [w, s, e, n];
    const want = [w - dx, s - dy, e + dx, n + dy];
    for (const d of DATASETS) {
      const on = P.current.enabled.includes(d.id);
      if (!on) {
        if (status.current[d.id]?.state !== 'off') pushStatus(d.id, { state: 'off' });
        continue;
      }
      if (z < d.minZoom) {
        aborts.current[d.id]?.abort();
        setData('ds-' + d.id, EMPTY);
        delete fetched.current[d.id];
        pushStatus(d.id, { state: 'zoom' });
        continue;
      }
      const prev = fetched.current[d.id];
      if (prev && contains(prev.bbox, view) && Math.abs(prev.zoom - z) < 3) continue;
      aborts.current[d.id]?.abort();
      const ac = new AbortController();
      aborts.current[d.id] = ac;
      pushStatus(d.id, { state: 'loading', count: status.current[d.id]?.count });
      fetchEntities({ datasets: [d.id], wkt: bboxWKT(want[0], want[1], want[2], want[3]), limit: 500, signal: ac.signal })
        .then((fc) => {
          setData('ds-' + d.id, fc);
          fetched.current[d.id] = { bbox: want, zoom: z };
          pushStatus(d.id, { state: 'ok', count: fc.features.length });
        })
        .catch((err) => {
          if (err.name !== 'AbortError') pushStatus(d.id, { state: 'error' });
        });
    }
  }

  function renderDraw() {
    const mode = P.current.drawMode;
    const v = verts.current;
    const pts = cursor.current && mode ? [...v, cursor.current] : v;
    const feats: Feature[] = v.map((c) => turf.point(c));
    let text = '';
    if (mode === 'polygon') {
      if (pts.length >= 3) {
        const poly = turf.polygon([[...pts, pts[0]]]);
        feats.push(poly);
        const a = turf.area(poly);
        text = `${(a / 10000).toFixed(3)} ha · ${(a / 4046.86).toFixed(2)} acres · ${Math.round(a * 10.7639).toLocaleString()} sq ft`;
      } else if (pts.length === 2) feats.push(turf.lineString(pts));
      if (!text) text = v.length ? 'Keep clicking to add corners' : 'Click on the map to start drawing your site';
    } else if (mode === 'measure') {
      if (pts.length >= 2) {
        const line = turf.lineString(pts);
        feats.push(line);
        const km = turf.length(line, { units: 'kilometers' });
        text = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
        text += ` · ${(km * 0.621371).toFixed(2)} miles`;
      } else text = 'Click to start measuring';
    }
    setData('draw', { type: 'FeatureCollection', features: feats });
    P.current.onDrawProgress(text);
  }

  function finishDraw() {
    const mode = P.current.drawMode;
    // dblclick also fires two clicks; drop the duplicated last vertex
    const v = verts.current.filter((c, i, a) => i === 0 || turf.distance(c, a[i - 1], { units: 'meters' }) > 0.5);
    if (mode === 'polygon' && v.length >= 3) {
      P.current.onDrawComplete({ type: 'Polygon', coordinates: [[...v, v[0]]] }, mode);
    } else if (mode === 'measure' && v.length >= 2) {
      P.current.onDrawComplete({ type: 'LineString', coordinates: v }, mode);
    }
    verts.current = [];
    cursor.current = null;
    setData('draw', EMPTY);
  }

  function syncAll() {
    if (!loaded.current) return;
    syncBasemap();
    syncLayers();
    syncSites();
    syncSelection();
    syncHighlight();
    syncPlots();
    syncPending();
    setData('sourcing', P.current.sourcing ?? EMPTY);
  }

  function syncBasemap() {
    const m = map.current!;
    for (const b of BASEMAPS) m.setLayoutProperty('bm-' + b.id, 'visibility', b.id === P.current.basemap ? 'visible' : 'none');
    m.setLayoutProperty('bm-labels', 'visibility', P.current.basemap === 'satellite' ? 'visible' : 'none');
  }

  function syncLayers() {
    const m = map.current!;
    const op = P.current.opacity;
    for (const d of DATASETS) {
      const vis = P.current.enabled.includes(d.id) ? 'visible' : 'none';
      for (const suf of ['-fill', '-line', '-pt', '-ptfill']) if (m.getLayer(`ds-${d.id}${suf}`)) m.setLayoutProperty(`ds-${d.id}${suf}`, 'visibility', vis);
      if (m.getLayer(`ds-${d.id}-line`)) m.setPaintProperty(`ds-${d.id}-line`, 'line-opacity', op);
      if (m.getLayer(`ds-${d.id}-pt`)) m.setPaintProperty(`ds-${d.id}-pt`, 'circle-opacity', op);
    }
    refreshData();
  }

  function syncSites() {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: P.current.sites.map((s) => ({ type: 'Feature', geometry: s.geometry, properties: { id: s.id, name: s.name, stage: s.stage, color: STAGE_COLORS[s.stage] } })),
    };
    setData('sites', fc);
    map.current!.setFilter('sites-selected', ['==', ['get', 'id'], P.current.selectedSiteId || '']);
  }

  function syncSelection() {
    const g = P.current.selection;
    const m = map.current!;
    marker.current?.remove();
    marker.current = null;
    if (g?.type === 'Point') {
      const div = document.createElement('div');
      div.appendChild(document.createElement('div')).className = 'pulse-marker';
      marker.current = new maplibregl.Marker({ element: div }).setLngLat(g.coordinates as [number, number]).addTo(m);
      setData('selection', EMPTY);
    } else {
      setData('selection', g ? { type: 'Feature', geometry: g, properties: {} } : EMPTY);
    }
    animateSelection(!!g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
  }

  function syncPlots() {
    const m = map.current!;
    if (!m.getLayer('plots')) return;
    m.setLayoutProperty('plots', 'visibility', P.current.showPlots ? 'visible' : 'none');
    // Outlines are dark lines; brighten them to white on dark backgrounds
    const darkBg = P.current.basemap === 'satellite' || P.current.basemap === 'dark';
    m.setPaintProperty('plots', 'raster-brightness-min', darkBg ? 1 : 0);
    m.setPaintProperty('plots', 'raster-opacity', darkBg ? 0.85 : 0.7);
  }

  function syncPending() {
    pendingMarker.current?.remove();
    pendingMarker.current = null;
    const p = P.current.pending;
    if (!p) return;
    const div = document.createElement('div');
    div.appendChild(document.createElement('div')).className = 'seek-marker';
    pendingMarker.current = new maplibregl.Marker({ element: div }).setLngLat(p).addTo(map.current!);
  }

  /** "Marching ants" on the selected plot outline. */
  function animateSelection(on: boolean) {
    cancelAnimationFrame(anim.current);
    if (!on) return;
    let step = 0, last = 0;
    const tick = (t: number) => {
      if (t - last > 70) {
        last = t;
        step = (step + 1) % DASH.length;
        if (map.current?.getLayer('selection-line')) map.current.setPaintProperty('selection-line', 'line-dasharray', DASH[step]);
      }
      anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  }

  function syncHighlight() {
    setData('highlight', P.current.highlight ?? EMPTY);
  }

  // ---------- prop sync ----------
  useEffect(() => { if (loaded.current) { syncBasemap(); syncPlots(); } }, [props.basemap]);
  useEffect(() => { if (loaded.current) syncPlots(); }, [props.showPlots]);
  useEffect(() => { if (loaded.current) syncPending(); }, [props.pending?.join(',')]);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  useEffect(() => { if (loaded.current) syncLayers(); }, [props.enabled.join(','), props.opacity]);
  useEffect(() => { if (loaded.current) syncSites(); }, [props.sites, props.selectedSiteId]);
  useEffect(() => { if (loaded.current) syncSelection(); }, [props.selection]);
  useEffect(() => { if (loaded.current) syncHighlight(); }, [props.highlight]);
  useEffect(() => { if (loaded.current) setData('sourcing', props.sourcing ?? EMPTY); }, [props.sourcing]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    verts.current = [];
    cursor.current = null;
    if (props.drawMode) {
      m.doubleClickZoom.disable();
      m.getCanvas().style.cursor = 'crosshair';
      renderDraw();
    } else {
      m.doubleClickZoom.enable();
      m.getCanvas().style.cursor = '';
      if (loaded.current) setData('draw', EMPTY);
    }
  }, [props.drawMode]);

  return <div ref={el} className="map" />;
}

const SEL = '#4f46e5';
// dash patterns that shift along the line, giving a "marching ants" effect
const DASH: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

function contains(outer: number[], inner: number[]) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
