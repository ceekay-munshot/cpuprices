/**
 * GET /api/price-changes
 *
 * For each (sku_id, source_id) pair, compares the latest price_history row
 * to the previous one. Returns absolute and percentage change, with clean
 * null handling when either side has no price (e.g. PassMark "NA" rendered
 * as price_cents = NULL).
 *
 * Drives the dashboard's "Price Changed" view.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface PriceChangeRow {
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

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    // Two CTEs: rank each (sku, source) by scraped_at DESC, then pick
    // rn=1 (latest) and rn=2 (previous). LEFT JOIN so a SKU with only one
    // recorded scrape still shows up with previous_* = NULL.
    //
    // The percentage_change calculation guards against:
    //   - either side null  -> NULL
    //   - previous = 0      -> NULL (avoid divide by zero)
    // Round to 2 decimal places.
    const res = await env.DB.prepare(
      `WITH ranked AS (
         SELECT
           ph.sku_id,
           ph.source_id,
           ph.price_cents,
           ph.scraped_at,
           row_number() OVER (PARTITION BY ph.sku_id, ph.source_id ORDER BY ph.scraped_at DESC, ph.id DESC) AS rn
         FROM price_history ph
       ),
       latest   AS (SELECT * FROM ranked WHERE rn = 1),
       previous AS (SELECT * FROM ranked WHERE rn = 2)
       SELECT
         s.id   AS sku_id,
         s.name AS sku_name,
         s.vendor,
         s.bucket,
         l.price_cents AS latest_price_cents,
         p.price_cents AS previous_price_cents,
         CASE
           WHEN l.price_cents IS NULL OR p.price_cents IS NULL THEN NULL
           ELSE l.price_cents - p.price_cents
         END AS absolute_change_cents,
         CASE
           WHEN l.price_cents IS NULL OR p.price_cents IS NULL OR p.price_cents = 0 THEN NULL
           ELSE ROUND((CAST(l.price_cents - p.price_cents AS REAL) * 100.0) / p.price_cents, 2)
         END AS percentage_change,
         l.scraped_at AS latest_scraped_at,
         p.scraped_at AS previous_scraped_at
       FROM latest l
       LEFT JOIN previous p ON p.sku_id = l.sku_id AND p.source_id = l.source_id
       JOIN skus s ON s.id = l.sku_id
       ORDER BY s.vendor, s.name;`,
    ).all<PriceChangeRow>();

    return {
      source_note: PASSMARK_NOTE,
      count: res.results.length,
      rows: res.results,
    };
  });

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};
