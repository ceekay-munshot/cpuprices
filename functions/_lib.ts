/**
 * Shared helpers for Pages Functions under /api/*.
 *
 * Response envelope (consistent across every endpoint):
 *   { "success": true,  "data": <T>         }
 *   { "success": false, "error": "<string>" }
 *
 * D1 binding `DB` is configured in wrangler.toml's [[d1_databases]] block;
 * the Pages runtime injects it as env.DB.
 */

export interface Env {
  DB: D1Database;
}

export interface ApiOk<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export function jsonOk<T>(data: T, status = 200): Response {
  const body: ApiOk<T> = { success: true, data };
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function jsonError(error: string, status = 400): Response {
  const body: ApiError = { success: false, error };
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Wraps an async handler so any thrown error becomes a clean 500 JSON envelope
 * instead of an unhandled rejection in the worker runtime.
 */
export async function safeHandle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return jsonOk(await fn());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

/**
 * Disclosure embedded in select endpoints so downstream UI never accidentally
 * presents PassMark's price column as direct vendor retail.
 */
export const PASSMARK_NOTE =
  'PassMark / CPUbenchmark is a benchmark and market-share proxy source. ' +
  'Its price column is an observed street price, not a direct vendor retail ' +
  'price like Newegg, CDW, Provantage, or Arrow.';

// ---------------------------------------------------------------------------
// Vendor aggregation (duplicated from src/scraper/pipeline.ts to keep the
// functions/ project boundary clean; ~30 lines, no imports outside this file).
// ---------------------------------------------------------------------------

export interface VendorAggregateInput {
  vendor_inferred: string | null;
  price_cents: number | null;
  benchmark_score: number | null;
}

export interface VendorAggregate {
  vendor_inferred: string;
  rows_observed: number;
  rows_with_price: number;
  avg_price_cents: number | null;
  median_price_cents: number | null;
  avg_benchmark_score: number | null;
}

export function aggregateByVendor(rows: VendorAggregateInput[]): VendorAggregate[] {
  const buckets = new Map<string, { prices: number[]; benchmarks: number[]; total: number }>();
  for (const row of rows) {
    const vendor = row.vendor_inferred ?? 'Other';
    let b = buckets.get(vendor);
    if (!b) {
      b = { prices: [], benchmarks: [], total: 0 };
      buckets.set(vendor, b);
    }
    b.total++;
    if (typeof row.price_cents === 'number' && Number.isFinite(row.price_cents)) {
      b.prices.push(row.price_cents);
    }
    if (typeof row.benchmark_score === 'number' && Number.isFinite(row.benchmark_score)) {
      b.benchmarks.push(row.benchmark_score);
    }
  }
  const out: VendorAggregate[] = [];
  for (const [vendor, b] of buckets) {
    out.push({
      vendor_inferred: vendor,
      rows_observed: b.total,
      rows_with_price: b.prices.length,
      avg_price_cents:
        b.prices.length > 0 ? Math.round(b.prices.reduce((s, n) => s + n, 0) / b.prices.length) : null,
      median_price_cents: b.prices.length > 0 ? median(b.prices) : null,
      avg_benchmark_score:
        b.benchmarks.length > 0
          ? Math.round(b.benchmarks.reduce((s, n) => s + n, 0) / b.benchmarks.length)
          : null,
    });
  }
  out.sort((a, b) => b.rows_observed - a.rows_observed);
  return out;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return sorted[mid]!;
}
