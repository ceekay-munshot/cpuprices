/**
 * Thin typed client for the Pages Functions API.
 *
 * Every endpoint returns the standard envelope:
 *   { "success": true,  "data": <T> }
 *   { "success": false, "error": "<string>" }
 *
 * call<T>() unwraps `data` and throws on `success: false`.
 *
 * In production the dashboard is served from the same Pages project as the
 * API, so an empty base URL → relative /api/* paths → same-origin call.
 * Override at build time via VITE_API_BASE if you want the local dev server
 * to hit a deployed environment.
 */

const BASE = ((import.meta.env as { VITE_API_BASE?: string }).VITE_API_BASE ?? '').replace(/\/$/, '');

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} from ${path}: response was not JSON`);
  }
  if (!body.success) {
    throw new Error(body.error ?? `HTTP ${res.status} from ${path}: success:false`);
  }
  return body.data as T;
}

// ============================================================================
// Response types — mirror the JSON returned by functions/api/*
// ============================================================================

export interface ScrapeRun {
  id: number;
  source_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_found: number | null;
  rows_inserted: number | null;
  observations_inserted: number | null;
  price_history_inserted: number | null;
  tracked_skus_matched: number | null;
  tracked_skus_missing: number | null;
}

export interface StatusData {
  latest_run: ScrapeRun | null;
  source_observations_count: number;
  price_history_count: number;
  last_scraped_at: string | null;
  minutes_since_last_scrape: number | null;
  is_fresh_daily: boolean;
  source_note: string;
}

export interface VendorRow {
  vendor_inferred: string;
  rows_observed: number;
  rows_with_price: number;
  avg_price_cents: number | null;
  median_price_cents: number | null;
  avg_benchmark_score: number | null;
  latest_scrape_run_id: number;
  latest_scraped_at: string | null;
}

export interface VendorSummaryData {
  source_note: string;
  latest_scrape_run_id: number | null;
  latest_scraped_at: string | null;
  vendors: VendorRow[];
}

export interface CurrentPriceRow {
  sku_id: number;
  sku_name: string;
  vendor: string;
  bucket: string;
  tier: string | null;
  source_slug: string;
  source_sku_name: string;
  price_cents: number | null;
  raw_price_text: string | null;
  currency: string;
  benchmark_score: number | null;
  url: string | null;
  scraped_at: string;
}

export interface CurrentPricesData {
  source_note: string;
  count: number;
  rows: CurrentPriceRow[];
}

export interface SkuHistoryRow {
  sku_id: number;
  sku_name: string;
  source_slug: string;
  price_cents: number | null;
  raw_price_text: string | null;
  benchmark_score: number | null;
  scraped_at: string;
  scrape_run_id: number;
}

export interface SkuHistoryData {
  source_note: string;
  sku_id: number;
  sku_name: string | null;
  count: number;
  rows: SkuHistoryRow[];
}

export interface PriceChangeRow {
  sku_id: number;
  sku_name: string;
  vendor: string;
  bucket: string;
  latest_price_cents: number | null;
  previous_price_cents: number | null;
  absolute_change_cents: number | null;
  percentage_change: number | null;
  latest_scraped_at: string;
  previous_scraped_at: string | null;
}

export interface PriceChangesData {
  source_note: string;
  count: number;
  rows: PriceChangeRow[];
}

export interface ObservationRow {
  source_sku_name: string;
  normalized_source_name: string;
  vendor_inferred: string | null;
  segment_inferred: string | null;
  benchmark_score: number | null;
  rank: number | null;
  cpu_value: number | null;
  price_cents: number | null;
  raw_price_text: string | null;
  currency: string;
  url: string | null;
  scraped_at: string;
  /** Closest historical price 7 days before the latest scrape. Null when no history yet. */
  wow_price_cents: number | null;
  /** Closest historical price 30 days before the latest scrape. Null when no history yet. */
  mom_price_cents: number | null;
  /** Closest historical price 90 days before the latest scrape. Null when no history yet. */
  qoq_price_cents: number | null;
}

export interface ObservationsData {
  source_note: string;
  latest_scrape_run_id: number | null;
  latest_scraped_at: string | null;
  count: number;
  rows: ObservationRow[];
}

export const api = {
  status: () => call<StatusData>('/api/status'),
  vendorSummary: () => call<VendorSummaryData>('/api/passmark/vendor-summary'),
  currentPrices: () => call<CurrentPricesData>('/api/current-prices'),
  skuHistory: (id: number) => call<SkuHistoryData>(`/api/sku-history?sku_id=${id}`),
  priceChanges: () => call<PriceChangesData>('/api/price-changes'),
  observations: () => call<ObservationsData>('/api/observations'),
};
