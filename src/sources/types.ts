import type { Browser } from 'playwright';
import type { Logger, TrackedSku } from '../shared/types';

/**
 * One raw row returned by a source's scrape() method, before alias resolution.
 *
 * Prices are integer cents — never floats — matching the price_history schema.
 * `rawPriceText` preserves the exact source rendering for audit so we can
 * always reconstruct what the page showed even if our parser changes.
 */
export interface RawObservation {
  /** Exactly as the source displayed it (pre-normalization). */
  sourceSkuName: string;
  /** Integer cents. Null when the source shows "NA" / "—" / no price. */
  priceCents: number | null;
  /** Exact text the source displayed for the price. Empty string if absent. */
  rawPriceText: string;
  /** ISO-4217. 'USD' in v1. */
  currency: string;
  /**
   * v1 sources only emit "street". The schema column is open so a future
   * source can emit "msrp" or "sale" without a migration.
   */
  priceType: 'street';
  /** PassMark CPU Mark or equivalent benchmark. Integer when present. */
  benchmarkScore: number | null;
  /** Source URL the row was scraped from. */
  url: string;
  /** ISO-8601 UTC, e.g. "2026-05-24T09:17:00.000Z". */
  scrapedAt: string;
}

/**
 * Everything a source needs to perform its scrape: a Playwright browser
 * (shared across sources within one run), the run logger, and the list
 * of tracked SKUs loaded from config/tracked-skus.json. Sources may
 * choose to filter against this list, or return everything and let the
 * runner filter via source_sku_aliases — both are supported.
 */
export interface ScrapeContext {
  browser: Browser;
  logger: Logger;
  trackedSkus: TrackedSku[];
}

/**
 * A source is a small module that knows how to extract observations from one
 * site. Adding a source means:
 *   1. Implement Source in src/sources/<slug>.ts
 *   2. Register it in src/sources/index.ts
 *   3. Add a row to config/sources.json
 *   4. Add per-source aliases in config/tracked-skus.json
 *   5. Run `npm run sync:remote`
 *
 * The runner is responsible for opening a scrape_runs row, calling scrape(),
 * resolving aliases, and inserting price_history rows. Sources should not
 * touch D1 directly — keep them pure data-extractors.
 */
export interface Source {
  /** Must match sources.slug in the DB and the key used in tracked-skus aliases. */
  slug: string;
  /** Human-readable display name. */
  name: string;
  /** Base URL of the source; used for logs and as the default for `url`. */
  baseUrl: string;
  /** Perform the scrape. Returns one observation per row encountered on the page(s). */
  scrape(ctx: ScrapeContext): Promise<RawObservation[]>;
}
