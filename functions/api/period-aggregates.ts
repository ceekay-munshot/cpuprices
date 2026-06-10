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
 * CALENDAR-DRIVEN, not data-driven: the period list is a complete calendar
 * spine from the oldest captured period through TODAY. Periods with no
 * successful scrape inside them are still emitted, as ghost rows with
 * has_data=false and null buckets — so the live (current) period always
 * exists, the table grows with the calendar forever, and a scraper outage
 * shows up as visible gap rows instead of silently freezing the table
 * (which is exactly what happened 2026-05-26 → 2026-06-09).
 *
 * % comparisons skip ghosts: each captured period is compared against the
 * most recent prior captured period.
 *
 * Honest about sparsity: each period row includes scrape_run_count so the
 * UI can flag thin coverage.
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

/**
 * Matched-cohort comparison vs the immediately prior period in the list.
 *
 * `cohort_sku_count` is the size of the intersection of SKUs (joined by
 * `normalized_source_name`) priced in BOTH scrapes — that's the basket the
 * two averages are computed over. Without this, when the SKU mix shifts
 * (chips listed/delisted between scrapes), the standalone period averages
 * would compare apples-to-oranges and the % move would mostly reflect mix
 * change, not actual price movement.
 */
interface MatchedComparison {
  segment: string;
  manufacturer: string;
  cohort_sku_count: number;
  current_avg_cents: number | null;
  prior_avg_cents:   number | null;
}

interface PeriodAgg {
  period_id: string;
  period_label: string;
  period_start: string;
  /** false → calendar period with no successful capture (outage / pre-history gap). */
  has_data: boolean;
  scrape_run_count: number;
  last_scrape_run_id: number | null;
  last_scraped_at: string | null;
  buckets: BucketAgg[];
  /**
   * Comparison vs the most recent PRIOR CAPTURED period (ghosts are skipped).
   * null for ghost rows and for the oldest captured period.
   */
  matched_vs_prior: MatchedComparison[] | null;
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

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Monday-Sunday range that contains the given timestamp, formatted like
 * "May 18-24" within a single month or "Apr 27-May 3" when the week
 * straddles a month boundary.
 */
function weekRangeLabel(timestampIso: string): string {
  const d = new Date(timestampIso);
  if (Number.isNaN(d.getTime())) return '—';
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Days back to Monday:
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysFromMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const mMonth = MONTH_NAMES[monday.getUTCMonth()] ?? '???';
  const sMonth = MONTH_NAMES[sunday.getUTCMonth()] ?? '???';
  const mDay = monday.getUTCDate();
  const sDay = sunday.getUTCDate();
  return monday.getUTCMonth() === sunday.getUTCMonth()
    ? `${mMonth} ${mDay}-${sDay}`
    : `${mMonth} ${mDay}-${sMonth} ${sDay}`;
}

/**
 * Pretty label for the UI.
 *   weekly    → "May 18-24"  or  "Apr 27-May 3"
 *   monthly   → "May-26"
 *   quarterly → "Q2-26"
 *
 * `split()` returns `string | undefined` under noUncheckedIndexedAccess, so we
 * destructure with empty-string defaults — periodId is always well-formed in
 * practice but this keeps the type checker happy without runtime branching.
 */
function formatLabel(
  periodId: string,
  granularity: 'weekly' | 'monthly' | 'quarterly',
  referenceTimestamp: string,
): string {
  if (granularity === 'weekly') {
    return weekRangeLabel(referenceTimestamp);
  }
  if (granularity === 'monthly') {
    // periodId like "2026-05" -> "May-26"
    const [yyyy = '', mm = '01'] = periodId.split('-');
    const idx = Math.max(0, Math.min(11, parseInt(mm, 10) - 1));
    const name = MONTH_NAMES[idx] ?? '???';
    return `${name}-${yyyy.slice(2)}`;
  }
  // quarterly: "2026-Q2" -> "Q2-26"
  const [yyyy = '', q = ''] = periodId.split('-');
  return `${q}-${yyyy.slice(2)}`;
}

// ============================================================================
// Calendar spine — every period from the oldest capture through today.
// ============================================================================

type Granularity = 'weekly' | 'monthly' | 'quarterly';

/** ISO date (YYYY-MM-DD) of the Monday of the Mon-Sun week containing `d`. */
function mondayOf(d: Date): string {
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** The period id that contains `now`, per granularity. */
function currentPeriodId(granularity: Granularity, now: Date): string {
  if (granularity === 'weekly') return mondayOf(now);
  if (granularity === 'monthly') return now.toISOString().slice(0, 7);
  return isoQuarter(now.toISOString()).id;
}

/** Step a period id backward by one period. Ids are self-describing:
 *  weekly = the week's Monday (YYYY-MM-DD), monthly = YYYY-MM, quarterly = YYYY-Qn. */
function prevPeriodId(granularity: Granularity, id: string): string {
  if (granularity === 'weekly') {
    const d = new Date(`${id}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  if (granularity === 'monthly') {
    const [y = 0, m = 1] = id.split('-').map(Number);
    return m <= 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  const [y = 0, q = 1] = id.split('-Q').map(Number);
  return q <= 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

/** Calendar start of a period, as an ISO date — used as period_start for ghosts. */
function periodStartOf(granularity: Granularity, id: string): string {
  if (granularity === 'weekly') return id;
  if (granularity === 'monthly') return `${id}-01`;
  const [y = '', q = '1'] = id.split('-Q');
  return `${y}-${String((Number(q) - 1) * 3 + 1).padStart(2, '0')}-01`;
}

/**
 * DESCENDING list of every period id from the period containing `now` back
 * through `oldestId` (inclusive). If a captured period somehow sits beyond
 * "now" (clock skew, bad scraped_at), start from it rather than drop it.
 *
 * Hard-capped as a runaway guard — one bogus 1970 scraped_at must not turn
 * into a 30,000-row response. Walks NEWEST→oldest so hitting the cap sheds
 * ancient rows, never the live one. All three id formats compare correctly
 * as strings (fixed-width, big-endian date components).
 */
function buildSpineDesc(
  granularity: Granularity,
  oldestId: string,
  newestDataId: string,
  now: Date,
): string[] {
  const SPINE_MAX = 600;
  const current = currentPeriodId(granularity, now);
  let id = newestDataId > current ? newestDataId : current;
  const ids: string[] = [];
  while (id >= oldestId && ids.length < SPINE_MAX) {
    ids.push(id);
    id = prevPeriodId(granularity, id);
  }
  return ids;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const response = await safeHandle(async () => {
    // Three independent granularity workloads — fan them out so D1 latency
    // overlaps instead of stacking serially.
    const [weekly, monthly, quarterly] = await Promise.all([
      loadGranularity(env, 'weekly'),
      loadGranularity(env, 'monthly'),
      loadGranularity(env, 'quarterly'),
    ]);

    const data: PeriodAggregatesData = {
      source_note: PASSMARK_NOTE,
      weekly,
      monthly,
      quarterly,
    };
    return data;
  });

  // Underlying scrape refreshes once a day. Give the browser a tight window
  // (so a manual Refresh always feels live within ~1 min) and let Cloudflare
  // edges hold the response for 30 min with a 1-hr stale-while-revalidate
  // window — repeat visits and other dashboard users get instant loads.
  response.headers.set(
    'Cache-Control',
    'public, max-age=60, s-maxage=1800, stale-while-revalidate=3600',
  );
  return response;
};

async function loadGranularity(
  env: Env,
  granularity: Granularity,
): Promise<PeriodAgg[]> {
  // SQLite period_id derivation:
  //  weekly  -> Monday of the Mon-Sun week, as YYYY-MM-DD. ('-6 days' then
  //             'weekday 1' lands on the week's own Monday for every weekday.)
  //             A date id makes the calendar spine trivial to generate in TS
  //             and — unlike strftime('%Y-W%W') — never splits the week that
  //             straddles a year boundary into two periods.
  //  monthly -> strftime('%Y-%m', scraped_at)
  //  quarter -> computed in TS (SQLite lacks quarter formatter)
  //
  // For weekly/monthly we group at the SQL level. For quarterly we group at
  // the application level since "year-Q" needs Math.floor(month/3)+1.
  const periodExpr =
    granularity === 'weekly'
      ? `date(scraped_at, '-6 days', 'weekday 1')`
      : granularity === 'monthly'
        ? `strftime('%Y-%m', scraped_at)`
        : `strftime('%Y-%m', scraped_at)`; // quarterly: aggregate by month first, then collapse in TS

  // Step 1: which scrape_run is the last one in each period?
  // We pick the highest scrape_run_id whose scraped_at falls in the period,
  // restricted to runs that actually finished successfully. A stuck or partial
  // run (status='running' with finished_at=null, or status='failed') would
  // otherwise silently become the period's "latest snapshot" and pollute the
  // averages — observed in the wild as scrape_run #4 leaving the dashboard
  // with 0 Server-Intel rows in its live period.
  const metaSql = `
    WITH per_run AS (
      SELECT
        so.scrape_run_id,
        ${periodExpr.replace(/scraped_at/g, 'so.scraped_at')} AS period_id,
        MIN(so.scraped_at) AS run_started_at,
        MAX(so.scraped_at) AS run_ended_at
      FROM source_observations so
      JOIN scrape_runs sr ON sr.id = so.scrape_run_id
      WHERE sr.status = 'success'
      GROUP BY so.scrape_run_id, period_id
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

  // For quarterly, collapse months -> quarters: the quarter's snapshot is the
  // latest scrape run across its months, and scrape_run_count sums over ALL
  // months (not just those that raised the max run id).
  if (granularity === 'quarterly') {
    const collapsed = new Map<string, RawPeriodMetaRow>();
    for (const row of metaRows) {
      const { id: qid, start: qstart } = isoQuarter(row.period_start);
      const existing = collapsed.get(qid);
      if (!existing) {
        collapsed.set(qid, {
          period_id: qid,
          period_start: qstart,
          scrape_run_count: row.scrape_run_count,
          last_scrape_run_id: row.last_scrape_run_id,
        });
      } else {
        existing.scrape_run_count += row.scrape_run_count;
        existing.last_scrape_run_id = Math.max(
          existing.last_scrape_run_id,
          row.last_scrape_run_id,
        );
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

  // Step 3a: matched-cohort comparisons for each adjacent pair of periods.
  // For pair (metaRows[i], metaRows[i+1]) we restrict the averages to SKUs
  // present in BOTH scrapes (joined by normalized_source_name) so the % cell
  // reflects price movement, not basket churn. Each pair is an independent
  // D1 round-trip, so fan them out in parallel.
  const pairs: Array<{ periodId: string; cur: number; prior: number }> = [];
  for (let i = 0; i < metaRows.length - 1; i++) {
    const cur = metaRows[i];
    const prior = metaRows[i + 1];
    if (!cur || !prior) continue;
    pairs.push({ periodId: cur.period_id, cur: cur.last_scrape_run_id, prior: prior.last_scrape_run_id });
  }
  const pairResults = await Promise.all(
    pairs.map((p) => matchedCohort(env, p.cur, p.prior)),
  );
  const matchedByPeriod = new Map<string, MatchedComparison[]>();
  pairs.forEach((p, idx) => {
    matchedByPeriod.set(p.periodId, pairResults[idx] ?? []);
  });

  // Step 4: lay the captured periods onto the full calendar spine. Slots
  // without a capture become ghost rows — the current (live) period is always
  // emitted, so the table keeps growing with the calendar even when the
  // scraper is down, and outage gaps stay visible instead of collapsing.
  const byId = new Map(metaRows.map((m) => [m.period_id, m]));
  const newestData = metaRows[0]?.period_id;
  const oldestData = metaRows[metaRows.length - 1]?.period_id;
  if (!newestData || !oldestData) return [];
  const spine = buildSpineDesc(granularity, oldestData, newestData, new Date());

  return spine.map((id) => {
    const m = byId.get(id);
    if (!m) {
      const start = periodStartOf(granularity, id);
      return {
        period_id: id,
        period_label: formatLabel(id, granularity, start),
        period_start: start,
        has_data: false,
        scrape_run_count: 0,
        last_scrape_run_id: null,
        last_scraped_at: null,
        buckets: fillBucketGrid([]),
        matched_vs_prior: null,
      };
    }
    // matchedByPeriod has no entry for the oldest captured period (nothing
    // earlier to compare against) — that's the only captured row with null.
    const matched = matchedByPeriod.get(m.period_id);
    return {
      period_id: m.period_id,
      period_label: formatLabel(m.period_id, granularity, m.period_start),
      period_start: m.period_start,
      has_data: true,
      scrape_run_count: m.scrape_run_count,
      last_scrape_run_id: m.last_scrape_run_id,
      last_scraped_at: m.period_start,
      buckets: fillBucketGrid(byRun.get(m.last_scrape_run_id) ?? []),
      matched_vs_prior: matched ? fillMatchedGrid(matched) : null,
    };
  });
}

/** Ensure all 6 (segment × manufacturer) bucket cells exist, missing → null avg. */
function fillBucketGrid(found: BucketAgg[]): BucketAgg[] {
  const out: BucketAgg[] = [];
  for (const segment of SEGMENTS) {
    for (const manufacturer of MANUFACTURERS) {
      const match = found.find(
        (b) => b.segment === segment && b.manufacturer === manufacturer,
      );
      out.push(
        match ?? { segment, manufacturer, avg_price_cents: null, sku_count: 0 },
      );
    }
  }
  return out;
}

/**
 * Restrict each (segment, manufacturer) average to SKUs priced in BOTH
 * scrapes — the intersection joined by normalized_source_name. Segment and
 * manufacturer classification follow the current scrape; if a SKU was
 * reclassified between the two scrapes (rare), it's bucketed under its
 * current label, which is what the cell label promises.
 *
 * DISTINCT on the subqueries defends against the same SKU appearing twice
 * in one scrape — shouldn't happen with the PassMark all-CPUs source but
 * the schema doesn't enforce it, and a duplicate would inflate the COUNT
 * and skew the AVG via a cartesian fan-out.
 */
async function matchedCohort(
  env: Env,
  currentRunId: number,
  priorRunId:   number,
): Promise<MatchedComparison[]> {
  const sql = `
    WITH current_obs AS (
      SELECT normalized_source_name, segment_inferred, vendor_inferred,
             AVG(CAST(price_cents AS REAL)) AS price
      FROM source_observations
      WHERE scrape_run_id = ?1
        AND price_cents IS NOT NULL
        AND segment_inferred IN ('Server','Laptop','Desktop')
        AND vendor_inferred  IN ('Intel','AMD')
      GROUP BY normalized_source_name, segment_inferred, vendor_inferred
    ),
    prior_obs AS (
      SELECT normalized_source_name,
             AVG(CAST(price_cents AS REAL)) AS price
      FROM source_observations
      WHERE scrape_run_id = ?2
        AND price_cents IS NOT NULL
      GROUP BY normalized_source_name
    )
    SELECT c.segment_inferred AS segment,
           c.vendor_inferred  AS manufacturer,
           COUNT(*)                AS cohort_sku_count,
           AVG(c.price)            AS current_avg_cents,
           AVG(p.price)            AS prior_avg_cents
    FROM current_obs c
    INNER JOIN prior_obs p
      ON p.normalized_source_name = c.normalized_source_name
    GROUP BY c.segment_inferred, c.vendor_inferred;
  `;
  const res = await env.DB.prepare(sql).bind(currentRunId, priorRunId).all<{
    segment: string;
    manufacturer: string;
    cohort_sku_count: number;
    current_avg_cents: number | null;
    prior_avg_cents:   number | null;
  }>();
  return res.results.map((r) => ({
    segment:           r.segment,
    manufacturer:      r.manufacturer,
    cohort_sku_count:  r.cohort_sku_count,
    current_avg_cents: r.current_avg_cents,
    prior_avg_cents:   r.prior_avg_cents,
  }));
}

/** Ensure all 6 (segment × manufacturer) cells exist, missing → zero cohort. */
function fillMatchedGrid(rows: MatchedComparison[]): MatchedComparison[] {
  const out: MatchedComparison[] = [];
  for (const segment of SEGMENTS) {
    for (const manufacturer of MANUFACTURERS) {
      const m = rows.find(
        (r) => r.segment === segment && r.manufacturer === manufacturer,
      );
      out.push(
        m ?? {
          segment,
          manufacturer,
          cohort_sku_count: 0,
          current_avg_cents: null,
          prior_avg_cents:   null,
        },
      );
    }
  }
  return out;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};

// Re-export for tests / TS consumers
export type { PeriodAggregatesData, PeriodAgg, BucketAgg, MatchedComparison };
