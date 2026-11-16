import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { bboxWKT, fetchEntities, nearestPostcodes, pricePaid, prop, squareAround } from '../src/lib/api';
import { CONSTRAINT_IDS, DATASET_BY_ID, DATASETS } from '../src/lib/datasets';
import { NPPF, POLICY_TOPICS, TOPIC_BY_ID, topicText } from '../src/lib/policy';
import { localPlanFor } from '../src/lib/localplan';
import { runAppraisal, DEFAULT_APPRAISAL } from '../src/lib/appraisal';
import type { AgentAction, AgentContext, AgentEvent, ChatTurn } from '../src/lib/agentTypes';

const MODEL = process.env.PLOTSCOPE_MODEL || 'claude-opus-5-5';
const client = new Anthropic();

// Kept byte-stable so it caches; per-request context goes in the user turn.
const SYSTEM = `You are the planning and land-sourcing assistant inside Plotscope, a map-based platform used by UK property developers, land promoters and planning consultants.

What you do:
- Assess sites: constraints, national policy (NPPF), the council's local plan and supplementary planning documents (SPDs), housing land supply, and deliverability.
- Find opportunities: brownfield register sites, and guidance on what kinds of land are likely to get permission.
- Run quick residual land appraisals and sense-check them against nearby sold prices.
- Drive the map for the user: fly to places, open site reports, switch layers on, show sourcing results, save sites to their pipeline.

How you work:
- Use the tools for facts about a location rather than guessing. The <app_context> block tells you what the user is looking at; when they say "this site" they mean the selection or saved site in it.
- National policy: ${NPPF.title}, published ${NPPF.published}. It splits policies into plan-making and national decision-making policies; local plan policies materially inconsistent with the national decision-making policies carry very limited weight unless adopted under the 2026 Framework. Use get_nppf_guidance for the topic summaries. When the user needs exact wording, policy codes or paragraph numbers, fetch the official text from gov.uk with web search / web fetch and cite it; never invent a policy code or paragraph number.
- Local policy: use find_local_plan_documents first, then web search the council's website for the adopted local plan, policies map, and relevant SPDs (design, affordable housing, planning obligations, parking, HMOs etc.). Quote policy references exactly as the council writes them, with links.
- England only for the national datasets. Say so if a location is in Wales, Scotland or Northern Ireland.
- Be direct and practical, like an experienced planning consultant briefing a developer: lead with the conclusion, then the reasons, then what to check next. Flag uncertainty and what evidence would resolve it. This is screening advice, not a formal planning opinion.
- Format for a narrow side panel: short paragraphs, compact bullet lists, **bold** for key findings, markdown links for sources. No tables wider than 3 columns.`;

type Emit = (e: AgentEvent) => void;

function contextBlock(ctx: AgentContext) {
  return `<app_context>\n${JSON.stringify(ctx, null, 1)}\n</app_context>`;
}

export function buildTools(emit: Emit) {
  const act = (a: AgentAction) => emit({ type: 'action', action: a });
  const geomInput = z.object({
    lng: z.number().optional().describe('Longitude of a point (WGS84)'),
    lat: z.number().optional().describe('Latitude of a point (WGS84)'),
    polygon: z.array(z.array(z.array(z.number()))).optional().describe('GeoJSON Polygon coordinates [[[lng,lat],...]] for a site boundary'),
  });

  return [
    betaZodTool({
      name: 'get_site_constraints',
      description:
        'Check a point or site boundary in England against national planning designations (Green Belt, flood zones, conservation areas, listed buildings, SSSI, National Landscapes, Article 4, TPOs, brownfield register, etc). Returns each designation with record names and, for a boundary, the % of the site covered. Also returns the local planning authority.',
      inputSchema: geomInput,
      eager_input_streaming: true,
      run: async ({ lng, lat, polygon }) => {
        const geometry: Polygon = polygon ? { type: 'Polygon', coordinates: polygon } : squareAround(lng!, lat!, 30);
        if (!polygon && (lng == null || lat == null)) return 'Provide lng/lat or polygon.';
        const fc = await fetchEntities({ datasets: [...CONSTRAINT_IDS, 'local-authority-district'], geometry, limit: 500 });
        const siteArea = polygon ? turf.area(geometry) : 0;
        const by: Record<string, Feature[]> = {};
        for (const f of fc.features) (by[prop(f, 'dataset')] ||= []).push(f);
        const lpa = by['local-authority-district']?.map((f) => prop(f, 'name')).join(' / ');
        delete by['local-authority-district'];
        const lines = Object.entries(by).map(([ds, feats]) => {
          const d = DATASET_BY_ID[ds];
          let cov = '';
          if (siteArea) {
            try {
              const polys = feats.filter((f) => f.geometry.type.includes('Polygon')) as Feature<Polygon>[];
              const u = polys.length > 1 ? turf.union(turf.featureCollection(polys)) : polys[0];
              const i = u && turf.intersect(turf.featureCollection([turf.feature(geometry), u as any]));
              if (u) cov = ` — covers ${Math.round(((i ? turf.area(i) : 0) / siteArea) * 100)}% of site`;
            } catch { /* ignore */ }
          }
          const names = feats.slice(0, 8).map((f) => [prop(f, 'name') || prop(f, 'reference'), prop(f, 'listed-building-grade') && `grade ${prop(f, 'listed-building-grade')}`, prop(f, 'flood-risk-level') && `zone ${prop(f, 'flood-risk-level')}`].filter(Boolean).join(' ')).join('; ');
          return `- ${d?.name || ds} [${d?.severity || 'info'} impact] (${feats.length})${cov}: ${names}`;
        });
        return [`Local planning authority: ${lpa || 'unknown (may be outside England)'}`, siteArea ? `Site area: ${(siteArea / 10000).toFixed(3)} ha` : 'Point check (30 m radius)', lines.length ? 'Designations:' : 'No national designations found on the planning data platform.', ...lines].join('\n');
      },
    }),

    betaZodTool({
      name: 'get_location_info',
      description: 'Nearest postcode and administrative geography (ward, council, parish, constituency, region, LSOA, rural/urban) for a point.',
      inputSchema: z.object({ lng: z.number(), lat: z.number() }),
      eager_input_streaming: true,
      run: async ({ lng, lat }) => {
        const [p] = await nearestPostcodes(lng, lat, 1, 2000);
        return p ? JSON.stringify(p, null, 1) : 'No postcode within 2 km (may be outside Great Britain or offshore).';
      },
    }),

    betaZodTool({
      name: 'get_nppf_guidance',
      description: `Summaries of national planning policy (NPPF 2026) by topic, with the tests that apply and the evidence usually needed. Topics: ${POLICY_TOPICS.map((t) => t.id).join(', ')}.`,
      inputSchema: z.object({ topics: z.array(z.enum(POLICY_TOPICS.map((t) => t.id) as [string, ...string[]])).min(1) }),
      eager_input_streaming: true,
      run: async ({ topics }) => [`${NPPF.title} — ${NPPF.url}`, ...NPPF.notes.map((n) => `Note: ${n}`), '', ...topics.map((t) => topicText(TOPIC_BY_ID[t]))].join('\n\n'),
    }),

    betaZodTool({
      name: 'find_local_plan_documents',
      description:
        "List a council's development plan documents published on the national planning data platform (adopted local plans, site allocations, SPDs, neighbourhood plans, evidence base), plus search links. Coverage varies; follow up with web search on the council's own website for anything missing.",
      inputSchema: z.object({ lpa_name: z.string().describe('Local planning authority name, e.g. "Oxford" or "South Oxfordshire"') }),
      eager_input_streaming: true,
      run: async ({ lpa_name }) => {
        const r = await localPlanFor(lpa_name);
        return JSON.stringify({ ...r, documents: r.documents.slice(0, 60) }, null, 1);
      },
    }),

    betaZodTool({
      name: 'search_brownfield_sites',
      description:
        'Search council brownfield land registers inside a bounding box. Use the current map view from app_context unless the user names another area. Results are also shown on the user\'s map.',
      inputSchema: z.object({
        west: z.number(), south: z.number(), east: z.number(), north: z.number(),
        min_hectares: z.number().optional(), max_hectares: z.number().optional(),
        permission: z.enum(['any', 'permissioned', 'not_permissioned']).optional(),
        min_dwellings: z.number().optional(),
      }),
      eager_input_streaming: true,
      run: async (q) => {
        if ((q.east - q.west) * (q.north - q.south) > 4) return 'Area too large — narrow it to a district or town (under ~2° × 2°).';
        const fc = await fetchEntities({ datasets: ['brownfield-land'], wkt: bboxWKT(q.west, q.south, q.east, q.north), limit: 500 });
        const rows = fc.features
          .filter((f) => {
            const ha = +prop(f, 'hectares') || 0;
            const ps = String(prop(f, 'planning-permission-status') || '').toLowerCase();
            const units = +prop(f, 'maximum-net-dwellings') || +prop(f, 'minimum-net-dwellings') || 0;
            if (q.min_hectares != null && ha < q.min_hectares) return false;
            if (q.max_hectares != null && ha > q.max_hectares) return false;
            if (q.min_dwellings != null && units < q.min_dwellings) return false;
            if (q.permission === 'permissioned' && (ps.includes('not') || !ps.includes('permissioned'))) return false;
            if (q.permission === 'not_permissioned' && !ps.includes('not')) return false;
            return true;
          })
          .sort((a, b) => (+prop(b, 'hectares') || 0) - (+prop(a, 'hectares') || 0));
        const pts = rows.map((f) => (f.geometry.type === 'Point' ? f : ({ ...turf.centroid(f as any), properties: f.properties } as Feature)));
        act({ type: 'show_sites', features: pts, label: 'Brownfield sites found by the assistant' });
        return [`${rows.length} matching sites (of ${fc.features.length} on registers in the area)${fc.features.length >= 500 ? ' — capped at 500, narrow the area' : ''}.`, ...pts.slice(0, 40).map((f) => {
          const [lng, lat] = (f.geometry as any).coordinates;
          return `- ${prop(f, 'site-address') || prop(f, 'name')} | ${prop(f, 'hectares')} ha | ${prop(f, 'minimum-net-dwellings') || '?'}–${prop(f, 'maximum-net-dwellings') || '?'} homes | ${prop(f, 'planning-permission-status') || 'status unknown'} | ${prop(f, 'ownership-status') || ''} | ${lat.toFixed(5)},${lng.toFixed(5)}`;
        })].join('\n');
      },
    }),

    betaZodTool({
      name: 'get_sold_prices',
      description: 'HM Land Registry sold prices (last 5 years) within a radius of a point, with a summary by property type.',
      inputSchema: z.object({ lng: z.number(), lat: z.number(), radius_m: z.number().min(100).max(3000).optional() }),
      eager_input_streaming: true,
      run: async ({ lng, lat, radius_m }) => {
        const pcs = await nearestPostcodes(lng, lat, 25, radius_m ?? 600);
        const sales = await pricePaid(pcs.map((p) => p.postcode));
        if (!sales.length) return 'No recorded sales in that radius.';
        const byType: Record<string, number[]> = {};
        sales.forEach((s) => (byType[s.type || 'Other'] ||= []).push(s.price));
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
        return [
          `${sales.length} sales since ${new Date().getFullYear() - 5}. Overall median £${med(sales.map((s) => s.price)).toLocaleString('en-GB')}.`,
          ...Object.entries(byType).map(([t, a]) => `- ${t}: ${a.length} sales, median £${med(a).toLocaleString('en-GB')}`),
          `New builds: ${sales.filter((s) => s.newBuild).length}.`,
          'Latest 15:',
          ...sales.slice(0, 15).map((s) => `- ${s.date} ${s.address} ${s.postcode} (${s.type}${s.newBuild ? ', new build' : ''}) £${s.price.toLocaleString('en-GB')}`),
        ].join('\n');
      },
    }),

    betaZodTool({
      name: 'run_appraisal',
      description: 'Indicative residual land value appraisal (RLV after SDLT and acquisition costs). Unspecified inputs use defaults: ' + JSON.stringify(DEFAULT_APPRAISAL),
      inputSchema: z.object({
        units: z.number().optional(), avgSize: z.number().optional().describe('m² per home'), salePsf: z.number().optional().describe('£ per ft²'),
        buildPsm: z.number().optional().describe('£ per m²'), externalPct: z.number().optional(), feesPct: z.number().optional(), contingencyPct: z.number().optional(),
        financePct: z.number().optional(), profitPct: z.number().optional().describe('% of GDV'), affordablePct: z.number().optional(), affordableDiscountPct: z.number().optional(),
        s106PerUnit: z.number().optional(), buildMonths: z.number().optional(), site_area_ha: z.number().optional(),
      }),
      eager_input_streaming: true,
      run: async ({ site_area_ha, ...inp }) => {
        const a = { ...DEFAULT_APPRAISAL, ...Object.fromEntries(Object.entries(inp).filter(([, v]) => v != null)) };
        const r = runAppraisal(a);
        const f = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
        return [
          `Inputs: ${JSON.stringify(a)}`,
          `GDV ${f(r.gdv)} | Build ${f(r.build)} | Externals ${f(r.external)} | Fees ${f(r.fees)} | Contingency ${f(r.contingency)} | S106/CIL ${f(r.s106)} | Finance ${f(r.finance)} | Sales ${f(r.disposal)} | Profit ${f(r.profit)}`,
          `Residual land value ${f(r.rlv)} (after SDLT ${f(r.sdlt)} and acquisition fees ${f(r.acqFees)}); ${f(r.rlv / Math.max(a.units, 1))} per plot; profit on cost ${(r.profitOnCost * 100).toFixed(1)}%.`,
          site_area_ha ? `${f(r.rlv / (site_area_ha * 2.47105))} per acre; density ${(a.units / site_area_ha).toFixed(0)} dph.` : '',
        ].filter(Boolean).join('\n');
      },
    }),

    betaZodTool({
      name: 'map_action',
      description:
        "Control the user's map: fly_to a point, open_location (fly there and open the site report), or enable_layers to switch data layers on. Layer ids: " +
        DATASETS.map((d) => d.id).join(', '),
      inputSchema: z.object({
        action: z.enum(['fly_to', 'open_location', 'enable_layers']),
        lng: z.number().optional(), lat: z.number().optional(), zoom: z.number().optional(),
        layers: z.array(z.string()).optional(),
      }),
      eager_input_streaming: true,
      run: async ({ action, lng, lat, zoom, layers }) => {
        if (action === 'enable_layers') {
          const ok = (layers || []).filter((l) => DATASET_BY_ID[l]);
          act({ type: 'enable_layers', layers: ok });
          return `Enabled: ${ok.join(', ') || 'none (unknown ids)'}`;
        }
        if (lng == null || lat == null) return 'lng and lat are required.';
        act(action === 'fly_to' ? { type: 'fly_to', lng, lat, zoom } : { type: 'open_location', lng, lat });
        return 'Done.';
      },
    }),

    betaZodTool({
      name: 'save_site_to_pipeline',
      description: "Save a site boundary to the user's pipeline (Prospect stage) with notes. Only do this when the user asks you to save or add a site.",
      inputSchema: z.object({ name: z.string(), polygon: z.array(z.array(z.array(z.number()))), notes: z.string().optional() }),
      eager_input_streaming: true,
      run: async ({ name, polygon, notes }) => {
        act({ type: 'save_site', name, geometry: { type: 'Polygon', coordinates: polygon }, notes });
        return `Saved "${name}" to the pipeline.`;
      },
    }),
  ];
}

const TOOL_LABELS: Record<string, string> = {
  get_site_constraints: 'Checking planning constraints',
  get_location_info: 'Looking up location',
  get_nppf_guidance: 'Reading national policy (NPPF)',
  find_local_plan_documents: 'Finding local plan & SPDs',
  search_brownfield_sites: 'Searching brownfield registers',
  get_sold_prices: 'Pulling sold prices',
  run_appraisal: 'Running appraisal',
  map_action: 'Updating map',
  save_site_to_pipeline: 'Saving to pipeline',
  web_search: 'Searching the web',
  web_fetch: 'Reading a web page',
};

export async function runAgent(history: ChatTurn[], ctx: AgentContext, emit: Emit, signal: AbortSignal) {
  const turns = history.slice(-20);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) => ({
    role: t.role,
    content: i === turns.length - 1 && t.role === 'user' ? `${contextBlock(ctx)}\n\n${t.content}` : t.content,
  }));

  const tools = [
    ...buildTools(emit),
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 8, user_location: { type: 'approximate' as const, country: 'GB' } },
    { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: 8 },
  ];

  let runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools,
      messages,
      stream: true,
      max_iterations: 25,
    },
    { signal },
  );

  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const ev of messageStream) {
          if (ev.type === 'content_block_start') {
            const b = ev.content_block;
            if (b.type === 'tool_use' || b.type === 'server_tool_use') emit({ type: 'tool', id: b.id, label: TOOL_LABELS[b.name] || b.name });
          } else if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'text_delta') emit({ type: 'text', text: ev.delta.text });
            else if (ev.delta.type === 'thinking_delta') emit({ type: 'thinking', text: ev.delta.thinking });
          }
        }
        const msg = await messageStream.finalMessage();
        attempt = 0;
        for (const b of msg.content) if (b.type === 'tool_use' || b.type === 'server_tool_use') emit({ type: 'tool_done', id: b.id, ok: true });
        if (msg.stop_reason === 'refusal') {
          emit({ type: 'text', text: '\n\n_I can’t help with that request._' });
          break;
        }
        if (msg.stop_reason === 'max_tokens' && msg.content.some((b) => b.type === 'tool_use')) throw new Error('The response was cut off mid-tool call. Try a narrower question.');
      }
      break;
    } catch (err) {
      if (err instanceof Anthropic.APIError || signal.aborted || attempt >= 2 || (err as Error).message?.startsWith('The response was cut off')) throw err;
      runner = client.beta.messages.toolRunner({ ...runner.params }, { signal });
    }
  }
}
