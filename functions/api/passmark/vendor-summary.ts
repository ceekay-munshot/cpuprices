/**
 * GET /api/passmark/vendor-summary
 *
 * Aggregates the most recent scrape_run's source_observations by
 * vendor_inferred. One row per vendor with row counts, avg/median price,
 * and avg benchmark score. Includes the scrape_run_id and scraped_at so
 * the UI can show "as of …" labelling.
 */

import {
  aggregateByVendor,
  jsonError,
  PASSMARK_NOTE,
  safeHandle,
  type Env,
  type VendorAggregateInput,
} from '../../_lib';

interface LatestRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  /** MAX(scraped_at) of the run's observations — the data's own timestamp. */
  data_ts: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    // Latest SUCCESSFUL run by DATA time — run ids don't track data time
    // (Wayback backfills insert older captures under newer ids).
    const latestRun = await env.DB.prepare(
      `SELECT sr.id, sr.started_at, sr.finished_at,
              (SELECT MAX(so.scraped_at) FROM source_observations so
                WHERE so.scrape_run_id = sr.id) AS data_ts
       FROM scrape_runs sr
       WHERE sr.status = 'success'
       ORDER BY data_ts DESC
       LIMIT 1;`,
    ).first<LatestRunRow>();

    if (!latestRun) {
      return {
        source_note: PASSMARK_NOTE,
        latest_scrape_run_id: null,
        latest_scraped_at: null,
        vendors: [],
      };
    }

    const obsRes = await env.DB.prepare(
      `SELECT vendor_inferred, price_cents, benchmark_score
       FROM source_observations
       WHERE scrape_run_id = ?;`,
    )
      .bind(latestRun.id)
      .all<VendorAggregateInput>();

    const aggregates = aggregateByVendor(obsRes.results);
    const scrapedAt = latestRun.data_ts ?? latestRun.finished_at ?? latestRun.started_at;

    return {
      source_note: PASSMARK_NOTE,
      latest_scrape_run_id: latestRun.id,
      latest_scraped_at: scrapedAt,
      vendors: aggregates.map((a) => ({
        ...a,
        latest_scrape_run_id: latestRun.id,
        latest_scraped_at: scrapedAt,
      })),
    };
  });

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};
