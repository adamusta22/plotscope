# Plotscope

A map-first land sourcing and site appraisal platform for UK property development.
Rename it by changing `APP_NAME` in `src/App.tsx` and the `<title>` in `index.html`.

## Run it

```bash
npm install
cp .env.example .env   # then put your Anthropic API key in .env
npm run dev
```

Then open http://localhost:5173. `npm run dev` starts both the web app and the small API server (port 8787) that runs the AI assistant. Everything except the assistant works without a key.

## Features

- **Map**: smooth fly-to animations, five base maps (streets, light, dark, satellite with labels, OSM), tilt and rotate, geolocate, scale bar. The map position is kept in the URL so you can share links.
- **Search**: postcodes, outcodes, addresses and places, `lat,lng` coordinates and your own saved sites. Keyboard navigation works.
- **22 constraint layers** from planning.data.gov.uk: Green Belt, flood zones, SSSI, ancient woodland, SAC/SPA/Ramsar, National Landscapes, National Parks, conservation areas, listed buildings, scheduled monuments, Article 4, TPOs, brownfield register, planning applications and LPA boundaries. Layers load for the area in view and highlight on hover.
- **Instant site report**: click anywhere or draw a boundary to see every designation, the % of the site each one covers, a 0–100 constraint score, area/acres/perimeter, postcode, ward, LPA, constituency, LSOA and research links (EPC, title search, flood map, Street View).
- **Sold prices**: HM Land Registry Price Paid data within 250 m–2 km, filtered by property type, with median/average/new-build stats and a yearly trend.
- **Source land**: scans the councils' brownfield land registers for the area on screen. Filter by size, dwellings, permission status and ownership, then export to CSV or add sites to the pipeline in one click.
- **Development appraisal**: residual land value with SDLT and acquisition costs, £/acre, £/plot, profit on cost, affordable housing, a density-to-units helper, a 5×5 sensitivity grid, and headroom against the asking price.
- **Pipeline CRM**: drag-and-drop kanban across 7 stages, plus a table view, search, tags, owner and asking price, notes, an activity log, and CSV/GeoJSON export and GeoJSON import.
- **Planning policy (new)**: every site report has a Policy tab. It lists the NPPF 2026 topics triggered by the site's designations, with the tests, the evidence needed and links to guidance. It also shows the council's local plan, SPDs and neighbourhood plans from the national development-plan datasets, plus quick links to the policies map, housing land supply statement and CIL schedule.
- **AI planning assistant (new)**: press `I`, or "Assess with AI" on any site. It runs on Claude and can check constraints, read the NPPF, find and read the council's local plan and SPDs on the web, search brownfield registers, pull sold prices, run appraisals, and drive the map: fly to places, switch layers on, show results and save sites. It cites sources and won't invent policy references. The code is in `server/agent.ts`.
- **Tools**: draw a site (with live ha/acres/sq ft), measure distance, undo points, print a site report to PDF.
- **Keyboard shortcuts**: `/` search, `D` draw, `M` measure, `L` layers, `S` source, `A` appraise, `P` pipeline, `I` assistant, `B` base map, `?` help.
- Works on phones and supports dark mode.

## Data sources (all free, Open Government Licence or ODbL)

| Data | Source |
|---|---|
| Planning constraints, brownfield register, LPA boundaries | planning.data.gov.uk (England) |
| Postcodes and admin geography | postcodes.io |
| Place search | OpenStreetMap Nominatim |
| Sold prices | HM Land Registry Price Paid (SPARQL) |
| Base maps | CARTO / OpenStreetMap / Esri imagery |

## Not yet included (these need paid or licensed data)

- Freehold title polygons and ownership (HMLR INSPIRE bulk data, or the OS NGD/HMLR APIs)
- Company ownership and owner contact details (CCOD/OCOD + Companies House)
- Full planning application history for every council (via a commercial aggregator)
- EPC data (free API key from the EPC register)

Pipeline data is currently saved in the browser (localStorage). The next step for a multi-user product is a backend with accounts and shared pipelines.

## Docs

- [How Searchland works: a function-by-function assessment and roadmap](docs/SEARCHLAND-ASSESSMENT.md)

## Deploy

Plotscope runs as a single Node service: `npm run build` then `npm start`. The server delivers the web app and the API on `PORT`.

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on the AI assistant (required for AI) |
| `APP_PASSWORD` | Password-protects the whole site. Leave it empty to make the site public |
| `AGENT_REQUESTS_PER_HOUR` | Caps AI questions per visitor per hour (default 30) to limit spend |

- **Render:** New → Blueprint → choose this repo (`render.yaml` is included), then fill in the settings.
- **Railway / Fly.io / Cloud Run:** use the included `Dockerfile`.
