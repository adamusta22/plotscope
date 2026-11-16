import { useMemo, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import { runAppraisal } from '../lib/appraisal';
import { DEFAULT_APPRAISAL } from '../lib/appraisal';
import { ago, download, gbp, num, Site, siteStore, STAGES, STAGE_COLORS, Stage } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  sites: Site[];
  onOpen: (s: Site) => void;
  onClose: () => void;
  toast: (t: string) => void;
}

export function PipelineBoard({ sites, onOpen, onClose, toast }: Props) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const t = q.toLowerCase();
    return sites.filter((s) => !t || [s.name, s.address, s.district, s.owner, s.notes, ...s.tags].join(' ').toLowerCase().includes(t));
  }, [sites, q]);

  const live = list.filter((s) => s.stage !== 'Dead');
  const totalHa = live.reduce((a, s) => a + s.areaHa, 0);
  const totalRlv = live.reduce((a, s) => a + (s.appraisal ? runAppraisal({ ...DEFAULT_APPRAISAL, ...s.appraisal }).rlv : 0), 0);

  const exportGeo = () =>
    download('plotscope-pipeline.geojson', JSON.stringify(turf.featureCollection(sites.map((s) => turf.feature(s.geometry as any, { ...s, geometry: undefined })))));
  const exportCsv = () => {
    const cols: (keyof Site)[] = ['name', 'stage', 'address', 'district', 'areaHa', 'score', 'owner', 'askingPrice', 'tags', 'notes'];
    const csv = [[...cols, 'lng', 'lat'], ...sites.map((s) => [...cols.map((c) => (Array.isArray(s[c]) ? (s[c] as any).join('; ') : s[c] ?? '')), ...turf.centroid(s.geometry as any).geometry.coordinates])]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    download('plotscope-pipeline.csv', csv, 'text/csv');
  };
  const importFile = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [];
      let n = 0;
      for (const ft of feats) {
        if (!ft.geometry || !String(ft.geometry.type).includes('Polygon')) continue;
        const p = ft.properties || {};
        siteStore.add({ name: p.name || p.title || `Imported site ${n + 1}`, geometry: ft.geometry, areaHa: turf.area(ft) / 10000, stage: STAGES.includes(p.stage) ? p.stage : 'Prospect', tags: p.tags || [], notes: p.notes || '', owner: p.owner, askingPrice: p.askingPrice, appraisal: p.appraisal, address: p.address, district: p.district });
        n++;
      }
      toast(`Imported ${n} site${n === 1 ? '' : 's'}`);
    } catch {
      toast('That file is not valid GeoJSON');
    }
  };

  return (
    <div className="board-overlay">
      <header className="board-head">
        <div>
          <h2>Pipeline</h2>
          <p className="muted">{live.length} active sites · {num(totalHa, 1)} ha · {totalRlv ? `${gbp(totalRlv, true)} appraised land value` : 'no appraisals yet'}</p>
        </div>
        <div className="row">
          <input className="input" placeholder="Search sites, owners, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg sm">
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
          <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Import GeoJSON"><Icon name="upload" size={16} /></button>
          <input ref={fileRef} type="file" accept=".geojson,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button className="btn ghost" onClick={exportCsv} title="Export CSV">CSV</button>
          <button className="btn ghost" onClick={exportGeo} title="Export GeoJSON">GeoJSON</button>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
      </header>

      {sites.length === 0 ? (
        <div className="empty">
          <Icon name="draw" size={36} />
          <h3>No sites yet</h3>
          <p>Draw a boundary on the map (press <kbd>D</kbd>) or add sites from the Source tool to start building your pipeline.</p>
          <button className="btn primary" onClick={onClose}>Back to map</button>
        </div>
      ) : view === 'board' ? (
        <div className="board">
          {STAGES.map((st) => {
            const col = list.filter((s) => s.stage === st);
            return (
              <div
                key={st}
                className={'col' + (over === st ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOver(st); }}
                onDragLeave={() => setOver(null)}
                onDrop={() => {
                  if (drag) siteStore.update(drag, { stage: st }, `Moved to ${st}`);
                  setDrag(null);
                  setOver(null);
                }}
              >
                <h3 style={{ '--c': STAGE_COLORS[st] } as any}>
                  {st}<span>{col.length}</span>
                </h3>
                <div className="col-meta">{num(col.reduce((a, s) => a + s.areaHa, 0), 1)} ha</div>
                {col.map((s) => (
                  <article key={s.id} className={'card' + (drag === s.id ? ' dragging' : '')} draggable onDragStart={() => setDrag(s.id)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(s)}>
                    <MiniShape site={s} />
                    <div className="card-body">
                      <b>{s.name}</b>
                      <span>{[s.district, `${num(s.areaHa, 2)} ha`].filter(Boolean).join(' · ')}</span>
                      <div className="card-foot">
                        {s.score != null && <span className={'score-pill ' + (s.score >= 80 ? 'good' : s.score >= 55 ? 'warn' : 'bad')}>{s.score}</span>}
                        {s.appraisal && <span className="tag">{gbp(runAppraisal({ ...DEFAULT_APPRAISAL, ...s.appraisal }).rlv, true)}</span>}
                        {s.tags.filter((t) => !t.startsWith('bf:')).slice(0, 2).map((t) => <span key={t} className="tag">{t}</span>)}
                        <small>{ago(s.updatedAt)}</small>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Site</th><th>Stage</th><th>Authority</th><th className="r">Area</th><th className="r">Score</th><th>Constraints</th><th>Owner</th><th className="r">Updated</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} onClick={() => onOpen(s)} className="clickable">
                  <td><b>{s.name}</b><small>{s.address}</small></td>
                  <td><span className="stage-dot" style={{ background: STAGE_COLORS[s.stage] }} />{s.stage}</td>
                  <td>{s.district}</td>
                  <td className="r">{num(s.areaHa, 2)} ha</td>
                  <td className="r">{s.score ?? '–'}</td>
                  <td>{(s.constraints || []).join(', ') || '–'}</td>
                  <td>{s.owner}</td>
                  <td className="r">{ago(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniShape({ site }: { site: Site }) {
  const d = useMemo(() => {
    try {
      const [w, s, e, n] = turf.bbox(site.geometry as any);
      const sc = 40 / Math.max(e - w, (n - s) * 1.6, 1e-9);
      const polys = site.geometry.type === 'Polygon' ? [(site.geometry as any).coordinates] : (site.geometry as any).coordinates;
      return polys.map((p: number[][][]) => 'M' + p[0].map(([x, y]) => `${((x - w) * sc + (44 - (e - w) * sc) / 2).toFixed(1)},${((n - y) * sc * 1.6 + (44 - (n - s) * sc * 1.6) / 2).toFixed(1)}`).join('L') + 'Z').join('');
    } catch {
      return '';
    }
  }, [site.geometry]);
  return (
    <svg className="mini" viewBox="0 0 44 44" style={{ '--c': STAGE_COLORS[site.stage] } as any}>
      <path d={d} />
    </svg>
  );
}
