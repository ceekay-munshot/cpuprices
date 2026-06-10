/**
 * Backfill a missed daily capture from a Wayback Machine snapshot of
 * PassMark's /cpu-list/all page, writing to REMOTE Cloudflare D1 through the
 * exact same pipeline as the daily scrape (same parsing, normalization,
 * vendor/segment inference, chunked inserts, tracked-SKU matching).
 *
 * Why this exists: the 2026-05-27 → 2026-06-09 scraper outage (SQLITE_TOOBIG)
 * left a hole in the record. The Internet Archive holds exactly one snapshot
 * inside that window — 2026-06-03 08:08:50 UTC — which is a full
 * server-rendered copy of the page (≈5.9k rows incl. prices).
 *
 * Provenance is recorded on the data itself:
 *   - every observation's `url` points at the archive snapshot, not the live page
 *   - every observation's `scraped_at` is the SNAPSHOT capture time (so the
 *     row buckets into the calendar period it actually describes)
 *   - the scrape_runs row's started_at is the backfill execution time, so the
 *     run is visibly retroactive (started_at ≫ scraped_at)
 *
 * Idempotent: refuses to run if a successful run already has observations on
 * the snapshot's calendar day.
 *
 * Usage:
 *   npx tsx scripts/backfill-wayback.ts                  # default snapshot below
 *   npx tsx scripts/backfill-wayback.ts 20260603080850   # explicit snapshot id
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { TrackedSkusFile } from '../src/shared/types';
import { launchBrowser } from '../src/scraper/browser';
import { createRemoteD1Executor } from '../src/scraper/d1-client';
import { scrapeListPage } from '../src/sources/cpubenchmark';
import {
  makeStderrLogger,
  scrapeAllIntoD1,
} from '../src/scraper/pipeline';

const DEFAULT_SNAPSHOT = '20260603080850';
const LIVE_URL = 'https://www.cpubenchmark.net/cpu-list/all';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function snapshotIso(ts: string): string {
  // "20260603080850" -> "2026-06-03T08:08:50.000Z"
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Bad snapshot timestamp: ${ts} (expected YYYYMMDDhhmmss)`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

async function main() {
  const snapshot = process.argv[2] ?? DEFAULT_SNAPSHOT;
  const scrapedAtIso = snapshotIso(snapshot);
  const day = scrapedAtIso.slice(0, 10);
  // id_ serves the original captured bytes without the archive toolbar, so
  // the DOM matches what the daily scraper sees on the live page.
  const archiveUrl = `http://web.archive.org/web/${snapshot}id_/${LIVE_URL}`;

  const logger = makeStderrLogger();
  const executor = createRemoteD1Executor();
  const trackedFile: TrackedSkusFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/tracked-skus.json'), 'utf-8'),
  );

  // Idempotence guard: one backfill per calendar day.
  const existing = await executor.exec(
    `SELECT COUNT(*) AS cnt FROM source_observations so
     JOIN scrape_runs sr ON sr.id = so.scrape_run_id
     WHERE sr.status = 'success' AND date(so.scraped_at) = '${day}';`,
  );
  const cnt = Number(existing[0]?.results?.[0]?.cnt ?? 0);
  if (cnt > 0) {
    logger.error(`A successful run already has ${cnt} observations on ${day} — nothing to do.`);
    process.exit(2);
  }

  logger.info(`Backfilling from Wayback snapshot ${snapshot} (${scrapedAtIso})`);
  logger.info(`Source: ${archiveUrl}`);

  const browser = await launchBrowser();
  try {
    const result = await scrapeAllIntoD1({
      executor,
      trackedSkus: trackedFile.skus,
      browser,
      logger,
      scrapeRows: async (ctx) => {
        const rows = await scrapeListPage(ctx, archiveUrl);
        // Stamp rows with the SNAPSHOT's capture time, not "now" — period
        // bucketing reads scraped_at. url already points at the archive.
        return rows.map((r) => ({ ...r, scrapedAt: scrapedAtIso }));
      },
    });

    console.log();
    console.log(`Backfill complete: scrape_run ${result.scrapeRunId} -> ${result.status}`);
    console.log(`rows scraped from snapshot:        ${result.rowsFound}`);
    console.log(`observations inserted:             ${result.rowsInsertedObservations}`);
    console.log(`price_history inserted (tracked):  ${result.rowsInsertedPriceHistory}`);
    console.log(`observation scraped_at:            ${scrapedAtIso}`);
    if (result.status !== 'success') {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`backfill-wayback failed: ${msg}\n`);
  process.exit(1);
});
