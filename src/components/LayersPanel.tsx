import { useState } from 'react';
import { BASEMAPS, BasemapId, DATASETS } from '../lib/datasets';
import type { LayerStatus } from './MapView';

interface Props {
  enabled: string[];
  setEnabled: (ids: string[]) => void;
  status: Record<string, LayerStatus>;
  opacity: number;
  setOpacity: (n: number) => void;
  basemap: BasemapId;
  setBasemap: (b: BasemapId) => void;
}

const PRESETS: { name: string; ids: string[] }[] = [
  { name: 'Key constraints', ids: ['green-belt', 'flood-risk-zone', 'conservation-area', 'site-of-special-scientific-interest', 'area-of-outstanding-natural-beauty'] },
  { name: 'Heritage', ids: ['conservation-area', 'listed-building', 'scheduled-monument', 'world-heritage-site', 'park-and-garden'] },
  { name: 'Ecology', ids: ['site-of-special-scientific-interest', 'ancient-woodland', 'special-area-of-conservation', 'special-protection-area', 'ramsar', 'local-nature-reserve'] },
  { name: 'Opportunities', ids: ['brownfield-land', 'planning-application', 'local-authority-district'] },
];

export function LayersPanel({ enabled, setEnabled, status, opacity, setOpacity, basemap, setBasemap }: Props) {
  const [filter, setFilter] = useState('');
  const groups = Array.from(new Set(DATASETS.map((d) => d.group)));
  const toggle = (id: string) => setEnabled(enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id]);

  return (
    <div className="panel-body">
      <section>
        <h4>Base map</h4>
        <div className="basemaps">
          {BASEMAPS.map((b) => (
            <button key={b.id} className={'bm bm-' + b.id + (b.id === basemap ? ' on' : '')} onClick={() => setBasemap(b.id)}>
              <span />
              {b.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>Quick presets</h4>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => setEnabled(Array.from(new Set([...enabled, ...p.ids])))}>
              + {p.name}
            </button>
          ))}
          {enabled.length > 0 && <button className="chip danger" onClick={() => setEnabled([])}>Clear all</button>}
        </div>
      </section>

      <section>
        <div className="row-between">
          <h4>Data layers</h4>
          <label className="opacity">
            Opacity
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
          </label>
        </div>
        <input className="input" placeholder="Filter layers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {groups.map((g) => {
          const items = DATASETS.filter((d) => d.group === g && d.name.toLowerCase().includes(filter.toLowerCase()));
          if (!items.length) return null;
          return (
            <div key={g} className="layer-group">
              <h5>{g}</h5>
              {items.map((d) => {
                const on = enabled.includes(d.id);
                const s = status[d.id];
                return (
                  <label key={d.id} className={'layer' + (on ? ' on' : '')} title={d.desc}>
                    <input type="checkbox" checked={on} onChange={() => toggle(d.id)} />
                    <span className={'swatch ' + d.kind} style={{ '--c': d.color } as any} />
                    <span className="layer-name">
                      {d.name}
                      <small>{d.desc}</small>
                    </span>
                    {on && (
                      <span className={'layer-status ' + (s?.state || '')}>
                        {s?.state === 'loading' ? <span className="spinner sm" /> : s?.state === 'zoom' ? 'zoom in' : s?.state === 'error' ? 'offline' : s?.count != null ? (s.count >= 500 ? '500+' : s.count) : ''}
                      </span>
                    )}
                    <span className={'toggle' + (on ? ' on' : '')} />
                  </label>
                );
              })}
            </div>
          );
        })}
      </section>
      <p className="fineprint">
        Constraint data: planning.data.gov.uk (England), Open Government Licence. Layers load for the area in view; some only appear when zoomed in.
      </p>
    </div>
  );
}
