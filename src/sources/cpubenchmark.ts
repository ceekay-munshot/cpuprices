// page.evaluate() callbacks run in the browser, so this file needs DOM
// types. The reference is scoped to the compilation but kept here (rather
// than added to tsconfig) so the dependency is documented in-place.
/// <reference lib="dom" />

import type { RawObservation, ScrapeContext, Source } from './types';
import { createContext } from '../scraper/browser';
import { parsePrice } from '../shared/money';

/**
 * PassMark / CPUbenchmark source.
 *
 * IMPORTANT: PassMark is a benchmark + market-share proxy. The price column
 * here is a PassMark-observed street price, NOT a direct vendor retail price
 * like Newegg / CDW / Provantage / Arrow. We capture it as `price_type =
 * 'street'` with the raw text preserved verbatim in `rawPriceText` so the
 * downstream UI can label and disclose the provenance accurately.
 *
 * Columns on the public list pages, in order:
 *   CPU Name | CPU Mark | Rank | CPU Value | Price (USD)
 */

const INTEL_URL = 'https://www.cpubenchmark.net/cpu-list/intel';
const AMD_URL = 'https://www.cpubenchmark.net/cpu-list/amd';
const ALL_URL = 'https://www.cpubenchmark.net/cpu-list/all';

/**
 * Richer per-row shape than RawObservation. Adds Rank and CPU Value, which
 * the verification script surfaces in its audit table. These columns are not
 * persisted to D1 today — `price_history` only stores benchmark_score
 * (= cpuMark) alongside the price fields.
 */
export interface CpubenchmarkRow {
  sourceSkuName: string;
  cpuMark: number | null;
  rank: number | null;
  cpuValue: number | null;
  rawPriceText: string;
  priceCents: number | null;
  url: string;
  scrapedAt: string;
}

export const cpubenchmark: Source = {
  slug: 'cpubenchmark',
  name: 'PassMark CPU Benchmark',
  baseUrl: 'https://www.cpubenchmark.net',
  async scrape(ctx) {
    // Production: one request to /cpu-list/all covers every vendor. The
    // per-vendor functions below remain for debugging and the legacy
    // scrape:local:{intel,amd} commands.
    const rows = await scrapeAllRows(ctx);
    return rows.map(toRawObservation);
  },
};

export async function scrapeIntelRows(ctx: ScrapeContext): Promise<CpubenchmarkRow[]> {
  return scrapeListPage(ctx, INTEL_URL);
}

export async function scrapeAmdRows(ctx: ScrapeContext): Promise<CpubenchmarkRow[]> {
  return scrapeListPage(ctx, AMD_URL);
}

/**
 * Production daily scrape entry point. Returns every CPU on the full
 * /cpu-list/all page — Intel, AMD, Apple, Qualcomm, ARM, plus the long tail.
 * Per-vendor scrape functions above are kept for debugging only.
 */
export async function scrapeAllRows(ctx: ScrapeContext): Promise<CpubenchmarkRow[]> {
  return scrapeListPage(ctx, ALL_URL);
}

async function scrapeListPage(ctx: ScrapeContext, url: string): Promise<CpubenchmarkRow[]> {
  const context = await createContext(ctx.browser);
  const page = await context.newPage();

  try {
    ctx.logger.info(`cpubenchmark: GET ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for any table on the page to have a meaningful number of rows.
    // Resilient to PassMark's table id/class changing — looks for the largest
    // table with >10 rows, which is the data table on these list pages.
    await page.waitForFunction(
      () => {
        const tables = Array.from(document.querySelectorAll('table'));
        return tables.some((t) => (t as HTMLTableElement).rows.length > 10);
      },
      { timeout: 20_000 },
    );

    const rawCells = await page.evaluate(() => {
      // Prefer the historic id; fall back to the largest table on the page.
      const byId = document.querySelector('table#cputable') as HTMLTableElement | null;
      let table: HTMLTableElement | null = byId;
      if (!table) {
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
        tables.sort((a, b) => b.rows.length - a.rows.length);
        table = tables[0] ?? null;
      }
      if (!table) return [];

      const out: string[][] = [];
      for (const row of Array.from(table.rows)) {
        const tds = row.querySelectorAll('td');
        if (tds.length < 5) continue; // header / separator rows
        out.push(
          Array.from(tds).map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
        );
      }
      return out;
    });

    const scrapedAt = new Date().toISOString();
    ctx.logger.info(`cpubenchmark: extracted ${rawCells.length} data rows from ${url}`);

    return rawCells.map((cells) => parseRow(cells, url, scrapedAt));
  } finally {
    await page.close();
    await context.close();
  }
}

function parseRow(cells: string[], url: string, scrapedAt: string): CpubenchmarkRow {
  const sourceSkuName = cells[0] ?? '';
  const cpuMark = parseIntegerWithCommas(cells[1]);
  const rank = parseIntegerWithCommas(cells[2]);
  const cpuValue = parseFloatLoose(cells[3]);
  const rawPriceText = (cells[4] ?? '').trim();
  const parsed = parsePrice(rawPriceText);

  return {
    sourceSkuName,
    cpuMark,
    rank,
    cpuValue,
    // parsePrice preserves the raw text verbatim (including markers like "*").
    rawPriceText: parsed.rawText,
    priceCents: parsed.priceCents,
    url,
    scrapedAt,
  };
}

function parseIntegerWithCommas(text: string | undefined): number | null {
  if (text == null) return null;
  const cleaned = text.replace(/[,\s]/g, '');
  if (cleaned === '' || !/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseFloatLoose(text: string | undefined): number | null {
  if (text == null) return null;
  const cleaned = text.replace(/[,\s$]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Narrow a CpubenchmarkRow to the storage shape consumed by the scraper
 * runner when it inserts into `price_history`. Rank and CPU Value are
 * dropped — they aren't part of the canonical schema.
 */
export function toRawObservation(row: CpubenchmarkRow): RawObservation {
  return {
    sourceSkuName: row.sourceSkuName,
    priceCents: row.priceCents,
    rawPriceText: row.rawPriceText,
    currency: 'USD',
    priceType: 'street',
    benchmarkScore: row.cpuMark,
    url: row.url,
    scrapedAt: row.scrapedAt,
  };
}
