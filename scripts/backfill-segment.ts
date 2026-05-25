/**
 * One-off backfill: classify every existing source_observations row by
 * segment (Server / Desktop / Laptop / Other) and write the value to the
 * already-existing `segment_inferred` column.
 *
 * The price_history table is unaffected. New scrapes already write
 * segment_inferred at insert time (see src/scraper/pipeline.ts), so this
 * script is only needed for historical rows.
 *
 * Why a script and not a migration:
 *   The classifier is JS / regex; SQLite has no REGEXP by default in D1,
 *   so the rule logic can't live in pure SQL. The script reads ids in
 *   bulk, classifies in JS, and writes back as batched CASE-WHEN UPDATEs.
 *
 * The source_observations table has an append-only BEFORE UPDATE trigger.
 * This script drops it, runs the backfill, and restores it. Triggers are
 * recreated in the finally block so a crash mid-run still leaves the table
 * protected.
 *
 * Usage:
 *   npm run backfill:segment:local
 *   npm run backfill:segment:remote
 *
 * Flags:
 *   --all   Re-classify EVERY row (default: only rows where segment_inferred IS NULL).
 *           Use after changing classifier rules.
 */

import {
  createLocalD1Executor,
  createRemoteD1Executor,
  sqlString,
  type D1Executor,
} from '../src/scraper/d1-client';
import { inferSegment, type InferredSegment } from '../src/shared/segment';

const UPDATE_CHUNK = 500;

const TRIGGER_NO_UPDATE = `
  CREATE TRIGGER IF NOT EXISTS source_observations_no_update
  BEFORE UPDATE ON source_observations
  BEGIN
    SELECT RAISE(ABORT, 'source_observations is append-only: UPDATE is not allowed');
  END
`.trim();

const TRIGGER_NO_DELETE = `
  CREATE TRIGGER IF NOT EXISTS source_observations_no_delete
  BEFORE DELETE ON source_observations
  BEGIN
    SELECT RAISE(ABORT, 'source_observations is append-only: DELETE is not allowed');
  END
`.trim();

interface SourceRow {
  id: number;
  source_sku_name: string;
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const remote = args.includes('--remote');
  const reclassifyAll = args.includes('--all');

  if (local === remote) {
    throw new Error('Pass exactly one of --local or --remote.');
  }
  const executor: D1Executor = local ? createLocalD1Executor() : createRemoteD1Executor();

  log(`backfill: target=${executor.label}, mode=${reclassifyAll ? 'all rows' : 'NULL only'}`);

  // 1. Fetch rows to classify.
  const where = reclassifyAll ? '' : 'WHERE segment_inferred IS NULL';
  const sel = await executor.exec(
    `SELECT id, source_sku_name FROM source_observations ${where} ORDER BY id;`,
  );
  const rows = (sel[0]?.results ?? []) as unknown as SourceRow[];
  if (rows.length === 0) {
    log('No rows to backfill. Done.');
    return;
  }
  log(`Fetched ${rows.length.toLocaleString()} rows to classify.`);

  // 2. Classify in memory.
  const classified = rows.map((r) => ({
    id: Number(r.id),
    segment: inferSegment(String(r.source_sku_name)),
  }));
  const tally = classified.reduce<Record<InferredSegment, number>>(
    (acc, c) => {
      acc[c.segment] = (acc[c.segment] ?? 0) + 1;
      return acc;
    },
    { Server: 0, Desktop: 0, Laptop: 0, Other: 0 },
  );
  log(
    `Classification tally: Server=${tally.Server}, Desktop=${tally.Desktop}, ` +
      `Laptop=${tally.Laptop}, Other=${tally.Other}`,
  );

  // 3. Drop the append-only trigger so UPDATEs are allowed.
  log('Dropping append-only triggers on source_observations…');
  await executor.exec('DROP TRIGGER IF EXISTS source_observations_no_update;');
  await executor.exec('DROP TRIGGER IF EXISTS source_observations_no_delete;');

  try {
    // 4. Batch UPDATEs as CASE WHEN per chunk so the round trips stay small.
    let written = 0;
    for (let i = 0; i < classified.length; i += UPDATE_CHUNK) {
      const chunk = classified.slice(i, i + UPDATE_CHUNK);
      const cases = chunk.map((c) => `WHEN ${c.id} THEN ${sqlString(c.segment)}`).join('\n  ');
      const ids = chunk.map((c) => c.id).join(', ');
      const sql =
        `UPDATE source_observations\n` +
        `SET segment_inferred = CASE id\n  ${cases}\nEND\n` +
        `WHERE id IN (${ids});`;
      await executor.execBatch(sql);
      written += chunk.length;
      log(`Updated ${written.toLocaleString()} / ${classified.length.toLocaleString()}…`);
    }
  } finally {
    // 5. Always restore triggers, even on partial failure.
    log('Restoring append-only triggers…');
    await executor.exec(TRIGGER_NO_UPDATE + ';');
    await executor.exec(TRIGGER_NO_DELETE + ';');
  }

  // 6. Verify by re-counting nulls.
  const check = await executor.exec(
    `SELECT
       sum(CASE WHEN segment_inferred IS NULL THEN 1 ELSE 0 END) AS nulls,
       sum(CASE WHEN segment_inferred = 'Server'  THEN 1 ELSE 0 END) AS server,
       sum(CASE WHEN segment_inferred = 'Desktop' THEN 1 ELSE 0 END) AS desktop,
       sum(CASE WHEN segment_inferred = 'Laptop'  THEN 1 ELSE 0 END) AS laptop,
       sum(CASE WHEN segment_inferred = 'Other'   THEN 1 ELSE 0 END) AS other,
       count(*) AS total
     FROM source_observations;`,
  );
  const r = check[0]?.results?.[0] as
    | Record<'nulls' | 'server' | 'desktop' | 'laptop' | 'other' | 'total', number>
    | undefined;
  if (r) {
    log(
      `Post-backfill: total=${r.total}, nulls=${r.nulls}, ` +
        `Server=${r.server}, Desktop=${r.desktop}, Laptop=${r.laptop}, Other=${r.other}`,
    );
  }
  log('Done.');
}

function log(msg: string): void {
  process.stderr.write(`[backfill-segment] ${msg}\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`backfill-segment failed: ${msg}\n`);
  process.exit(1);
});
