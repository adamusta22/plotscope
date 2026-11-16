// Local plan and supplementary planning document (SPD) discovery.
// Uses the national planning data platform's development plan datasets
// (`development-plan`, `development-plan-document`), joined to councils via
// their organisation entity. Coverage depends on what each council has
// published there, so we always return search links as a fallback.

const PD = 'https://www.planning.data.gov.uk';

export interface PlanDocument {
  name: string;
  url?: string;
  types: string[];
  date?: string;
  plan?: string;
  kind: 'local-plan' | 'spd' | 'neighbourhood' | 'evidence' | 'other';
  source: string;
}

export interface LocalPlanResult {
  lpa: string;
  organisation?: { entity: number; name: string };
  documents: PlanDocument[];
  plans: { name: string; url?: string; period?: string; status?: string }[];
  searchLinks: { label: string; url: string }[];
  note?: string;
}

let orgCache: Promise<any[]> | null = null;

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(the|council|borough|district|city|metropolitan|county|royal|of|london|unitary|authority)\b/g, '')
    .replace(/[^a-z]/g, '');
}

async function organisations(): Promise<any[]> {
  if (!orgCache) {
    orgCache = Promise.all(
      ['local-authority', 'national-park-authority', 'development-corporation'].map((ds) =>
        fetch(`${PD}/entity.json?dataset=${ds}&limit=500`)
          .then((r) => (r.ok ? r.json() : { entities: [] }))
          .then((j) => j.entities || [])
          .catch(() => []),
      ),
    ).then((a) => a.flat());
    orgCache.then((x) => { if (!x.length) orgCache = null; });
  }
  return orgCache;
}

export async function findOrganisation(lpaName: string) {
  const orgs = await organisations();
  const n = norm(lpaName);
  if (!n) return undefined;
  const exact = orgs.find((o) => norm(o.name || '') === n);
  const loose = exact || orgs.find((o) => norm(o.name || '').includes(n) || n.includes(norm(o.name || '')));
  return loose ? { entity: Number(loose.entity), name: String(loose.name) } : undefined;
}

function classify(name: string, types: string[]): PlanDocument['kind'] {
  const t = (types.join(' ') + ' ' + name).toLowerCase();
  if (/supplementary|\bspd\b|design guide|design code/.test(t)) return 'spd';
  if (/neighbourhood/.test(t)) return 'neighbourhood';
  if (/local.?plan|core strategy|site allocations|development plan|policies map|area action plan/.test(t)) return 'local-plan';
  if (/assessment|study|evidence|shlaa|hela|sfra|viability|monitoring|five.year|housing land/.test(t)) return 'evidence';
  return 'other';
}

const listify = (v: any): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,]/) : []).map((s: string) => s.trim()).filter(Boolean);

export async function localPlanFor(lpaName: string, signal?: AbortSignal): Promise<LocalPlanResult> {
  const q = encodeURIComponent(lpaName);
  const searchLinks = [
    { label: `${lpaName} local plan`, url: `https://www.google.com/search?q=${q}+local+plan+adopted` },
    { label: `${lpaName} supplementary planning documents (SPDs)`, url: `https://www.google.com/search?q=${q}+supplementary+planning+documents` },
    { label: `${lpaName} policies map`, url: `https://www.google.com/search?q=${q}+local+plan+policies+map` },
    { label: `${lpaName} housing land supply statement`, url: `https://www.google.com/search?q=${q}+five+year+housing+land+supply+statement` },
    { label: `${lpaName} CIL charging schedule`, url: `https://www.google.com/search?q=${q}+CIL+charging+schedule` },
  ];
  const out: LocalPlanResult = { lpa: lpaName, documents: [], plans: [], searchLinks };
  try {
    const org = await findOrganisation(lpaName);
    if (!org) {
      out.note = 'Could not match this council on the national planning data platform.';
      return out;
    }
    out.organisation = org;
    const p = new URLSearchParams({ organisation_entity: String(org.entity), limit: '500' });
    p.append('dataset', 'development-plan');
    p.append('dataset', 'development-plan-document');
    const r = await fetch(`${PD}/entity.json?${p}`, { signal });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const ents: any[] = j.entities || [];
    for (const e of ents) {
      if (e.dataset === 'development-plan') {
        out.plans.push({
          name: e.name || e.reference,
          url: e['documentation-url'] || e['document-url'],
          period: [e['period-start-date'], e['period-end-date']].filter(Boolean).map((d: string) => d.slice(0, 4)).join('–') || undefined,
          status: e['adopted-date'] ? `Adopted ${String(e['adopted-date']).slice(0, 10)}` : e['development-plan-type'] || undefined,
        });
      } else {
        const types = listify(e['document-types'] || e['document-type']);
        const name = e.name || e.reference || 'Document';
        out.documents.push({ name, url: e['document-url'] || e['documentation-url'], types, date: e['start-date'] || e['entry-date'], plan: e['development-plan'], kind: classify(name, types), source: `${PD}/entity/${e.entity}` });
      }
    }
    const order = { 'local-plan': 0, spd: 1, neighbourhood: 2, evidence: 3, other: 4 };
    out.documents.sort((a, b) => order[a.kind] - order[b.kind] || String(b.date || '').localeCompare(String(a.date || '')));
    if (!ents.length) out.note = `${org.name} hasn't published plan documents to the national platform yet — use the search links.`;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    out.note = 'The national planning data platform could not be reached.';
  }
  return out;
}
