/**
 * Deterministic segment inference from a CPU name.
 *
 * Categorizes each scraped CPU into one of:
 *   - Server   (Xeon, EPYC, Opteron, Threadripper PRO, POWER, UltraSPARC)
 *   - Laptop   (Apple Silicon; phone-chip vendors; Intel/AMD mobile suffixes
 *               H/HX/HS/U/Y/P; Turion; explicit "Mobile" in the name)
 *   - Desktop  (Intel K/KF/F/T/S/X; AMD X/X3D/G/GE; Threadripper non-PRO;
 *               Athlon/Phenom/Sempron/FX/A-series APU; Core 2; VIA; Zhaoxin;
 *               fallback for Intel Core / AMD Ryzen without a clear suffix)
 *   - Other    (Atom embedded, Rockchip SBC, Virtual machines, generic ARM,
 *               unrecognized)
 *
 * Pure and synchronous. Rule order matters:
 *   1. Server checked first  (so a mobile Xeon stays Server)
 *   2. Laptop second         (so "Mobile" beats an Athlon → Desktop default)
 *   3. Desktop third
 *   4. Other / Embedded / fallthrough
 *
 * Expected accuracy on PassMark's ~5.9k-row /cpu-list/all corpus is ~85% with
 * <20% legitimate Other. Known weak spots that we accept:
 *   - Apple M-series (Mac Studio = desktop; whole family classifies as
 *     Laptop because MacBook is the dominant ship volume)
 *   - Old Intel "Core 2 Duo T9300" / "Core 2 Duo P7350" mobile chips
 *     (prefix-style suffix, not modern suffix — fall through to Desktop)
 *   - Workstation Xeon-W (intentionally Server, not Desktop)
 */

export type InferredSegment = 'Server' | 'Desktop' | 'Laptop' | 'Other';

export function inferSegment(name: string): InferredSegment {
  const n = name.toLowerCase();

  // --- 1. Server: explicit families. Checked first so a mobile Xeon stays Server.
  if (/\bxeon\b/.test(n)) return 'Server';
  if (/\bepyc\b/.test(n)) return 'Server';
  if (/\bopteron\b/.test(n)) return 'Server';
  if (/\bthreadripper\s+pro\b/.test(n)) return 'Server';
  if (/\bpower\s*\d/.test(n)) return 'Server';
  if (/\bultrasparc\b/.test(n)) return 'Server';

  // --- 2. Laptop / Mobile.
  // Vendor families that ship overwhelmingly in laptops, phones, tablets.
  if (/\bapple\b/.test(n)) return 'Laptop';
  if (/\bm[1-4]\b/.test(n)) return 'Laptop';
  if (/\bsnapdragon\b/.test(n)) return 'Laptop';
  if (/\bqualcomm\b/.test(n)) return 'Laptop';        // QTI / "Qualcomm Technologies"
  if (/\bqti\b/.test(n)) return 'Laptop';
  if (/\bmediatek\b/.test(n)) return 'Laptop';
  if (/\bsamsung\b/.test(n)) return 'Laptop';         // Exynos / Galaxy variants
  if (/\bspreadtrum\b/.test(n)) return 'Laptop';
  if (/\bunisoc\b/.test(n)) return 'Laptop';
  if (/\bturion\b/.test(n)) return 'Laptop';          // AMD's mobile brand
  if (/\bmobile\b/.test(n)) return 'Laptop';          // literal "Mobile" anywhere

  // Intel / AMD modern mobile suffixes: digits then suffix at a word boundary.
  // Matches "13900HX", "1365U", "Ultra 9 185H", "7840U", "7945HX".
  // Longest suffixes first so HX/HS/HK/HQ win over bare H.
  if (/\b\d+(hx|hs|hk|hq|h|u|y|p)\b/.test(n)) return 'Laptop';

  // --- 3. Desktop.
  // Suffixes longest-first so x3d / kf / ge win over x / k / g / e.
  if (/\b\d+(x3d|kf|ge|xt|k|f|t|s|x|g|e)\b/.test(n)) return 'Desktop';
  if (/\bthreadripper\b/.test(n)) return 'Desktop';   // non-PRO HEDT

  // Older AMD desktop families.
  if (/\bathlon\b/.test(n)) return 'Desktop';
  if (/\bphenom\b/.test(n)) return 'Desktop';
  if (/\bsempron\b/.test(n)) return 'Desktop';
  if (/\bduron\b/.test(n)) return 'Desktop';
  if (/\bamd\s+fx-?\d/.test(n)) return 'Desktop';     // FX-8350, FX 6300
  if (/\bamd\s+a\d+-?\d/.test(n)) return 'Desktop';   // A10-7890K APU
  if (/\bcore\s+2\b/.test(n)) return 'Desktop';       // Core 2 Duo/Quad default

  // Smaller x86 vendors — typically desktop / embedded desktop.
  if (/\bvia\s+/.test(n)) return 'Desktop';
  if (/\bzhaoxin\b/.test(n)) return 'Desktop';

  // No suffix but recognizable family → Desktop default.
  if (/\bintel\s+core\b/.test(n)) return 'Desktop';
  if (/\bamd\s+ryzen\b/.test(n)) return 'Desktop';
  if (/\bcore\s+ultra\b/.test(n)) return 'Desktop';
  if (/\bpentium\b/.test(n)) return 'Desktop';
  if (/\bceleron\b/.test(n)) return 'Desktop';

  // --- 4. Other / Embedded / unknown.
  if (/\batom\b/.test(n)) return 'Other';
  if (/\brockchip\b/.test(n)) return 'Other';         // SBC / embedded
  if (/\bvirtual\b/.test(n)) return 'Other';          // VMs

  return 'Other';
}
