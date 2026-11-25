import { useEffect, useRef, useState } from 'react';
import { buildDossier, Dossier, DossierInput } from '../lib/dossier';
import { dossierHtml } from '../lib/dossierHtml';
import { download } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  input: DossierInput;
  onClose: () => void;
  onAsk: (q: string) => void;
}

const STEPS = ['Planning constraints', 'Heritage setting & planning history', 'Location', 'Buildings & streets', 'Local services & transport', 'Sold prices', 'Local plan & SPDs'];

export function DossierView({ input, onClose, onAsk }: Props) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    setDossier(null);
    setSteps({});
    buildDossier(input, (step, done) => live && setSteps((s) => ({ ...s, [step]: done })))
      .then((d) => live && setDossier(d))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const html = dossier ? dossierHtml(dossier, { standalone: true }) : '';
  const fileName = dossier ? `${dossier.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'site'}-dossier.html` : '';
  const done = STEPS.filter((s) => steps[s]).length;

  return (
    <div className="dossier-overlay" role="dialog" aria-label="Site dossier">
      <header className="dossier-bar">
        <div className="dossier-title">
          <Icon name="report" size={18} />
          <div>
            <b>{dossier?.name || 'Building site dossier…'}</b>
            <span>{dossier ? 'Everything about this plot in one place' : `${done} of ${STEPS.length} data sources gathered`}</span>
          </div>
        </div>
        <div className="row">
          {dossier && (
            <>
              <button className="btn ai" onClick={() => onAsk(`Using the site dossier for "${dossier.name}", write me a planning and development appraisal: the opportunity, the key planning risks with the policies behind them, a realistic scheme, and the next steps.`)}>
                <Icon name="spark" size={15} /> Ask AI about it
              </button>
              <button className="btn" onClick={() => frame.current?.contentWindow?.print()} title="Print or save as PDF"><Icon name="print" size={15} /> PDF</button>
              <button className="btn" onClick={() => download(fileName, html, 'text/html')} title="Download as an HTML file"><Icon name="download" size={15} /> HTML</button>
            </>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close dossier"><Icon name="x" /></button>
        </div>
      </header>
      {dossier ? (
        <iframe ref={frame} className="dossier-frame" title="Site dossier" srcDoc={html} />
      ) : (
        <div className="dossier-loading">
          {error ? (
            <div className="callout bad">{error}</div>
          ) : (
            <>
              <div className="dl-progress"><i style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
              <ul>
                {STEPS.map((s) => (
                  <li key={s} className={steps[s] ? 'done' : s in steps ? 'busy' : ''}>
                    {steps[s] ? <Icon name="check" size={14} /> : s in steps ? <span className="spinner sm" /> : <span className="pending-dot" />}
                    {s}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
