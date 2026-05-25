/**
 * Deterministic vendor and segment inference from a raw CPU name.
 *
 * Used by the /cpu-list/all pipeline to tag every observation before insert.
 * Pure and synchronous — no I/O, no allocations beyond the regex engine.
 *
 * Vendor priority order:
 *   1. Name starts with "Intel"               -> Intel
 *   2. Name starts with "AMD"                 -> AMD
 *   3. Name contains "Apple"                  -> Apple
 *   4. Name contains M1/M2/M3/M4              -> Apple   (Apple Silicon model id)
 *   5. Name contains Qualcomm or Snapdragon   -> Qualcomm
 *   6. Name contains ARM or AArch64           -> ARM
 *   7. otherwise                              -> Other
 *
 * The "starts with" checks for Intel/AMD anchor on `^` so e.g. an AMD reseller
 * mention inside an Intel product description doesn't flip the classification.
 * The Apple M[1-4] match uses word boundaries; PassMark's main CPU list
 * doesn't list Cortex-M microcontrollers, so the collision risk is low.
 */

export type InferredVendor = 'Intel' | 'AMD' | 'Apple' | 'Qualcomm' | 'ARM' | 'Other';

export function inferVendor(name: string): InferredVendor {
  if (/^intel\b/i.test(name)) return 'Intel';
  if (/^amd\b/i.test(name)) return 'AMD';
  if (/\bapple\b/i.test(name)) return 'Apple';
  if (/\bm[1-4]\b/i.test(name)) return 'Apple';
  if (/\b(qualcomm|snapdragon)\b/i.test(name)) return 'Qualcomm';
  if (/\b(arm|aarch64)\b/i.test(name)) return 'ARM';
  return 'Other';
}

// Segment inference (Server / Desktop / Laptop / Other) moved to ./segment.ts
// once it stopped being a stub. Import from there.
