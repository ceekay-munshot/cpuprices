/**
 * Production-shaped daily scrape into local D1.
 *
 * Hits PassMark's /cpu-list/all in one request, then double-writes:
 *   - every scraped row -> source_observations (full corpus)
 *   - matched tracked SKUs -> price_history (curated, sku_id-bound)
 *
 * PassMark / CPUbenchmark is a benchmark + market-share proxy source. Its
 * price column is a PassMark-observed street price, NOT direct vendor retail
 * (Newegg / CDW / Provantage / Arrow). raw_price_text is preserved verbatim
 * in both tables for downstream auditability.
 *
 * Run: npm run scrape:local:all
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { TrackedSkusFile } from '../src/shared/types';
import { launchBrowser } from '../src/scraper/browser';
import {
  makeStderrLogger,
  scrapeAllIntoLocalD1,
  type AllScrapeResult,
  type VendorAggregate,
} from '../src/scraper/local-pipeline';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function main() {
  const logger = makeStderrLogger();
  const trackedFile: TrackedSkusFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/tracked-skus.json'), 'utf-8'),
  );

  const browser = await launchBrowser();
  let result: AllScrapeResult;
  try {
    result = await scrapeAllIntoLocalD1({
      trackedSkus: trackedFile.skus,
      browser,
      logger,
    });
  } finally {
    await browser.close();
  }

  console.log();
  console.log('Source: PassMark / CPUbenchmark (observed street price; not direct vendor retail)');
  console.log('URL:    https://www.cpubenchmark.net/cpu-list/all');
  console.log();
  printVendorTable(result.vendorAggregates);
  console.log();
  printSummary(result);
}

function printVendorTable(aggregates: VendorAggregate[]): void {
  const header = [
    'Vendor Inferred',
    'Rows Observed',
    'Rows With Price',
    'Avg Price',
    'Median Price',
    'Avg CPU Mark',
  ];
  console.log('| ' + header.join(' | ') + ' |');
  console.log('|' + header.map(() => '---').join('|') + '|');
  for (const a of aggregates) {
    const cells = [
      a.vendor,
      String(a.rowsObserved),
      String(a.rowsWithPrice),
      formatPrice(a.avgPriceCents),
      formatPrice(a.medianPriceCents),
      a.avgCpuMark == null ? '—' : String(a.avgCpuMark),
    ];
    console.log('| ' + cells.join(' | ') + ' |');
  }
}

function formatPrice(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function printSummary(result: AllScrapeResult): void {
  console.log(`scrape_run_id:                              ${result.scrapeRunId}`);
  console.log(`status:                                     ${result.status}`);
  console.log(`total rows scraped from source:             ${result.rowsFound}`);
  console.log(`rows inserted into source_observations:     ${result.rowsInsertedObservations}`);
  console.log(`tracked SKUs matched into price_history:    ${result.trackedMatched} of ${result.trackedTotal}`);
  console.log(`tracked SKUs missing:                       ${result.trackedMissing.length}`);
  if (result.trackedMissing.length > 0) {
    console.log('Missing tracked SKUs (no normalized alias matched any scraped row):');
    for (const sku of result.trackedMissing) console.log(`  - ${sku.name}`);
  }
  console.log();
  console.log(
    `source_observations: before=${result.beforeObservationsCount}, ` +
      `after=${result.afterObservationsCount}, ` +
      `delta=${result.afterObservationsCount - result.beforeObservationsCount}`,
  );
  console.log(
    `price_history:       before=${result.beforePriceHistoryCount}, ` +
      `after=${result.afterPriceHistoryCount}, ` +
      `delta=${result.afterPriceHistoryCount - result.beforePriceHistoryCount}`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`scrape-local-all failed: ${msg}\n`);
  process.exit(1);
});
