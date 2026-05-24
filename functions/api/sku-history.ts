/**
 * GET /api/sku-history?sku_id=<n>
 *
 * Full price_history time series for a single tracked SKU, ordered by
 * scraped_at ascending so a chart can plot it directly.
 *
 * Validates sku_id is present and a positive integer.
 */

import { jsonError, PASSMARK_NOTE, safeHandle, type Env } from '../_lib';

interface HistoryRow {
  sku_id: number;
  sku_name: string;
  source_slug: string;
  price_cents: number | null;
  raw_price_text: string | null;
  benchmark_score: number | null;
  scraped_at: string;
  scrape_run_id: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const raw = url.searchParams.get('sku_id');
  if (raw == null || raw === '') {
    return jsonError('Missing required query parameter: sku_id', 400);
  }
  // Reject anything that isn't a plain positive integer: blocks decimals,
  // negatives, scientific notation, NaN, hex, etc.
  if (!/^[1-9]\d*$/.test(raw)) {
    return jsonError('sku_id must be a positive integer', 400);
  }
  const skuId = Number(raw);

  return safeHandle(async () => {
    const skuRes = await env.DB.prepare(
      'SELECT id, name FROM skus WHERE id = ?;',
    )
      .bind(skuId)
      .first<{ id: number; name: string }>();

    if (!skuRes) {
      // Surface unknown sku_id as data (not a 404 envelope) so the UI can
      // show "no such SKU" without parsing error strings.
      return {
        source_note: PASSMARK_NOTE,
        sku_id: skuId,
        sku_name: null,
        count: 0,
        rows: [] as HistoryRow[],
      };
    }

    const historyRes = await env.DB.prepare(
      `SELECT
         ph.sku_id,
         s.name   AS sku_name,
         src.slug AS source_slug,
         ph.price_cents,
         ph.raw_price_text,
         ph.benchmark_score,
         ph.scraped_at,
         ph.scrape_run_id
       FROM price_history ph
       JOIN skus    s   ON s.id   = ph.sku_id
       JOIN sources src ON src.id = ph.source_id
       WHERE ph.sku_id = ?
       ORDER BY ph.scraped_at ASC, ph.id ASC;`,
    )
      .bind(skuId)
      .all<HistoryRow>();

    return {
      source_note: PASSMARK_NOTE,
      sku_id: skuId,
      sku_name: skuRes.name,
      count: historyRes.results.length,
      rows: historyRes.results,
    };
  });
};

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') {
    return jsonError(`Method ${ctx.request.method} not allowed`, 405);
  }
  return ctx.next();
};
