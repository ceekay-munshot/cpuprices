/**
 * GET /api/status
 *
 * Returns the latest scrape_runs row, the latest SUCCESSFUL run, total counts
 * for both tables, and derived freshness fields.
 *
 * Freshness is computed from the last SUCCESSFUL scrape, not the last attempt.
 * During the 2026-05-26 → 2026-06-09 outage the dashboard showed "Fresh · 5h
 * ago" for two weeks because every failing run still updated last_scraped_at —
 * the badge was tracking attempts while the data quietly went stale.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface LatestRunRow {
  id: number;
  source_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
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

const RUN_COLUMNS =
  'id, source_id, status, started_at, finished_at, error_message, rows_found, rows_inserted, ' +
  'observations_inserted, price_history_inserted, tracked_skus_matched, tracked_skus_missing';

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    const [latestRun, latestSuccessRun, obsRow, successObsRow, phRow, successCountRow, failsSinceSuccessRow] =
      await Promise.all([
        env.DB.prepare(
          `SELECT ${RUN_COLUMNS} FROM scrape_runs ORDER BY id DESC LIMIT 1;`,
        ).first<LatestRunRow>(),
        env.DB.prepare(
          `SELECT ${RUN_COLUMNS} FROM scrape_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1;`,
        ).first<LatestRunRow>(),
        env.DB.prepare('SELECT count(*) AS cnt FROM source_observations;').first<CountRow>(),
        // Rows attached to successful runs — what the aggregates actually use.
        // Failed runs leave partially-inserted orphan rows behind (append-only
        // schema), so the raw total overstates usable history.
        env.DB.prepare(
          `SELECT count(*) AS cnt FROM source_observations so
           JOIN scrape_runs sr ON sr.id = so.scrape_run_id
           WHERE sr.status = 'success';`,
        ).first<CountRow>(),
        env.DB.prepare('SELECT count(*) AS cnt FROM price_history;').first<CountRow>(),
        env.DB.prepare(
          `SELECT count(*) AS cnt FROM scrape_runs WHERE status = 'success';`,
        ).first<CountRow>(),
        // Attempts newer than the last success that did not succeed — the
        // current failure streak. 'running' rows older than a day are stuck,
        // not in-flight, so they count too.
        env.DB.prepare(
          `SELECT count(*) AS cnt FROM scrape_runs
           WHERE id > (SELECT COALESCE(MAX(id), 0) FROM scrape_runs WHERE status = 'success')
             AND status != 'success';`,
        ).first<CountRow>(),
      ]);

    const lastAttemptAt = latestRun?.finished_at ?? latestRun?.started_at ?? null;
    const lastSuccessAt = latestSuccessRun?.finished_at ?? latestSuccessRun?.started_at ?? null;

    const minutesSince = (iso: string | null): number | null => {
      if (!iso) return null;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? Math.floor((Date.now() - ms) / 60_000) : null;
    };

    const minutesSinceLastSuccess = minutesSince(lastSuccessAt);
    const isFreshDaily =
      minutesSinceLastSuccess != null && minutesSinceLastSuccess <= FRESHNESS_DAILY_MINUTES;

    return {
      latest_run: latestRun,
      latest_success_run: latestSuccessRun,
      source_observations_count: obsRow?.cnt ?? 0,
      source_observations_in_success_runs: successObsRow?.cnt ?? 0,
      price_history_count: phRow?.cnt ?? 0,
      success_run_count: successCountRow?.cnt ?? 0,
      consecutive_failures: failsSinceSuccessRow?.cnt ?? 0,
      /** Last attempt of any status — kept for CI verification and debugging. */
      last_scraped_at: lastAttemptAt,
      minutes_since_last_scrape: minutesSince(lastAttemptAt),
      /** Last scrape that actually landed data — what freshness means. */
      last_success_at: lastSuccessAt,
      minutes_since_last_success: minutesSinceLastSuccess,
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
