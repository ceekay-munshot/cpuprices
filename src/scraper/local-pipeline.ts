/**
 * Shared end-to-end pipeline for scraping one vendor and writing into local
 * D1. Called from scripts/scrape-local-{intel,amd,all}.ts.
 *
 * What it does, per invocation:
 *   1. Resolve source_id + the vendor's sku_ids + alias index from D1
 *   2. Snapshot the current price_history row count (for before/after delta)
 *   3. Call the vendor-specific scrape function (caller provides it)
 *   4. Match scraped rows to tracked SKUs via the alias index
 *   5. Open a scrape_runs row, capture id via RETURNING
 *   6. INSERT matched rows into price_history + UPDATE scrape_runs to final status
 *   7. Snapshot the count again and return per-run metadata
 *
 * Append-only is enforced by both convention (no UPDATE/DELETE of price_history
 * in this pipeline) and the migration's price_history_no_update / no_delete
 * triggers.
 */

import type { Browser } from 'playwright';
import type { Logger, TrackedSku } from '../shared/types';
import { normalizeCpuName } from '../shared/normalize';
import { inferSegment, inferVendor } from '../shared/vendor';
import { scrapeAllRows, type CpubenchmarkRow } from '../sources/cpubenchmark';
import {
  execLocalBatch,
  execLocalCommand,
  sqlString,
  sqlValue,
  type D1ResultBlock,
} from './d1-local';

const SOURCE_SLUG = 'cpubenchmark';

export type ScrapeRunStatus = 'success' | 'partial' | 'failure';

export interface VendorRunResult {
  vendor: string;
  scrapeRunId: number;
  status: ScrapeRunStatus;
  /** Total rows the source returned (before alias matching). */
  rowsFound: number;
  /** Rows actually written to price_history (= matched count). */
  rowsInserted: number;
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
  /** Filter trackedSkus by skus.vendor. e.g. 'Intel' or 'AMD'. */
  vendor: string;
  /** Full tracked list; pipeline filters internally by vendor. */
  trackedSkus: TrackedSku[];
  /** Source-specific scrape function. e.g. scrapeIntelRows, scrapeAmdRows. */
  scrape: VendorScrapeFn;
  browser: Browser;
  logger: Logger;
}

export async function scrapeVendorIntoLocalD1(opts: VendorRunOptions): Promise<VendorRunResult> {
  const { vendor, scrape, browser, logger } = opts;
  const tracked = opts.trackedSkus.filter((s) => s.vendor === vendor);

  if (tracked.length === 0) {
    throw new Error(`No tracked SKUs found for vendor "${vendor}"`);
  }

  const sourceId = scalarNumber(
    await execLocalCommand(`SELECT id FROM sources WHERE slug = ${sqlString(SOURCE_SLUG)};`),
    'id',
  );
  if (sourceId == null) {
    throw new Error(
      `${SOURCE_SLUG} source not found in D1. Did you run \`npm run sync:local\`?`,
    );
  }

  const skuRes = await execLocalCommand(
    `SELECT id, name FROM skus WHERE vendor = ${sqlString(vendor)};`,
  );
  const skuIdByName = new Map<string, number>();
  for (const row of skuRes[0]?.results ?? []) {
    skuIdByName.set(String(row.name), Number(row.id));
  }

  const aliasRes = await execLocalCommand(
    `SELECT a.normalized_source_name AS norm, a.sku_id AS sku_id, s.name AS canonical
     FROM source_sku_aliases a JOIN skus s ON s.id = a.sku_id
     WHERE a.source_id = ${sourceId} AND s.vendor = ${sqlString(vendor)};`,
  );
  const aliasIndex = new Map<string, { canonical: string; skuId: number }>();
  for (const row of aliasRes[0]?.results ?? []) {
    aliasIndex.set(String(row.norm), {
      canonical: String(row.canonical),
      skuId: Number(row.sku_id),
    });
  }
  // Self-alias fallback: a canonical name normalized to itself.
  for (const sku of tracked) {
    const skuId = skuIdByName.get(sku.name);
    if (skuId != null) {
      const norm = normalizeCpuName(sku.name);
      if (!aliasIndex.has(norm)) {
        aliasIndex.set(norm, { canonical: sku.name, skuId });
      }
    }
  }

  logger.info(
    `[${vendor}] source_id=${sourceId}, skus=${skuIdByName.size}, aliases=${aliasIndex.size}`,
  );

  const beforeCount =
    scalarNumber(await execLocalCommand('SELECT count(*) AS cnt FROM price_history;'), 'cnt') ?? 0;

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

  const runOpen = await execLocalCommand(
    `INSERT INTO scrape_runs (source_id, status, started_at) ` +
      `VALUES (${sourceId}, 'running', ${sqlString(startedAt)}) RETURNING id;`,
  );
  const scrapeRunId = scalarNumber(runOpen, 'id');
  if (scrapeRunId == null) {
    throw new Error('Failed to capture scrape_run id from INSERT...RETURNING.');
  }

  const rowsFound = scraped.length;
  const rowsInserted = matched.size;
  const status: ScrapeRunStatus =
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

  // No raw BEGIN/COMMIT — D1 rejects those. wrangler runs --file statements
  // sequentially; idempotent UPSERTs and unique scrape_run_id per row mean
  // partial failures are recoverable on rerun.
  const batchSql = [
    'PRAGMA foreign_keys = ON;',
    valueRows.length > 0
      ? `INSERT INTO price_history (sku_id, source_id, scrape_run_id, source_sku_name, price_cents, raw_price_text, currency, price_type, benchmark_score, url, scraped_at) VALUES\n  ${valueRows.join(',\n  ')};`
      : '-- no matched rows',
    `UPDATE scrape_runs SET status = ${sqlString(status)}, finished_at = ${sqlString(finishedAt)}, rows_found = ${rowsFound}, rows_inserted = ${rowsInserted} WHERE id = ${scrapeRunId};`,
  ].join('\n');

  await execLocalBatch(batchSql);

  // Update scrape_runs with the explicit count columns. observations_inserted
  // is 0 here because the per-vendor debug scripts never write to
  // source_observations — only the production /cpu-list/all path does.
  // rows_inserted stays = price_history_inserted for back-compat.
  await execLocalBatch(
    'PRAGMA foreign_keys = ON;\n' +
      `UPDATE scrape_runs SET ` +
      `observations_inserted = 0, ` +
      `price_history_inserted = ${rowsInserted}, ` +
      `tracked_skus_matched = ${matched.size}, ` +
      `tracked_skus_missing = ${missing.length} ` +
      `WHERE id = ${scrapeRunId};`,
  );
  logger.info(
    `[${vendor}] scrape_run ${scrapeRunId} -> ${status}; inserted ${rowsInserted}/${tracked.length}`,
  );

  const afterCount =
    scalarNumber(await execLocalCommand('SELECT count(*) AS cnt FROM price_history;'), 'cnt') ?? 0;

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

/**
 * Query just-inserted rows for one or more scrape_run_ids and print a
 * markdown audit table. `includeVendor` adds a Vendor column for the
 * combined intel+amd view.
 */
export async function printRunTable(
  scrapeRunIds: number[],
  options: { includeVendor: boolean },
): Promise<void> {
  if (scrapeRunIds.length === 0) {
    console.log('(no rows to display — no scrape_run_ids provided)');
    return;
  }
  const idList = scrapeRunIds.map((n) => String(n)).join(', ');
  const orderBy = options.includeVendor ? 's.vendor, s.name' : 's.name';
  const select = options.includeVendor
    ? 's.vendor, s.name AS sku'
    : 's.name AS sku';

  const res = await execLocalCommand(
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

export async function getPriceHistoryCount(): Promise<number> {
  return scalarNumber(
    await execLocalCommand('SELECT count(*) AS cnt FROM price_history;'),
    'cnt',
  ) ?? 0;
}

export async function getSourceObservationsCount(): Promise<number> {
  return scalarNumber(
    await execLocalCommand('SELECT count(*) AS cnt FROM source_observations;'),
    'cnt',
  ) ?? 0;
}

// ============================================================================
// Full /cpu-list/all pipeline
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
  scrapeRunId: number;
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
 *  wrangler / D1 per-request limits with thousands of rows. */
const OBSERVATIONS_INSERT_CHUNK = 500;

export async function scrapeAllIntoLocalD1(opts: {
  trackedSkus: TrackedSku[];
  browser: Browser;
  logger: Logger;
}): Promise<AllScrapeResult> {
  const { trackedSkus, browser, logger } = opts;

  const sourceId = scalarNumber(
    await execLocalCommand(`SELECT id FROM sources WHERE slug = ${sqlString(SOURCE_SLUG)};`),
    'id',
  );
  if (sourceId == null) {
    throw new Error(
      `${SOURCE_SLUG} source not found in D1. Did you run \`npm run sync:local\`?`,
    );
  }

  // Pull every tracked SKU + every registered alias for this source. The
  // matcher needs vendor-agnostic coverage because /cpu-list/all serves all
  // vendors in one response.
  const skuRes = await execLocalCommand('SELECT id, name FROM skus;');
  const skuIdByName = new Map<string, number>();
  for (const row of skuRes[0]?.results ?? []) {
    skuIdByName.set(String(row.name), Number(row.id));
  }
  const aliasRes = await execLocalCommand(
    `SELECT a.normalized_source_name AS norm, a.sku_id AS sku_id, s.name AS canonical
     FROM source_sku_aliases a JOIN skus s ON s.id = a.sku_id
     WHERE a.source_id = ${sourceId};`,
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
      if (!aliasIndex.has(norm)) {
        aliasIndex.set(norm, { canonical: sku.name, skuId });
      }
    }
  }

  logger.info(
    `[all] source_id=${sourceId}, skus=${skuIdByName.size}, aliases=${aliasIndex.size}, tracked=${trackedSkus.length}`,
  );

  const beforeObservations = await getSourceObservationsCount();
  const beforePriceHistory = await getPriceHistoryCount();

  const startedAt = new Date().toISOString();
  const scraped = await scrapeAllRows({ browser, logger, trackedSkus });
  logger.info(`[all] scraped ${scraped.length} rows from /cpu-list/all`);

  // Match tracked SKUs against the full corpus.
  const matched = new Map<string, { row: CpubenchmarkRow; skuId: number }>();
  for (const row of scraped) {
    const norm = normalizeCpuName(row.sourceSkuName);
    const hit = aliasIndex.get(norm);
    if (hit && !matched.has(hit.canonical)) {
      matched.set(hit.canonical, { row, skuId: hit.skuId });
    }
  }
  const trackedMissing = trackedSkus.filter((s) => !matched.has(s.name));

  const runOpen = await execLocalCommand(
    `INSERT INTO scrape_runs (source_id, status, started_at) ` +
      `VALUES (${sourceId}, 'running', ${sqlString(startedAt)}) RETURNING id;`,
  );
  const scrapeRunId = scalarNumber(runOpen, 'id');
  if (scrapeRunId == null) {
    throw new Error('Failed to capture scrape_run id from INSERT...RETURNING.');
  }

  // Build source_observations rows: vendor + segment inferred per name.
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

  // Chunk the observations insert so wrangler --file stays well under
  // per-request size + parse limits.
  for (let i = 0; i < obsValues.length; i += OBSERVATIONS_INSERT_CHUNK) {
    const chunk = obsValues.slice(i, i + OBSERVATIONS_INSERT_CHUNK);
    const sql = [
      'PRAGMA foreign_keys = ON;',
      `INSERT INTO source_observations (source_id, scrape_run_id, source_sku_name, normalized_source_name, vendor_inferred, segment_inferred, benchmark_score, rank, cpu_value, price_cents, raw_price_text, currency, url, scraped_at) VALUES\n  ${chunk.join(',\n  ')};`,
    ].join('\n');
    await execLocalBatch(sql);
    logger.info(`[all] observations inserted ${Math.min(i + OBSERVATIONS_INSERT_CHUNK, obsValues.length)}/${obsValues.length}`);
  }

  // Matched tracked SKUs -> price_history (single batch; max 14 rows today).
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
    await execLocalBatch(
      'PRAGMA foreign_keys = ON;\n' +
        `INSERT INTO price_history (sku_id, source_id, scrape_run_id, source_sku_name, price_cents, raw_price_text, currency, price_type, benchmark_score, url, scraped_at) VALUES\n  ${phValues.join(',\n  ')};`,
    );
  }

  // Finalize scrape_runs. rows_found = source row count; rows_inserted is
  // intentionally the observations count (= the daily corpus size), not the
  // matched price_history count.
  const finishedAt = new Date().toISOString();
  const rowsFound = scraped.length;
  const rowsInsertedObs = obsValues.length;
  const rowsInsertedPh = phValues.length;
  const status: ScrapeRunStatus =
    rowsInsertedObs === rowsFound && rowsInsertedPh === trackedSkus.length
      ? 'success'
      : rowsInsertedObs > 0
        ? 'partial'
        : 'failure';

  // Finalize scrape_runs. The explicit count columns are the source of truth;
  // rows_inserted stays = price_history_inserted for back-compat with rows
  // written before 0003_scrape_runs_counts.
  await execLocalBatch(
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
  logger.info(`[all] scrape_run ${scrapeRunId} -> ${status}`);

  const afterObservations = await getSourceObservationsCount();
  const afterPriceHistory = await getPriceHistoryCount();
  const vendorAggregates = await computeVendorAggregates(scrapeRunId);

  return {
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

async function computeVendorAggregates(scrapeRunId: number): Promise<VendorAggregate[]> {
  const res = await execLocalCommand(
    `SELECT vendor_inferred, price_cents, benchmark_score ` +
      `FROM source_observations WHERE scrape_run_id = ${scrapeRunId};`,
  );
  const rows = res[0]?.results ?? [];

  const byVendor = new Map<string, { prices: number[]; benchmarks: number[]; total: number }>();
  for (const row of rows) {
    const vendor = String(row.vendor_inferred ?? 'Other');
    let bucket = byVendor.get(vendor);
    if (!bucket) {
      bucket = { prices: [], benchmarks: [], total: 0 };
      byVendor.set(vendor, bucket);
    }
    bucket.total++;
    // wrangler --json sometimes serializes SQL NULL as the JS string "null"
    // (not JSON null), and `Number("null") === NaN`, which would poison the
    // average. typeof check trusts the numeric path and rejects everything
    // else (null, "null", undefined, stray strings).
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
        b.prices.length > 0
          ? Math.round(b.prices.reduce((s, n) => s + n, 0) / b.prices.length)
          : null,
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

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
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

function scalarNumber(blocks: D1ResultBlock[], column: string): number | null {
  for (const block of blocks) {
    const r = block.results?.[0];
    if (r && column in r) {
      const v = r[column];
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}
