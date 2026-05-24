/**
 * CORS + light cache headers for every /api/* response.
 *
 * Scoped to /api/* by living in functions/api/. Lets the dashboard call us
 * from a browser (eventually from the same origin, but permissive here so
 * a deployed Pages preview can also be hit during development). Short
 * cache lets edges absorb burst reads without hiding the daily refresh.
 */

import type { Env } from '../_lib';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const response = await ctx.next();

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    response.headers.set(k, v);
  }
  if (!response.headers.has('Cache-Control')) {
    response.headers.set('Cache-Control', 'public, max-age=60');
  }
  return response;
};
