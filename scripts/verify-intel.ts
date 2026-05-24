/**
 * Standalone verification: scrape PassMark / CPUbenchmark Intel list,
 * match against the 6 tracked Intel SKUs in config/tracked-skus.json,
 * and print a markdown audit table to stdout.
 *
 * Run: npm run scrape:verify:intel
 *
 * No D1 writes. No API. No UI. This script's only job is to prove the
 * Intel capture works end-to-end before we wire up anything downstream.
 *
 * Output: one row per tracked SKU (always 6 rows). Missing SKUs render
 * with em-dashes and Matched = No. Logs go to stderr so the table
 * survives `> out.md` redirection.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { Logger, TrackedSku, TrackedSkusFile } from '../src/shared/types';
import { normalizeCpuName } from '../src/shared/normalize';
import { launchBrowser } from '../src/scraper/browser';
import { scrapeIntelRows, type CpubenchmarkRow } from '../src/sources/cpubenchmark';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const logger: Logger = {
  info: (m, meta) => stderr('info', m, meta),
  warn: (m, meta) => stderr('warn', m, meta),
  error: (m, meta) => stderr('error', m, meta),
  debug: () => {},
};

function stderr(level: string, msg: string, meta?: Record<string, unknown>): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  process.stderr.write(`[${level}] ${msg}${suffix}\n`);
}

async function main() {
  const trackedPath = resolve(repoRoot, 'config/tracked-skus.json');
  const trackedFile: TrackedSkusFile = JSON.parse(await readFile(trackedPath, 'utf-8'));
  const intelTracked = trackedFile.skus.filter((s) => s.vendor === 'Intel');

  if (intelTracked.length === 0) {
    throw new Error('No Intel SKUs found in config/tracked-skus.json');
  }

  // Build alias index: normalized form -> canonical SKU name.
  // Includes the canonical name itself as a self-alias so a SKU with no
  // explicit cpubenchmark alias still matches when the page shows the
  // canonical name verbatim.
  const aliasToCanonical = new Map<string, string>();
  for (const sku of intelTracked) {
    aliasToCanonical.set(normalizeCpuName(sku.name), sku.name);
    for (const alias of sku.aliases.cpubenchmark ?? []) {
      aliasToCanonical.set(normalizeCpuName(alias), sku.name);
    }
  }

  const browser = await launchBrowser();
  let scraped: CpubenchmarkRow[];
  try {
    scraped = await scrapeIntelRows({ browser, logger, trackedSkus: intelTracked });
  } finally {
    await browser.close();
  }

  // Resolve each scraped row to a canonical SKU (first match wins).
  const matched = new Map<string, CpubenchmarkRow>();
  for (const row of scraped) {
    const canonical = aliasToCanonical.get(normalizeCpuName(row.sourceSkuName));
    if (canonical && !matched.has(canonical)) {
      matched.set(canonical, row);
    }
  }

  const missing = intelTracked.filter((s) => !matched.has(s.name));

  // --- Report ---
  console.log();
  console.log('Source: PassMark / CPUbenchmark (https://www.cpubenchmark.net/cpu-list/intel)');
  console.log('Note:   "Price" below is the PassMark-observed street price, NOT a direct');
  console.log('        vendor retail (Newegg / CDW / Provantage / Arrow). raw_price_text is');
  console.log('        preserved verbatim; price_cents is normalized separately.');
  console.log();

  printTable(intelTracked, matched);

  console.log();
  console.log(`Total rows scraped from page: ${scraped.length}`);
  console.log(`Matched: ${matched.size} of ${intelTracked.length} tracked Intel SKUs`);
  console.log(`Missing: ${missing.length}`);
  if (missing.length > 0) {
    console.log('Missing canonical SKUs:');
    for (const sku of missing) {
      console.log(`  - ${sku.name}`);
    }
  }
}

function printTable(tracked: TrackedSku[], matched: Map<string, CpubenchmarkRow>): void {
  const header = [
    'Canonical SKU',
    'Source SKU Name',
    'CPU Mark',
    'Rank',
    'CPU Value',
    'Raw Price Text',
    'Price Cents',
    'Currency',
    'Source URL',
    'Matched',
  ];
  console.log('| ' + header.join(' | ') + ' |');
  console.log('|' + header.map(() => '---').join('|') + '|');

  for (const sku of tracked) {
    const row = matched.get(sku.name);
    const cells = row
      ? [
          sku.name,
          row.sourceSkuName,
          fmt(row.cpuMark),
          fmt(row.rank),
          fmt(row.cpuValue),
          row.rawPriceText || '—',
          fmt(row.priceCents),
          'USD',
          row.url,
          'Yes',
        ]
      : [sku.name, '—', '—', '—', '—', '—', '—', '—', '—', 'No'];
    console.log('| ' + cells.join(' | ') + ' |');
  }
}

function fmt(n: number | null): string {
  return n == null ? '—' : String(n);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`verify-intel failed: ${msg}\n`);
  process.exit(1);
});
