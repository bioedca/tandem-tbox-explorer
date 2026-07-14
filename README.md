# tbdb.tandem

A static web app for exploring the **470 tandem T-box riboswitch loci** — a companion to
[tbdb.io](https://tbdb.io).

**▶ Live: https://bioedca.github.io/tbdb.tandem/** — one URL, no install.

[![Deploy](https://github.com/bioedca/tbdb.tandem/actions/workflows/deploy.yml/badge.svg)](https://github.com/bioedca/tbdb.tandem/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **tandem** locus stacks two or more complete T-box riboswitch elements in the same mRNA
leader, all regulating the same downstream gene or operon. tbdb.tandem takes the
*tandem-level* view — stacked-element architecture, specifier–tRNA pairing, shared-operon
regulation, RNA secondary structure, and a sequence-similarity map across all 949 elements.
Every element deep-links back to its canonical tbdb.io entry.

## What you can do

The whole app is one cross-filtered view: click any bar, matrix cell, or tree tip and every
panel and the table narrow together.

- **Dashboard (`/`)** — a KPI strip over three coordinated panels (specifier-pairing bars +
  element-pair matrix; operon/function bars + a specifier↔function Sankey; the similarity
  map) above a faceted, searchable table of all 470 loci. One shared filter drives everything.
- **Browse (`/browse`)** — full-screen faceted table: search, sort, stack facet filters
  (specifier, phylum, type, confidence, function class), export CSV.
- **Similarity map (`/tree`)** — an unrooted, radial map of the Stem-I consensus (847
  main-tree tips; degenerate elements route to a 102-tip antiterminator fallback). Locus⇄
  element and main⇄fallback toggles, a branch-support fade, a non-Firmicutes filter. Tips are
  coloured by specifier. *It is an exploratory similarity map, not a phylogeny* (see below).
- **3D cloud (`/cloud`)** — the same Stem-I relationships as a WebGL point cloud (classical
  MDS/PCoA recovers ~41% of the pairwise distance vs ~32% for a flat 2D layout), colour/size
  by five presets, a fully reversible "spread" de-pile slider, nearest-neighbour
  constellations. Lazily loaded — `three.js` never touches first paint.
- **Locus detail (`/locus/:id`)** — a to-scale tandem-architecture diagram with the
  regulated downstream gene (NCBI genomic context) and a continuous full-locus sequence
  track; a pairwise %-identity matrix; per-element RNA secondary-structure diagrams (R2DT
  canonical template ⇄ fornac force layout, antiterminator ⇄ terminator conformations) with
  feature highlights; deep links to tbdb.io.
- **About (`/about`)** — the method, the five-step build, a downloadable reproduction script,
  data caveats, the no-polarity explainer, and provenance/citations.

## The dataset

|                              |                                                      |
| ---------------------------- | ---------------------------------------------------- |
| Tandem loci                  | **470** (461 pairs + 9 triples)                      |
| T-box elements (members)     | **949**                                              |
| Intra-locus identity pairs   | **488**                                              |
| Similarity-map tips          | **847** main (Stem-I length-gate) + **102** fallback |
| Confidence                   | 394 high · 76 low                                    |
| Taxonomy                     | 454 Firmicutes · 16 non-Firmicutes                   |

Every count is emitted and gate-checked by the data pipeline. The app loads baked JSON from
`public/data/` (~330 KB gzipped) — there is no backend.

## The similarity map is not a phylogeny

The `/tree` and `/cloud` views are exploratory sequence-similarity maps built from the Stem-I
consensus only (Infernal `cmalign` against the RF00230 covariance model). They are **not**
ancestral-state reconstructions: the trees are displayed unrooted (midpoint-rooted internally
for a stable on-screen layout only), there is no time axis, and nothing in the interface
implies evolutionary direction. Distances reflect Stem-I sequence similarity — which carries
the specifier but not the rest of the leader.

## Tech stack

A static SPA, no server:

- **Vite 8** · **Svelte 5 (runes)** · **Tailwind CSS v4** · **TypeScript** · hash routing
  (`svelte-spa-router`).
- Visualization: **Plotly** (bars, heatmap, Sankey), **phylotree.js** (radial tree),
  **three.js** (3D cloud), **R2DT** assets + **fornac** (RNA 2° structure), **Tabulator**
  (faceted table), **@molbiohive/hatchlings** (sequence viewer).
- Data build: **Python 3.12** (pandas, biopython, numpy), pytest-validated.
- Tests: **Vitest** + Testing Library (unit/component), **Playwright** (e2e + visual),
  **pytest** (data pipeline).

## Repository layout

```
data-pipeline/      offline Python build: TBDB sources → public/data/*.json (+ tree, cloud,
                    R2DT, NCBI context); pytest suite. See data-pipeline/README.md
src/                Vite + Svelte 5 + Tailwind frontend (routes/, lib/components, lib/stores,
                    lib/cloud, …)
public/data/        baked JSON the app loads + the downloadable reproduce_tandem_tbox_db.py
docs/               method notes (similarity-cloud.md)
.github/workflows/  ci.yml (test gate) · deploy.yml (build → GitHub Pages)
```

Read-only inputs live outside the repo and are never committed: `../tandem_tbox_FINAL.tsv`
(470 loci) and `../tboxdb-master/Master_tboxes.csv` (the 92 MB TBDB master table).

## Develop locally

Requires **Node ≥ 20** (see `.nvmrc`).

```bash
npm ci
npm run dev        # Vite dev server
npm run build      # production build to dist/ (base '/' locally, '/tbdb.tandem/' in CI)
npm run preview    # serve the production build
```

Checks and tests:

```bash
npm run check      # Svelte diagnostics through the native TypeScript 7 API
npm run typecheck  # stable native TypeScript 7 CLI (`tsc --noEmit`)
npm run test       # vitest (unit + component)
npx playwright test          # e2e + visual, against the production build
pytest data-pipeline         # data-pipeline suite (see data-pipeline/README.md for the env)
```

`svelte-check` 4.7 still needs the TypeScript 6 JavaScript API while it starts,
so `typescript@6` remains as a pinned compatibility shim. The application is
checked with stable TypeScript 7: `svelte-check` uses its TS-Go API and the
standalone typecheck invokes the native TypeScript 7 binary directly. A fixture
guard fails CI if cross-component Svelte prop diagnostics stop working.

Rebuilding the data is optional — the JSON artifacts are committed.
See **[`data-pipeline/README.md`](data-pipeline/README.md)** for the Python env and every
build step (data, cluster tree, 3D cloud, R2DT diagrams, NCBI genomic context), and
**[`docs/similarity-cloud.md`](docs/similarity-cloud.md)** for the cloud-embedding method.

## Reproduce the dataset

The app ships a self-contained
**[`reproduce_tandem_tbox_db.py`](public/reproduce_tandem_tbox_db.py)** (also downloadable
from the About page) that regenerates the core tables — loci, members, summary, identity,
`members.csv`, and the tree input — offline from the public TBDB master table, with no clone
and no app build. The tandem set was derived from TBDB and independently verified against it.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci` → `npm run build` →
publish `dist/` to **GitHub Pages**. The Vite `base` is `/tbdb.tandem/` on CI and `/`
locally; routing is hash-based, so deep links resolve without server rewrites.

## Provenance & citation

Built on **TBDB** (Marchand et al. 2021, *NAR* 49(D1):D229–D235,
[doi:10.1093/nar/gkaa721](https://doi.org/10.1093/nar/gkaa721)). For the T-box mechanism and
the tandem ("double" / "partially double") arrangement:

- Vitreschak, Mironov, Lyubetsky & Gelfand (2008). *Comparative genomic analysis of T-box
  regulatory systems in bacteria.* RNA 14(4):717–735.
  [doi:10.1261/rna.819308](https://doi.org/10.1261/rna.819308)
- Gutiérrez-Preciado, Henkin, Grundy, Yanofsky & Merino (2009). *Biochemical features and
  functional implications of the RNA-based T-box regulatory mechanism.* MMBR 73(1):36–61.
  [doi:10.1128/MMBR.00026-08](https://doi.org/10.1128/MMBR.00026-08)

## License

Code is **MIT** (see [`LICENSE`](LICENSE)). The underlying T-box data comes from **TBDB**,
which grants no blanket data-reuse license — please **cite the source** (Marchand et al.
2021) when you reuse the data. tbdb.tandem attributes TBDB in-app.
