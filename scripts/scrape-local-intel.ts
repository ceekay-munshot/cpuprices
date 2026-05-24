/**
 * Intel-only PassMark scrape into local D1.
 *
 * Thin entry point: loads tracked SKUs, runs the shared pipeline for
 * vendor='Intel', and prints the D1-backed audit table + run summary.
 *
 * Run: npm run scrape:local:intel
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { TrackedSkusFile } from '../src/shared/types';
import { launchBrowser } from '../src/scraper/browser';
import { scrapeIntelRows } from '../src/sources/cpubenchmark';
import {
  makeStderrLogger,
  printRunTable,
  scrapeVendorIntoLocalD1,
  type VendorRunResult,
} from '../src/scraper/local-pipeline';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function main() {
  const logger = makeStderrLogger();
  const trackedFile: TrackedSkusFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/tracked-skus.json'), 'utf-8'),
  );

  const browser = await launchBrowser();
  let result: VendorRunResult;
  try {
    result = await scrapeVendorIntoLocalD1({
      vendor: 'Intel',
      trackedSkus: trackedFile.skus,
      scrape: scrapeIntelRows,
      browser,
      logger,
    });
  } finally {
    await browser.close();
  }

  console.log();
  console.log('Source: PassMark / CPUbenchmark (observed street price; not direct vendor retail)');
  console.log();
  console.log('NOTE: scrape:local:intel is a DEBUG command.');
  console.log('  - Writes tracked rows only to price_history.');
  console.log('  - Does NOT populate source_observations.');
  console.log('  - Production / full-universe capture is `npm run scrape:local:all` against /cpu-list/all.');
  console.log();
  await printRunTable([result.scrapeRunId], { includeVendor: false });
  console.log();
  console.log(`scrape_run_id:    ${result.scrapeRunId}`);
  console.log(`status:           ${result.status}`);
  console.log(`rows_found:       ${result.rowsFound}`);
  console.log(`rows_inserted:    ${result.rowsInserted}`);
  console.log(`matched:          ${result.matched} of ${result.tracked.length}`);
  console.log(`missing:          ${result.missing.length}`);
  if (result.missing.length > 0) {
    console.log('Missing canonical SKUs:');
    for (const sku of result.missing) console.log(`  - ${sku.name}`);
  }
  console.log(
    `price_history:    before=${result.beforeCount}, after=${result.afterCount}, delta=${result.afterCount - result.beforeCount}`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`scrape-local-intel failed: ${msg}\n`);
  process.exit(1);
});
