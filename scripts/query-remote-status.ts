/**
 * Read-only status query against remote Cloudflare D1.
 *
 * Prints:
 *   - Latest scrape_runs row with all count columns
 *   - source_observations total row count
 *   - price_history total row count
 *   - Vendor summary table for the latest scrape_run
 *
 * Required env (same as scrape:remote:all):
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_D1_DATABASE_ID
 *
 * Run: npm run query:remote:status
 */

import { createRemoteD1Executor } from '../src/scraper/d1-client';
import {
  computeVendorAggregatesFromDb,
  getPriceHistoryCount,
  getSourceObservationsCount,
  type VendorAggregate,
} from '../src/scraper/pipeline';

async function main() {
  const executor = createRemoteD1Executor();

  const latestRunRes = await executor.exec(
    `SELECT id, source_id, status, started_at, finished_at, rows_found, rows_inserted, ` +
      `observations_inserted, price_history_inserted, tracked_skus_matched, tracked_skus_missing ` +
      `FROM scrape_runs ORDER BY id DESC LIMIT 1;`,
  );
  const latest = latestRunRes[0]?.results?.[0] as Record<string, unknown> | undefined;

  const [obsCount, phCount] = await Promise.all([
    getSourceObservationsCount(executor),
    getPriceHistoryCount(executor),
  ]);

  console.log();
  console.log('Source: PassMark / CPUbenchmark (observed street price; not direct vendor retail)');
  console.log('Target: remote Cloudflare D1');
  console.log();
  console.log('Latest scrape_runs row:');
  if (!latest) {
    console.log('  (none — no runs have been recorded yet)');
  } else {
    for (const [k, v] of Object.entries(latest)) {
      console.log(`  ${k.padEnd(24)} ${v ?? '(null)'}`);
    }
  }
  console.log();
  console.log(`source_observations total rows: ${obsCount}`);
  console.log(`price_history       total rows: ${phCount}`);

  if (latest && typeof latest.id === 'number') {
    const aggregates = await computeVendorAggregatesFromDb(executor, latest.id);
    console.log();
    console.log(`Vendor summary for scrape_run_id = ${latest.id}:`);
    printVendorTable(aggregates);
  }
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

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`query-remote-status failed: ${msg}\n`);
  process.exit(1);
});
