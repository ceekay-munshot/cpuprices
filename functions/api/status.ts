/**
 * GET /api/status
 *
 * Returns the latest scrape_runs row, total counts for both tables, and
 * derived freshness fields the dashboard uses to render a "stale data"
 * banner when the daily scrape didn't run.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface LatestRunRow {
  id: number;
  source_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_found: number | null;
  rows_inserted: number | null;
  observations_inserted: number | null;
  price_history_inserted: number | null;
  tracked_skus_matched: number | null;
  tracked_skus_missing: number | null;
}

interface CountRow {
  cnt: number;
}

const FRESHNESS_DAILY_MINUTES = 60 * 24;

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    const latestRun = await env.DB.prepare(
      `SELECT id, source_id, status, started_at, finished_at, rows_found, rows_inserted,
              observations_inserted, price_history_inserted,
              tracked_skus_matched, tracked_skus_missing
       FROM scrape_runs ORDER BY id DESC LIMIT 1;`,
    ).first<LatestRunRow>();

    const [obsRow, phRow] = await Promise.all([
      env.DB.prepare('SELECT count(*) AS cnt FROM source_observations;').first<CountRow>(),
      env.DB.prepare('SELECT count(*) AS cnt FROM price_history;').first<CountRow>(),
    ]);

    const lastScrapedAt = latestRun?.finished_at ?? latestRun?.started_at ?? null;
    let minutesSinceLastScrape: number | null = null;
    let isFreshDaily = false;
    if (lastScrapedAt) {
      const lastMs = Date.parse(lastScrapedAt);
      if (Number.isFinite(lastMs)) {
        minutesSinceLastScrape = Math.floor((Date.now() - lastMs) / 60_000);
        isFreshDaily = minutesSinceLastScrape <= FRESHNESS_DAILY_MINUTES;
      }
    }

    return {
      latest_run: latestRun,
      source_observations_count: obsRow?.cnt ?? 0,
      price_history_count: phRow?.cnt ?? 0,
      last_scraped_at: lastScrapedAt,
      minutes_since_last_scrape: minutesSinceLastScrape,
      is_fresh_daily: isFreshDaily,
      source_note: PASSMARK_NOTE,
    };
  });

// Reject non-GET methods explicitly so an accidental POST doesn't 404 silently.
export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};
