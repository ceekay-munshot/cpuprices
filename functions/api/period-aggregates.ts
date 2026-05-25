/**
 * GET /api/period-aggregates
 *
 * Returns avg-price aggregates bucketed by (period_id, segment, manufacturer)
 * at three granularities: weekly, monthly, quarterly.
 *
 * For each period, the snapshot used is the LAST scrape_run that completed
 * within that period — this gives a clean "end-of-period" reading rather than
 * an average of intra-period daily averages. The frontend computes
 * period-over-period % change between consecutive rows.
 *
 * Only the (Server / Laptop / Desktop) × (Intel / AMD) cross is returned —
 * matching the Overview tab's 6-cell layout.
 *
 * Honest about sparsity: with N days of scrape history, only one period
 * exists for monthly/quarterly until the calendar rolls over. Each period
 * row includes scrape_run_count so the UI can flag thin coverage.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface RawAggregateRow {
  period_id: string;
  period_start: string;
  segment: string;
  manufacturer: string;
  avg_price_cents: number | null;
  sku_count: number;
  scrape_run_id: number;
  scrape_run_started_at: string;
}

interface RawPeriodMetaRow {
  period_id: string;
  period_start: string;
  scrape_run_count: number;
  last_scrape_run_id: number;
}

interface BucketAgg {
  segment: string;
  manufacturer: string;
  avg_price_cents: number | null;
  sku_count: number;
}

interface PeriodAgg {
  period_id: string;
  period_label: string;
  period_start: string;
  scrape_run_count: number;
  last_scrape_run_id: number;
  last_scraped_at: string;
  buckets: BucketAgg[];
}

interface PeriodAggregatesData {
  source_note: string;
  weekly:    PeriodAgg[];
  monthly:   PeriodAgg[];
  quarterly: PeriodAgg[];
}

const SEGMENTS      = ['Server', 'Laptop', 'Desktop'] as const;
const MANUFACTURERS = ['Intel',  'AMD']               as const;

/**
 * Convert an ISO date string to a quarter key like "2026-Q2".
 * SQLite has no native quarter formatter, so we compute it in TS.
 */
function isoQuarter(dateIso: string): { id: string; start: string } {
  const d = new Date(dateIso);
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  return { id: `${year}-Q${q}`, start };
}

/**
 * Pretty label for the UI ("W22-26", "Apr-26", "Q2-26").
 */
function formatLabel(periodId: string, granularity: 'weekly' | 'monthly' | 'quarterly'): string {
  if (granularity === 'weekly') {
    // periodId like "2026-W22"  -> "W22-26"
    const [yyyy, wnn] = periodId.split('-W');
    return `W${wnn}-${yyyy.slice(2)}`;
  }
  if (granularity === 'monthly') {
    // periodId like "2026-05" -> "May-26"
    const [yyyy, mm] = periodId.split('-');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const name = monthNames[Math.max(0, Math.min(11, parseInt(mm, 10) - 1))];
    return `${name}-${yyyy.slice(2)}`;
  }
  // quarterly: "2026-Q2" -> "Q2-26"
  const [yyyy, q] = periodId.split('-');
  return `${q}-${yyyy.slice(2)}`;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    const weekly    = await loadGranularity(env, 'weekly');
    const monthly   = await loadGranularity(env, 'monthly');
    const quarterly = await loadGranularity(env, 'quarterly');

    const data: PeriodAggregatesData = {
      source_note: PASSMARK_NOTE,
      weekly,
      monthly,
      quarterly,
    };
    return data;
  });

async function loadGranularity(
  env: Env,
  granularity: 'weekly' | 'monthly' | 'quarterly',
): Promise<PeriodAgg[]> {
  // SQLite period_id derivation:
  //  weekly  -> strftime('%Y-W%W', scraped_at)
  //  monthly -> strftime('%Y-%m',  scraped_at)
  //  quarter -> computed in TS (SQLite lacks quarter formatter)
  //
  // For weekly/monthly we group at the SQL level. For quarterly we group at
  // the application level since "year-Q" needs Math.floor(month/3)+1.
  const periodExpr =
    granularity === 'weekly'
      ? `strftime('%Y-W%W', scraped_at)`
      : granularity === 'monthly'
        ? `strftime('%Y-%m', scraped_at)`
        : `strftime('%Y-%m', scraped_at)`; // quarterly: aggregate by month first, then collapse in TS

  // Step 1: which scrape_run is the last one in each period?
  // We pick the highest scrape_run_id whose scraped_at falls in the period.
  const metaSql = `
    WITH per_run AS (
      SELECT
        scrape_run_id,
        ${periodExpr} AS period_id,
        MIN(scraped_at) AS run_started_at,
        MAX(scraped_at) AS run_ended_at
      FROM source_observations
      GROUP BY scrape_run_id, period_id
    ),
    last_run_per_period AS (
      SELECT
        period_id,
        MAX(scrape_run_id) AS last_scrape_run_id,
        COUNT(DISTINCT scrape_run_id) AS scrape_run_count
      FROM per_run
      GROUP BY period_id
    )
    SELECT
      lr.period_id,
      pr.run_ended_at  AS period_start,   -- timestamp of the chosen run
      lr.scrape_run_count,
      lr.last_scrape_run_id
    FROM last_run_per_period lr
    JOIN per_run pr ON pr.scrape_run_id = lr.last_scrape_run_id AND pr.period_id = lr.period_id
    ORDER BY lr.period_id DESC;
  `;
  const metaRes = await env.DB.prepare(metaSql).all<RawPeriodMetaRow>();
  let metaRows = metaRes.results;

  // For quarterly, collapse months -> quarters by picking the latest scrape
  // run across the months that belong to the same quarter.
  if (granularity === 'quarterly') {
    const collapsed = new Map<string, RawPeriodMetaRow>();
    for (const row of metaRows) {
      const { id: qid, start: qstart } = isoQuarter(row.period_start);
      const existing = collapsed.get(qid);
      if (!existing || row.last_scrape_run_id > existing.last_scrape_run_id) {
        collapsed.set(qid, {
          period_id: qid,
          period_start: existing
            ? row.last_scrape_run_id > existing.last_scrape_run_id
              ? row.period_start
              : existing.period_start
            : row.period_start,
          scrape_run_count:
            (existing?.scrape_run_count ?? 0) + row.scrape_run_count,
          last_scrape_run_id: existing
            ? Math.max(existing.last_scrape_run_id, row.last_scrape_run_id)
            : row.last_scrape_run_id,
        });
        // Use quarter start for display
        const merged = collapsed.get(qid)!;
        merged.period_start = qstart;
      }
    }
    metaRows = Array.from(collapsed.values()).sort((a, b) =>
      a.period_id < b.period_id ? 1 : -1,
    );
  }

  if (metaRows.length === 0) return [];

  // Step 2: aggregate (segment, manufacturer) buckets for each chosen run.
  const runIds = metaRows.map((r) => r.last_scrape_run_id);
  const placeholders = runIds.map(() => '?').join(',');
  const aggSql = `
    SELECT
      scrape_run_id,
      segment_inferred AS segment,
      vendor_inferred  AS manufacturer,
      AVG(CAST(price_cents AS REAL)) AS avg_price_cents,
      COUNT(*) AS sku_count
    FROM source_observations
    WHERE scrape_run_id IN (${placeholders})
      AND price_cents IS NOT NULL
      AND segment_inferred IN ('Server','Laptop','Desktop')
      AND vendor_inferred  IN ('Intel','AMD')
    GROUP BY scrape_run_id, segment_inferred, vendor_inferred;
  `;
  const aggRes = await env.DB.prepare(aggSql)
    .bind(...runIds)
    .all<{
      scrape_run_id: number;
      segment: string;
      manufacturer: string;
      avg_price_cents: number;
      sku_count: number;
    }>();

  // Step 3: stitch buckets into their period. Always emit all 6 cells per
  // period (segment × manufacturer cross) so the UI can render a stable grid;
  // missing cells become avg_price_cents = null.
  const byRun = new Map<number, BucketAgg[]>();
  for (const row of aggRes.results) {
    if (!byRun.has(row.scrape_run_id)) byRun.set(row.scrape_run_id, []);
    byRun.get(row.scrape_run_id)!.push({
      segment: row.segment,
      manufacturer: row.manufacturer,
      avg_price_cents: row.avg_price_cents,
      sku_count: row.sku_count,
    });
  }

  return metaRows.map((m) => {
    const found = byRun.get(m.last_scrape_run_id) ?? [];
    const buckets: BucketAgg[] = [];
    for (const segment of SEGMENTS) {
      for (const manufacturer of MANUFACTURERS) {
        const match = found.find(
          (b) => b.segment === segment && b.manufacturer === manufacturer,
        );
        buckets.push(
          match ?? {
            segment,
            manufacturer,
            avg_price_cents: null,
            sku_count: 0,
          },
        );
      }
    }
    return {
      period_id: m.period_id,
      period_label: formatLabel(m.period_id, granularity),
      period_start: m.period_start,
      scrape_run_count: m.scrape_run_count,
      last_scrape_run_id: m.last_scrape_run_id,
      last_scraped_at: m.period_start,
      buckets,
    };
  });
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};

// Re-export for tests / TS consumers
export type { PeriodAggregatesData, PeriodAgg, BucketAgg };
