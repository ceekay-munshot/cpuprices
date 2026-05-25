/**
 * GET /api/observations
 *
 * Returns every source_observations row from the latest scrape_run — the
 * full PassMark CPU universe (~5,900 rows). Filtering and pagination happen
 * client-side; this endpoint keeps responsibility narrow: "give me the most
 * recent snapshot of /cpu-list/all".
 *
 * Distinct from /api/current-prices which is the curated tracked-basket view
 * keyed by sku_id; this view has no sku_id requirement and covers every
 * vendor PassMark publishes (Intel, AMD, Apple, Qualcomm, ARM, Other).
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface LatestRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
}

interface ObservationRow {
  source_sku_name: string;
  normalized_source_name: string;
  vendor_inferred: string | null;
  segment_inferred: string | null;
  benchmark_score: number | null;
  rank: number | null;
  cpu_value: number | null;
  price_cents: number | null;
  raw_price_text: string | null;
  currency: string;
  url: string | null;
  scraped_at: string;
  // Closest historical price (taken from the LATEST observation whose
  // scraped_at is on/before the cutoff). Null when no observation exists
  // that far back yet, OR when the CPU was added to the source after the
  // cutoff. Fills in automatically as the daily cron accumulates history.
  wow_price_cents: number | null; //  7 days
  mom_price_cents: number | null; // 30 days
  qoq_price_cents: number | null; // 90 days
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    const latestRun = await env.DB.prepare(
      `SELECT id, started_at, finished_at FROM scrape_runs ORDER BY id DESC LIMIT 1;`,
    ).first<LatestRunRow>();

    if (!latestRun) {
      return {
        source_note: PASSMARK_NOTE,
        latest_scrape_run_id: null,
        latest_scraped_at: null,
        count: 0,
        rows: [] as ObservationRow[],
      };
    }

    // For each row in the latest scrape, look up the closest historical
    // price at 7 / 30 / 90 days before the latest run's timestamp via
    // correlated subqueries. Matching is by normalized_source_name (stable
    // across cosmetic renames). NULL when no observation that far back yet
    // — which is the honest state today (2 days of remote history).
    //
    // Performance: 5,889 rows × 3 subqueries = ~18k lookups. With the
    // existing idx_so_normalized index this completes in <100ms on the
    // current ~12k-row corpus. A compound (normalized_source_name,
    // scraped_at DESC) index will be worth adding once history reaches
    // 30+ days × 5,889 SKUs (~180k+ rows).
    //
    // SQLite DESC sorts NULLs last by default — rows with a benchmark
    // score float to the top so the workbench opens on recognizable chips.
    const latestTs = latestRun.finished_at ?? latestRun.started_at;
    const res = await env.DB.prepare(
      `SELECT
         l.source_sku_name, l.normalized_source_name,
         l.vendor_inferred, l.segment_inferred,
         l.benchmark_score, l.rank, l.cpu_value,
         l.price_cents, l.raw_price_text, l.currency,
         l.url, l.scraped_at,
         (SELECT price_cents FROM source_observations
            WHERE normalized_source_name = l.normalized_source_name
              AND scraped_at <= datetime(?2, '-7 days')
            ORDER BY scraped_at DESC LIMIT 1) AS wow_price_cents,
         (SELECT price_cents FROM source_observations
            WHERE normalized_source_name = l.normalized_source_name
              AND scraped_at <= datetime(?2, '-30 days')
            ORDER BY scraped_at DESC LIMIT 1) AS mom_price_cents,
         (SELECT price_cents FROM source_observations
            WHERE normalized_source_name = l.normalized_source_name
              AND scraped_at <= datetime(?2, '-90 days')
            ORDER BY scraped_at DESC LIMIT 1) AS qoq_price_cents
       FROM source_observations l
       WHERE l.scrape_run_id = ?1
       ORDER BY l.benchmark_score DESC, l.source_sku_name ASC;`,
    )
      .bind(latestRun.id, latestTs)
      .all<ObservationRow>();

    return {
      source_note: PASSMARK_NOTE,
      latest_scrape_run_id: latestRun.id,
      latest_scraped_at: latestRun.finished_at ?? latestRun.started_at,
      count: res.results.length,
      rows: res.results,
    };
  });

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};
