import { useEffect, useMemo, useState } from 'react';
import * as turf from '@turf/turf';
import type { Feature, Geometry, Polygon, MultiPolygon } from 'geojson';
import { CONSTRAINT_IDS, DATASET_BY_ID, SEVERITY_WEIGHT, Severity } from '../lib/datasets';
import { entityUrl, fetchEntities, nearestPostcodes, PostcodeInfo, pricePaid, prop, Sale, squareAround } from '../lib/api';
import { ago, download, gbp, num, Site, siteStore, STAGES, STAGE_COLORS, Stage } from '../lib/store';
import { Icon } from './Icon';
import { PolicyTab } from './PolicyTab';

export type Selection =
  | { kind: 'point'; lng: number; lat: number }
  | { kind: 'area'; geometry: Polygon | MultiPolygon; siteId?: string };

interface Props {
  selection: Selection;
  site?: Site;
  onClose: () => void;
  onDrawBoundary: () => void;
  onAppraise: (siteId: string) => void;
  onSaved: (s: Site) => void;
  onAsk: (q: string) => void;
  onHighlight: (f: Feature | null) => void;
  onFly: (g: Geometry) => void;
  toast: (t: string) => void;
}

interface Hit { dataset: string; features: Feature[]; coverage?: number }

export function ReportPanel({ selection, site, onClose, onDrawBoundary, onAppraise, onSaved, onAsk, onHighlight, onFly, toast }: Props) {
  const geom: Geometry = selection.kind === 'area' ? selection.geometry : { type: 'Point', coordinates: [selection.lng, selection.lat] };
  const center = useMemo(() => turf.centroid(geom as any).geometry.coordinates, [JSON.stringify(geom)]);
  const areaM2 = selection.kind === 'area' ? turf.area(selection.geometry) : 0;
  const perimeter = selection.kind === 'area' ? turf.length(turf.polygonToLine(selection.geometry as any) as any, { units: 'meters' }) : 0;

  const [hits, setHits] = useState<Hit[] | null>(null);
  const [lpa, setLpa] = useState<string>();
  const [err, setErr] = useState<string>();
  const [pc, setPc] = useState<PostcodeInfo | null>(null);
  const [tab, setTab] = useState<'overview' | 'policy' | 'comps' | 'notes'>('overview');

  const key = JSON.stringify(geom);
  useEffect(() => {
    const ac = new AbortController();
    setHits(null);
    setErr(undefined);
    setPc(null);
    setLpa(undefined);
    const queryGeom = selection.kind === 'point' ? squareAround(selection.lng, selection.lat, 30) : selection.geometry;
    fetchEntities({ datasets: [...CONSTRAINT_IDS, 'local-authority-district'], geometry: queryGeom, limit: 500, signal: ac.signal })
      .then((fc) => {
        const by: Record<string, Feature[]> = {};
        for (const f of fc.features) {
          const ds = prop(f, 'dataset');
          (by[ds] ||= []).push(f);
        }
        setLpa(by['local-authority-district']?.map((f) => prop(f, 'name')).join(' / '));
        delete by['local-authority-district'];
        const list: Hit[] = Object.entries(by).map(([dataset, features]) => {
          let coverage: number | undefined;
          if (selection.kind === 'area' && areaM2 > 0 && features.some((f) => f.geometry.type.includes('Polygon'))) {
            try {
              const polys = features.filter((f) => f.geometry.type.includes('Polygon')) as Feature<Polygon | MultiPolygon>[];
              const u = polys.length > 1 ? turf.union(turf.featureCollection(polys)) : polys[0];
              const inter = u && turf.intersect(turf.featureCollection([turf.feature(selection.geometry), u as any]));
              coverage = inter ? Math.min(1, turf.area(inter) / areaM2) : 0;
            } catch {
              coverage = undefined;
            }
          }
          return { dataset, features, coverage };
        });
        const order: Severity[] = ['high', 'medium', 'low', 'info'];
        list.sort((a, b) => order.indexOf(DATASET_BY_ID[a.dataset]?.severity ?? 'info') - order.indexOf(DATASET_BY_ID[b.dataset]?.severity ?? 'info'));
        setHits(list);
      })
      .catch((e) => e.name !== 'AbortError' && setErr('Could not reach planning.data.gov.uk — check your connection.'));
    nearestPostcodes(center[0], center[1], 1, 1500)
      .then((r) => setPc(r[0] || null))
      .catch(() => setPc(null));
    return () => ac.abort();
  }, [key]);

  const score = useMemo(() => {
    if (!hits) return null;
    let s = 100;
    for (const h of hits) {
      const d = DATASET_BY_ID[h.dataset];
      if (!d) continue;
      const w = SEVERITY_WEIGHT[d.severity];
      s -= h.coverage != null ? w * Math.max(0.35, h.coverage) : w;
      if (d.id === 'brownfield-land') s += 8;
    }
    return Math.round(Math.max(0, Math.min(100, s)));
  }, [hits]);

  // keep saved site's summary fresh
  useEffect(() => {
    if (!site || score == null || !hits) return;
    const constraints = hits.filter((h) => DATASET_BY_ID[h.dataset]?.severity !== 'info').map((h) => DATASET_BY_ID[h.dataset]?.name || h.dataset);
    const district = lpa || pc?.admin_district;
    if (site.score !== score || JSON.stringify(site.constraints) !== JSON.stringify(constraints) || site.district !== district) {
      siteStore.update(site.id, { score, constraints, district, address: site.address || pc?.postcode });
    }
  }, [score, site?.id, lpa, pc]);

  const save = () => {
    if (selection.kind !== 'area') return;
    const s = siteStore.add({
      name: pc ? `Land near ${pc.postcode}` : `Site ${new Date().toLocaleDateString('en-GB')}`,
      geometry: selection.geometry,
      areaHa: areaM2 / 10000,
      address: pc?.postcode,
      district: lpa || pc?.admin_district,
      score: score ?? undefined,
    });
    toast(`Saved "${s.name}" to your pipeline`);
    onSaved(s);
    return s;
  };

  const scoreLabel = score == null ? '' : score >= 80 ? 'Low constraint' : score >= 55 ? 'Some constraints' : 'Heavily constrained';
  const scoreColor = score == null ? 'var(--muted)' : score >= 80 ? 'var(--good)' : score >= 55 ? 'var(--warn)' : 'var(--bad)';
  const [lng, lat] = center;
  const title = site?.name || (selection.kind === 'area' ? 'Drawn site' : pc?.postcode ? `Near ${pc.postcode}` : 'Location');

  return (
    <div className="panel-body report">
      <div className="report-head">
        {site ? (
          <input className="title-input" value={site.name} onChange={(e) => siteStore.update(site.id, { name: e.target.value })} />
        ) : (
          <h2>{title}</h2>
        )}
        <p className="muted">
          {[pc?.admin_ward, lpa || pc?.admin_district].filter(Boolean).join(' · ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        </p>
        {site && (
          <div className="stage-row">
            {STAGES.map((st) => (
              <button key={st} className={'stage-pill' + (site.stage === st ? ' on' : '')} style={{ '--c': STAGE_COLORS[st] } as any} onClick={() => siteStore.update(site.id, { stage: st as Stage }, `Moved to ${st}`)}>
                {st}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat score" style={{ '--c': scoreColor } as any}>
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.5" className="track" />
            <circle cx="18" cy="18" r="15.5" className="bar" strokeDasharray={`${((score ?? 0) / 100) * 97.4} 97.4`} />
          </svg>
          <b>{score ?? '–'}</b>
          <span>{scoreLabel || 'Scoring…'}</span>
        </div>
        {selection.kind === 'area' ? (
          <>
            <div className="stat"><b>{num(areaM2 / 10000, 2)} ha</b><span>{num(areaM2 / 4046.86, 2)} acres</span></div>
            <div className="stat"><b>{num(perimeter)} m</b><span>perimeter</span></div>
          </>
        ) : (
          <div className="stat wide"><b>{hits ? hits.length : '–'}</b><span>designations at this point</span></div>
        )}
      </div>

      <div className="actions">
        {selection.kind === 'area' && !site && <button className="btn primary" onClick={save}><Icon name="plus" size={16} />Save to pipeline</button>}
        {selection.kind === 'point' && <button className="btn primary" onClick={onDrawBoundary}><Icon name="draw" size={16} />Draw site boundary</button>}
        {selection.kind === 'area' && (
          <button className="btn" onClick={() => onAppraise((site || save())!.id)}><Icon name="calc" size={16} />Appraise</button>
        )}
        <button className="btn ai" onClick={() => onAsk('Give me a planning and deliverability assessment of this site: constraints, the national and local policies that apply, likely capacity, and the key risks and next steps.')}><Icon name="spark" size={16} />Assess with AI</button>
        <a className="btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`}><Icon name="globe" size={16} />Street View</a>
        <button className="btn ghost" onClick={() => window.print()} title="Print / save as PDF"><Icon name="print" size={16} /></button>
        {selection.kind === 'area' && (
          <button className="btn ghost" title="Export boundary as GeoJSON" onClick={() => download(`${(site?.name || 'site').replace(/\W+/g, '-')}.geojson`, JSON.stringify(turf.feature(selection.geometry, { name: site?.name, areaHa: areaM2 / 10000 })))}>
            <Icon name="download" size={16} />
          </button>
        )}
      </div>

      <div className="tabs">
        {(['overview', 'policy', 'comps', 'notes'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Constraints' : t === 'policy' ? 'Policy' : t === 'comps' ? 'Sold prices' : 'Notes'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <section>
            <h4>Planning constraints</h4>
            {err && <div className="callout bad">{err}</div>}
            {!hits && !err && <Skeleton rows={4} />}
            {hits && hits.length === 0 && <div className="callout good"><Icon name="check" size={16} /> No designations found on the national planning data platform.</div>}
            {hits?.map((h) => {
              const d = DATASET_BY_ID[h.dataset];
              return (
                <details key={h.dataset} className={'constraint sev-' + (d?.severity || 'info')}>
                  <summary>
                    <span className="dot" style={{ background: d?.color }} />
                    <span className="c-name">
                      {d?.name || h.dataset}
                      <small>{d?.severity === 'info' ? 'Information' : `${d?.severity} impact`} · {h.features.length} record{h.features.length > 1 ? 's' : ''}</small>
                    </span>
                    {h.coverage != null && (
                      <span className="coverage" title="Share of site covered">
                        <i style={{ width: `${Math.max(3, h.coverage * 100)}%`, background: d?.color }} />
                        <em>{Math.round(h.coverage * 100)}%</em>
                      </span>
                    )}
                    <Icon name="chevron" size={14} />
                  </summary>
                  <p className="muted small">{d?.desc}</p>
                  <ul>
                    {h.features.slice(0, 25).map((f, i) => (
                      <li key={i} onMouseEnter={() => onHighlight(f)} onMouseLeave={() => onHighlight(null)}>
                        <button className="link" onClick={() => onFly(f.geometry)}>{prop(f, 'name') || prop(f, 'site-address') || prop(f, 'reference') || 'Unnamed'}</button>
                        {prop(f, 'listed-building-grade') && <span className="tag">Grade {prop(f, 'listed-building-grade')}</span>}
                        {prop(f, 'flood-risk-level') && <span className="tag">Zone {prop(f, 'flood-risk-level')}</span>}
                        {prop(f, 'hectares') && <span className="tag">{prop(f, 'hectares')} ha</span>}
                        {entityUrl(f) && <a href={entityUrl(f)} target="_blank" rel="noreferrer" title="Source record"><Icon name="external" size={13} /></a>}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </section>

          <section>
            <h4>Location</h4>
            {pc ? (
              <dl className="kv">
                <dt>Nearest postcode</dt><dd>{pc.postcode}</dd>
                <dt>Planning authority</dt><dd>{lpa || pc.admin_district}</dd>
                <dt>Ward</dt><dd>{pc.admin_ward}</dd>
                {pc.parish && <><dt>Parish</dt><dd>{pc.parish}</dd></>}
                <dt>Constituency</dt><dd>{pc.parliamentary_constituency}</dd>
                <dt>Region</dt><dd>{pc.region}</dd>
                <dt>LSOA</dt><dd>{pc.lsoa}</dd>
                <dt>Coordinates</dt><dd>{lat.toFixed(5)}, {lng.toFixed(5)}</dd>
              </dl>
            ) : (
              <Skeleton rows={3} />
            )}
          </section>

          <section>
            <h4>Research links</h4>
            <div className="links">
              {pc && <a target="_blank" rel="noreferrer" href={`https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(pc.postcode)}`}>EPC certificates <Icon name="external" size={12} /></a>}
              <a target="_blank" rel="noreferrer" href="https://search-property-information.service.gov.uk/">Land Registry title search <Icon name="external" size={12} /></a>
              <a target="_blank" rel="noreferrer" href="https://flood-map-for-planning.service.gov.uk/">EA flood map for planning <Icon name="external" size={12} /></a>
              <a target="_blank" rel="noreferrer" href={`https://www.planning.data.gov.uk/map/#${lat},${lng},17z`}>Planning data map <Icon name="external" size={12} /></a>
              <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`${lpa || pc?.admin_district || ''} council planning application search`)}`}>Council planning portal <Icon name="external" size={12} /></a>
              <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}>Google Maps <Icon name="external" size={12} /></a>
            </div>
          </section>
        </>
      )}

      {tab === 'policy' && <PolicyTab datasets={hits ? hits.map((h) => h.dataset) : err ? [] : null} lpa={lpa || pc?.admin_district} onAsk={onAsk} />}

      {tab === 'comps' && <Comparables lng={lng} lat={lat} />}

      {tab === 'notes' && (site ? <SiteNotes site={site} /> : <div className="callout">Save this site to your pipeline to add notes, owner details and track activity.</div>)}

      {site && (
        <div className="danger-zone">
          <span className="muted small">Added {ago(site.createdAt)} · updated {ago(site.updatedAt)}</span>
          <button className="btn ghost danger" onClick={() => { if (confirm(`Delete "${site.name}"?`)) { siteStore.remove(site.id); onClose(); } }}>
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return <div className="skeleton">{Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: `${60 + ((i * 37) % 40)}%` }} />)}</div>;
}

function Comparables({ lng, lat }: { lng: number; lat: number }) {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [err, setErr] = useState<string>();
  const [type, setType] = useState('All');
  const [radius, setRadius] = useState(500);

  useEffect(() => {
    let live = true;
    setSales(null);
    setErr(undefined);
    nearestPostcodes(lng, lat, 25, radius)
      .then((pcs) => {
        const codes = pcs.map((p) => p.postcode);
        // Land Registry may block browser requests (CORS): fall back to the Plotscope API server
        return pricePaid(codes).catch(() =>
          fetch(`/api/price-paid?postcodes=${encodeURIComponent(codes.join(','))}`).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.json() as Promise<Sale[]>;
          }),
        );
      })
      .then((s) => live && setSales(s))
      .catch(() => live && setErr('Could not load Land Registry price paid data.'));
    return () => { live = false; };
  }, [lng, lat, radius]);

  const types = ['All', ...Array.from(new Set((sales || []).map((s) => s.type).filter(Boolean)))];
  const list = (sales || []).filter((s) => type === 'All' || s.type === type);
  const prices = list.map((s) => s.price).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const nb = list.filter((s) => s.newBuild);
  const nbAvg = nb.length ? nb.reduce((a, s) => a + s.price, 0) / nb.length : 0;

  // simple yearly trend
  const byYear: Record<string, number[]> = {};
  list.forEach((s) => (byYear[s.date.slice(0, 4)] ||= []).push(s.price));
  const years = Object.keys(byYear).sort();
  const yMax = Math.max(1, ...years.map((y) => byYear[y].reduce((a, b) => a + b, 0) / byYear[y].length));

  return (
    <section>
      <div className="row-between">
        <h4>Sold prices nearby (last 5 years)</h4>
        <select className="input sm" value={radius} onChange={(e) => setRadius(+e.target.value)}>
          <option value={250}>250 m</option>
          <option value={500}>500 m</option>
          <option value={1000}>1 km</option>
          <option value={2000}>2 km</option>
        </select>
      </div>
      {err && <div className="callout bad">{err}</div>}
      {!sales && !err && <Skeleton rows={5} />}
      {sales && (
        <>
          <div className="chips">
            {types.map((t) => <button key={t} className={'chip' + (t === type ? ' on' : '')} onClick={() => setType(t)}>{t}</button>)}
          </div>
          <div className="stats three">
            <div className="stat"><b>{gbp(median, true)}</b><span>median</span></div>
            <div className="stat"><b>{gbp(avg, true)}</b><span>average</span></div>
            <div className="stat"><b>{nb.length ? gbp(nbAvg, true) : '–'}</b><span>new build avg ({nb.length})</span></div>
          </div>
          {years.length > 1 && (
            <div className="bars" role="img" aria-label="Average sold price by year">
              {years.map((y) => {
                const v = byYear[y].reduce((a, b) => a + b, 0) / byYear[y].length;
                return (
                  <div key={y} title={`${y}: ${gbp(v)} (${byYear[y].length} sales)`}>
                    <i style={{ height: `${(v / yMax) * 100}%` }} />
                    <span>{y.slice(2)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <table className="table">
            <thead><tr><th>Address</th><th>Type</th><th className="r">Price</th></tr></thead>
            <tbody>
              {list.slice(0, 60).map((s, i) => (
                <tr key={i}>
                  <td>{s.address}<small>{s.postcode} · {new Date(s.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}{s.newBuild ? ' · New build' : ''}</small></td>
                  <td>{s.type}<small>{s.tenure}</small></td>
                  <td className="r">{gbp(s.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="muted">No sales recorded in this radius.</p>}
          <p className="fineprint">HM Land Registry Price Paid Data, Open Government Licence.</p>
        </>
      )}
    </section>
  );
}

function SiteNotes({ site }: { site: Site }) {
  const [entry, setEntry] = useState('');
  const [tags, setTags] = useState(site.tags.join(', '));
  useEffect(() => setTags(site.tags.join(', ')), [site.id]);
  return (
    <section className="notes">
      <div className="grid2">
        <label>Owner / contact<input className="input" value={site.owner || ''} onChange={(e) => siteStore.update(site.id, { owner: e.target.value })} placeholder="e.g. J. Smith, 07…" /></label>
        <label>Asking / guide price<input className="input" type="number" value={site.askingPrice ?? ''} onChange={(e) => siteStore.update(site.id, { askingPrice: e.target.value ? +e.target.value : undefined })} placeholder="£" /></label>
      </div>
      <label>Tags<input className="input" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => siteStore.update(site.id, { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="e.g. infill, off-market, 10+ units" /></label>
      <label>Notes<textarea className="input" rows={5} value={site.notes} onChange={(e) => siteStore.update(site.id, { notes: e.target.value })} placeholder="Access, ownership, planning history…" /></label>
      <h4>Activity</h4>
      <form className="log-form" onSubmit={(e) => { e.preventDefault(); if (entry.trim()) { siteStore.update(site.id, {}, entry.trim()); setEntry(''); } }}>
        <input className="input" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Log a call, letter, viewing…" />
        <button className="btn">Log</button>
      </form>
      <ul className="activity">
        {site.activity.map((a, i) => <li key={i}><span>{a.text}</span><small>{ago(a.at)}</small></li>)}
      </ul>
    </section>
  );
}
