/**
 * Production-shaped daily scrape into REMOTE Cloudflare D1.
 *
 * Hits PassMark's /cpu-list/all in one request, then double-writes against the
 * remote D1 via the REST API:
 *   - every scraped row -> source_observations (full corpus)
 *   - matched tracked SKUs -> price_history (curated, sku_id-bound)
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_D1_DATABASE_ID
 *
 * Pass --dry-run to scrape and report what WOULD be written without
 * touching the database.
 *
 * Run:
 *   npm run scrape:remote:all
 *   npm run scrape:remote:all:dry-run
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { TrackedSkusFile } from '../src/shared/types';
import { launchBrowser } from '../src/scraper/browser';
import { createRemoteD1Executor } from '../src/scraper/d1-client';
import {
  makeStderrLogger,
  scrapeAllIntoD1,
  type AllScrapeResult,
  type VendorAggregate,
} from '../src/scraper/pipeline';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  const logger = makeStderrLogger();
  const executor = createRemoteD1Executor();
  const trackedFile: TrackedSkusFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/tracked-skus.json'), 'utf-8'),
  );

  const browser = await launchBrowser();
  let result: AllScrapeResult;
  try {
    result = await scrapeAllIntoD1({
      executor,
      trackedSkus: trackedFile.skus,
      browser,
      logger,
      dryRun,
    });
  } finally {
    await browser.close();
  }

  console.log();
  console.log('Source: PassMark / CPUbenchmark (observed street price; not direct vendor retail)');
  console.log('URL:    https://www.cpubenchmark.net/cpu-list/all');
  console.log(`Target: remote Cloudflare D1${dryRun ? '  (DRY RUN — nothing written)' : ''}`);
  console.log();
  printVendorTable(result.vendorAggregates);
  console.log();
  printSummary(result);
}

function printVendorTable(aggregates: VendorAggregate[]): void {
  const header = ['Vendor Inferred', 'Rows Observed', 'Rows With Price', 'Avg Price', 'Median Price', 'Avg CPU Mark'];
  console.log('| ' + header.join(' | ') + ' |');
  console.log('|' + header.map(() => '---').join('|') + '|');
  for (const a of aggregates) {
    console.log('| ' + [
      a.vendor,
      String(a.rowsObserved),
      String(a.rowsWithPrice),
      formatPrice(a.avgPriceCents),
      formatPrice(a.medianPriceCents),
      a.avgCpuMark == null ? '—' : String(a.avgCpuMark),
    ].join(' | ') + ' |');
  }
}

function formatPrice(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

function printSummary(result: AllScrapeResult): void {
  const runLabel = result.dryRun
    ? '(dry run — no scrape_runs row opened)'
    : String(result.scrapeRunId);
  const obsLabel = result.dryRun
    ? `${result.rowsInsertedObservations} (would be inserted)`
    : String(result.rowsInsertedObservations);
  const phLabel = result.dryRun
    ? `${result.rowsInsertedPriceHistory} (would be inserted)`
    : String(result.rowsInsertedPriceHistory);

  console.log(`scrape_run_id:                              ${runLabel}`);
  console.log(`status:                                     ${result.status}${result.dryRun ? ' (computed; not persisted)' : ''}`);
  console.log(`total rows scraped from source:             ${result.rowsFound}`);
  console.log(`rows ${result.dryRun ? 'TO BE inserted' : 'inserted'} into source_observations:     ${obsLabel}`);
  console.log(`tracked SKUs ${result.dryRun ? 'TO BE matched' : 'matched'} into price_history:    ${result.trackedMatched} of ${result.trackedTotal}`);
  console.log(`tracked SKUs missing:                       ${result.trackedMissing.length}`);
  if (result.trackedMissing.length > 0) {
    console.log('Missing tracked SKUs (no normalized alias matched any scraped row):');
    for (const sku of result.trackedMissing) console.log(`  - ${sku.name}`);
  }
  console.log();
  if (result.dryRun) {
    console.log('(dry run — before/after counts are equal; nothing was written)');
    console.log(`source_observations: ${result.beforeObservationsCount} (would become ${result.beforeObservationsCount + result.rowsInsertedObservations})`);
    console.log(`price_history:       ${result.beforePriceHistoryCount} (would become ${result.beforePriceHistoryCount + result.rowsInsertedPriceHistory})`);
  } else {
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
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`scrape-remote-all failed: ${msg}\n`);
  process.exit(1);
});
