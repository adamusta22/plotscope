import { useEffect, useState } from 'react';
import { NPPF, topicsForDatasets } from '../lib/policy';
import { localPlanFor, LocalPlanResult, PlanDocument } from '../lib/localplan';
import { Icon } from './Icon';

interface Props {
  datasets: string[] | null;
  lpa?: string;
  onAsk: (q: string) => void;
}

const KIND_LABEL: Record<PlanDocument['kind'], string> = {
  'local-plan': 'Local plan',
  spd: 'SPD',
  neighbourhood: 'Neighbourhood plan',
  evidence: 'Evidence base',
  other: 'Other',
};

export function PolicyTab({ datasets, lpa, onAsk }: Props) {
  const [plan, setPlan] = useState<LocalPlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!lpa) return;
    const ac = new AbortController();
    setLoading(true);
    setPlan(null);
    localPlanFor(lpa, ac.signal)
      .then(async (r) => {
        // fall back to the server (if running) when the browser call was blocked
        if (r.note?.includes('could not be reached')) {
          const s = await fetch(`/api/local-plan?lpa=${encodeURIComponent(lpa)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (s && !s.note?.includes('could not be reached')) return s;
        }
        return r;
      })
      .then(setPlan)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [lpa]);

  const topics = datasets ? topicsForDatasets(datasets) : [];
  const docs = plan?.documents || [];
  const shown = showAll ? docs : docs.filter((d) => d.kind === 'local-plan' || d.kind === 'spd' || d.kind === 'neighbourhood').slice(0, 12);

  return (
    <>
      <section>
        <div className="row-between">
          <h4>National policy (NPPF 2026)</h4>
          <a className="small" href={NPPF.url} target="_blank" rel="noreferrer">Full text <Icon name="external" size={11} /></a>
        </div>
        <p className="muted small">Policies that apply to this site based on its designations. Decision-making policies in the 2026 Framework apply directly to applications from {NPPF.published}.</p>
        {!datasets && <div className="skeleton"><i /><i /><i /></div>}
        {topics.map((t) => (
          <details key={t.id} className="policy">
            <summary>
              <Icon name="book" size={15} />
              <span>{t.title}</span>
              {t.triggers.some((d) => datasets?.includes(d)) && <span className="tag warn">On this site</span>}
              <Icon name="chevron" size={14} />
            </summary>
            <p>{t.summary}</p>
            <h6>Key tests</h6>
            <ul>{t.tests.map((x) => <li key={x}>{x}</li>)}</ul>
            <h6>Evidence usually needed</h6>
            <ul>{t.evidence.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="policy-links">
              {t.guidance?.map((g) => <a key={g.url} href={g.url} target="_blank" rel="noreferrer">{g.label} <Icon name="external" size={11} /></a>)}
              <button className="link" onClick={() => onAsk(`For this site, explain how the NPPF policy on "${t.title}" applies and quote the exact current policy wording with its code from gov.uk.`)}>Ask the assistant →</button>
            </div>
          </details>
        ))}
      </section>

      <section>
        <h4>Local plan &amp; SPDs{lpa ? ` · ${lpa}` : ''}</h4>
        {!lpa && <p className="muted small">Waiting for the planning authority…</p>}
        {loading && <div className="skeleton"><i /><i /><i /></div>}
        {plan && (
          <>
            {plan.plans.map((p) => (
              <div key={p.name} className="plan-card">
                <b>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}</b>
                <span className="muted small">{[p.period, p.status].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
            {shown.length > 0 && (
              <ul className="docs">
                {shown.map((d, i) => (
                  <li key={i}>
                    <span className={'tag kind-' + d.kind}>{KIND_LABEL[d.kind]}</span>
                    {d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.name}</a> : <span>{d.name}</span>}
                  </li>
                ))}
              </ul>
            )}
            {docs.length > shown.length && <button className="link small" onClick={() => setShowAll(true)}>Show all {docs.length} documents (incl. evidence base)</button>}
            {plan.note && <p className="muted small">{plan.note}</p>}
            <div className="links" style={{ marginTop: 10 }}>
              {plan.searchLinks.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{cap(l.label.replace(`${lpa} `, ''))} <Icon name="external" size={12} /></a>)}
            </div>
          </>
        )}
        {lpa && (
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => onAsk(`Find ${lpa}'s adopted local plan, policies map and the SPDs relevant to this site, then summarise the local policies that would apply to residential development here, with policy references and links.`)}>
            <Icon name="spark" size={15} /> Have the assistant read the local plan for this site
          </button>
        )}
      </section>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
