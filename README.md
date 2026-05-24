# CPU Prices

CPU pricing tracker for Tybourne. Daily scraping of public retail and benchmark data into Cloudflare D1, served through a Cloudflare Pages dashboard.

> Status: scaffolding. v1 tracks one source (PassMark / cpubenchmark.net) and 14 current-generation desktop SKUs.

## Architecture

```
GitHub Actions (cron)                   Cloudflare Pages (cpuprices)
+--------------------------+            +------------------------------+
| scrape.yml (daily)       |            |  web/  React + Chart.js UI   |
|   Playwright + TS        |            |    -> calls /api/* only      |
|   GET /cpu-list/all      |  D1 REST   |                              |
|   -> source_observations | --------># |  functions/api/* (D1 bound)  |
|   -> price_history (matched)          +------------------------------+
+--------------------------+                          |
                                                      v
                                          Cloudflare D1 (cpuprices)
                                          - sources, skus
                                          - source_sku_aliases
                                          - scrape_runs
                                          - source_observations (append-only)
                                          - price_history       (append-only)
```

The Playwright scraper runs in GitHub Actions, not inside a Cloudflare Worker. Pages Functions only read from D1; they never scrape.

## Repo Layout

```
config/                  Source-of-truth JSON for sources and tracked SKUs.
migrations/              D1 schema migrations (wrangler d1 migrations apply).
scripts/                 sync-config.ts (config -> D1) and ad-hoc query helper.
src/scraper/             Daily scraper runner (entrypoint + D1 client + retry).
src/sources/             Per-source scraper modules. Add one file per source.
src/shared/              Normalization and shared types.
functions/api/           Cloudflare Pages Functions read API.
web/                     Vite + React + TypeScript + Chart.js dashboard.
.github/workflows/       scrape, deploy, migrate.
```

## Sources

| Slug          | Production URL                                  | Status     |
|---------------|--------------------------------------------------|------------|
| cpubenchmark  | https://www.cpubenchmark.net/cpu-list/all       | v1 active  |

The production daily scrape hits `/cpu-list/all` (Intel + AMD + Apple + Qualcomm + ARM + others) in one request. Per-vendor URLs (`/cpu-list/intel`, `/cpu-list/amd`) remain wired into `scrape:local:{intel,amd}` for debugging only — they write tracked rows to `price_history` and do NOT populate `source_observations`.

### Source framing

PassMark / CPUbenchmark is a benchmark and market-share proxy source. Its price column is an **observed street price** — useful as a directional signal — but it is **not a direct vendor retail price** like Newegg, CDW, Provantage, or Arrow. `raw_price_text` is preserved verbatim in both `source_observations` and `price_history` so the customer-facing UI can disclose the provenance accurately.

Designed for ~8 sources. Adding one: new file in `src/sources/`, register in `src/sources/index.ts`, add aliases under each SKU in `config/tracked-skus.json`, add a row to `config/sources.json`, then run `npm run sync:remote`.

## Tracked SKUs (v1)

Current-generation desktop only — Intel Arrow Lake (Core Ultra 200S, 6 SKUs) and AMD Ryzen 9000 (8 SKUs). Total 14. See `config/tracked-skus.json` for the canonical list and per-source aliases.

## Local Development

### Prerequisites

- Node 20+
- A Cloudflare account with D1 enabled
- `wrangler login`

### First-time setup

```bash
npm install
npx playwright install chromium

# 1. Create the remote D1 (once). Copy the database_id into wrangler.toml.
npx wrangler d1 create cpuprices

# 2. Apply the schema. Local creates .wrangler/state sqlite; remote hits production D1.
npm run migrate:local
npm run migrate:remote

# 3. Push sources + canonical SKUs + aliases into D1 from config/.
npm run sync:local
npm run sync:remote
```

### Daily commands

```bash
npm run dev                       # Local Pages dev (web + functions + local D1)
npm run build                     # Build web/ -> web/dist
npm run typecheck                 # Type-check Node project
npm test                          # Run shared-lib unit tests (money / normalize / vendor)

# Scrape into local D1
npm run scrape:local:all          # PRODUCTION SHAPE — /cpu-list/all -> source_observations + price_history
npm run scrape:local:intel        # debug — Intel-only page; price_history only, no source_observations
npm run scrape:local:amd          # debug — AMD-only page; price_history only, no source_observations
npm run scrape:verify:intel       # debug — Intel scrape with no D1 writes (prints table only)

# Scrape into REMOTE Cloudflare D1 (needs CLOUDFLARE_* env vars set)
npm run scrape:remote:all:dry-run # scrape + report; no D1 writes
npm run scrape:remote:all         # scrape + double-write to remote source_observations + price_history
npm run query:remote:status       # read-only: latest scrape_run row, total counts, vendor summary
```

### Remote workflow

The remote scrape uses the Cloudflare D1 REST API directly from Node (no
wrangler subprocess). Same pipeline code path as the local scrape — the
only difference is which `D1Executor` is wired in.

1. Provision the database (one-time): `npx wrangler d1 create cpuprices` and
   paste the returned UUID into `wrangler.toml`'s `database_id`.
2. Set credentials in `.env` (see `.env.example`) or export in shell:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`.
   `.env` is gitignored and auto-loaded by the remote commands; shell exports
   win over file values.
3. Apply schema + sync config + scrape:
   ```bash
   npm run migrate:remote
   npm run sync:remote
   npm run scrape:remote:all:dry-run    # always do a dry run first
   npm run scrape:remote:all
   npm run query:remote:status
   ```

Secrets are never written to logs, prints, or commits. The Authorization
header is the only place the API token appears; error messages truncate
response bodies and never echo headers.

## Required Secrets

| Variable                     | Used by         | Purpose                                              |
|------------------------------|-----------------|------------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`       | Scraper, CI     | API token with D1 read+write on `cpuprices`.         |
| `CLOUDFLARE_ACCOUNT_ID`      | Scraper, CI     | Cloudflare account ID.                               |
| `CLOUDFLARE_D1_DATABASE_ID`  | Scraper, CI     | Same ID stored in `wrangler.toml` `database_id`.     |

Set these as GitHub Actions repository secrets for the scheduled scrape. Locally, copy `.env.example` to `.env`. **No frontend code reads these.** The dashboard only calls our read API, which uses the D1 binding.

## Deployment

- Push to `main` triggers `.github/workflows/deploy.yml` -> builds web and deploys Pages.
- Scheduled scrape runs daily via `.github/workflows/scrape.yml`. Manual runs available via the GitHub Actions UI.
- Schema and config changes go through `.github/workflows/migrate.yml` (dispatch-only) so they stay deliberate.

## Data Model

Two append-only tables capture scraped data; each has a different role.

### `source_observations` — full daily corpus

Every row the source page returns, every day. **No `sku_id` requirement** — this table is vendor-agnostic and intentionally wide. Used for market-wide trends, vendor share, and the long tail beyond the curated basket. Vendor and segment are inferred deterministically from the CPU name (see `src/shared/vendor.ts`).

Columns: `source_id`, `scrape_run_id`, `source_sku_name`, `normalized_source_name`, `vendor_inferred` (CHECK: `NULL` or `Intel/AMD/Apple/Qualcomm/ARM/Other`), `segment_inferred` (nullable; placeholder for now), `benchmark_score`, `rank`, `cpu_value`, `price_cents`, `raw_price_text`, `currency`, `url`, `scraped_at`, `created_at`.

### `price_history` — curated tracked basket

Narrow table for the canonical SKUs declared in `config/tracked-skus.json`. Each row links to a `sku_id` and a `scrape_run_id`. Used for the customer's featured-basket views: current price, SKU history, WoW/MoM/QoQ comparisons, like-for-like deltas, XLS export.

### Single daily scrape writes to both

A `scrape:local:all` invocation:
1. GETs `/cpu-list/all`.
2. Inserts every scraped row into `source_observations` (vendor inferred).
3. Matches scraped names against `source_sku_aliases`; matched rows go additionally into `price_history`.
4. Closes the `scrape_runs` row with explicit counts:
   - `rows_found` — total rows the source returned
   - `observations_inserted` — rows inserted into `source_observations`
   - `price_history_inserted` — tracked rows inserted into `price_history`
   - `tracked_skus_matched`, `tracked_skus_missing`
   - `rows_inserted` — preserved = `price_history_inserted` for back-compat; the four columns above are the source of truth going forward.

### Append-only enforcement

Both tables have `BEFORE UPDATE` and `BEFORE DELETE` triggers that raise `SQLITE_CONSTRAINT` on any attempted mutation. INSERTs are allowed; UPDATE/DELETE are not. Defense in depth on top of the convention that the scraper code never mutates history.

### Other invariants

- Prices stored as `price_cents INTEGER` (no float drift) plus `raw_price_text` verbatim (e.g. PassMark's `*` footnote marker is preserved).
- `currency` defaults to `'USD'`.
- All timestamps are ISO-8601 UTC TEXT (sortable).
- `scrape_runs.status` is constrained to `running` / `success` / `partial` / `failure`.
- Authoritative schema: `migrations/0001_initial_schema.sql` + `0002_source_observations.sql` + `0003_scrape_runs_counts.sql`.
