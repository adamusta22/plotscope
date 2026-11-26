import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Geometry } from 'geojson';

export const STAGES = ['Prospect', 'Researching', 'Approached', 'Negotiating', 'Under offer', 'Acquired', 'Dead'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_COLORS: Record<Stage, string> = {
  Prospect: '#5b7fb5', Researching: '#4dabf7', Approached: '#3bc9db', Negotiating: '#fcc419',
  'Under offer': '#ff922b', Acquired: '#51cf66', Dead: '#868e96',
};

export interface Appraisal {
  units: number; avgSize: number; salePsf: number; buildPsm: number; externalPct: number; feesPct: number;
  contingencyPct: number; financePct: number; profitPct: number; affordablePct: number; affordableDiscountPct: number;
  s106PerUnit: number; buildMonths: number;
}

export interface Activity { at: number; text: string }

export interface Site {
  id: string;
  name: string;
  geometry: Geometry;
  areaHa: number;
  stage: Stage;
  tags: string[];
  notes: string;
  address?: string;
  district?: string;
  score?: number;
  constraints?: string[];
  owner?: string;
  askingPrice?: number;
  appraisal?: Partial<Appraisal>;
  activity: Activity[];
  createdAt: number;
  updatedAt: number;
}

const KEY = 'plotscope.sites.v1';
let sites: Site[] = load();
const listeners = new Set<() => void>();

function load(): Site[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(sites));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export const siteStore = {
  get: () => sites,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  add(s: Omit<Site, 'id' | 'createdAt' | 'updatedAt' | 'activity' | 'stage' | 'tags' | 'notes'> & Partial<Site>): Site {
    const now = Date.now();
    const site: Site = { stage: 'Prospect', tags: [], notes: '', ...s, id: crypto.randomUUID(), createdAt: now, updatedAt: now, activity: [{ at: now, text: 'Site created' }] };
    sites = [site, ...sites];
    persist();
    return site;
  },
  update(id: string, patch: Partial<Site>, log?: string) {
    sites = sites.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now(), activity: log ? [{ at: Date.now(), text: log }, ...s.activity] : s.activity } : s,
    );
    persist();
  },
  remove(id: string) {
    sites = sites.filter((s) => s.id !== id);
    persist();
  },
  importMany(list: Site[]) {
    const ids = new Set(sites.map((s) => s.id));
    sites = [...list.filter((s) => !ids.has(s.id)), ...sites];
    persist();
  },
};

export function useSites() {
  return useSyncExternalStore(siteStore.subscribe, siteStore.get);
}

/** Small persisted preference hook. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('plotscope.pref.' + key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('plotscope.pref.' + key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV];
}

// ---------- formatting ----------
export const gbp = (n: number, compact = false) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(n || 0);
export const num = (n: number, d = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n || 0);
export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
