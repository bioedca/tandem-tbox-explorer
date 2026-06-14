# data-pipeline

The offline build that turns the two read-only TBDB source files into the static
JSON the tbdb.tandem SPA loads, plus the `tree_input.fasta` the cluster tree build
consumes. This is the **single source of truth** for member resolution and field
provenance.

```
SOURCE (read-only, outside the repo)            COMMITTED ARTIFACTS          APP
  ../tandem_tbox_FINAL.tsv      ── build_json ─▶  public/data/*.json      ─▶ Svelte SPA
  ../tboxdb-master/Master_tboxes.csv (92 MB)      public/data/tree_input.fasta
                                                          │
                                  build_tree.sbatch (cluster, parallel track)
                                                          ▼
                                     tree.nwk · tree_fallback.nwk · tree_tips.json · tree_locus_map.json
```

The 92 MB `Master_tboxes.csv` is **never** copied into the repo — it is read in
place from `../tboxdb-master/`. Only the small derived artifacts
under `public/data/` are committed.

## Requirements

- **Python 3.12+** (CI pins 3.12; see `.github/workflows/ci.yml`).
- Dependencies pinned in [`requirements.txt`](./requirements.txt): `pandas==3.0.3`,
  `biopython==1.87` (pairwise %-identity), `numpy` (PCoA for `build_cloud.py`), and
  `pytest` (test runner).

## Setup

```bash
# from the repo root (use any Python 3.12+ interpreter)
python3 -m venv data-pipeline/.venv
source data-pipeline/.venv/bin/activate
pip install -r data-pipeline/requirements.txt
```

`.venv/` is gitignored.

## Run the data build

`build_json.py` reads the two sources and writes
`summary.json`, `loci.json`, `members.json`, `identity.json`, `members.csv`
(the member-level base table — every per-member field plus the component-stem
colour spans flattened into columns), and `tree_input.fasta` to `public/data/`:

```bash
python3 data-pipeline/build_json.py \
  --master ../tboxdb-master/Master_tboxes.csv \
  --tandem ../tandem_tbox_FINAL.tsv \
  --out public/data
```

The build aborts non-zero on any validation gate failure and prints
the main-tree tip count emitted for the length-gated `tree_input.fasta`.

`members.csv` also carries the NCBI-derived **genomic-context** columns
(`genomic_resolved`, `locus_interval_*`, `element_offset`, and the proximal
regulated `downstream_gene_*` facts that drive the `/locus` continuous view).
These are filled from `public/data/locus_context/` when it exists, so the table is
written in **two passes** for a clean rebuild: run `build_json.py` (the columns are
blank on this first pass), then the genomic-context fetch below, then **re-run
`build_json.py`** to fill them. The committed `locus_context/` is already present, so
a normal `--out public/data` build fills the columns in one go.

## Run the cluster tree build

The similarity tree is built on the lab cluster as a parallel track. One-time
login-node setup (user miniconda env `phylo`):

```bash
# install Infernal + FastTree + MAFFT + gotree, then fetch the RF00230 CM
cmfetch Rfam.cm RF00230 > tbox_RF00230.cm     # redirect is mandatory; name must match the sbatch
```

Then submit the batch job, which aligns the full leader to RF00230, slices the
Stem-I consensus columns, and infers the tree with FastTree:

```bash
ssh two sbatch data-pipeline/build_tree.sbatch   # poll with squeue / sacct
```

`build_tree.sbatch` and its post-processing scripts (`slice_stemI_columns.py`,
`build_tree_artifacts.py`) live in this directory.

## Build the 3D similarity cloud (`/cloud`)

`build_cloud.py` turns the **already-committed** trees + metadata into
`public/data/cloud.json`, the single artifact the lazy `/cloud` route renders. It
reads `tree.nwk` / `tree_fallback.nwk`, computes each tree's patristic distance
matrix with a small pure-Python parser + per-leaf walk (no `dendropy` — the matrix
is rooting-independent, so no ancestry is read), embeds it in 3D by classical MDS /
PCoA (`numpy`), and joins each leaf to its per-element / per-locus metadata:

```bash
python3 data-pipeline/build_cloud.py --out public/data   # defaults read public/data/*
```

The embedding is byte-deterministic (each eigenvector axis's sign is fixed so the
largest-magnitude coordinate is positive); only `meta.generated` is wall-clock —
pass `--generated <iso8601>` for a byte-exact rebuild. The 3 PCoA axes capture ~41%
of the main tree's pairwise distance (a flat 2D layout: ~32%); the `/cloud` view
surfaces that caveat. Run **after** the data build + tree artifacts exist.

## Fetch the per-locus genomic context (NCBI)

This step has two interchangeable entry points: `fetch_genomic_context.py` (the
maintainer build, reads the **committed** `loci.json` + `members.json`) and the
self-contained `public/reproduce_tandem_tbox_db.py --genomic-context` (which fetches the
context for its OWN freshly-detected loci and fills the members.csv genomic columns —
see that script's header). Both port the same pure resolver/assembly code, so they
produce the same per-locus records.

`fetch_genomic_context.py` resolves each locus's downstream gene coordinates +
surrounding interval sequence from NCBI (the source data has the gene name + protein
id but **no coordinates**), so the `/locus` figure can draw the gene + intergenic to
scale and a continuous full-locus sequence track. Like `build_cloud.py` it reads the
**already-committed** `loci.json` + `members.json` (never the read-only sources), and
emits one file per locus under `public/data/locus_context/` + a `manifest.json`:

```bash
NCBI_EMAIL=you@example.org [NCBI_API_KEY=...] \
python3 data-pipeline/fetch_genomic_context.py --out public/data   # defaults read public/data/*
```

It resolves each gene by efetching the protein record and reading the CDS `/coded_by`
qualifier (coords on the same accession as the leader), computes the interval
(transcription-direction aware, clamped to 20 kb), and stores the interval sequence
**transcription-5′→3′** so `seq[offset:offset+length]` round-trips each member's
`fasta_sequence`. Unresolvable genes degrade gracefully (`resolved:false` → the figure
draws the schematic ORF). Raw NCBI responses are cached under `data-pipeline/ncbi_cache/`
(gitignored); `--offline` rebuilds the committed artifact byte-identically from the cache
(pass `--generated <iso8601>` to pin `meta.generated`). This is a separate, optional step,
run **after** the data build; the default network-free reproduction run leaves the
members.csv genomic columns blank. (No polarity: genomic location + transcription
direction only.)

## Build the R2DT structure diagrams

The locus detail page renders each element's RNA 2° structure with **R2DT** on the
canonical RF00230 / T-box template (alongside the fornac force layout). R2DT is a
heavyweight templated pipeline (Infernal + a covariance-model template library)
that can't run in the browser, so — like the tree — the diagrams are generated
offline once and committed under `public/data/r2dt/`. `build_r2dt.py` has four
stages — `fasta` + `ingest` (decoupled by the offline R2DT run itself), then the
`graft` + `terminator` post-processing below:

```bash
# 1. emit the input FASTA (one RNA leader per member; auto-classifies to RF00230)
python3 data-pipeline/build_r2dt.py fasta --out /tmp/r2dt_input.fasta

# 2. run R2DT however is available — the EMBL-EBI R2DT web service, local Docker,
#    or the cluster (Singularity/Apptainer), e.g. Docker (image rnacentral/r2dt):
#    docker run -v /tmp:/work rnacentral/r2dt r2dt.py draw /work/r2dt_input.fasta /work/r2dt_out

# 3. ingest R2DT's RNA-2D-JSON output -> compact committed assets + manifest
python3 data-pipeline/build_r2dt.py ingest \
  --results /tmp/r2dt_out/results/json \
  --metadata /tmp/r2dt_out/results/metadata.tsv \
  --out public/data/r2dt
```

`ingest` writes one compact `<member_id>.json` (per-nucleotide coordinates + base
pairs) plus `manifest.json`, and **skips** any diagram whose sequence does not
match its member's `fasta_sequence` (which would misalign the stem coloring) — so
only elements R2DT draws faithfully on the full leader are committed (800 of 949;
the degenerate or R2DT-clipped leaders fall back to the fornac viewer). The app
colors each nucleotide client-side from `src/lib/color.ts`, not in the assets.

Two further post-processing stages run **offline from the committed raw snapshot**
(`data-pipeline/r2dt_raw.json`, the untouched `ingest` output kept committed so they
reproduce without re-running the gated R2DT pipeline):

```bash
# 4. graft a real ANTITERMINATOR hairpin into each R2DT diagram + reflow the backbone
python3 data-pipeline/build_r2dt.py graft       # -> public/data/r2dt/ (790 of 949)

# 5. graft the TERMINATOR hairpin onto the SAME Stem I/II/III coords -> the gene-OFF
#    conformation, full-length (Stem I/II/III pinned, only the 3' hairpin swaps)
python3 data-pipeline/build_r2dt.py terminator  # -> public/data/r2dt/term/ (784 of 949)
```

The RF00230 template does not base-pair either regulatory hairpin, so `graft` folds
the antiterminator (from `whole_antiterm_structure`) onto R2DT's Stem I/II/III layout
and `terminator` folds the terminator hairpin onto the *same* coordinates — so toggling
antiterminator ⇄ terminator in the viewer pins the stems and only the 3′ region morphs.
Both reuse the deterministic straight-ladder (simple hairpins) or NAView (branched), an
outward orientation, and a single-strand reflow, and drop members whose reflow stays too
distorted to the fornac fallback (which renders the same conformations from
`whole_antiterm_structure` / `whole_term_structure`). ViennaRNA is a build-time-only
dependency (the NAView branch).

> The published assets were generated via the EMBL-EBI R2DT REST service (the lab
> cluster runs Ubuntu 24.04, which blocks rootless Apptainer; the `build_r2dt.sbatch`
> job is kept for clusters that allow it).

## Run the tests

The pipeline test suite runs from this directory:

```bash
cd data-pipeline && pytest            # or, from the repo root:  pytest data-pipeline
```

- `tests/test_wuss.py` — WUSS→dot-bracket converter golden + balance tests.
- `tests/test_build.py` — build gates 1–10 + golden values on a fixture subset.
- `tests/test_artifacts.py` — integrity checks over the committed `public/data/*.json` + `members.csv`.
- `tests/test_build_r2dt.py` — R2DT compact extraction + ingest (sequence-match guard, manifest).
- `tests/test_build_cloud.py` — PCoA embedding on a fixture tree (patristic ordering, deterministic sign convention, k-NN dedup) + committed `cloud.json` integrity.
