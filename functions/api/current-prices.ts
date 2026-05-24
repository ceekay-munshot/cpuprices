/**
 * GET /api/current-prices
 *
 * Latest price_history row per (sku_id, source_id). Joined to skus + sources
 * so the UI gets vendor / bucket / tier / source_slug in one round trip.
 *
 * Drives the dashboard's "Current Prices" view.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface CurrentPriceRow {
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

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  safeHandle(async () => {
    const res = await env.DB.prepare(
      `WITH ranked AS (
         SELECT ph.*,
                row_number() OVER (PARTITION BY ph.sku_id, ph.source_id ORDER BY ph.scraped_at DESC, ph.id DESC) AS rn
         FROM price_history ph
       )
       SELECT
         s.id   AS sku_id,
         s.name AS sku_name,
         s.vendor,
         s.bucket,
         s.tier,
         src.slug AS source_slug,
         r.source_sku_name,
         r.price_cents,
         r.raw_price_text,
         r.currency,
         r.benchmark_score,
         r.url,
         r.scraped_at
       FROM ranked r
       JOIN skus    s   ON s.id   = r.sku_id
       JOIN sources src ON src.id = r.source_id
       WHERE r.rn = 1
       ORDER BY s.vendor, s.name;`,
    ).all<CurrentPriceRow>();

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
