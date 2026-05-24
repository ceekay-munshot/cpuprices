/**
 * Normalize a CPU product name for alias matching.
 *
 * Sources display names with slight variations: trademark glyphs, ASCII
 * (R)/(TM) markers, an "@ N.N GHz" clock-speed suffix, and inconsistent
 * whitespace. The normalized form drops all of these and lowercases, so that
 * a canonical name like "Intel Core Ultra 9 285K" and a source rendering like
 * "Intel(R) Core(TM) Ultra 9 285K @ 3.7GHz" collapse to the same key for
 * matching against source_sku_aliases.normalized_source_name.
 *
 * Pure, idempotent, and intentionally conservative — keeps digits, letters,
 * and the dashes that distinguish SKU variants (e.g. "9950X3D").
 */
export function normalizeCpuName(name: string): string {
  return name
    .toLowerCase()
    // Unicode trademark / registered / copyright glyphs.
    .replace(/[®™©]/g, '')
    // ASCII trademark markers: (r), (tm), (c).
    .replace(/\((?:r|tm|c)\)/g, '')
    // Clock-speed suffix: " @ 3.7 GHz", "@3.7GHz", "@ 1.2 thz", etc.
    .replace(/\s*@\s*[\d.]+\s*[a-z]*hz\b/g, '')
    // Collapse internal whitespace runs (including tabs) to a single space.
    .replace(/\s+/g, ' ')
    .trim();
}
