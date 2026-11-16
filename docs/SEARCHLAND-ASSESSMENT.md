# How Searchland works: a function-by-function assessment

_Prepared 16 November 2026 to plan Plotscope's roadmap._

## Sources and method

- **Searchland's own data catalogue.** I read it through the Searchland connector on your account. It lists every dataset and searchable field the platform exposes, so it is the most reliable evidence of how the product works underneath.
- **Searchland's public marketing pages, help centre and third-party reviews,** found through web search. Feature claims from marketing are flagged as such.
- **Not tested hands-on.** I couldn't open searchland.co.uk directly from my environment, so UI details (screens and click-paths) aren't covered.

## The one thing to understand first

**Searchland is a title-centric search engine.** Every Land Registry title in England and Wales is a record. Each record has been pre-enriched with **211 searchable attributes**, including:

- **Constraints:** % Green Belt, flood and surface-water risk, Article 4, TPO, BNG habitat units, radon, agricultural land grade, rights of way.
- **Planning signals:** application counts, max dwellings applied for, committee history, SHLAA and allocation status, settlement boundary %.
- **Ownership:** proprietor, company status, ultimate parent, mortgages, overseas owner, titles owned.
- **Market data:** latest sale, £/m², rental listings, VOA, EPC.
- **Distances** to roads, stations, schools, GP surgeries, substations with headroom, and more.
- **Physical:** developable vs developed area, building heights, roof type, land cover.
- **Political:** ward councillors and MP.

"Sourcing" is a filter query over that index, for example: _freehold, company-owned, 0.5–2 ha, < 20% Green Belt, inside or within 100 m of a settlement boundary, no planning in 5 years, within 400 m of a station_. Everything else (reports, letters, alerts, AI) sits on top of that index.

**Implication for Plotscope:** matching Searchland comes down to building the **title index plus a pre-computation pipeline**. Adding more map layers won't get us there. Plotscope today computes constraints live, per site, from public APIs. That works well for assessing a site you have already found, but it cannot answer "find me every title that matches X" across a district.

---

## Function by function

Legend: ✅ Plotscope has it · 🟡 partial · ❌ missing

### 1. Map, title boundaries and site selection
- **Searchland:** a vector map of every registered title (from HMLR INSPIRE polygons) with click-to-open title cards. Users can draw custom areas and merge titles.
- **Plotscope:** 🟡 a fast map, 5 basemaps, drawing and measuring tools, and click-for-report anywhere. **There are no title polygons**, so users draw boundaries by hand.
- **Gap and fix:** load HMLR INSPIRE Index Polygons. They are free under the INSPIRE licence, but bulk download only (~25M polygons), and need to be served as vector tiles (PMTiles/Tippecanoe). INSPIRE polygons have no title number. The join to a title needs the paid HMLR Title Number API, or a spatial match to CCOD/OCOD addresses.

### 2. Ownership intelligence
- **Searchland:** shows the proprietor name and category, company number and status, ultimate parent, directors and PSCs, number of mortgages and charges, overseas flag, and the owner's whole portfolio (titles owned, total m²). One review says ownership refreshes every 24h.
- **Plotscope:** ❌
- **Gap and fix:** HMLR **CCOD** (UK companies) and **OCOD** (overseas companies) are free with a licence and have monthly updates. Combined with the **Companies House API** (free) for status, officers, PSC and charges, that covers all corporate owners. Individual owners need a title register purchase, which costs £3 each via HMLR Business Gateway / Portal.

### 3. Title documents
- **Searchland:** official title registers and plans can be bought in-app for £3 each.
- **Plotscope:** 🟡 links out to HMLR's title search.
- **Gap and fix:** integrate HMLR Business Gateway. This needs a commercial HMLR account and per-document fees.

### 4. Site sourcing engine
- **Searchland:** a filter builder over the 211 attributes, plus predefined workflows such as Class MA, Class Q, small sites, and grey belt. Users can save searches and get alerts on new matches.
- **Plotscope:** 🟡 brownfield-register sourcing for the map view, filtered by size, dwellings, permission and ownership, with CSV export and one-click add to pipeline. **The AI assistant can also run sourcing searches in plain English.**
- **Gap and fix:** build a pipeline that pre-computes per-title attributes from free data (§§1, 2, 8, 9, 10, 11) into PostGIS or Elasticsearch, then a filter UI and saved searches. This is the biggest single piece of work (see roadmap).

### 5. Planning applications
- **Searchland:** a national applications dataset with 167 fields: decision, appeal, use classes, dwellings, storeys and floor area extracted from proposal text, and **full text of planning documents** (officer reports, decision notices). It also has public comment sentiment and committee history. Build-out status is inferred from building control, new EPCs and OS construction sites. Users get planning alerts.
- **Plotscope:** 🟡 a layer from planning.data.gov.uk, where coverage depends on which councils publish there.
- **Gap and fix:** there is no free national feed. The options are: (a) scrape council portals (Idox/Northgate/Agile), which is a large, ongoing engineering job; (b) license an aggregator; or (c) let the AI assistant search a council portal on demand, which is cheap and good enough for one site.

### 6. Appeals and council committees
- **Searchland:** Planning Inspectorate appeal decisions, plus council committee meetings, agendas, officer recommendations vs decisions, recorded votes, councillors' voting records and **webcast transcripts**.
- **Plotscope:** ❌
- **Gap and fix:** appeals come from the Planning Inspectorate's open appeal casework data (free). Committee data means scraping council ModernGov sites (many use the same software, so it is feasible). This is a "phase 3" feature.

### 7. Local plan intelligence
- **Searchland:** a profile for every LPA, covering:
  - adopted and emerging plan stage, with Reg 18/19, submission and examination dates
  - annual housing target and five-year land supply figure (including the appeal-determined figure)
  - Housing Delivery Test result and consequence
  - Green Belt review date and call-for-sites deadline
  - a summary of the affordable housing policy

  It also holds the spatial layers: **site allocations** (adopted and emerging, with unit numbers), **SHLAA/HELAA sites**, **settlement boundaries with settlement hierarchy tiers**, **local plan policy designations**, and neighbourhood plan areas.
- **Plotscope:** 🟡 **new in this release:**
  - each site's report now has a **Policy tab**. It lists the NPPF 2026 topics triggered by the site's constraints, with key tests, the evidence needed and links to guidance.
  - It also shows the **council's local plan, SPDs and neighbourhood plans** from the national development-plan datasets, plus search links for the policies map, housing land supply statement and CIL schedule.
  - The **AI assistant reads the actual local plan and SPDs** from council websites and summarises the policies that apply to the site, with references.
- **Gap and fix:**
  - **Structured LPA profiles:** compile once from the MHCLG local plan monitoring tables, the HDT publication and councils' 5YHLS statements, then refresh quarterly. The AI assistant can draft them, but a human should review them.
  - **Allocations, SHLAA and settlement boundaries:** these are council PDFs and GIS files. Partly on planning.data.gov.uk as the platform expands; the rest needs digitising.

### 8. Constraints
- **Searchland:** pre-computed per title. It includes planning considerations, Article 4 (with which use classes are removed), TPO, BNG habitat units, surface-water flood risk (including the climate-change scenario), flood defences, radon, agricultural land grade, rights of way, developable/unconstrained area and % Green Belt.
- **Plotscope:** ✅ / 🟡 22 national layers live from planning.data.gov.uk, with **% coverage of the site, a 0–100 constraint score**, hover highlights and source links.
- **Gaps:**
  - surface-water flooding (EA RoFSW, free)
  - agricultural land classification (Natural England, free)
  - BNG habitat baseline (Natural England Living England, free)
  - radon (UKHSA, free indicative)
  - public rights of way (council data, patchy)
  - SSSI Impact Risk Zones and nutrient neutrality catchments (Natural England, free)

### 9. Comparables and values
- **Searchland:** Price Paid joined to historical **Rightmove listings** (asking vs sold, listing dates). It also has on-market Rightmove data, rental listings, its own estimated land values per title, VOA rateable values and EPC floor areas, which give real £/ft².
- **Plotscope:** 🟡 Land Registry Price Paid by radius and type, with median/average/new-build stats and a trend chart. A server fallback handles browsers that block the Land Registry API.
- **Gap and fix:**
  - **EPC API** (free key) to get floor areas, which unlock £/ft².
  - **VOA** rating list (free).
  - Rightmove/Zoopla data is licensed only, with no legitimate free source.
  - Land values: build our own model from Price Paid land transactions plus planning signals.

### 10. Energy and grid
- **Searchland:** the Embedded Capacity Register, DNO substations with **headroom (green/amber/red)**, lines and towers, National Grid assets, and regional clean-power targets. It is aimed at BESS, solar and data-centre sourcing.
- **Plotscope:** ❌
- **Gap and fix:** all six DNOs publish open data portals (free) and the ECR is public. This is a clear add-on for an energy persona.

### 11. Location, amenity and demographics
- **Searchland:** distances to more than 60 amenity types, schools with Ofsted ratings, CQC care homes, public transport stops, footfall and vehicle counts, and Census 2021 demographics.
- **Plotscope:** 🟡 postcode, ward, LSOA and constituency only.
- **Gap and fix:** Get Information About Schools and Ofsted (free), CQC (free), NaPTAN stops (free), ONS Census (free), and OS Open Roads / OpenStreetMap for distances. Footfall data is licensed (Predik).

### 12. Development appraisal
- **Searchland:** a "professional grade" add-on covering RLV, GDV, profit and **cashflow**.
- **Plotscope:** ✅ a residual appraisal with SDLT and acquisition costs, £/acre, £/plot and profit on cost. It handles affordable housing, has a density-to-units helper, a **5×5 sensitivity grid**, and headroom vs asking price. The AI assistant can run it too.
- **Gap:** monthly cashflow and IRR, a mixed unit schedule, CIL lookup by LPA, and export to PDF/Excel.

### 13. Direct-to-vendor letters
- **Searchland:** bulk branded letters with templates and merge fields from title data. It handles printing and posting, tracks delivery status, and supports re-sends and campaigns.
- **Plotscope:** ❌ (the pipeline has owner and contact fields and an activity log).
- **Gap and fix:** mail-merge PDF generation is easy. Printing and posting needs a print API (e.g. Stannp or PostGrid, paid per letter). Depends on the ownership data in §2.

### 14. Projects, pipeline and collaboration
- **Searchland:** sites are saved to projects, and letters and alerts work from projects. A third-party review suggests heavy users pair it with a separate CRM.
- **Plotscope:** ✅ **stronger here**. It has a drag-and-drop kanban with 7 stages, a table view, tags, owner and asking price, notes, an activity log, scoring, appraisal value roll-ups, and CSV/GeoJSON import and export.
- **Gap:** it is single-user (saved in the browser). It needs accounts, shared team pipelines and permissions, which means a backend.

### 15. AI
- **Searchland:** an "AI sourcing assistant" (marketing claim), plus an **MCP connector** that exposes all datasets to AI tools. It comes with playbooks for sourcing land, title planning reports, development appraisals and **planning statements**.
- **Plotscope:** ✅ **new in this release:** an AI planning assistant built into the app. It:
  - knows what you are looking at (the selected site, map view and pipeline)
  - checks constraints, reads NPPF 2026 guidance, and finds and **reads the council's local plan and SPDs on the web**
  - searches brownfield registers, pulls sold prices and runs appraisals
  - **drives the map**: flies to places, opens site reports, switches layers on, shows results and saves sites to the pipeline.

  It cites its sources and won't invent policy numbers.
- **Gap:**
  - **planning statement drafting** as a downloadable document
  - an MCP server so users' own AI tools can query Plotscope
  - scheduled AI monitoring, e.g. "tell me when a council's 5YHLS drops below 5 years"

### 16. Reports
- **Searchland:** title and planning reports per site.
- **Plotscope:** 🟡 a printable site report (browser → PDF) covering constraints, policy, location and comps.
- **Gap:** a branded PDF report that includes the AI assessment.

---

## Where Plotscope is already better

1. **Coverage % and constraint score** on any boundary you draw, not only on registered titles.
2. **The policy tab:** NPPF 2026 topics are linked to the actual constraints found, together with the tests and evidence needed.
3. **The assistant acts on the map**, not only in chat, and reads live local plans.
4. **Pipeline CRM** with drag and drop, appraisal roll-ups, and import/export.
5. **Sensitivity grid** in the appraisal.
6. **Free and open data**: no per-seat licence cost to start, and it works on phones.

## Roadmap to parity (ordered by value ÷ effort)

| # | Build | Data (cost) | Size |
|---|---|---|---|
| 1 | Backend, accounts, shared pipelines | — | M |
| 2 | Title polygons as vector tiles; click a title to see its area and constraints | HMLR INSPIRE (free, licence) | M |
| 3 | Company ownership on titles plus Companies House enrichment | CCOD/OCOD + Companies House (free) | M |
| 4 | **Title index**: pre-compute ~40 key attributes per title; sourcing filter UI; saved searches and alerts | All free layers above | L |
| 5 | Extra constraints: surface water, ALC, SSSI IRZ, nutrient neutrality, BNG baseline | Natural England, EA (free) | S |
| 6 | LPA profiles: plan stage, 5YHLS, HDT, targets | MHCLG + council statements (free; AI-assisted, human-checked) | S–M |
| 7 | EPC floor areas → £/ft² comps | EPC API (free key) | S |
| 8 | Planning statement generator and PDF site report | — | S |
| 9 | Direct-to-vendor letters | Print/post API (paid per letter) | M |
| 10 | Grid capacity layers | DNO open data + ECR (free) | M |
| 11 | Planning applications at scale; appeals; committees | Portal scraping or licensed feed (paid) | L |

## Things only paid data can match

Rightmove/Zoopla listings, footfall and vehicle counts, full planning-application coverage with document text, and individual (non-company) owner names. The last one needs a £3 title register per title.

## Sources

- Searchland data catalogue, read through the Searchland connector on 16 Nov 2026.
- [Searchland homepage](https://searchland.co.uk) · [Site sourcing workflows](https://searchland.co.uk/features/site-sourcing-workflow) · [Direct to vendor letters](https://searchland.co.uk/features/dtv-letter-sending) · [Development appraisal tool](https://searchland.co.uk/blog/development-appraisal-tool) · [Rightmove on-market data](https://www.searchland.co.uk/features/rightmove-on-market-data) · [Land requirements / AI sourcing assistant](https://searchland.co.uk/land-requirements) · [Help centre](https://help.searchland.co.uk/en) · [HMLR blog on Searchland](https://hmlandregistry.blog.gov.uk/2022/08/18/how-searchland-is-using-our-data-to-help-land-developers/) · [August: property sourcing software review](https://www.augustapp.com/blog/best-property-sourcing-software)
- NPPF 2026 commentary: [Bell Cornwell](https://www.bell-cornwell.co.uk/insights/the-new-national-planning-policy-framework-is-here-what-you-need-to-know/) · [Irwin Mitchell](https://www.irwinmitchell.com/news-and-insights/expert-comment/post/102nq79/new-nppf-published-key-changes-from-the-december-2025-consultation-and-what-come) · [Burges Salmon](https://www.burges-salmon.com/our-thinking/the-august-2026-nppf-key-departures-from-the-consultation-draft/) · [Pegasus Group](https://www.pegasusgroup.co.uk/?p=13383) · [Chief Planner Newsletter, Aug 2026](https://assets.publishing.service.gov.uk/media/6a85760f1b45e4e555421e9a/Chief_Planner_Newsletter_-_August_2026.pdf)
