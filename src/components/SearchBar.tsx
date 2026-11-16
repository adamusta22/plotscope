import { forwardRef, useEffect, useRef, useState } from 'react';
import { geocode, Place } from '../lib/api';
import { Site } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  sites: Site[];
  onPlace: (p: Place) => void;
  onSite: (s: Site) => void;
}

type Row = { kind: 'site'; site: Site } | { kind: 'place'; place: Place };

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar({ sites, onPlace, onSite }, ref) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController>();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      return;
    }
    const local: Row[] = sites
      .filter((s) => [s.name, s.address, s.district, ...s.tags].join(' ').toLowerCase().includes(term.toLowerCase()))
      .slice(0, 4)
      .map((site) => ({ kind: 'site', site }));
    setRows(local);
    const t = setTimeout(async () => {
      ac.current?.abort();
      ac.current = new AbortController();
      setBusy(true);
      try {
        const places = await geocode(term, ac.current.signal);
        setRows([...local, ...places.map((place) => ({ kind: 'place' as const, place }))]);
        setActive(0);
      } catch {
        /* aborted / offline */
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, sites]);

  const pick = (r: Row) => {
    setOpen(false);
    if (r.kind === 'site') {
      setQ(r.site.name);
      onSite(r.site);
    } else {
      setQ(r.place.label);
      onPlace(r.place);
    }
    (document.activeElement as HTMLElement)?.blur();
  };

  return (
    <div className={'search' + (open && rows.length ? ' open' : '')}>
      <Icon name="search" size={17} />
      <input
        ref={ref}
        value={q}
        placeholder="Search postcode, address, place, coordinates or your sites…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, rows.length - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter' && rows[active]) pick(rows[active]);
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {busy ? <span className="spinner" /> : q ? <button className="icon-btn ghost" onClick={() => setQ('')} aria-label="Clear"><Icon name="x" size={15} /></button> : <kbd>/</kbd>}
      {open && rows.length > 0 && (
        <ul className="search-results">
          {rows.map((r, i) => (
            <li key={i} className={i === active ? 'active' : ''} onMouseDown={() => pick(r)} onMouseEnter={() => setActive(i)}>
              <Icon name={r.kind === 'site' ? 'board' : 'pin'} size={16} />
              <div>
                <b>{r.kind === 'site' ? r.site.name : r.place.label}</b>
                <span>{r.kind === 'site' ? `Your pipeline · ${r.site.stage}` : r.place.sub}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
