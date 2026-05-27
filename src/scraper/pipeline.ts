/**
 * Shared scrape pipeline. Same code path for local-D1 and remote-D1 runs;
 * the difference is which `D1Executor` you hand it.
 *
 * Two flows:
 *   - scrapeVendorIntoD1()  — per-vendor debug path; writes only to price_history
 *   - scrapeAllIntoD1()     — production-shaped /cpu-list/all path; writes
 *                              every row to source_observations and matched
 *                              tracked SKUs to price_history. Supports dryRun.
 *
 * Append-only on both target tables is enforced by the migration's triggers.
 */

import type { Browser } from 'playwright';
import type { Logger, TrackedSku } from '../shared/types';
import { normalizeCpuName } from '../shared/normalize';
import { inferSegment } from '../shared/segment';
import { inferVendor } from '../shared/vendor';
import { scrapeAllRows, type CpubenchmarkRow } from '../sources/cpubenchmark';
import {
  sqlString,
  sqlValue,
  type D1Executor,
  type D1ResultBlock,
} from './d1-client';

const SOURCE_SLUG = 'cpubenchmark';

export type ScrapeRunStatus = 'success' | 'partial' | 'failure';

// ============================================================================
// Per-vendor (debug) pipeline
// ============================================================================

export interface VendorRunResult {
  vendor: string;
  scrapeRunId: number;
  status: ScrapeRunStatus;
  rowsFound: number;
  rowsInserted: number;   // = price_history rows inserted
  matched: number;
  tracked: TrackedSku[];
  missing: TrackedSku[];
  beforeCount: number;
  afterCount: number;
}

export interface VendorScrapeFn {
  (ctx: {
    browser: Browser;
    logger: Logger;
    trackedSkus: TrackedSku[];
  }): Promise<CpubenchmarkRow[]>;
}

export interface VendorRunOptions {
  executor: D1Executor;
  vendor: string;
  trackedSkus: TrackedSku[];
  scrape: VendorScrapeFn;
  browser: Browser;
  logger: Logger;
}

export async function scrapeVendorIntoD1(opts: VendorRunOptions): Promise<VendorRunResult> {
  const { executor, vendor, scrape, browser, logger } = opts;
  const tracked = opts.trackedSkus.filter((s) => s.vendor === vendor);
  if (tracked.length === 0) {
    throw new Error(`No tracked SKUs found for vendor "${vendor}"`);
  }

  const sourceId = scalarNumber(
    await executor.exec(`SELECT id FROM sources WHERE slug = ${sqlString(SOURCE_SLUG)};`),
    'id',
  );
  if (sourceId == null) {
    throw new Error(
      `${SOURCE_SLUG} source not found in D1 (${executor.label}). Did you run sync?`,
    );
  }

  const skuRes = await executor.exec(`SELECT id, name FROM skus WHERE vendor = ${sqlString(vendor)};`);
  const skuIdByName = new Map<string, number>();
  for (const row of skuRes[0]?.results ?? []) {
    skuIdByName.set(String(row.name), Number(row.id));
  }

  const aliasRes = await executor.exec(
    `SELECT a.normalized_source_name AS norm, a.sku_id AS sku_id, s.name AS canonical ` +
      `FROM source_sku_aliases a JOIN skus s ON s.id = a.sku_id ` +
      `WHERE a.source_id = ${sourceId} AND s.vendor = ${sqlString(vendor)};`,
  );
  const aliasIndex = new Map<string, { canonical: string; skuId: number }>();
  for (const row of aliasRes[0]?.results ?? []) {
    aliasIndex.set(String(row.norm), {
      canonical: String(row.canonical),
      skuId: Number(row.sku_id),
    });
  }
  for (const sku of tracked) {
    const skuId = skuIdByName.get(sku.name);
    if (skuId != null) {
      const norm = normalizeCpuName(sku.name);
      if (!aliasIndex.has(norm)) aliasIndex.set(norm, { canonical: sku.name, skuId });
    }
  }

  logger.info(
    `[${vendor}] source_id=${sourceId}, skus=${skuIdByName.size}, aliases=${aliasIndex.size} (${executor.label})`,
  );

  const beforeCount = await getPriceHistoryCount(executor);

  const startedAt = new Date().toISOString();
  const scraped = await scrape({ browser, logger, trackedSkus: tracked });

  const matched = new Map<string, { row: CpubenchmarkRow; skuId: number }>();
  for (const row of scraped) {
    const hit = aliasIndex.get(normalizeCpuName(row.sourceSkuName));
    if (hit && !matched.has(hit.canonical)) {
      matched.set(hit.canonical, { row, skuId: hit.skuId });
    }
  }
  const missing = tracked.filter((s) => !matched.has(s.name));

  const runOpen = await executor.exec(
    `INSERT INTO scrape_runs (source_id, status, started_at) ` +
      `VALUES (${sourceId}, 'running', ${sqlString(startedAt)}) RETURNING id;`,
  );
  const scrapeRunId = scalarNumber(runOpen, 'id');
  if (scrapeRunId == null) {
    throw new Error('Failed to capture scrape_run id from INSERT...RETURNING.');
  }

  let afterCount: number;
  let rowsFound: number;
  let rowsInserted: number;
  let status: ScrapeRunStatus;
  try {
    rowsFound = scraped.length;
    rowsInserted = matched.size;
    status =
      rowsInserted === tracked.length ? 'success' : rowsInserted > 0 ? 'partial' : 'failure';
    const finishedAt = new Date().toISOString();

    const valueRows: string[] = [];
    for (const sku of tracked) {
      const m = matched.get(sku.name);
      if (!m) continue;
      const { row, skuId } = m;
      valueRows.push(
        `(${skuId}, ${sourceId}, ${scrapeRunId}, ` +
          `${sqlString(row.sourceSkuName)}, ${sqlValue(row.priceCents)}, ${sqlValue(row.rawPriceText)}, ` +
          `'USD', 'street', ${sqlValue(row.cpuMark)}, ${sqlValue(row.url)}, ${sqlString(row.scrapedAt)})`,
      );
    }
    const batchSql = [
      'PRAGMA foreign_keys = ON;',
      valueRows.length > 0
        ? `INSERT INTO price_history (sku_id, source_id, scrape_run_id, source_sku_name, price_cents, raw_price_text, currency, price_type, benchmark_score, url, scraped_at) VALUES\n  ${valueRows.join(',\n  ')};`
        : '-- no matched rows',
      `UPDATE scrape_runs SET status = ${sqlString(status)}, finished_at = ${sqlString(finishedAt)}, rows_found = ${rowsFound}, rows_inserted = ${rowsInserted} WHERE id = ${scrapeRunId};`,
    ].join('\n');
    await executor.execBatch(batchSql);

    // observations_inserted is 0 because the per-vendor debug scripts never
    // write to source_observations.
    await executor.execBatch(
      'PRAGMA foreign_keys = ON;\n' +
        `UPDATE scrape_runs SET ` +
        `observations_inserted = 0, ` +
        `price_history_inserted = ${rowsInserted}, ` +
        `tracked_skus_matched = ${matched.size}, ` +
        `tracked_skus_missing = ${missing.length} ` +
        `WHERE id = ${scrapeRunId};`,
    );
    logger.info(
      `[${vendor}] scrape_run ${scrapeRunId} -> ${status}; inserted ${rowsInserted}/${tracked.length} (${executor.label})`,
    );

    afterCount = await getPriceHistoryCount(executor);
  } catch (err) {
    await markRunFailedBestEffort(executor, scrapeRunId, logger, `[${vendor}]`, err);
    throw err;
  }

  return {
    vendor,
    scrapeRunId,
    status,
    rowsFound,
    rowsInserted,
    matched: matched.size,
    tracked,
    missing,
    beforeCount,
    afterCount,
  };
}

// ============================================================================
// /cpu-list/all (production-shaped) pipeline
// ============================================================================

export interface VendorAggregate {
  vendor: string;
  rowsObserved: number;
  rowsWithPrice: number;
  avgPriceCents: number | null;
  medianPriceCents: number | null;
  avgCpuMark: number | null;
}

export interface AllScrapeResult {
  dryRun: boolean;
  /** null on dry runs (no scrape_runs row is opened). */
  scrapeRunId: number | null;
  status: ScrapeRunStatus;
  rowsFound: number;
  rowsInsertedObservations: number;
  rowsInsertedPriceHistory: number;
  trackedMatched: number;
  trackedTotal: number;
  trackedMissing: TrackedSku[];
  beforeObservationsCount: number;
  afterObservationsCount: number;
  beforePriceHistoryCount: number;
  afterPriceHistoryCount: number;
  vendorAggregates: VendorAggregate[];
}

/** Chunk size for the source_observations INSERT to stay well under
 *  D1 REST and wrangler --file per-request size limits. */
const OBSERVATIONS_INSERT_CHUNK = 500;

export async function scrapeAllIntoD1(opts: {
  executor: D1Executor;
  trackedSkus: TrackedSku[];
  browser: Browser;
  logger: Logger;
  dryRun?: boolean;
}): Promise<AllScrapeResult> {
  const { executor, trackedSkus, browser, logger } = opts;
  const dryRun = opts.dryRun === true;

  const sourceId = scalarNumber(
    await executor.exec(`SELECT id FROM sources WHERE slug = ${sqlString(SOURCE_SLUG)};`),
    'id',
  );
  if (sourceId == null) {
    throw new Error(
      `${SOURCE_SLUG} source not found in D1 (${executor.label}). Did you run sync?`,
    );
  }

  const skuRes = await executor.exec('SELECT id, name FROM skus;');
  const skuIdByName = new Map<string, number>();
  for (const row of skuRes[0]?.results ?? []) {
    skuIdByName.set(String(row.name), Number(row.id));
  }
  const aliasRes = await executor.exec(
    `SELECT a.normalized_source_name AS norm, a.sku_id AS sku_id, s.name AS canonical ` +
      `FROM source_sku_aliases a JOIN skus s ON s.id = a.sku_id ` +
      `WHERE a.source_id = ${sourceId};`,
  );
  const aliasIndex = new Map<string, { canonical: string; skuId: number }>();
  for (const row of aliasRes[0]?.results ?? []) {
    aliasIndex.set(String(row.norm), {
      canonical: String(row.canonical),
      skuId: Number(row.sku_id),
    });
  }
  for (const sku of trackedSkus) {
    const skuId = skuIdByName.get(sku.name);
    if (skuId != null) {
      const norm = normalizeCpuName(sku.name);
      if (!aliasIndex.has(norm)) aliasIndex.set(norm, { canonical: sku.name, skuId });
    }
  }

  logger.info(
    `[all/${executor.label}${dryRun ? '/dry-run' : ''}] source_id=${sourceId}, skus=${skuIdByName.size}, aliases=${aliasIndex.size}, tracked=${trackedSkus.length}`,
  );

  const beforeObservations = await getSourceObservationsCount(executor);
  const beforePriceHistory = await getPriceHistoryCount(executor);

  const scraped = await scrapeAllRows({ browser, logger, trackedSkus });
  logger.info(`[all/${executor.label}] scraped ${scraped.length} rows from /cpu-list/all`);

  const matched = new Map<string, { row: CpubenchmarkRow; skuId: number }>();
  for (const row of scraped) {
    const hit = aliasIndex.get(normalizeCpuName(row.sourceSkuName));
    if (hit && !matched.has(hit.canonical)) {
      matched.set(hit.canonical, { row, skuId: hit.skuId });
    }
  }
  const trackedMissing = trackedSkus.filter((s) => !matched.has(s.name));

  const rowsFound = scraped.length;

  if (dryRun) {
    // Dry run: skip every write. Compute aggregates in memory from the
    // scraped rows directly (no D1 round-trip needed).
    const vendorAggregates = computeVendorAggregatesFromRows(scraped);
    logger.info(`[all/${executor.label}/dry-run] would insert ${rowsFound} observations + ${matched.size} price_history rows`);
    return {
      dryRun: true,
      scrapeRunId: null,
      status:
        matched.size === trackedSkus.length ? 'success' : matched.size > 0 ? 'partial' : 'failure',
      rowsFound,
      rowsInsertedObservations: rowsFound, // would-be count
      rowsInsertedPriceHistory: matched.size, // would-be count
      trackedMatched: matched.size,
      trackedTotal: trackedSkus.length,
      trackedMissing,
      beforeObservationsCount: beforeObservations,
      afterObservationsCount: beforeObservations,
      beforePriceHistoryCount: beforePriceHistory,
      afterPriceHistoryCount: beforePriceHistory,
      vendorAggregates,
    };
  }

  // Open scrape_runs row.
  const startedAt = new Date().toISOString();
  const runOpen = await executor.exec(
    `INSERT INTO scrape_runs (source_id, status, started_at) ` +
      `VALUES (${sourceId}, 'running', ${sqlString(startedAt)}) RETURNING id;`,
  );
  const scrapeRunId = scalarNumber(runOpen, 'id');
  if (scrapeRunId == null) {
    throw new Error('Failed to capture scrape_run id from INSERT...RETURNING.');
  }

  // Everything after this opens the run row; any throw between here and the
  // final UPDATE would leave the run as status='running' forever (observed in
  // the wild as scrape_run #4: 6 chunks of 500 obs inserted, chunk 7 errored,
  // run row never closed, dashboard treated the partial scrape as the latest
  // snapshot). Wrap the work and best-effort-mark the run failed on throw.
  let status: ScrapeRunStatus;
  let rowsInsertedObs: number;
  let rowsInsertedPh: number;
  let afterObservations: number;
  let afterPriceHistory: number;
  let vendorAggregates: VendorAggregate[];
  try {
    const obsValues: string[] = [];
    for (const row of scraped) {
      const norm = normalizeCpuName(row.sourceSkuName);
      const vendor = inferVendor(row.sourceSkuName);
      const segment = inferSegment(row.sourceSkuName);
      obsValues.push(
        `(${sourceId}, ${scrapeRunId}, ` +
          `${sqlString(row.sourceSkuName)}, ${sqlString(norm)}, ` +
          `${sqlString(vendor)}, ${sqlValue(segment)}, ` +
          `${sqlValue(row.cpuMark)}, ${sqlValue(row.rank)}, ${sqlValue(row.cpuValue)}, ` +
          `${sqlValue(row.priceCents)}, ${sqlValue(row.rawPriceText)}, ` +
          `'USD', ${sqlValue(row.url)}, ${sqlString(row.scrapedAt)})`,
      );
    }

    for (let i = 0; i < obsValues.length; i += OBSERVATIONS_INSERT_CHUNK) {
      const chunk = obsValues.slice(i, i + OBSERVATIONS_INSERT_CHUNK);
      const sql = [
        'PRAGMA foreign_keys = ON;',
        `INSERT INTO source_observations (source_id, scrape_run_id, source_sku_name, normalized_source_name, vendor_inferred, segment_inferred, benchmark_score, rank, cpu_value, price_cents, raw_price_text, currency, url, scraped_at) VALUES\n  ${chunk.join(',\n  ')};`,
      ].join('\n');
      await executor.execBatch(sql);
      logger.info(`[all/${executor.label}] observations inserted ${Math.min(i + OBSERVATIONS_INSERT_CHUNK, obsValues.length)}/${obsValues.length}`);
    }

    const phValues: string[] = [];
    for (const sku of trackedSkus) {
      const m = matched.get(sku.name);
      if (!m) continue;
      const { row, skuId } = m;
      phValues.push(
        `(${skuId}, ${sourceId}, ${scrapeRunId}, ` +
          `${sqlString(row.sourceSkuName)}, ${sqlValue(row.priceCents)}, ${sqlValue(row.rawPriceText)}, ` +
          `'USD', 'street', ${sqlValue(row.cpuMark)}, ${sqlValue(row.url)}, ${sqlString(row.scrapedAt)})`,
      );
    }
    if (phValues.length > 0) {
      await executor.execBatch(
        'PRAGMA foreign_keys = ON;\n' +
          `INSERT INTO price_history (sku_id, source_id, scrape_run_id, source_sku_name, price_cents, raw_price_text, currency, price_type, benchmark_score, url, scraped_at) VALUES\n  ${phValues.join(',\n  ')};`,
      );
    }

    const finishedAt = new Date().toISOString();
    rowsInsertedObs = obsValues.length;
    rowsInsertedPh = phValues.length;
    status =
      rowsInsertedObs === rowsFound && rowsInsertedPh === trackedSkus.length
        ? 'success'
        : rowsInsertedObs > 0
          ? 'partial'
          : 'failure';

    await executor.execBatch(
      'PRAGMA foreign_keys = ON;\n' +
        `UPDATE scrape_runs SET ` +
        `status = ${sqlString(status)}, ` +
        `finished_at = ${sqlString(finishedAt)}, ` +
        `rows_found = ${rowsFound}, ` +
        `rows_inserted = ${rowsInsertedPh}, ` +
        `observations_inserted = ${rowsInsertedObs}, ` +
        `price_history_inserted = ${rowsInsertedPh}, ` +
        `tracked_skus_matched = ${matched.size}, ` +
        `tracked_skus_missing = ${trackedMissing.length} ` +
        `WHERE id = ${scrapeRunId};`,
    );
    logger.info(`[all/${executor.label}] scrape_run ${scrapeRunId} -> ${status}`);

    afterObservations = await getSourceObservationsCount(executor);
    afterPriceHistory = await getPriceHistoryCount(executor);
    vendorAggregates = await computeVendorAggregatesFromDb(executor, scrapeRunId);
  } catch (err) {
    await markRunFailedBestEffort(executor, scrapeRunId, logger, `[all/${executor.label}]`, err);
    throw err;
  }

  return {
    dryRun: false,
    scrapeRunId,
    status,
    rowsFound,
    rowsInsertedObservations: rowsInsertedObs,
    rowsInsertedPriceHistory: rowsInsertedPh,
    trackedMatched: matched.size,
    trackedTotal: trackedSkus.length,
    trackedMissing,
    beforeObservationsCount: beforeObservations,
    afterObservationsCount: afterObservations,
    beforePriceHistoryCount: beforePriceHistory,
    afterPriceHistoryCount: afterPriceHistory,
    vendorAggregates,
  };
}

// ============================================================================
// Helpers (count queries, vendor aggregation, table printer)
// ============================================================================

/**
 * Best-effort marker that closes a partially-written scrape_run as 'failure'.
 *
 * Called from the catch arm of both pipelines. If this UPDATE itself throws
 * (e.g. D1 is the thing that's down), we log and swallow — the operator's
 * actionable error is the ORIGINAL one being re-thrown by the caller, and
 * masking it with a secondary "couldn't even mark it failed" error would
 * make on-call debugging worse, not better.
 *
 * Idempotent at the DB layer: the UPDATE is unconditional on status, so a
 * second call is a no-op. Safe to call even if some earlier code already
 * set status to a terminal value — the latest write wins.
 */
async function markRunFailedBestEffort(
  executor: D1Executor,
  scrapeRunId: number,
  logger: Logger,
  tag: string,
  originalError: unknown,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const msg = originalError instanceof Error ? originalError.message : String(originalError);
  logger.error(
    `${tag} scrape_run ${scrapeRunId} threw mid-execution; marking as 'failure'. cause: ${msg}`,
  );
  try {
    await executor.execBatch(
      `UPDATE scrape_runs SET status = 'failure', finished_at = ${sqlString(finishedAt)} WHERE id = ${scrapeRunId};`,
    );
  } catch (markErr) {
    const markMsg = markErr instanceof Error ? markErr.message : String(markErr);
    logger.error(
      `${tag} could not mark scrape_run ${scrapeRunId} as failed (will leave as 'running'): ${markMsg}`,
    );
  }
}

export async function getPriceHistoryCount(executor: D1Executor): Promise<number> {
  return scalarNumber(await executor.exec('SELECT count(*) AS cnt FROM price_history;'), 'cnt') ?? 0;
}

export async function getSourceObservationsCount(executor: D1Executor): Promise<number> {
  return scalarNumber(await executor.exec('SELECT count(*) AS cnt FROM source_observations;'), 'cnt') ?? 0;
}

/** Vendor aggregation against persisted rows (after a real insert). */
export async function computeVendorAggregatesFromDb(
  executor: D1Executor,
  scrapeRunId: number,
): Promise<VendorAggregate[]> {
  const res = await executor.exec(
    `SELECT vendor_inferred, price_cents, benchmark_score ` +
      `FROM source_observations WHERE scrape_run_id = ${scrapeRunId};`,
  );
  return aggregateByVendor(res[0]?.results ?? []);
}

/** Vendor aggregation directly from scraped rows (no D1 round-trip — used by dry-run). */
export function computeVendorAggregatesFromRows(rows: CpubenchmarkRow[]): VendorAggregate[] {
  const flat = rows.map((r) => ({
    vendor_inferred: inferVendor(r.sourceSkuName),
    price_cents: r.priceCents,
    benchmark_score: r.cpuMark,
  }));
  return aggregateByVendor(flat as Record<string, unknown>[]);
}

function aggregateByVendor(rows: Record<string, unknown>[]): VendorAggregate[] {
  const byVendor = new Map<string, { prices: number[]; benchmarks: number[]; total: number }>();
  for (const row of rows) {
    const vendor = String(row.vendor_inferred ?? 'Other');
    let bucket = byVendor.get(vendor);
    if (!bucket) {
      bucket = { prices: [], benchmarks: [], total: 0 };
      byVendor.set(vendor, bucket);
    }
    bucket.total++;
    // Trust numbers; reject null, "null" (wrangler quirk), undefined, strings.
    if (typeof row.price_cents === 'number' && Number.isFinite(row.price_cents)) {
      bucket.prices.push(row.price_cents);
    }
    if (typeof row.benchmark_score === 'number' && Number.isFinite(row.benchmark_score)) {
      bucket.benchmarks.push(row.benchmark_score);
    }
  }
  const out: VendorAggregate[] = [];
  for (const [vendor, b] of byVendor) {
    out.push({
      vendor,
      rowsObserved: b.total,
      rowsWithPrice: b.prices.length,
      avgPriceCents:
        b.prices.length > 0 ? Math.round(b.prices.reduce((s, n) => s + n, 0) / b.prices.length) : null,
      medianPriceCents: b.prices.length > 0 ? median(b.prices) : null,
      avgCpuMark:
        b.benchmarks.length > 0
          ? Math.round(b.benchmarks.reduce((s, n) => s + n, 0) / b.benchmarks.length)
          : null,
    });
  }
  out.sort((a, b) => b.rowsObserved - a.rowsObserved);
  return out;
}

/** Query just-inserted rows for one or more scrape_run_ids and print an audit table. */
export async function printRunTable(
  executor: D1Executor,
  scrapeRunIds: number[],
  options: { includeVendor: boolean },
): Promise<void> {
  if (scrapeRunIds.length === 0) {
    console.log('(no rows to display — no scrape_run_ids provided)');
    return;
  }
  const idList = scrapeRunIds.map((n) => String(n)).join(', ');
  const orderBy = options.includeVendor ? 's.vendor, s.name' : 's.name';
  const select = options.includeVendor ? 's.vendor, s.name AS sku' : 's.name AS sku';

  const res = await executor.exec(
    `SELECT ${select}, src.slug AS source, ph.price_cents, ph.raw_price_text, ` +
      `ph.benchmark_score, ph.scraped_at, ph.scrape_run_id ` +
      `FROM price_history ph ` +
      `JOIN skus s ON s.id = ph.sku_id ` +
      `JOIN sources src ON src.id = ph.source_id ` +
      `WHERE ph.scrape_run_id IN (${idList}) ` +
      `ORDER BY ${orderBy};`,
  );
  const rows = res[0]?.results ?? [];
  const header = options.includeVendor
    ? ['Vendor', 'SKU', 'Source', 'Price Cents', 'Raw Price Text', 'CPU Mark', 'Scraped At', 'Run ID']
    : ['SKU', 'Source', 'Price Cents', 'Raw Price Text', 'CPU Mark', 'Scraped At', 'Run ID'];
  console.log('| ' + header.join(' | ') + ' |');
  console.log('|' + header.map(() => '---').join('|') + '|');
  for (const r of rows) {
    const cells = options.includeVendor
      ? [
          String(r.vendor ?? '—'),
          String(r.sku ?? '—'),
          String(r.source ?? '—'),
          r.price_cents == null ? '—' : String(r.price_cents),
          r.raw_price_text == null ? '—' : String(r.raw_price_text),
          r.benchmark_score == null ? '—' : String(r.benchmark_score),
          r.scraped_at == null ? '—' : String(r.scraped_at),
          r.scrape_run_id == null ? '—' : String(r.scrape_run_id),
        ]
      : [
          String(r.sku ?? '—'),
          String(r.source ?? '—'),
          r.price_cents == null ? '—' : String(r.price_cents),
          r.raw_price_text == null ? '—' : String(r.raw_price_text),
          r.benchmark_score == null ? '—' : String(r.benchmark_score),
          r.scraped_at == null ? '—' : String(r.scraped_at),
          r.scrape_run_id == null ? '—' : String(r.scrape_run_id),
        ];
    console.log('| ' + cells.join(' | ') + ' |');
  }
}

export function makeStderrLogger(): Logger {
  const emit = (level: string, msg: string, meta?: Record<string, unknown>): void => {
    const suffix = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    process.stderr.write(`[${level}] ${msg}${suffix}\n`);
  };
  return {
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    debug: () => {},
  };
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return sorted[mid]!;
}

function scalarNumber(blocks: D1ResultBlock[], column: string): number | null {
  for (const block of blocks) {
    const r = block.results?.[0];
    if (r && column in r) {
      const v = r[column];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      return null;
    }
  }
  return null;
}
