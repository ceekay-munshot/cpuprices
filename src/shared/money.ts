/**
 * Parse a price string into integer cents.
 *
 * We store prices as INTEGER cents in D1 (no float drift) plus the raw text
 * for audit. v1 sources are USD-only; the currency field is included to keep
 * the return shape stable when a non-USD source comes online.
 *
 * Unparseable inputs (null/undefined, empty, "NA", "—", prose without digits)
 * return priceCents: null rather than throwing. The raw text is preserved.
 *
 * Format handled:
 *   - "$589.99"          -> 58999
 *   - "$1,299"           -> 129900
 *   - "$1,299.50"        -> 129950
 *   - "$1,234,567.89"    -> 123456789
 *   - "$0.99"            -> 99
 *   - "$1.5"             -> 150  (one decimal = tens of cents)
 *   - "1234"             -> 123400
 *   - "  $42.00  "       -> 4200
 *   - "NA" / "n/a" / "--" / "—" / "TBD" / "n.a." -> null
 *   - "" / null / undefined / prose-only -> null
 */

export interface ParsedPrice {
  /** Integer cents. Null when unparseable. */
  priceCents: number | null;
  /** ISO-4217. Always 'USD' in v1. */
  currency: 'USD';
  /** Original input, trimmed; empty string for null/undefined input. */
  rawText: string;
}

/** Source-specific markers that mean "no price available". */
const NO_PRICE_PATTERN = /^(?:na|n\/a|n\.a\.|--|—|–|tbd|tba|—|-)$/i;

export function parsePrice(input: string | null | undefined): ParsedPrice {
  const rawText = input == null ? '' : String(input).trim();

  if (rawText === '' || NO_PRICE_PATTERN.test(rawText)) {
    return { priceCents: null, currency: 'USD', rawText };
  }

  // First numeric run: optional thousands-separated whole part + optional decimals.
  const match = rawText.match(/(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!match) {
    return { priceCents: null, currency: 'USD', rawText };
  }

  const wholeRaw = match[1] ?? '';
  const fracRaw = match[2] ?? '';

  const whole = Number(wholeRaw.replace(/[,\s]/g, ''));
  // One decimal digit means tens of cents; pad to 2.
  const fracPadded = fracRaw.padEnd(2, '0').slice(0, 2);
  const frac = fracPadded === '' ? 0 : Number(fracPadded);

  if (!Number.isFinite(whole) || !Number.isFinite(frac)) {
    return { priceCents: null, currency: 'USD', rawText };
  }

  return { priceCents: whole * 100 + frac, currency: 'USD', rawText };
}
