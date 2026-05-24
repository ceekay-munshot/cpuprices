/**
 * Types shared across the scraper, sync-config, and ad-hoc scripts.
 * Anything imported from here must be runtime-erasable (types only) so it can
 * be safely consumed by both Node-side code and (with care) Pages Functions.
 */

/** Constrained to match the CHECK on scrape_runs.status. */
export type ScrapeRunStatus = 'running' | 'success' | 'partial' | 'failure';

/** Shape of one entry in config/tracked-skus.json. */
export interface TrackedSku {
  /** Canonical SKU name. Unique across the catalog. */
  name: string;
  /** "Intel" or "AMD" today. Kept as string for future flexibility. */
  vendor: string;
  /** "Desktop Intel" / "Desktop AMD" today. Kept as string. */
  bucket: string;
  /** Free-form: "Core Ultra 9", "Ryzen 7", etc. */
  tier: string | null;
  /** Per-source name variants, keyed by source slug. */
  aliases: Record<string, string[]>;
}

/** Wrapper for tracked-skus.json. */
export interface TrackedSkusFile {
  skus: TrackedSku[];
}

/** Shape of one entry in config/sources.json. */
export interface SourceConfig {
  slug: string;
  name: string;
  base_url: string;
  is_active: boolean;
}

/** Wrapper for sources.json. */
export interface SourcesFile {
  sources: SourceConfig[];
}

/**
 * What the scraper inserts into price_history. One row per (sku, source) per run.
 * Mirrors the column layout of the price_history table.
 */
export interface PriceObservation {
  skuId: number;
  sourceId: number;
  scrapeRunId: number;
  sourceSkuName: string;
  priceCents: number | null;
  rawPriceText: string | null;
  currency: string;
  priceType: string;
  benchmarkScore: number | null;
  url: string | null;
  /** ISO-8601 UTC, e.g. "2026-05-24T09:17:00.000Z". */
  scrapedAt: string;
}

/** Minimal structured logger interface implemented in src/scraper/logger.ts. */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}
