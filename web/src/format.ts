/**
 * Display formatters. Treat null/undefined as "—" so the UI never shows
 * "$NaN" or "null". Integer cents in; human strings out.
 */

const EM_DASH = '—';

export function fmtPrice(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return EM_DASH;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return n.toLocaleString('en-US');
}

export function fmtPercent(pct: number | null | undefined, withSign = true): string {
  if (pct == null || !Number.isFinite(pct)) return EM_DASH;
  const sign = withSign && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function fmtAbsCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return EM_DASH;
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  // YYYY-MM-DD HH:mm UTC — terse, monospaced-friendly, no locale ambiguity
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const minsAgo = Math.floor((Date.now() - ms) / 60_000);
  if (minsAgo < 1) return 'just now';
  if (minsAgo < 60) return `${minsAgo} min ago`;
  const hoursAgo = Math.floor(minsAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo}h ago`;
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo}d ago`;
}

export function fmtCoverage(numer: number, denom: number): string {
  if (denom === 0) return EM_DASH;
  return `${((numer / denom) * 100).toFixed(1)}%`;
}

/** Class hint for delta cells. */
export function deltaTone(n: number | null | undefined): 'up' | 'down' | 'flat' | 'na' {
  if (n == null || !Number.isFinite(n)) return 'na';
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

export const PLACEHOLDER_VENDOR_DATA = 'Requires vendor pricing sources';
export const PLACEHOLDER_NOT_LIVE = 'Not live yet';
