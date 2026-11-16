import { useEffect, useMemo, useState } from 'react';
import { Appraisal, gbp, num, Site, siteStore } from '../lib/store';
import { DEFAULT_APPRAISAL, runAppraisal } from '../lib/appraisal';

interface Props {
  sites: Site[];
  siteId?: string;
  setSiteId: (id?: string) => void;
  toast: (t: string) => void;
}

const FIELDS: { key: keyof Appraisal; label: string; unit: string; step: number }[] = [
  { key: 'units', label: 'Number of homes', unit: '', step: 1 },
  { key: 'avgSize', label: 'Average home size', unit: 'm²', step: 5 },
  { key: 'salePsf', label: 'Sales value', unit: '£/ft²', step: 10 },
  { key: 'buildPsm', label: 'Build cost', unit: '£/m²', step: 50 },
  { key: 'externalPct', label: 'Externals & infrastructure', unit: '% build', step: 1 },
  { key: 'feesPct', label: 'Professional fees', unit: '% build', step: 0.5 },
  { key: 'contingencyPct', label: 'Contingency', unit: '% build', step: 0.5 },
  { key: 's106PerUnit', label: 'S106 / CIL', unit: '£/home', step: 1000 },
  { key: 'financePct', label: 'Finance rate', unit: '% p.a.', step: 0.25 },
  { key: 'buildMonths', label: 'Build period', unit: 'months', step: 1 },
  { key: 'profitPct', label: 'Developer profit', unit: '% GDV', step: 1 },
  { key: 'affordablePct', label: 'Affordable housing', unit: '% homes', step: 5 },
  { key: 'affordableDiscountPct', label: 'Affordable discount', unit: '% off', step: 5 },
];

export function AppraisalPanel({ sites, siteId, setSiteId, toast }: Props) {
  const site = sites.find((s) => s.id === siteId);
  const [a, setA] = useState<Appraisal>({ ...DEFAULT_APPRAISAL, ...site?.appraisal });
  const [density, setDensity] = useState(35);

  useEffect(() => {
    setA({ ...DEFAULT_APPRAISAL, ...(site?.appraisal || (site ? { units: Math.max(1, Math.round(site.areaHa * 35)) } : {})) });
  }, [siteId]);

  const r = useMemo(() => runAppraisal(a), [a]);
  const set = (k: keyof Appraisal, v: number) => setA((x) => ({ ...x, [k]: isFinite(v) ? v : 0 }));

  const acres = site ? site.areaHa * 2.47105 : 0;
  const avgPrice = (a.avgSize * 10.7639 * a.salePsf);

  // sensitivity: sales value vs build cost
  const steps = [-10, -5, 0, 5, 10];
  const grid = steps.map((ds) => steps.map((dc) => runAppraisal({ ...a, salePsf: a.salePsf * (1 + ds / 100), buildPsm: a.buildPsm * (1 + dc / 100) }).rlv));
  const gMax = Math.max(...grid.flat().map(Math.abs), 1);

  const rows: [string, number, boolean?][] = [
    ['Gross development value', r.gdv, true],
    ['Build cost', -r.build],
    ['Externals', -r.external],
    ['Professional fees', -r.fees],
    ['Contingency', -r.contingency],
    ['S106 / CIL', -r.s106],
    ['Finance', -r.finance],
    ['Sales & marketing (2.5%)', -r.disposal],
    ['Developer profit', -r.profit],
    ['Residual before land costs', r.residual, true],
    ['SDLT', -r.sdlt],
    ['Acquisition fees (1.75%)', -r.acqFees],
  ];

  return (
    <div className="panel-body">
      <label>Site
        <select className="input" value={siteId || ''} onChange={(e) => setSiteId(e.target.value || undefined)}>
          <option value="">— Standalone appraisal —</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({num(s.areaHa, 2)} ha)</option>)}
        </select>
      </label>

      <div className={'rlv-card ' + (r.rlv < 0 ? 'neg' : '')}>
        <span>Residual land value</span>
        <b>{gbp(r.rlv)}</b>
        <div className="rlv-sub">
          {site && site.areaHa > 0 && <span>{gbp(r.rlv / acres, true)} / acre · {gbp(r.rlv / site.areaHa, true)} / ha</span>}
          <span>{gbp(r.rlv / Math.max(a.units, 1), true)} / plot · profit on cost {num(r.profitOnCost * 100, 1)}%</span>
        </div>
        {site?.askingPrice ? (
          <div className={'vs ' + (r.rlv >= site.askingPrice ? 'good' : 'bad')}>
            {r.rlv >= site.askingPrice ? 'Headroom' : 'Shortfall'} vs asking {gbp(site.askingPrice, true)}: {gbp(Math.abs(r.rlv - site.askingPrice), true)}
          </div>
        ) : null}
      </div>

      {site && (
        <div className="density">
          <span>Suggest homes from density</span>
          <input className="input sm" type="number" value={density} onChange={(e) => setDensity(+e.target.value)} /> dph
          <button className="btn sm" onClick={() => set('units', Math.max(1, Math.round(site.areaHa * density)))}>= {Math.max(1, Math.round(site.areaHa * density))} homes</button>
        </div>
      )}

      <section className="inputs">
        {FIELDS.map((f) => (
          <label key={f.key} className="num-field">
            <span>{f.label}</span>
            <div>
              <input className="input" type="number" step={f.step} value={a[f.key]} onChange={(e) => set(f.key, parseFloat(e.target.value))} />
              <em>{f.unit}</em>
            </div>
          </label>
        ))}
        <p className="muted small">Average sale price ≈ {gbp(avgPrice)} · {num(r.nsaSqft)} ft² saleable</p>
      </section>

      <section>
        <h4>Appraisal summary</h4>
        <table className="table money">
          <tbody>
            {rows.map(([l, v, strong]) => (
              <tr key={l} className={strong ? 'strong' : ''}><td>{l}</td><td className={'r' + (v < 0 ? ' neg' : '')}>{gbp(v)}</td></tr>
            ))}
            <tr className="total"><td>Residual land value</td><td className="r">{gbp(r.rlv)}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h4>Sensitivity: land value</h4>
        <table className="sens">
          <thead>
            <tr><th>Sales ↓ / Build →</th>{steps.map((s) => <th key={s}>{s > 0 ? '+' : ''}{s}%</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i}>
                <th>{steps[i] > 0 ? '+' : ''}{steps[i]}%</th>
                {row.map((v, j) => (
                  <td key={j} style={{ background: `color-mix(in srgb, ${v >= 0 ? 'var(--good)' : 'var(--bad)'} ${Math.round((Math.abs(v) / gMax) * 45)}%, transparent)` }} className={i === 2 && j === 2 ? 'base' : ''}>
                    {gbp(v, true)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {site ? (
        <button className="btn primary block" onClick={() => { siteStore.update(site.id, { appraisal: a }, `Appraisal saved: RLV ${gbp(r.rlv, true)}`); toast('Appraisal saved to site'); }}>
          Save appraisal to site
        </button>
      ) : (
        <p className="muted small">Pick a site from your pipeline to save this appraisal against it.</p>
      )}
      <p className="fineprint">Indicative residual appraisal for early-stage screening only. Not a RICS valuation.</p>
    </div>
  );
}
