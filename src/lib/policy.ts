// National planning policy knowledge base (England).
//
// The NPPF was republished on 17 August 2026 and restructured into coded
// plan-making and decision-making policies. Policy codes and paragraph numbers
// are deliberately NOT hard-coded here: they are easy to get wrong and change
// between versions. Each topic summarises the policy position and links to the
// official text; the AI assistant fetches exact wording live from GOV.UK.

export const NPPF = {
  title: 'National Planning Policy Framework (2026)',
  published: '17 August 2026',
  url: 'https://www.gov.uk/government/publications/national-planning-policy-framework--2',
  guidanceUrl: 'https://www.gov.uk/government/collections/planning-practice-guidance',
  notes: [
    'Policies are split into plan-making policies (for councils preparing local plans) and national decision-making policies (applied directly to planning applications).',
    'National decision-making policies took effect on publication. Local plan policies that are materially inconsistent with them carry very limited weight, unless the plan was examined and adopted under the 2026 Framework.',
    'Applications are still decided in accordance with the development plan unless material considerations indicate otherwise (s38(6) Planning and Compulsory Purchase Act 2004).',
  ],
};

export interface PolicyTopic {
  id: string;
  title: string;
  /** planning.data.gov.uk datasets that make this topic relevant to a site */
  triggers: string[];
  summary: string;
  tests: string[];
  evidence: string[];
  guidance?: { label: string; url: string }[];
}

export const POLICY_TOPICS: PolicyTopic[] = [
  {
    id: 'housing-supply',
    title: 'Housing delivery, land supply and the presumption',
    triggers: [],
    summary:
      'National policy prioritises boosting housing supply. Where a council cannot show a sufficient deliverable housing land supply, or fails the Housing Delivery Test, national decision-making policy tilts decisions in favour of sustainable development. In the 2026 Framework this replaced the former "tilted balance" with new decision-making policies.',
    tests: ['Can the council demonstrate the required housing land supply?', 'What is its latest Housing Delivery Test result?', 'Is the local plan up to date and consistent with the 2026 national decision-making policies?'],
    evidence: ['Latest housing land supply position statement', 'Housing Delivery Test measurement', 'Local plan adoption date and review status'],
    guidance: [{ label: 'Housing supply and delivery (PPG)', url: 'https://www.gov.uk/guidance/housing-supply-and-delivery' }],
  },
  {
    id: 'green-belt',
    title: 'Green Belt and grey belt',
    triggers: ['green-belt'],
    summary:
      'Inappropriate development in the Green Belt is harmful and should only be approved in very special circumstances. Exceptions include limited infilling, redevelopment of previously developed land, and development on "grey belt" land. In the 2026 Framework, grey belt is defined only by how much the land contributes to Green Belt purposes (a), (b) and (d); the earlier footnote 7 qualification was removed. Major housing on released or grey belt land must meet the "golden rules": affordable housing, infrastructure, and access to green space.',
    tests: ['Is the land previously developed or grey belt?', 'Does it strongly contribute to Green Belt purposes (a) checking sprawl, (b) preventing towns merging, or (d) preserving historic town setting?', 'Would the golden rules be met?', 'Is there unmet need that makes the site necessary?'],
    evidence: ['Council Green Belt assessment / grey belt review', 'Landscape and visual appraisal', 'Planning history showing previously developed land'],
    guidance: [{ label: 'Green Belt (PPG)', url: 'https://www.gov.uk/guidance/green-belt' }],
  },
  {
    id: 'flood-risk',
    title: 'Flood risk',
    triggers: ['flood-risk-zone'],
    summary:
      'Development should be steered to the lowest-risk areas. In Flood Zones 2 and 3, the sequential test usually applies (are there reasonably available sites at lower risk?), and some uses also need the exception test. A site-specific flood risk assessment is required, and development must be safe for its lifetime without increasing flood risk elsewhere. The 2026 Framework gives flood risk and resilience its own chapter.',
    tests: ['Which flood zone is the developable part in?', 'Is the use classed as "more vulnerable" (e.g. housing)?', 'Can the sequential test be passed? Can built development avoid the flood zone?', 'Is the exception test needed?'],
    evidence: ['Site-specific flood risk assessment', 'Sequential test report', 'Strategic flood risk assessment (council)', 'Surface water/drainage strategy (SuDS)'],
    guidance: [{ label: 'Flood risk and coastal change (PPG)', url: 'https://www.gov.uk/guidance/flood-risk-and-coastal-change' }, { label: 'EA flood map for planning', url: 'https://flood-map-for-planning.service.gov.uk/' }],
  },
  {
    id: 'heritage',
    title: 'Historic environment',
    triggers: ['conservation-area', 'listed-building', 'scheduled-monument', 'world-heritage-site', 'park-and-garden', 'battlefield'],
    summary:
      'Great weight is given to conserving designated heritage assets: listed buildings, conservation areas, scheduled monuments, registered parks and battlefields, and World Heritage Sites. Substantial harm needs clear and convincing justification and is only acceptable in exceptional (or, for the highest-grade assets, wholly exceptional) circumstances. Less than substantial harm is weighed against public benefits. Setting matters as well as the asset itself. Statutory duties also apply under the Planning (Listed Buildings and Conservation Areas) Act 1990.',
    tests: ['What is the significance of each asset and its setting?', 'Is the level of harm substantial or less than substantial?', 'Do public benefits outweigh the harm?', 'Does the scheme preserve or enhance the conservation area?'],
    evidence: ['Heritage statement / impact assessment', 'Conservation area appraisal (council)', 'Historic England list entry'],
    guidance: [{ label: 'Historic environment (PPG)', url: 'https://www.gov.uk/guidance/conserving-and-enhancing-the-historic-environment' }, { label: 'Historic England list search', url: 'https://historicengland.org.uk/listing/the-list/' }],
  },
  {
    id: 'landscape',
    title: 'Protected landscapes',
    triggers: ['area-of-outstanding-natural-beauty', 'national-park'],
    summary:
      'National Parks and National Landscapes (formerly AONBs) have the highest status of protection for landscape and scenic beauty, and great weight is given to conserving and enhancing them. Major development should be refused other than in exceptional circumstances, where it is in the public interest. Relevant authorities must also seek to further the purposes of these designations.',
    tests: ['Is the proposal "major development" in this context (a matter of judgement)?', 'Are there exceptional circumstances and a public interest case?', 'Could the need be met outside the designated area?'],
    evidence: ['Landscape and visual impact assessment', 'Management plan for the protected landscape'],
    guidance: [{ label: 'Natural environment (PPG)', url: 'https://www.gov.uk/guidance/natural-environment' }],
  },
  {
    id: 'biodiversity',
    title: 'Biodiversity and habitats',
    triggers: ['site-of-special-scientific-interest', 'special-area-of-conservation', 'special-protection-area', 'ramsar', 'ancient-woodland', 'local-nature-reserve'],
    summary:
      'Development that would harm a SSSI is not normally permitted. Habitats sites (SAC, SPA, Ramsar) need a Habitats Regulations Assessment, and nutrient neutrality or recreational pressure mitigation may apply. Loss of irreplaceable habitats, such as ancient woodland and veteran trees, should be refused except in wholly exceptional circumstances. Statutory biodiversity net gain (a minimum of 10%) applies to most developments.',
    tests: ['Is the site in or near a SSSI Impact Risk Zone or habitats site?', 'Is a Habitats Regulations Assessment needed (e.g. nutrient neutrality catchments)?', 'Can 10% BNG be delivered on-site or off-site?', 'Are buffers to ancient woodland achievable?'],
    evidence: ['Preliminary ecological appraisal', 'BNG metric and habitat management plan', 'Habitats Regulations Assessment screening'],
    guidance: [{ label: 'Biodiversity net gain', url: 'https://www.gov.uk/guidance/biodiversity-net-gain' }, { label: 'Natural England MAGIC map', url: 'https://magic.defra.gov.uk/' }],
  },
  {
    id: 'trees',
    title: 'Protected trees',
    triggers: ['tree-preservation-zone', 'tree'],
    summary:
      'Works to trees protected by a Tree Preservation Order need consent. Trees in conservation areas also need six weeks\' notice. Expect to submit an arboricultural impact assessment, and retained trees and their root protection areas will constrain the developable area.',
    tests: ['Which trees are protected, and what are their root protection areas?', 'Can the layout avoid them?'],
    evidence: ['BS5837 tree survey and arboricultural impact assessment'],
    guidance: [{ label: 'Tree preservation orders (PPG)', url: 'https://www.gov.uk/guidance/tree-preservation-orders-and-trees-in-conservation-areas' }],
  },
  {
    id: 'brownfield',
    title: 'Brownfield land and effective use of land',
    triggers: ['brownfield-land'],
    summary:
      'National policy gives substantial weight to using suitable brownfield land in settlements for homes and other needs, and supports efficient use of land and appropriate densities, especially in well-connected locations. Sites on the brownfield land register have been judged suitable for housing. Those on Part 2 of the register have permission in principle.',
    tests: ['Is the site on Part 1 or Part 2 of the brownfield register?', 'Does it have permission in principle?', 'Is the proposed density an efficient use of the land?'],
    evidence: ['Brownfield register entry', 'Contamination (phase 1) report', 'Design-led capacity study'],
    guidance: [{ label: 'Brownfield land registers (PPG)', url: 'https://www.gov.uk/guidance/brownfield-land-registers' }],
  },
  {
    id: 'permitted-development',
    title: 'Permitted development and Article 4',
    triggers: ['article-4-direction-area'],
    summary:
      'Permitted development rights, such as Class MA (commercial to residential), Class Q (agricultural buildings to dwellings), and HMO conversions, allow some changes without a full application, usually subject to prior approval. An Article 4 direction removes specified rights in a defined area, so a full planning application is needed. Conservation areas and other designated land also restrict several classes.',
    tests: ['Which PD class would apply?', 'Is the site covered by an Article 4 direction or in Article 2(3) land?', 'Does the building meet the class limits (size, vacancy period, date of use)?'],
    evidence: ['Article 4 direction schedule', 'Evidence of lawful use and vacancy'],
    guidance: [{ label: 'When is permission required? (PPG)', url: 'https://www.gov.uk/guidance/when-is-permission-required' }],
  },
  {
    id: 'design',
    title: 'Design, density and local character',
    triggers: [],
    summary:
      'Good design is a key aspect of sustainable development. Proposals should reflect local design codes and guides, and development that is not well designed should be refused. Councils set design codes, and many have design or residential standards in supplementary planning documents (SPDs).',
    tests: ['Is there a local design code or design SPD?', 'Does the layout meet space, privacy and amenity standards?'],
    evidence: ['Design and access statement', 'Local design code / SPD compliance check'],
    guidance: [{ label: 'National Design Guide', url: 'https://www.gov.uk/government/publications/national-design-guide' }],
  },
  {
    id: 'affordable-viability',
    title: 'Affordable housing, contributions and viability',
    triggers: [],
    summary:
      'Local plans set affordable housing requirements, which typically apply to major development of 10 or more homes. Planning obligations (s106) and CIL fund infrastructure. Viability is tested at plan-making stage, so site-specific viability arguments need robust, publicly available evidence.',
    tests: ['What is the local affordable housing % and threshold?', 'Is CIL charged here, and at what rate?', 'Are there SPD-based contributions (education, open space, highways)?'],
    evidence: ['Local plan affordable housing policy', 'CIL charging schedule', 'Planning obligations SPD', 'Viability assessment (if needed)'],
    guidance: [{ label: 'Viability (PPG)', url: 'https://www.gov.uk/guidance/viability' }, { label: 'Planning obligations (PPG)', url: 'https://www.gov.uk/guidance/planning-obligations' }],
  },
];

export const TOPIC_BY_ID = Object.fromEntries(POLICY_TOPICS.map((t) => [t.id, t])) as Record<string, PolicyTopic>;

/** Policy topics relevant to a site given the constraint datasets found on it. */
export function topicsForDatasets(datasets: string[]): PolicyTopic[] {
  const hit = POLICY_TOPICS.filter((t) => t.triggers.some((d) => datasets.includes(d)));
  const always = ['housing-supply', 'design', 'affordable-viability'].map((id) => TOPIC_BY_ID[id]);
  return [...hit, ...always.filter((t) => !hit.includes(t))];
}

export function topicText(t: PolicyTopic) {
  return [`## ${t.title}`, t.summary, 'Key tests:', ...t.tests.map((x) => `- ${x}`), 'Evidence usually needed:', ...t.evidence.map((x) => `- ${x}`), ...(t.guidance || []).map((g) => `Guidance: ${g.label} - ${g.url}`)].join('\n');
}
