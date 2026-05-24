/**
 * Tiny CSV writer + browser download trigger.
 *
 * We label the button "Download CSV" instead of "Download XLSX" because
 * shipping an honest CSV beats faking a corrupted .xlsx. CSV opens in
 * Excel / Numbers / Sheets directly. A real XLSX export can land later
 * via SheetJS without changing call sites — same function signature.
 */

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]): void {
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v) : v;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
