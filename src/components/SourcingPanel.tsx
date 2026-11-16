import { useMemo, useState } from 'react';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import type { Map as MLMap } from 'maplibre-gl';
import { bboxWKT, fetchEntities, prop } from '../lib/api';
import { download, num, Site, siteStore } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  map: MLMap | null;
  sites: Site[];
  results: FeatureCollection | null;
  setResults: (fc: FeatureCollection | null) => void;
  onOpen: (f: Feature) => void;
  onHighlight: (f: Feature | null) => void;
  toast: (t: string) => void;
}

const PERMISSION = ['Any', 'Permissioned', 'Not permissioned'] as const;
const OWNERSHIP = ['Any', 'Private', 'Public authority', 'Mixed / unknown'] as const;

export function SourcingPanel({ map, sites, results, setResults, onOpen, onHighlight, toast }: Props) {
  const [minHa, setMinHa] = useState(0.1);
  const [maxHa, setMaxHa] = useState(5);
  const [minUnits, setMinUnits] = useState(0);
  const [perm, setPerm] = useState<(typeof PERMISSION)[number]>('Any');
  const [own, setOwn] = useState<(typeof OWNERSHIP)[number]>('Any');
  const [hideSaved, setHideSaved] = useState(true);
  const [sort, setSort] = useState<'size' | 'units' | 'name'>('size');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [truncated, setTruncated] = useState(false);

  const run = async () => {
    if (!map) return;
    if (map.getZoom() < 9) {
      setErr('Zoom in to a town or district (zoom 9+) to search.');
      return;
    }
    const b = map.getBounds();
    setBusy(true);
    setErr(undefined);
    try {
      const all: Feature[] = [];
      for (let offset = 0; offset < 2000; offset += 500) {
        const fc = await fetchEntities({ datasets: ['brownfield-land'], wkt: bboxWKT(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()), limit: 500, offset });
        all.push(...fc.features);
        if (fc.features.length < 500) break;
      }
      setTruncated(all.length >= 2000);
      // normalise to points for the results layer
      const pts = all.map((f) => (f.geometry.type === 'Point' ? f : { ...turf.centroid(f as any), properties: f.properties, _geom: f.geometry } as Feature));
      setResults({ type: 'FeatureCollection', features: pts });
    } catch {
      setErr('Could not reach the national brownfield register.');
    } finally {
      setBusy(false);
    }
  };

  const savedRefs = useMemo(() => new Set(sites.flatMap((s) => s.tags.filter((t) => t.startsWith('bf:')))), [sites]);

  const filtered = useMemo(() => {
    if (!results) return [];
    return results.features
      .filter((f) => {
        const ha = +prop(f, 'hectares') || 0;
        const maxU = +prop(f, 'maximum-net-dwellings') || +prop(f, 'minimum-net-dwellings') || 0;
        const ps = String(prop(f, 'planning-permission-status') || '').toLowerCase();
        const os = String(prop(f, 'ownership-status') || '').toLowerCase();
        if (ha < minHa || ha > maxHa) return false;
        if (maxU < minUnits) return false;
        if (perm === 'Permissioned' && !ps.includes('permissioned') ) return false;
        if (perm === 'Permissioned' && ps.includes('not')) return false;
        if (perm === 'Not permissioned' && !ps.includes('not')) return false;
        if (own === 'Private' && !os.includes('not owned by a public')) return false;
        if (own === 'Public authority' && !(os.includes('owned by a public') && !os.includes('not'))) return false;
        if (own === 'Mixed / unknown' && !(os.includes('mixed') || os.includes('unknown') || !os)) return false;
        if (hideSaved && savedRefs.has('bf:' + prop(f, 'entity'))) return false;
        return true;
      })
      .sort((a, b) =>
        sort === 'size' ? (+prop(b, 'hectares') || 0) - (+prop(a, 'hectares') || 0)
        : sort === 'units' ? (+prop(b, 'maximum-net-dwellings') || 0) - (+prop(a, 'maximum-net-dwellings') || 0)
        : String(prop(a, 'name') || '').localeCompare(String(prop(b, 'name') || '')),
      );
  }, [results, minHa, maxHa, minUnits, perm, own, hideSaved, sort, savedRefs]);

  const saveSite = (f: Feature) => {
    const ha = +prop(f, 'hectares') || 0.1;
    const raw = (f as any)._geom;
    const [lng, lat] = (f.geometry as any).coordinates;
    // brownfield registers mostly publish points: approximate a square of the stated area
    const geometry = raw && raw.type.includes('Polygon') ? raw : turf.bboxPolygon(turf.bbox(turf.buffer(turf.point([lng, lat]), Math.sqrt(ha * 10000) / 2, { units: 'meters', steps: 1 }) as any)).geometry;
    siteStore.add({
      name: prop(f, 'site-address') || prop(f, 'name') || 'Brownfield site',
      geometry,
      areaHa: ha,
      tags: ['brownfield', 'bf:' + prop(f, 'entity')],
      notes: [
        `Brownfield register ref: ${prop(f, 'reference') || '–'}`,
        `Planning status: ${prop(f, 'planning-permission-status') || '–'}`,
        `Ownership: ${prop(f, 'ownership-status') || '–'}`,
        `Net dwellings: ${prop(f, 'minimum-net-dwellings') || '?'}–${prop(f, 'maximum-net-dwellings') || '?'}`,
        raw ? '' : 'Boundary approximated from register area — redraw for accuracy.',
      ].filter(Boolean).join('\n'),
    });
    toast('Added to pipeline');
  };

  const exportCsv = () => {
    const cols = ['name', 'site-address', 'hectares', 'minimum-net-dwellings', 'maximum-net-dwellings', 'planning-permission-status', 'ownership-status', 'reference'];
    const rows = filtered.map((f) => [...cols.map((c) => prop(f, c) ?? ''), ...(f.geometry as any).coordinates]);
    const csv = [[...cols, 'longitude', 'latitude'], ...rows].map((r) => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download('brownfield-opportunities.csv', csv, 'text/csv');
  };

  return (
    <div className="panel-body">
      <p className="muted">
        Find development land in the area on screen. Searches every council's brownfield land register — sites already judged suitable for housing — then filters by your criteria.
      </p>
      <section className="filters">
        <div className="grid2">
          <label>Min size (ha)<input className="input" type="number" step="0.05" min={0} value={minHa} onChange={(e) => setMinHa(+e.target.value)} /></label>
          <label>Max size (ha)<input className="input" type="number" step="0.5" min={0} value={maxHa} onChange={(e) => setMaxHa(+e.target.value)} /></label>
          <label>Min dwellings<input className="input" type="number" min={0} value={minUnits} onChange={(e) => setMinUnits(+e.target.value)} /></label>
          <label>Sort by
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="size">Largest first</option>
              <option value="units">Most dwellings</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        <label>Planning permission</label>
        <div className="seg">{PERMISSION.map((p) => <button key={p} className={perm === p ? 'on' : ''} onClick={() => setPerm(p)}>{p}</button>)}</div>
        <label>Ownership</label>
        <div className="seg">{OWNERSHIP.map((p) => <button key={p} className={own === p ? 'on' : ''} onClick={() => setOwn(p)}>{p}</button>)}</div>
        <label className="check"><input type="checkbox" checked={hideSaved} onChange={(e) => setHideSaved(e.target.checked)} /> Hide sites already in my pipeline</label>
        <button className="btn primary block" onClick={run} disabled={busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="target" size={16} />} Search this map area
        </button>
      </section>

      {err && <div className="callout bad">{err}</div>}

      {results && (
        <section>
          <div className="row-between">
            <h4>{filtered.length} of {results.features.length}{truncated ? '+' : ''} sites match</h4>
            <div className="row">
              {filtered.length > 0 && <button className="btn ghost sm" onClick={exportCsv}><Icon name="download" size={14} /> CSV</button>}
              <button className="btn ghost sm" onClick={() => setResults(null)}>Clear</button>
            </div>
          </div>
          <ul className="results">
            {filtered.slice(0, 200).map((f, i) => {
              const ha = +prop(f, 'hectares') || 0;
              const ps = String(prop(f, 'planning-permission-status') || 'Unknown status');
              const minU = prop(f, 'minimum-net-dwellings'), maxU = prop(f, 'maximum-net-dwellings');
              return (
                <li key={i} onMouseEnter={() => onHighlight(f)} onMouseLeave={() => onHighlight(null)}>
                  <button className="result-main" onClick={() => onOpen(f)}>
                    <b>{prop(f, 'site-address') || prop(f, 'name') || 'Unnamed site'}</b>
                    <span>
                      {num(ha, 2)} ha · {num(ha * 2.471, 2)} ac
                      {(minU || maxU) && <> · {minU && maxU && minU !== maxU ? `${minU}–${maxU}` : maxU || minU} homes</>}
                    </span>
                    <span className={'tag ' + (ps.toLowerCase().includes('not') ? '' : 'good')}>{ps}</span>
                  </button>
                  <button className="icon-btn" title="Add to pipeline" onClick={() => saveSite(f)}><Icon name="plus" size={16} /></button>
                </li>
              );
            })}
          </ul>
          {filtered.length > 200 && <p className="muted small">Showing first 200 — tighten filters or zoom in.</p>}
        </section>
      )}
    </div>
  );
}
