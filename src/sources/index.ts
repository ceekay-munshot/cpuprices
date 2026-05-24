import type { Source } from './types';

/**
 * Registry of active sources. The scraper runner iterates this list, filters
 * by the `is_active` flag in the `sources` table, and invokes each one's
 * scrape() with a shared Playwright browser.
 *
 * To add a source: implement Source in src/sources/<slug>.ts, then push it
 * into the array below. Also add a row to config/sources.json and per-source
 * aliases under each canonical SKU in config/tracked-skus.json.
 *
 * Currently empty — checkpoint C3 adds the cpubenchmark module.
 */
export const sources: Source[] = [];
