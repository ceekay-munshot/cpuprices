/**
 * Sync config/sources.json + config/tracked-skus.json into D1.
 *
 * Generates a single idempotent SQL batch:
 *   - PRAGMA foreign_keys = ON;
 *   - BEGIN;
 *   - UPSERT each source by slug
 *   - UPSERT each canonical SKU by name
 *   - UPSERT each (source, alias) pair into source_sku_aliases
 *   - COMMIT;
 *
 * Usage:
 *   npm run sync:local   (tsx scripts/sync-config.ts --local)
 *   npm run sync:remote  (tsx scripts/sync-config.ts --remote)
 *
 * Remote support is stubbed for now — this v1 only wires up --local. The
 * remote path will use the D1 REST API and lands with the production
 * scraper.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { SourcesFile, TrackedSkusFile } from '../src/shared/types';
import { normalizeCpuName } from '../src/shared/normalize';
import { execLocalBatch, sqlString, sqlValue } from '../src/scraper/d1-local';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const remote = args.includes('--remote');
  if (local === remote) {
    throw new Error('Pass exactly one of --local or --remote.');
  }
  if (remote) {
    throw new Error(
      'sync:remote is not yet wired. v1 supports --local only; remote sync ' +
        'will land alongside the production scraper (REST API client).',
    );
  }

  const sourcesFile: SourcesFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/sources.json'), 'utf-8'),
  );
  const skusFile: TrackedSkusFile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/tracked-skus.json'), 'utf-8'),
  );

  const sql = buildSyncSql(sourcesFile, skusFile);

  process.stderr.write(
    `[info] sync: ${sourcesFile.sources.length} source(s), ${skusFile.skus.length} SKU(s), ` +
      `${countAliases(skusFile)} alias(es) -> local D1\n`,
  );

  await execLocalBatch(sql);

  process.stderr.write('[info] sync: complete\n');
}

function buildSyncSql(sourcesFile: SourcesFile, skusFile: TrackedSkusFile): string {
  const out: string[] = [];
  // D1 rejects raw BEGIN/COMMIT (must use the JS batch API). wrangler runs
  // --file statements sequentially; on interrupt the UPSERTs are idempotent
  // so a rerun converges. PRAGMA foreign_keys is set for parity with the
  // amendment; D1 may treat it as a no-op since it manages connections.
  out.push('PRAGMA foreign_keys = ON;');

  for (const s of sourcesFile.sources) {
    out.push(
      `INSERT INTO sources (name, slug, base_url, is_active) VALUES (` +
        `${sqlString(s.name)}, ${sqlString(s.slug)}, ${sqlString(s.base_url)}, ${s.is_active ? 1 : 0}` +
        `) ON CONFLICT(slug) DO UPDATE SET ` +
        `name = excluded.name, base_url = excluded.base_url, is_active = excluded.is_active, ` +
        `updated_at = datetime('now');`,
    );
  }

  for (const sku of skusFile.skus) {
    out.push(
      `INSERT INTO skus (name, vendor, bucket, tier, is_active) VALUES (` +
        `${sqlString(sku.name)}, ${sqlString(sku.vendor)}, ${sqlString(sku.bucket)}, ${sqlValue(sku.tier)}, 1` +
        `) ON CONFLICT(name) DO UPDATE SET ` +
        `vendor = excluded.vendor, bucket = excluded.bucket, tier = excluded.tier, ` +
        `is_active = excluded.is_active, updated_at = datetime('now');`,
    );
  }

  for (const sku of skusFile.skus) {
    for (const [sourceSlug, aliases] of Object.entries(sku.aliases ?? {})) {
      for (const alias of aliases) {
        const normalized = normalizeCpuName(alias);
        out.push(
          `INSERT INTO source_sku_aliases (source_id, sku_id, source_name, normalized_source_name) VALUES (` +
            `(SELECT id FROM sources WHERE slug = ${sqlString(sourceSlug)}), ` +
            `(SELECT id FROM skus WHERE name = ${sqlString(sku.name)}), ` +
            `${sqlString(alias)}, ${sqlString(normalized)}` +
            `) ON CONFLICT(source_id, normalized_source_name) DO UPDATE SET ` +
            `sku_id = excluded.sku_id, source_name = excluded.source_name, ` +
            `updated_at = datetime('now');`,
        );
      }
    }
  }

  return out.join('\n');
}

function countAliases(skusFile: TrackedSkusFile): number {
  let n = 0;
  for (const sku of skusFile.skus) {
    for (const arr of Object.values(sku.aliases ?? {})) n += arr.length;
  }
  return n;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`sync-config failed: ${msg}\n`);
  process.exit(1);
});
