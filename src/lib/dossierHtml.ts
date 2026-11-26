// Renders a Dossier as a self-contained HTML document (no scripts, no external
// assets except Google Fonts), so it can be viewed in-app, downloaded, or published.
import type { Position } from 'geojson';
import type { Dossier } from './dossier';
import { compass } from './dossier';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n0 = (v: number) => Math.round(v).toLocaleString('en-GB');
const n1 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const n2 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const gbp = (v: number) => '£' + n0(v);
const gbpk = (v: number) => (v >= 1e6 ? `£${(v / 1e6).toFixed(2)}m` : `£${Math.round(v / 1000)}k`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const link = (href: string | undefined, text: string) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

export interface HtmlOptions {
  /** Full HTML document (download / iframe). When false, a page fragment for hosts that add their own skeleton. */
  standalone: boolean;
}

export function dossierHtml(d: Dossier, opts: HtmlOptions): string {
  const osmDown = d.errors.some((e) => /^(Buildings & streets|Local services)/.test(e));
  const osmMsg = 'OpenStreetMap could not be reached when this dossier was made, so this section is incomplete. Regenerate the dossier to fill it in.';
  const [lng, lat] = d.centroid;
  const ha = d.areaM2 / 10000;
  const date = new Date(d.generatedAt);
  const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const ref = `PS-${d.gridRef.replace(/\s/g, '').slice(0, 2)}${String(d.easting).slice(1, 4)}${String(d.northing).slice(1, 4)}-${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const addr = [d.location?.postcode, d.location?.admin_ward, d.lpa].filter(Boolean).join(' · ');
  const sourceLabel = d.source === 'hmlr' ? 'HM Land Registry title extent (indicative)' : d.source === 'osm' ? 'OpenStreetMap outline' : d.source === 'saved' ? 'Saved site boundary' : 'Drawn boundary';
  const scoreTone = d.score >= 80 ? 'good' : d.score >= 55 ? 'warn' : 'bad';
  const scoreWord = d.score >= 80 ? 'Low constraint' : d.score >= 55 ? 'Some constraints' : 'Heavily constrained';
  const frontTotal = d.frontage.reduce((a, f) => a + f.metres, 0);

  const sections: [string, string][] = [
    ['summary', 'Summary'], ['plan', 'Site'], ['constraints', 'Constraints'], ['policy', 'Policy'], ['history', 'Planning history'],
    ['access', 'Access & services'], ['context', 'Context'], ['sun', 'Sun & orientation'], ['market', 'Market'], ['capacity', 'Capacity'], ['checklist', 'Surveys'], ['sources', 'Sources'],
  ];

  const body = `
<header class="sheet">
  <div class="sheet-main">
    <p class="eyebrow">Site dossier</p>
    <h1>${esc(d.name)}</h1>
    <p class="addr">${esc(addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}</p>
  </div>
  <dl class="titleblock">
    <div><dt>Ref</dt><dd class="mono">${esc(ref)}</dd></div>
    <div><dt>OS grid ref</dt><dd class="mono">${esc(d.gridRef)}</dd></div>
    <div><dt>Easting / northing</dt><dd class="mono">${n0(d.easting)} / ${n0(d.northing)}</dd></div>
    <div><dt>Planning authority</dt><dd>${esc(d.lpa || '—')}</dd></div>
    <div><dt>Boundary</dt><dd>${esc(sourceLabel)}</dd></div>
    <div><dt>Issued</dt><dd>${esc(dateStr)}</dd></div>
  </dl>
</header>

<nav class="toc" aria-label="Sections"><div class="toc-inner">${sections.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</div></nav>

<main class="wrap">

<section id="summary">
  <div class="facts">
    ${fact('Site area', `${n2(ha)} ha`, `${n2(ha * 2.47105)} acres · ${n0(d.areaM2 * 10.7639)} ft²`)}
    ${fact('Plot dimensions', `${n1(d.dims.long)} × ${n1(d.dims.short)} m`, `Perimeter ${n0(d.perimeterM)} m`)}
    ${fact('Street frontage', frontTotal ? `${n0(frontTotal)} m` : osmDown ? 'Not available' : 'None found', d.frontage[0] ? esc(d.frontage.map((f) => f.road).join(', ')) : osmDown ? 'Streets could not be loaded' : 'Check access rights')}
    ${fact('Constraint score', `<span class="tone-${scoreTone}">${d.score}</span><small>/100</small>`, scoreWord)}
    ${fact('Flood risk', esc(d.floodZone.split(' (')[0]), esc(d.floodZone.match(/\((.*)\)/)?.[1] || ''))}
    ${d.amenities.length ? fact('Walkability', `${d.walkScore}<small>/100</small>`, d.busStops400 ? `${d.busStops400} bus stop${d.busStops400 > 1 ? 's' : ''} within 400 m` : 'No bus stop within 400 m') : fact('Walkability', 'Not available', 'Services could not be loaded')}
  </div>
  <div class="split">
    <div>
      <h2 class="h">Key findings</h2>
      <ul class="findings">${d.findings.map((f) => `<li class="f-${f.tone}"><span class="dot" aria-hidden="true"></span>${esc(f.text)}</li>`).join('')}</ul>
    </div>
    <div>
      <h2 class="h">What to do next</h2>
      <ol class="next">${d.surveys.filter((s) => s.priority === 'Essential').slice(0, 5).map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.why)}</span></li>`).join('')}</ol>
      <p class="muted small">Full list in <a href="#checklist">Surveys &amp; reports</a>.</p>
    </div>
  </div>
</section>

<section id="plan">
  ${head('01', 'Site & plot', 'The plot as mapped, with buildings on and around it and the streets it fronts.')}
  <div class="split wide">
    <figure class="plan">${sitePlan(d)}<figcaption>${osmDown ? 'Buildings and streets could not be loaded from OpenStreetMap for this copy. ' : ''}Site plan (not to scale for measurement). Buildings and streets © OpenStreetMap contributors; boundary from ${esc(sourceLabel)}.</figcaption></figure>
    <div>
      <table class="kv">
        <tr><th>Area</th><td>${n0(d.areaM2)} m² · ${n2(ha)} ha · ${n2(ha * 2.47105)} acres</td></tr>
        <tr><th>Longest side</th><td>${n1(d.dims.long)} m, running ${esc(compass(d.dims.bearing))}–${esc(compass(d.dims.bearing + 180))}</td></tr>
        <tr><th>Width (shortest)</th><td>${n1(d.dims.short)} m</td></tr>
        <tr><th>Main elevations face</th><td>${esc(d.dims.facing[0])} and ${esc(d.dims.facing[1])}</td></tr>
        <tr><th>Frontage</th><td>${d.frontage.length ? d.frontage.map((f) => `${n0(f.metres)} m to ${esc(f.road)} <span class="muted">(${esc(roadType(f.type))})</span>`).join('<br>') : osmDown ? 'Not available (streets could not be loaded)' : 'No street frontage detected'}</td></tr>
        <tr><th>Buildings on site</th><td>${d.buildingsOnSite.length ? `${d.buildingsOnSite.length} · footprint ${n0(d.coverage.footprint)} m² (${pct(d.coverage.pct)} site coverage)` : osmDown ? 'Not available (buildings could not be loaded)' : 'None mapped (cleared or open land)'}</td></tr>
        ${d.buildingsOnSite.length ? `<tr><th>Existing floor area</th><td>≈ ${n0(d.coverage.existingGia)} m² GIA${d.coverage.giaEstimated ? ' <span class="muted">(storeys estimated where not mapped)</span>' : ''}</td></tr>` : ''}
        <tr><th>Coordinates</th><td class="mono">${lat.toFixed(6)}, ${lng.toFixed(6)}</td></tr>
        <tr><th>Postcode</th><td>${esc(d.location?.postcode || '—')}</td></tr>
        <tr><th>Ward / parish</th><td>${esc([d.location?.admin_ward, d.location?.parish].filter(Boolean).join(' · ') || '—')}</td></tr>
        <tr><th>Constituency</th><td>${esc(d.location?.parliamentary_constituency || '—')}</td></tr>
        <tr><th>Statistical area</th><td>${esc(d.location?.lsoa || '—')} <span class="muted">(LSOA)</span></td></tr>
      </table>
      <div class="links">
        ${extLink(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`, 'Street View')}
        ${extLink(`https://www.google.com/maps/@${lat},${lng},120m/data=!3m1!1e3`, 'Aerial view')}
        ${extLink('https://search-property-information.service.gov.uk/', 'Title register (HMLR)')}
        ${d.location?.postcode ? extLink(`https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(d.location.postcode)}`, 'EPC certificates') : ''}
      </div>
    </div>
  </div>
</section>

<section id="constraints">
  ${head('02', 'Planning constraints', 'National designations on the site, with how much of the plot each covers.')}
  ${d.constraints.length ? `<div class="ctable" role="table">
    <div class="crow chead" role="row"><span role="columnheader">Designation</span><span role="columnheader">Impact</span><span role="columnheader">Site covered</span><span role="columnheader">Records</span></div>
    ${d.constraints.map((c) => `<div class="crow" role="row">
      <span role="cell"><i class="sw" style="background:${esc(c.color)}"></i><b>${esc(c.name)}</b><small>${esc(c.desc)}</small></span>
      <span role="cell"><em class="sev sev-${c.severity}">${c.severity === 'info' ? 'Info' : c.severity}</em></span>
      <span role="cell">${c.coverage != null ? `<span class="bar"><i style="width:${Math.max(2, c.coverage * 100)}%;background:${esc(c.color)}"></i></span><span class="mono">${pct(c.coverage)}</span>` : '<span class="muted">On / at site</span>'}</span>
      <span role="cell" class="recs">${c.records.slice(0, 4).map((r) => `${link(r.url, r.name)}${r.detail ? ` <span class="muted">${esc(r.detail)}</span>` : ''}`).join('<br>')}${c.records.length > 4 ? `<br><span class="muted">+ ${c.records.length - 4} more</span>` : ''}</span>
    </div>`).join('')}
  </div>` : `<p class="empty">No national planning designations recorded on this site.</p>`}
  <div class="split">
    <div>
      <h3 class="h3">Flood risk</h3>
      <p><b>${esc(d.floodZone)}.</b> ${d.floodZone.includes('Zone 1') ? 'Lowest risk from rivers and the sea. Surface water risk still needs checking for drainage design.' : 'A site-specific flood risk assessment and the sequential test will be needed for new homes.'} ${extLink('https://flood-map-for-planning.service.gov.uk/', 'EA flood map for planning')}</p>
    </div>
    <div>
      <h3 class="h3">Heritage within 75 m</h3>
      ${d.nearbyHeritage.length ? `<ul class="plain">${d.nearbyHeritage.map((h) => `<li>${link(h.url, h.name)} ${h.grade ? `<em class="grade">Grade ${esc(h.grade)}</em>` : ''} <span class="muted mono">${h.metres} m</span></li>`).join('')}</ul>` : '<p class="muted">No listed buildings or scheduled monuments within 75 m.</p>'}
    </div>
  </div>
  ${d.brownfield ? `<p class="callout good"><b>Brownfield register:</b> ${esc(d.brownfield.name)}${d.brownfield.hectares ? ` · ${esc(d.brownfield.hectares)} ha` : ''}${d.brownfield.dwellings ? ` · ${esc(d.brownfield.dwellings)} homes` : ''}${d.brownfield.permission ? ` · ${esc(d.brownfield.permission)}` : ''}</p>` : ''}
</section>

<section id="policy">
  ${head('03', 'Planning policy', `National policy that applies here, and ${esc(d.lpa || 'the council')}'s development plan.`)}
  <p class="lede">The ${esc(d.policy.nppf.title)}, published ${esc(d.policy.nppf.published)}, separates plan-making from national decision-making policies. Local plan policies that conflict with the national decision-making policies carry very limited weight unless the plan was adopted under the 2026 Framework. ${extLink(d.policy.nppf.url, 'Read the NPPF')}</p>
  <div class="policies">
    ${d.policy.topics.map((t) => {
      const onSite = t.triggers.some((x) => d.constraints.some((c) => c.dataset === x));
      return `<details${onSite ? ' open' : ''}><summary><span>${esc(t.title)}</span>${onSite ? '<em class="tag">Applies to this site</em>' : ''}</summary>
        <p>${esc(t.summary)}</p>
        <div class="two"><div><h4>Key tests</h4><ul>${t.tests.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h4>Evidence usually needed</h4><ul>${t.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
        ${t.guidance?.length ? `<p class="small">${t.guidance.map((g) => extLink(g.url, g.label)).join(' · ')}</p>` : ''}
      </details>`;
    }).join('')}
  </div>
  <h3 class="h3">Local plan &amp; supplementary planning documents</h3>
  ${localPlan(d)}
</section>

<section id="history">
  ${head('04', 'Planning history', 'Applications on or within 75 m of the site published to the national planning data platform.')}
  ${d.planningApps.length ? `<div class="scroll"><table class="data"><thead><tr><th>Reference</th><th>Proposal</th><th>Decision</th><th>Date</th></tr></thead><tbody>${d.planningApps.map((a) => `<tr><td class="mono">${link(a.url, a.reference)}</td><td>${esc(a.description)}</td><td>${esc(a.decision || '—')}</td><td class="mono">${esc((a.date || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">No applications published nationally for this spot. Most councils still publish only on their own portal, so check ${esc(d.lpa || 'the council')}'s planning register. ${extLink(`https://www.google.com/search?q=${encodeURIComponent(`${d.lpa || ''} planning application search ${d.location?.postcode || ''}`)}`, 'Find the planning register')}</p>`}
</section>

<section id="access">
  ${head('05', 'Access & local services', 'Straight-line distance to the nearest of each, with an approximate walking time.')}
  <div class="split wide">
    ${!d.amenities.length ? `<p class="empty">${osmDown ? osmMsg : 'No local services found nearby in OpenStreetMap.'}</p>` : ''}<div class="scroll"${!d.amenities.length ? ' hidden' : ''}><table class="data amen"><thead><tr><th>Nearest</th><th>Name</th><th class="r">Distance</th><th class="r">Walk</th></tr></thead><tbody>
      ${d.amenities.map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.name)}</td><td class="r mono">${a.metres >= 1000 ? `${(a.metres / 1000).toFixed(1)} km` : `${a.metres} m`}</td><td class="r"><span class="walk"><i style="width:${Math.min(100, (a.walkMin / 30) * 100)}%"></i></span><span class="mono">${a.walkMin} min</span></td></tr>`).join('')}
    </tbody></table></div>
    <div>
      <div class="gauge-wrap"${!d.amenities.length ? ' hidden' : ''}>${gauge(d.walkScore)}<div><b>Walkability ${d.walkScore}/100</b><p class="muted small">How many everyday services (bus, school, GP, shops, park, pharmacy, rail) are within a 5, 10 or 20 minute walk. An indicator, not a PTAL score.</p></div></div>
      <h3 class="h3">Streets next to the site</h3>
      <ul class="plain">${uniqueRoads(d).slice(0, 6).map((r) => `<li><b>${esc(r.name)}</b> <span class="muted">${esc(roadType(r.type))}</span></li>`).join('') || '<li class="muted">No named streets within 80 m.</li>'}</ul>
      <h3 class="h3">Utilities</h3>
      <p class="small">${d.power.substationM != null ? `Nearest mapped electricity substation <b>${n0(d.power.substationM)} m</b>. ` : 'No electricity substation mapped within 1.2 km. '}${d.power.lineM != null ? `Overhead or underground power line mapped within ${n0(d.power.lineM)} m.` : ''} Confirm connection capacity with the network operator.</p>
    </div>
  </div>
</section>

<section id="context">
  ${head('06', 'Built context', 'Scale of surrounding buildings, to judge appropriate height and massing.')}
  ${osmDown && !d.context.count ? `<p class="empty">${osmMsg}</p>` : ''}
  <div class="facts small-facts">
    ${fact('Buildings within 130 m', n0(d.context.count), '')}
    ${fact('Typical height', d.context.medianLevels ? `${n1(d.context.medianLevels)} storeys` : 'Not mapped', d.context.medianLevels ? `median of ${pct(d.context.taggedPct)} with heights mapped` : 'OpenStreetMap has few heights here')}
    ${fact('Tallest nearby', d.context.maxLevels ? `${n1(d.context.maxLevels)} storeys` : '—', '')}
    ${fact('Existing on site', d.buildingsOnSite.length ? `${n0(d.coverage.footprint)} m²` : 'None', d.buildingsOnSite.length ? `footprint, ${pct(d.coverage.pct)} coverage` : 'open land or demolished')}
  </div>
  ${d.buildingsOnSite.length ? `<div class="scroll"><table class="data"><thead><tr><th>Building on site</th><th>Use</th><th class="r">Footprint</th><th class="r">Storeys</th><th class="r">≈ GIA</th></tr></thead><tbody>${d.buildingsOnSite.map((b, i) => `<tr><td>${esc(b.name || `Building ${i + 1}`)}</td><td>${esc(b.use || 'Not recorded')}</td><td class="r mono">${n0(b.footprint)} m²</td><td class="r mono">${b.levels ?? '2*'}</td><td class="r mono">${n0(b.footprint * (b.levels ?? 2) * 0.85)} m²</td></tr>`).join('')}</tbody></table></div>${d.coverage.giaEstimated ? '<p class="muted small">* Storeys not mapped; 2 assumed. GIA ≈ footprint × storeys × 0.85.</p>' : ''}` : ''}
</section>

<section id="sun">
  ${head('07', 'Sun & orientation', 'Sun path for this latitude, with the plot drawn to true north.')}
  <div class="split wide">
    <figure class="sunfig">${sunPath(d)}<figcaption>Sun path diagram: rings at 0°, 30° and 60° altitude. Times in local clock time.</figcaption></figure>
    <div>
      <table class="data"><thead><tr><th></th><th>Sunrise</th><th>Sunset</th><th class="r">Daylight</th><th class="r">Noon altitude</th></tr></thead><tbody>
        ${d.sun.map((s) => `<tr><td><i class="sw sun-${s.label.toLowerCase()}"></i>${esc(s.label)} <span class="muted">${esc(s.date)}</span></td><td class="mono">${s.sunrise} <span class="muted">${esc(compass(s.sunriseAz))}</span></td><td class="mono">${s.sunset} <span class="muted">${esc(compass(s.sunsetAz))}</span></td><td class="r mono">${n1(s.daylightHrs)} h</td><td class="r mono">${Math.round(s.noonAltitude)}°</td></tr>`).join('')}
      </tbody></table>
      <p>The plot's long axis runs <b>${esc(compass(d.dims.bearing))}–${esc(compass(d.dims.bearing + 180))}</b>, so its main elevations face <b>${esc(d.dims.facing[0])}</b> and <b>${esc(d.dims.facing[1])}</b>. ${southNote(d)}</p>
      <p class="muted small">Low winter sun (${Math.round(d.sun[2]?.noonAltitude ?? 0)}° at noon) means neighbouring buildings to the south cast long shadows from October to February.</p>
    </div>
  </div>
</section>

<section id="market">
  ${head('08', 'Market evidence', 'HM Land Registry sold prices within about 600 m over the last five years.')}
  ${d.salesSummary.count ? `
  <div class="split wide">
    <figure>${salesChart(d)}<figcaption>Median sold price by year (${d.salesSummary.count} sales).</figcaption></figure>
    <div class="scroll"><table class="data"><thead><tr><th>Property type</th><th class="r">Sales</th><th class="r">Median</th></tr></thead><tbody>
      ${d.salesSummary.byType.map((t) => `<tr><td>${esc(t.type)}</td><td class="r mono">${t.count}</td><td class="r mono">${gbp(t.median)}</td></tr>`).join('')}
      <tr class="total"><td>All sales</td><td class="r mono">${d.salesSummary.count}</td><td class="r mono">${gbp(d.salesSummary.median)}</td></tr>
    </tbody></table></div>
  </div>
  <details class="more"><summary>Latest ${Math.min(20, d.sales.length)} sales</summary><div class="scroll"><table class="data"><thead><tr><th>Date</th><th>Address</th><th>Type</th><th class="r">Price</th></tr></thead><tbody>
    ${d.sales.slice(0, 20).map((s) => `<tr><td class="mono">${esc(s.date.slice(0, 10))}</td><td>${esc(s.address)} <span class="muted">${esc(s.postcode)}</span>${s.newBuild ? ' <em class="tag">New build</em>' : ''}</td><td>${esc(s.type)}</td><td class="r mono">${gbp(s.price)}</td></tr>`).join('')}
  </tbody></table></div></details>` : `<p class="empty">No sold prices were returned for this area.</p>`}
</section>

<section id="capacity">
  ${head('09', 'Indicative capacity', 'Early-stage yield ranges for discussion. A design-led capacity study will refine these.')}
  <p class="lede">Net developable area <b>${n0(d.capacity.netArea)} m²</b> (${n2(d.capacity.netArea / 10000)} ha)${d.capacity.constrainedPct > 0 ? `, after excluding ${pct(d.capacity.constrainedPct)} covered by high-impact constraints` : ''}.${d.context.medianLevels ? ` Surrounding buildings are typically ${n1(d.context.medianLevels)} storeys.` : ''}</p>
  <div class="scen">
    ${d.capacity.scenarios.map((s) => `<div class="sc"><h4>${esc(s.name)}</h4><p class="big">${s.units}<small> home${s.units > 1 ? 's' : ''}</small></p><dl><div><dt>Basis</dt><dd>${esc(s.basis)}</dd></div><div><dt>Floor area</dt><dd>≈ ${n0(s.gia)} m² GIA</dd></div><div><dt>Height</dt><dd>${s.storeys} storeys</dd></div>${scenarioValue(d, s.name) ? `<div><dt>Indicative GDV</dt><dd>≈ ${gbpk(scenarioValue(d, s.name)! * s.units)}</dd></div>` : ''}</dl><p class="muted small">${esc(s.note)}</p></div>`).join('')}
  </div>
  ${d.salesSummary.count ? `<p class="small muted">Indicative GDV uses the local median sold price for each property type (flats ${d.salesSummary.flats ? gbp(d.salesSummary.flats) : 'n/a'}, terraced ${d.salesSummary.terraced ? gbp(d.salesSummary.terraced) : 'n/a'}, detached/semi ${d.salesSummary.houses ? gbp(d.salesSummary.houses) : 'n/a'}) before new-build premium, size and mix. Use the appraisal tool for a residual land value.</p>` : ''}
</section>

<section id="checklist">
  ${head('10', 'Surveys & reports', 'What a design team will need, based on this site’s constraints and context.')}
  ${(['Before purchase', 'Pre-application', 'With application'] as const).map((w) => {
    const list = d.surveys.filter((s) => s.when === w);
    return list.length ? `<h3 class="h3">${w}</h3><ul class="checks">${list.map((s) => `<li><span class="box" aria-hidden="true"></span><div><b>${esc(s.name)}</b> <em class="pri pri-${s.priority.toLowerCase()}">${s.priority}</em><span>${esc(s.why)}</span></div></li>`).join('')}</ul>` : '';
  }).join('')}
</section>

<section id="sources">
  ${head('11', 'Sources & limitations', '')}
  <ul class="sources small">
    <li>Planning designations, brownfield register, development plan documents and planning applications: planning.data.gov.uk (MHCLG), Open Government Licence. Coverage of planning applications and local plan documents varies by council.</li>
    <li>Plot boundary: ${esc(sourceLabel)}. INSPIRE index polygons show the indicative extent of a registered title; check the title plan. © Crown copyright and database rights, HM Land Registry / Ordnance Survey.</li>
    <li>Buildings, streets, services and utilities: © OpenStreetMap contributors (ODbL). Completeness varies; building heights are often unmapped.</li>
    <li>Sold prices: HM Land Registry Price Paid Data, Open Government Licence. Postcode geography: postcodes.io (ONS / OS data).</li>
    <li>National policy summaries are a guide to the ${esc(d.policy.nppf.title)}; rely on the official text and the council's adopted development plan.</li>
    <li>Sun positions are calculated for this latitude and longitude, ignoring terrain and neighbouring buildings.</li>
  </ul>
  ${d.errors.length ? `<p class="callout warn small"><b>Some data could not be loaded:</b> ${esc(d.errors.join('; '))}</p>` : ''}
  <p class="muted small">This dossier is for early-stage screening. It is not a planning opinion, a valuation or a substitute for professional surveys.</p>
</section>

</main>`;

  const docHead = `<title>${esc(d.name)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${CSS}</style>`;

  if (!opts.standalone) return `${docHead}\n${body}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${docHead}
</head>
<body>
${body}
</body>
</html>`;
}

// ---------- pieces ----------
function scenarioValue(d: Dossier, name: string): number | undefined {
  const m = d.salesSummary;
  const v = /apartment|flat/i.test(name) ? m.flats : /terrace|town/i.test(name) ? m.terraced : /house|dwelling/i.test(name) ? m.houses : 0;
  return v || m.median || undefined;
}

function fact(label: string, value: string, sub: string) {
  return `<div class="fact"><span class="fl">${esc(label)}</span><span class="fv">${value}</span><span class="fs">${sub}</span></div>`;
}
function head(num: string, title: string, sub: string) {
  return `<div class="sh"><span class="num mono">${num}</span><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>`;
}
function extLink(href: string, text: string) {
  return `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}<span aria-hidden="true"> ↗</span></a>`;
}
function roadType(t: string) {
  return ({ motorway: 'Motorway', trunk: 'Trunk road', primary: 'A road', secondary: 'B road', tertiary: 'Local distributor', residential: 'Residential street', unclassified: 'Minor road', living_street: 'Living street', pedestrian: 'Pedestrian street', service: 'Service road' } as Record<string, string>)[t] || t.replace(/_/g, ' ');
}
function uniqueRoads(d: Dossier) {
  const seen = new Set<string>();
  return d.context.roads.filter((r) => r.name && !seen.has(r.name) && seen.add(r.name));
}
function southNote(d: Dossier) {
  const south = d.dims.facing.some((f) => /^S/.test(f));
  return south ? 'One main elevation faces south, which suits living spaces and solar PV.' : 'Neither main elevation faces due south; consider dual-aspect layouts and roof orientation for PV.';
}

function localPlan(d: Dossier) {
  const lp = d.policy.local;
  if (!lp) return '<p class="muted">The planning authority could not be identified.</p>';
  const kind: Record<string, string> = { 'local-plan': 'Local plan', spd: 'SPD', neighbourhood: 'Neighbourhood plan', evidence: 'Evidence', other: 'Other' };
  const docs = lp.documents.filter((x) => x.kind !== 'other').slice(0, 14);
  return `${lp.plans.map((p) => `<p class="plan-card"><b>${link(p.url, p.name)}</b> <span class="muted">${esc([p.period, p.status].filter(Boolean).join(' · '))}</span></p>`).join('')}
  ${docs.length ? `<ul class="docs">${docs.map((x) => `<li><em class="kind k-${x.kind}">${kind[x.kind]}</em>${link(x.url, x.name)}</li>`).join('')}</ul>` : ''}
  ${lp.note ? `<p class="muted small">${esc(lp.note)}</p>` : ''}
  <p class="links">${lp.searchLinks.map((l) => extLink(l.url, l.label.replace(`${lp.lpa} `, '').replace(/^./, (c) => c.toUpperCase()))).join('')}</p>`;
}

// ---------- drawings ----------
function projector(center: [number, number]) {
  const k = Math.cos((center[1] * Math.PI) / 180);
  return (p: Position) => [(p[0] - center[0]) * 111320 * k, -(p[1] - center[1]) * 110540];
}

function sitePlan(d: Dossier) {
  const P = projector(d.centroid);
  const rings = (d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates).map((poly) => poly[0].map(P));
  const all = rings.flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const span = Math.max(70, w * 1.9, h * 1.9 * (640 / 420));
  const W = 640, H = 420, s = W / span;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const T = (p: number[]) => `${((p[0] - cx) * s + W / 2).toFixed(1)},${((p[1] - cy) * s + H / 2).toFixed(1)}`;
  const path = (ring: Position[]) => 'M' + ring.map((p) => T(P(p))).join('L') + 'Z';
  const ctx = d.context.buildings.map((b) => `<path d="${path(b.geom[0])}" class="b-ctx"/>`).join('');
  const on = d.buildingsOnSite.map((b) => `<path d="${path(b.geom[0])}" class="b-on"/>`).join('');
  const roadW = (t: string) => (['primary', 'trunk', 'secondary'].includes(t) ? 9 : ['tertiary', 'residential', 'unclassified', 'living_street'].includes(t) ? 7 : 4);
  const roads = d.context.roads.map((r) => `<path d="M${r.geom.map((p) => T(P(p))).join('L')}" class="road" stroke-width="${roadW(r.type)}"/>`).join('');
  // label each named street once, on its longest segment
  const labelled = new Set<string>();
  const labels = d.context.roads.filter((r) => r.name && r.geom.length > 1).map((r) => {
    if (labelled.has(r.name)) return '';
    let best = { len: 0, a: [0, 0], b: [0, 0] };
    for (let i = 0; i < r.geom.length - 1; i++) {
      const a = P(r.geom[i]), b = P(r.geom[i + 1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > best.len) best = { len, a, b };
    }
    if (best.len * s < 70) return '';
    const mx = ((best.a[0] + best.b[0]) / 2 - cx) * s + W / 2, my = ((best.a[1] + best.b[1]) / 2 - cy) * s + H / 2;
    if (mx < 20 || mx > W - 20 || my < 14 || my > H - 14) return '';
    labelled.add(r.name);
    let ang = (Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    return `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" class="rlabel">${esc(r.name)}</text>`;
  }).join('');
  const site = rings.map((r) => `<path d="M${r.map(T).join('L')}Z" class="site"/>`).join('');
  // scale bar
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500].find((m) => m * s >= 70) || 500;
  const bar = nice * s;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Site plan showing the plot boundary, buildings and streets">
  <defs><clipPath id="clip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern></defs>
  <g clip-path="url(#clip)"><rect width="${W}" height="${H}" class="ground"/>${roads}${ctx}<g class="site-g">${site}</g>${on}${labels}</g>
  <g transform="translate(${W - 38},38)" class="north"><circle r="18"/><path d="M0,-13 L6,7 L0,3 L-6,7Z"/><text y="-22">N</text></g>
  <g transform="translate(20,${H - 22})" class="scale"><rect width="${bar.toFixed(1)}" height="5"/><rect width="${(bar / 2).toFixed(1)}" height="5" class="alt"/><text x="0" y="-6">0</text><text x="${bar.toFixed(1)}" y="-6" text-anchor="end">${nice} m</text></g>
  <g transform="translate(${W - 20},${H - 18})" class="dimlabel"><text text-anchor="end">${n1(d.dims.long)} m × ${n1(d.dims.short)} m · ${n0(d.areaM2)} m²</text></g>
</svg>`;
}

function sunPath(d: Dossier) {
  const S = 320, c = S / 2, R = 128;
  const xy = (alt: number, az: number) => {
    const r = R * (1 - Math.max(0, alt) / 90);
    const a = (az * Math.PI) / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };
  const rings = [0, 30, 60].map((alt) => `<circle cx="${c}" cy="${c}" r="${(R * (1 - alt / 90)).toFixed(1)}" class="ring"/><text x="${c + 3}" y="${(c - R * (1 - alt / 90) + 11).toFixed(1)}" class="ringl">${alt}°</text>`).join('');
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315].map((az) => {
    const [x, y] = xy(0, az);
    const [lx, ly] = [c + (R + 14) * Math.sin((az * Math.PI) / 180), c - (R + 14) * Math.cos((az * Math.PI) / 180)];
    return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="spoke"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="cmp">${compass(az)}</text>`;
  }).join('');
  const bst = (label: string) => (label === 'Midsummer' ? 1 : 0);
  const curves = d.sun.map((day) => {
    const pts = day.path.map((p) => xy(p.alt, p.az));
    const dots = day.path.filter((p) => Number.isInteger(p.hour) && p.alt > 0 && (p.hour + bst(day.label)) % 3 === 0).map((p) => {
      const [x, y] = xy(p.alt, p.az);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" class="hdot sun-${day.label.toLowerCase()}"/>${day.label === 'Midsummer' ? `<text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" class="hl">${String(p.hour + 1).padStart(2, '0')}</text>` : ''}`;
    }).join('');
    return `<polyline points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" class="curve sun-${day.label.toLowerCase()}"/>${dots}`;
  }).join('');
  // plot outline at the centre, true north up
  const P = projector(d.centroid);
  const ring = (d.geometry.type === 'Polygon' ? d.geometry.coordinates[0] : d.geometry.coordinates[0][0]).map(P);
  const ext = Math.max(...ring.map((p) => Math.hypot(p[0], p[1]))) || 1;
  const k = 30 / ext;
  const plot = `<path d="M${ring.map((p) => `${(c + p[0] * k).toFixed(1)},${(c + p[1] * k).toFixed(1)}`).join('L')}Z" class="plotmini"/>`;
  return `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Sun path diagram">${rings}${spokes}${curves}${plot}</svg>
  <div class="legend"><span><i class="sw sun-midsummer"></i>Midsummer</span><span><i class="sw sun-equinox"></i>Equinox</span><span><i class="sw sun-midwinter"></i>Midwinter</span></div>`;
}

function salesChart(d: Dossier) {
  const ys = d.salesSummary.byYear;
  const W = 480, H = 220, pl = 54, pb = 26, pt = 12;
  const max = Math.max(...ys.map((y) => y.median)) * 1.1 || 1;
  const step = niceStep(max / 4);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const bw = (W - pl - 10) / ys.length;
  const Y = (v: number) => H - pb - (v / (ticks[ticks.length - 1] || max)) * (H - pb - pt);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Median sold price by year">
    ${ticks.map((v) => `<line x1="${pl}" x2="${W - 6}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${pl - 6}" y="${(Y(v) + 4).toFixed(1)}" class="axis" text-anchor="end">${gbpk(v)}</text>`).join('')}
    ${ys.map((y, i) => {
      const x = pl + i * bw + bw * 0.18, w = bw * 0.64, top = Y(y.median);
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pb - top).toFixed(1)}" rx="3" class="barfill"><title>${y.year}: ${gbp(y.median)} (${y.count} sales)</title></rect><text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" class="axis" text-anchor="middle">${y.year}</text>`;
    }).join('')}
  </svg>`;
}
function niceStep(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || p * 10;
}
function gauge(v: number) {
  const r = 30, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 80 80" class="gauge" aria-hidden="true"><circle cx="40" cy="40" r="${r}" class="g-track"/><circle cx="40" cy="40" r="${r}" class="g-val" stroke-dasharray="${((v / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/><text x="40" y="46" text-anchor="middle">${v}</text></svg>`;
}

// ---------- styles ----------
const CSS = `
/* Layout: an architect's drawing sheet: title block band, sticky section index, single reading column with wide figures. */
:root {
  --paper: #f5f7fb; --paper-2: #eaeef6; --card: #ffffff; --ink: #121a2e; --ink-2: #44506a; --muted: #6b7690;
  --rule: #d9dfeb; --accent: #1b3a6b; --accent-soft: #e6edf7; --constraint: #c2410c;
  --good: #15803d; --warn: #b45309; --bad: #b91c1c;
  --ground: #eef1f6; --bldg: #c9d0de; --bldg-on: #3d6aa8; --road: #ffffff; --road-edge: #c7cedc;
  --sun-s: #d97706; --sun-e: #0d9488; --sun-w: #2563eb;
  --f-display: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  --f-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  --f-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #0d1220; --paper-2: #141b2d; --card: #121929; --ink: #e8ecf6; --ink-2: #b4bdd3; --muted: #8a95b0;
  --rule: #253049; --accent: #8fb3e3; --accent-soft: #15233d; --constraint: #fb923c;
  --good: #4ade80; --warn: #fbbf24; --bad: #f87171;
  --ground: #141b2d; --bldg: #2a3550; --bldg-on: #6b96cf; --road: #222c44; --road-edge: #2f3a56;
  --sun-s: #fbbf24; --sun-e: #2dd4bf; --sun-w: #60a5fa; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #0d1220; --paper-2: #141b2d; --card: #121929; --ink: #e8ecf6; --ink-2: #b4bdd3; --muted: #8a95b0;
  --rule: #253049; --accent: #8fb3e3; --accent-soft: #15233d; --constraint: #fb923c;
  --good: #4ade80; --warn: #fbbf24; --bad: #f87171;
  --ground: #141b2d; --bldg: #2a3550; --bldg-on: #6b96cf; --road: #222c44; --road-edge: #2f3a56;
  --sun-s: #fbbf24; --sun-e: #2dd4bf; --sun-w: #60a5fa; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 64px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.6 var(--f-body); -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--paper); }
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.mono { font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
h1, h2, h3, h4 { font-family: var(--f-display); text-wrap: balance; margin: 0; letter-spacing: -0.01em; }

.sheet { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: end;
  padding-block: 40px 28px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  max-width: 1160px; margin: 0 auto; }
.eyebrow { font: 500 12px var(--f-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
.sheet h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.08; }
.addr { margin: 10px 0 0; color: var(--ink-2); font-size: 16px; }
.titleblock { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; border: 1.5px solid var(--ink); background: var(--card); }
.titleblock div { padding: 8px 12px; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); min-width: 0; }
.titleblock div:nth-child(2n) { border-right: 0; }
.titleblock div:nth-last-child(-n+2) { border-bottom: 0; }
.titleblock dt { font: 500 10px var(--f-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.titleblock dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }

.toc { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(8px); border-block: 1px solid var(--rule); }
.toc-inner { max-width: 1160px; margin: 0 auto; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
  padding-block: 8px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.toc a { white-space: nowrap; text-decoration: none; color: var(--ink-2); font-size: 13px; font-weight: 500; padding: 6px 10px; border-radius: 999px; }
.toc a:hover { background: var(--paper-2); color: var(--ink); }

.wrap { max-width: 1160px; margin: 0 auto; padding-block: 8px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
section { padding-block: 36px; border-bottom: 1px solid var(--rule); }
section:last-child { border-bottom: 0; }
.sh { display: flex; gap: 16px; align-items: baseline; margin-bottom: 20px; }
.sh .num { color: var(--accent); font-size: 13px; }
.sh h2 { font-size: 24px; }
.sh p { margin: 4px 0 0; color: var(--ink-2); max-width: 65ch; }
.h { font-size: 18px; margin-bottom: 12px; }
.h3 { font-size: 16px; margin: 24px 0 10px; }
.lede { max-width: 75ch; color: var(--ink-2); }

.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; margin-bottom: 28px; }
.fact { background: var(--card); padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fl { font: 500 10.5px var(--f-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.fv { font: 600 22px/1.2 var(--f-display); font-variant-numeric: tabular-nums; }
.fv small { font-size: 13px; color: var(--muted); font-weight: 500; }
.fs { font-size: 12.5px; color: var(--ink-2); }
.small-facts .fv { font-size: 19px; }
.tone-good { color: var(--good); } .tone-warn { color: var(--warn); } .tone-bad { color: var(--bad); }

.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
.split.wide { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); align-items: start; }
.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 820px) { .sheet, .split, .split.wide, .two { grid-template-columns: minmax(0, 1fr); } .sheet { padding-block-start: 24px; } }

.findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.findings li { display: flex; gap: 10px; align-items: baseline; }
.findings .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; transform: translateY(-1px); }
.f-good .dot { background: var(--good); } .f-risk .dot { background: var(--constraint); } .f-note .dot { background: var(--muted); }
.next { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
.next li b { display: block; }
.next li span { color: var(--ink-2); font-size: 13.5px; }

figure { margin: 0; min-width: 0; }
figure svg { width: 100%; height: auto; display: block; }
figcaption { font-size: 12px; color: var(--muted); margin-top: 8px; }
.plan svg { border: 1px solid var(--rule); border-radius: 10px; }
.ground { fill: var(--ground); }
.b-ctx { fill: var(--bldg); stroke: var(--paper); stroke-width: 0.8; }
.b-on { fill: var(--bldg-on); opacity: 0.85; stroke: var(--card); stroke-width: 0.8; }
.road { fill: none; stroke: var(--road); stroke-linecap: round; stroke-linejoin: round; }
.rlabel { font: 500 10px var(--f-body); fill: var(--ink-2); text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: var(--road); stroke-width: 3px; }
.site { fill: url(#hatch); stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; }
.hatch { stroke: var(--accent); stroke-width: 1.2; opacity: 0.35; }
.north circle { fill: var(--card); stroke: var(--rule); } .north path { fill: var(--ink); } .north text { font: 600 11px var(--f-mono); fill: var(--ink); text-anchor: middle; }
.scale rect { fill: var(--ink); } .scale rect.alt { fill: var(--card); stroke: var(--ink); stroke-width: 1; } .scale text, .dimlabel text { font: 500 10.5px var(--f-mono); fill: var(--ink-2); }

.kv { width: 100%; border-collapse: collapse; font-size: 14px; }
.kv th { text-align: left; font-weight: 500; color: var(--muted); padding: 7px 12px 7px 0; width: 38%; vertical-align: top; }
.kv td { padding: 7px 0; border-top: 1px solid var(--rule); vertical-align: top; }
.kv tr:first-child td { border-top: 0; }
.kv tr th { border-top: 1px solid var(--rule); } .kv tr:first-child th { border-top: 0; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.ext { display: inline-flex; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500; background: var(--card); }
.ext:hover { border-color: var(--accent); }

.ctable { border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; background: var(--card); margin-bottom: 20px; }
.crow { display: grid; grid-template-columns: minmax(0, 2.2fr) 90px minmax(0, 1fr) minmax(0, 1.6fr); gap: 14px; padding: 12px 16px; border-top: 1px solid var(--rule); align-items: start; }
.crow:first-child { border-top: 0; }
.chead { background: var(--paper-2); font: 500 10.5px var(--f-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); padding-block: 8px; }
.crow b { font-weight: 600; } .crow small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.45; margin-top: 2px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; vertical-align: 0; }
.sev { font-style: normal; font-size: 12px; font-weight: 600; text-transform: capitalize; padding: 2px 8px; border-radius: 999px; }
.sev-high { color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); }
.sev-medium { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.sev-low, .sev-info { color: var(--ink-2); background: var(--paper-2); }
.bar { display: inline-block; width: 70px; height: 8px; border-radius: 4px; background: var(--paper-2); overflow: hidden; margin-right: 8px; vertical-align: middle; }
.bar i { display: block; height: 100%; }
.recs { font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 720px) { .crow { grid-template-columns: minmax(0, 1fr) auto; } .crow > :nth-child(3), .crow > :nth-child(4) { grid-column: 1 / -1; } .chead { display: none; } }
.empty { padding: 16px; border: 1px dashed var(--rule); border-radius: 12px; color: var(--ink-2); max-width: 80ch; }
.callout { padding: 12px 14px; border-radius: 10px; background: var(--paper-2); }
.callout.good { background: color-mix(in srgb, var(--good) 10%, transparent); }
.callout.warn { background: color-mix(in srgb, var(--warn) 12%, transparent); }
.plain { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.grade, .tag { font-style: normal; font-size: 11.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }

.policies { display: grid; gap: 8px; margin: 16px 0; }
.policies details { border: 1px solid var(--rule); border-radius: 12px; background: var(--card); }
.policies summary { cursor: pointer; padding: 12px 16px; display: flex; gap: 10px; align-items: center; font-weight: 600; list-style: none; }
.policies summary::-webkit-details-marker { display: none; }
.policies summary span { flex: 1; }
.policies summary::after { content: "+"; font: 500 18px var(--f-mono); color: var(--muted); }
.policies details[open] summary::after { content: "–"; }
.policies details > *:not(summary) { margin-left: 16px; margin-right: 16px; }
.policies details > p { max-width: 80ch; color: var(--ink-2); margin-top: 0; }
.policies h4 { font-size: 12px; font-family: var(--f-mono); font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 4px 0; }
.policies ul { margin: 0 0 12px; padding-left: 18px; font-size: 14px; }
.plan-card { padding: 12px 14px; border-radius: 10px; background: var(--accent-soft); margin: 0 0 10px; }
.docs { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--rule); }
.docs li { padding: 8px 0; border-bottom: 1px solid var(--rule); display: flex; gap: 10px; align-items: baseline; font-size: 14px; }
.kind { font-style: normal; flex-shrink: 0; font: 500 10.5px var(--f-mono); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--paper-2); color: var(--ink-2); }
.k-spd { color: var(--accent); } .k-local-plan { color: var(--ink); } .k-neighbourhood { color: var(--good); }

.scroll { overflow-x: auto; min-width: 0; }
.data { width: 100%; border-collapse: collapse; font-size: 14px; }
.data th { text-align: left; font: 500 10.5px var(--f-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 8px 10px 8px 0; border-bottom: 1.5px solid var(--ink); white-space: nowrap; }
.data td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
.data .r { text-align: right; }
.data tr.total td { font-weight: 600; border-bottom: 0; border-top: 1.5px solid var(--ink); }
.walk { display: inline-block; width: 46px; height: 6px; border-radius: 3px; background: var(--paper-2); margin-right: 8px; vertical-align: middle; overflow: hidden; }
.walk i { display: block; height: 100%; background: var(--accent); }
.gauge-wrap { display: flex; gap: 14px; align-items: center; padding: 14px; border: 1px solid var(--rule); border-radius: 12px; background: var(--card); }
.gauge-wrap p { margin: 4px 0 0; }
.gauge { width: 72px; flex-shrink: 0; }
.g-track { fill: none; stroke: var(--paper-2); stroke-width: 8; }
.g-val { fill: none; stroke: var(--accent); stroke-width: 8; stroke-linecap: round; }
.gauge text { font: 600 18px var(--f-display); fill: var(--ink); }

.sunfig svg { max-width: 360px; margin: 0 auto; }
.ring { fill: none; stroke: var(--rule); } .spoke { stroke: var(--rule); stroke-dasharray: 2 3; }
.ringl { font: 400 9px var(--f-mono); fill: var(--muted); }
.cmp { font: 500 10px var(--f-mono); fill: var(--ink-2); text-anchor: middle; }
.curve { fill: none; stroke-width: 2.2; }
.curve.sun-midsummer { stroke: var(--sun-s); } .curve.sun-equinox { stroke: var(--sun-e); } .curve.sun-midwinter { stroke: var(--sun-w); }
.hdot.sun-midsummer, .sw.sun-midsummer { fill: var(--sun-s); background: var(--sun-s); }
.hdot.sun-equinox, .sw.sun-equinox { fill: var(--sun-e); background: var(--sun-e); }
.hdot.sun-midwinter, .sw.sun-midwinter { fill: var(--sun-w); background: var(--sun-w); }
.hl { font: 500 8.5px var(--f-mono); fill: var(--ink-2); text-anchor: middle; }
.plotmini { fill: color-mix(in srgb, var(--accent) 25%, transparent); stroke: var(--accent); stroke-width: 1.5; }
.legend { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); margin-top: 6px; }

.grid { stroke: var(--rule); } .axis { font: 400 10.5px var(--f-mono); fill: var(--muted); }
.barfill { fill: var(--accent); }
details.more { margin-top: 16px; } details.more summary { cursor: pointer; font-weight: 600; color: var(--accent); }

.scen { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0; }
.sc { border: 1px solid var(--rule); border-radius: 12px; padding: 16px; background: var(--card); display: flex; flex-direction: column; gap: 6px; }
.sc h4 { font-size: 15px; }
.big { font: 600 34px/1 var(--f-display); margin: 4px 0; font-variant-numeric: tabular-nums; }
.big small { font-size: 14px; color: var(--muted); font-weight: 500; }
.sc dl { margin: 0; display: grid; gap: 2px; font-size: 13px; }
.sc dl div { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid var(--rule); padding-top: 4px; }
.sc dt { color: var(--muted); } .sc dd { margin: 0; text-align: right; }
.sc p { margin: 4px 0 0; }

.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 2px; }
.checks li { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); }
.checks .box { width: 16px; height: 16px; border: 1.5px solid var(--ink-2); border-radius: 4px; flex-shrink: 0; margin-top: 3px; }
.checks b { font-weight: 600; } .checks span { display: block; color: var(--ink-2); font-size: 13.5px; }
.pri { font-style: normal; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; margin-left: 6px; }
.pri-essential { color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.pri-likely { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
.pri-consider { color: var(--ink-2); background: var(--paper-2); }
.sources { padding-left: 18px; color: var(--ink-2); display: grid; gap: 6px; max-width: 90ch; }

@media print {
  .toc { display: none; } body { background: #fff; } section { break-inside: avoid-page; } .policies details { break-inside: avoid; }
  .policies details:not([open]) > *:not(summary) { display: block; }
}
`;
