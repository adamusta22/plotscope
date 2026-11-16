import { useCallback, useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import type { Map as MLMap } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { MapView, DrawMode, LayerStatus, MapClick } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { LayersPanel } from './components/LayersPanel';
import { ReportPanel, Selection } from './components/ReportPanel';
import { SourcingPanel } from './components/SourcingPanel';
import { AppraisalPanel } from './components/AppraisalPanel';
import { PipelineBoard } from './components/PipelineBoard';
import { Icon } from './components/Icon';
import { BasemapId } from './lib/datasets';
import { Place, squareAround } from './lib/api';
import { Site, usePref, useSites } from './lib/store';

export const APP_NAME = 'Plotscope';

type Panel = 'layers' | 'report' | 'source' | 'appraise' | null;

export default function App() {
  const sites = useSites();
  const [map, setMap] = useState<MLMap | null>(null);
  const [panel, setPanel] = useState<Panel>('layers');
  const [board, setBoard] = useState(false);
  const [basemap, setBasemap] = usePref<BasemapId>('basemap', 'streets');
  const [enabled, setEnabled] = usePref<string[]>('layers', ['green-belt', 'conservation-area', 'flood-risk-zone']);
  const [opacity, setOpacity] = usePref('opacity', 0.9);
  const [status, setStatus] = useState<Record<string, LayerStatus>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [measure, setMeasure] = useState<Geometry | null>(null);
  const [highlight, setHighlight] = useState<Feature | null>(null);
  const [sourcing, setSourcing] = useState<FeatureCollection | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawText, setDrawText] = useState('');
  const [appraiseId, setAppraiseId] = useState<string>();
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(6);
  useEffect(() => {
    if (!map) return;
    const f = () => setZoom(map.getZoom());
    f();
    map.on('zoomend', f);
    return () => { map.off('zoomend', f); };
  }, [map]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const selectedSite = selection?.kind === 'area' && selection.siteId ? sites.find((s) => s.id === selection.siteId) : undefined;

  // if a selected saved site is deleted, close the report
  useEffect(() => {
    if (selection?.kind === 'area' && selection.siteId && !selectedSite) setSelection(null);
  }, [selectedSite, selection]);

  const fly = useCallback(
    (g: Geometry, maxZoom = 17) => {
      if (!map) return;
      const pad = { top: 90, bottom: 60, left: panel ? 470 : 90, right: 90 };
      if (g.type === 'Point') map.flyTo({ center: g.coordinates as [number, number], zoom: Math.max(map.getZoom(), 16), speed: 1.4, curve: 1.5, padding: pad, essential: true });
      else map.fitBounds(turf.bbox(g as any) as [number, number, number, number], { padding: pad, maxZoom, duration: 1400, essential: true });
    },
    [map, panel],
  );

  const openSite = useCallback(
    (s: Site) => {
      setBoard(false);
      setSelection({ kind: 'area', geometry: s.geometry as Polygon, siteId: s.id });
      setPanel('report');
      fly(s.geometry);
    },
    [fly],
  );

  const onPlace = (p: Place) => {
    if (!map) return;
    if (p.bbox && p.bbox[2] - p.bbox[0] > 0.01) map.fitBounds(p.bbox, { padding: 60, duration: 1600, maxZoom: 16 });
    else map.flyTo({ center: [p.lng, p.lat], zoom: 17, speed: 1.4, curve: 1.6 });
    setSelection({ kind: 'point', lng: p.lng, lat: p.lat });
    setPanel('report');
  };

  const onMapClick = (c: MapClick) => {
    setMeasure(null);
    if (c.siteId) {
      const s = sites.find((x) => x.id === c.siteId);
      if (s) return openSite(s);
    }
    setSelection({ kind: 'point', lng: c.lng, lat: c.lat });
    setPanel('report');
  };

  const onDrawComplete = (g: Geometry, mode: DrawMode) => {
    setDrawMode(null);
    if (mode === 'polygon') {
      setSelection({ kind: 'area', geometry: g as Polygon });
      setPanel('report');
    } else {
      setMeasure(g);
      toast(`Measured ${drawText.split(' · ')[0]}`);
    }
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === '/') { searchRef.current?.focus(); e.preventDefault(); }
      else if (k === 'escape') { if (drawMode) setDrawMode(null); else if (help) setHelp(false); else if (board) setBoard(false); else { setSelection(null); setMeasure(null); } }
      else if (k === 'd') setDrawMode((m) => (m === 'polygon' ? null : 'polygon'));
      else if (k === 'm') setDrawMode((m) => (m === 'measure' ? null : 'measure'));
      else if (k === 'l') setPanel((p) => (p === 'layers' ? null : 'layers'));
      else if (k === 's') setPanel((p) => (p === 'source' ? null : 'source'));
      else if (k === 'a') setPanel((p) => (p === 'appraise' ? null : 'appraise'));
      else if (k === 'p') setBoard((b) => !b);
      else if (k === 'b') {
        const order: BasemapId[] = ['streets', 'satellite', 'light', 'dark', 'osm'];
        setBasemap(order[(order.indexOf(basemap) + 1) % order.length]);
      } else if (k === '?') setHelp((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, help, board, basemap]);

  const selGeom: Geometry | null = measure || (selection ? (selection.kind === 'point' ? { type: 'Point', coordinates: [selection.lng, selection.lat] } : selectedSite ? null : selection.geometry) : null);

  const NAV: { id: Exclude<Panel, null> | 'pipeline'; icon: string; label: string; key: string }[] = [
    { id: 'layers', icon: 'layers', label: 'Layers', key: 'L' },
    { id: 'report', icon: 'report', label: 'Site report', key: '' },
    { id: 'source', icon: 'target', label: 'Source land', key: 'S' },
    { id: 'appraise', icon: 'calc', label: 'Appraisal', key: 'A' },
    { id: 'pipeline', icon: 'board', label: 'Pipeline', key: 'P' },
  ];

  const titles: Record<Exclude<Panel, null>, string> = { layers: 'Map layers', report: 'Site report', source: 'Source land', appraise: 'Development appraisal' };

  return (
    <div className={'app' + (panel ? ' has-panel' : '')}>
      <nav className="rail">
        <div className="logo" title={APP_NAME}>
          <svg viewBox="0 0 32 32" width="30" height="30"><rect width="32" height="32" rx="9" fill="var(--accent)" /><path d="M8 22 13 9l6 4 5 9z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" /><circle cx="13" cy="9" r="2.2" fill="#fff" /></svg>
        </div>
        {NAV.map((n) => {
          const on = n.id === 'pipeline' ? board : panel === n.id && !board;
          return (
            <button
              key={n.id}
              className={'rail-btn' + (on ? ' on' : '')}
              onClick={() => (n.id === 'pipeline' ? setBoard(!board) : (setBoard(false), setPanel(panel === n.id ? null : n.id)))}
              title={n.label + (n.key ? ` (${n.key})` : '')}
            >
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
              {n.id === 'pipeline' && sites.length > 0 && <em className="badge">{sites.length}</em>}
            </button>
          );
        })}
        <div className="rail-spacer" />
        <button className="rail-btn" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)"><Icon name="keyboard" size={20} /><span>Keys</span></button>
      </nav>

      <aside className={'panel' + (panel ? ' open' : '')} aria-hidden={!panel}>
        {panel && (
          <>
            <header className="panel-head">
              <h3>{titles[panel]}</h3>
              <button className="icon-btn ghost" onClick={() => setPanel(null)} aria-label="Close panel"><Icon name="x" /></button>
            </header>
            {panel === 'layers' && <LayersPanel enabled={enabled} setEnabled={setEnabled} status={status} opacity={opacity} setOpacity={setOpacity} basemap={basemap} setBasemap={setBasemap} />}
            {panel === 'report' &&
              (selection ? (
                <ReportPanel
                  key={selection.kind === 'area' ? JSON.stringify(selection.geometry).slice(0, 120) : `${selection.lng},${selection.lat}`}
                  selection={selection}
                  site={selectedSite}
                  onClose={() => setSelection(null)}
                  onDrawBoundary={() => setDrawMode('polygon')}
                  onAppraise={(id) => { setAppraiseId(id); setPanel('appraise'); }}
                  onSaved={(s) => setSelection({ kind: 'area', geometry: s.geometry as Polygon, siteId: s.id })}
                  onHighlight={setHighlight}
                  onFly={(g) => fly(g)}
                  toast={toast}
                />
              ) : (
                <div className="panel-body empty-state">
                  <Icon name="pin" size={34} />
                  <h3>Pick a location</h3>
                  <p>Click anywhere on the map, search an address, or <button className="link" onClick={() => setDrawMode('polygon')}>draw a site boundary</button> to get an instant constraints report, location data and sold prices.</p>
                </div>
              ))}
            {panel === 'source' && (
              <SourcingPanel
                map={map}
                sites={sites}
                results={sourcing}
                setResults={setSourcing}
                onHighlight={setHighlight}
                toast={toast}
                onOpen={(f) => {
                  const raw = (f as any)._geom;
                  const [lng, lat] = (f.geometry as any).coordinates;
                  setSelection(raw?.type?.includes('Polygon') ? { kind: 'area', geometry: raw } : { kind: 'point', lng, lat });
                  setPanel('report');
                  fly(raw || squareAround(lng, lat, 60));
                }}
              />
            )}
            {panel === 'appraise' && <AppraisalPanel sites={sites} siteId={appraiseId} setSiteId={setAppraiseId} toast={toast} />}
          </>
        )}
      </aside>

      <main className="stage">
        <MapView
          basemap={basemap}
          enabled={enabled}
          opacity={opacity}
          sites={sites}
          selectedSiteId={selectedSite?.id}
          selection={selGeom}
          highlight={highlight}
          sourcing={sourcing}
          drawMode={drawMode}
          onDrawProgress={setDrawText}
          onDrawComplete={onDrawComplete}
          onClick={onMapClick}
          onStatus={setStatus}
          onReady={setMap}
        />

        <div className="topbar">
          <SearchBar ref={searchRef} sites={sites} onPlace={onPlace} onSite={openSite} />
        </div>

        <div className="toolbox">
          <button className={'tool' + (drawMode === 'polygon' ? ' on' : '')} onClick={() => setDrawMode(drawMode === 'polygon' ? null : 'polygon')} title="Draw site (D)"><Icon name="draw" /><span>Draw</span></button>
          <button className={'tool' + (drawMode === 'measure' ? ' on' : '')} onClick={() => setDrawMode(drawMode === 'measure' ? null : 'measure')} title="Measure (M)"><Icon name="ruler" /><span>Measure</span></button>
          <button className={'tool' + (basemap === 'satellite' ? ' on' : '')} onClick={() => setBasemap(basemap === 'satellite' ? 'streets' : 'satellite')} title="Toggle satellite (B cycles)"><Icon name="globe" /><span>Satellite</span></button>
          <button className="tool" onClick={() => map?.easeTo({ pitch: map.getPitch() > 10 ? 0 : 55, bearing: map.getPitch() > 10 ? 0 : -20, duration: 900 })} title="Tilt view"><Icon name="map" /><span>Tilt</span></button>
        </div>

        {drawMode && (
          <div className="draw-hint">
            <span className="pulse-dot" />
            <b>{drawText}</b>
            <span className="muted">{drawMode === 'polygon' ? 'Double-click or Enter to finish' : 'Double-click to finish'} · Backspace undo · Esc cancel</span>
            <button className="btn sm" onClick={() => setDrawMode(null)}>Cancel</button>
          </div>
        )}

        {map && zoom < 7 && !selection && !drawMode && (
          <div className="welcome">
            <h1>Find your next site.</h1>
            <p>Search a place, click the map for an instant constraints report, draw a boundary with <kbd>D</kbd>, or use <b>Source land</b> to scan brownfield registers.</p>
          </div>
        )}

        <div className="toasts">
          {toasts.map((t) => <div key={t.id} className="toast"><Icon name="check" size={16} />{t.text}</div>)}
        </div>
      </main>

      {board && <PipelineBoard sites={sites} onOpen={openSite} onClose={() => setBoard(false)} toast={toast} />}

      {help && (
        <div className="modal-bg" onClick={() => setHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <dl className="keys">
              {[['/', 'Search'], ['D', 'Draw a site boundary'], ['M', 'Measure distance'], ['L', 'Layers'], ['S', 'Source land'], ['A', 'Appraisal'], ['P', 'Pipeline board'], ['B', 'Cycle base map'], ['Enter', 'Finish drawing'], ['Backspace', 'Undo last point'], ['Esc', 'Cancel / close'], ['?', 'This help']].map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
            <p className="muted small">Hold right-click (or Ctrl + drag) to rotate and tilt the map.</p>
          </div>
        </div>
      )}
    </div>
  );
}
