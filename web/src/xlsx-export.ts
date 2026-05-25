/**
 * XLSX export for the CPU Universe.
 *
 * Kept in a dedicated module + behind a dynamic import so SheetJS (~280 KB
 * gzipped) doesn't land in the base bundle. The first time the user clicks
 * Download XLSX the chunk fetches once; subsequent clicks reuse it.
 */

import type { ObservationRow } from './api';

interface ExportRow {
  Vendor: string;
  'Source SKU Name': string;
  'CPU Mark': number | null;
  Rank: number | null;
  'CPU Value': number | null;
  'Price (USD)': number | null;
  'Raw Price Text': string;
  Currency: string;
  'Price 7d Ago (USD)': number | null;
  'Price 30d Ago (USD)': number | null;
  'Price 90d Ago (USD)': number | null;
  'WoW %': number | null;
  'MoM %': number | null;
  'QoQ %': number | null;
  'WoW Abs (USD)': number | null;
  'MoM Abs (USD)': number | null;
  'QoQ Abs (USD)': number | null;
  'Source URL': string;
  'Scraped At (UTC)': string;
}

function centsToUsd(cents: number | null): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return Math.round(cents) / 100;
}

function pctDelta(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  // Round to 2 decimal places; sheet user can reformat.
  return Math.round(((latest - prior) / prior) * 10000) / 100;
}

function absDeltaUsd(latestCents: number | null, priorCents: number | null): number | null {
  if (latestCents == null || priorCents == null) return null;
  return Math.round(latestCents - priorCents) / 100;
}

function toExportRow(r: ObservationRow): ExportRow {
  return {
    Vendor: r.vendor_inferred ?? 'Other',
    'Source SKU Name': r.source_sku_name,
    'CPU Mark': r.benchmark_score,
    Rank: r.rank,
    'CPU Value': r.cpu_value,
    'Price (USD)': centsToUsd(r.price_cents),
    'Raw Price Text': r.raw_price_text ?? '',
    Currency: r.currency,
    'Price 7d Ago (USD)': centsToUsd(r.wow_price_cents),
    'Price 30d Ago (USD)': centsToUsd(r.mom_price_cents),
    'Price 90d Ago (USD)': centsToUsd(r.qoq_price_cents),
    'WoW %': pctDelta(r.price_cents, r.wow_price_cents),
    'MoM %': pctDelta(r.price_cents, r.mom_price_cents),
    'QoQ %': pctDelta(r.price_cents, r.qoq_price_cents),
    'WoW Abs (USD)': absDeltaUsd(r.price_cents, r.wow_price_cents),
    'MoM Abs (USD)': absDeltaUsd(r.price_cents, r.mom_price_cents),
    'QoQ Abs (USD)': absDeltaUsd(r.price_cents, r.qoq_price_cents),
    'Source URL': r.url ?? '',
    'Scraped At (UTC)': r.scraped_at,
  };
}

export async function exportObservationsXlsx(
  rows: ObservationRow[],
  scrapedAt: string | null,
): Promise<{ filename: string; rowCount: number }> {
  // Dynamic import so the SheetJS chunk only ships when needed.
  const XLSX = await import('xlsx');

  const exportRows = rows.map(toExportRow);
  const ws = XLSX.utils.json_to_sheet(exportRows);

  // Column widths tuned for the columns above. wch = character count.
  ws['!cols'] = [
    { wch: 10 }, // Vendor
    { wch: 42 }, // Source SKU Name
    { wch: 10 }, // CPU Mark
    { wch: 8 },  // Rank
    { wch: 10 }, // CPU Value
    { wch: 12 }, // Price (USD)
    { wch: 16 }, // Raw Price Text
    { wch: 9 },  // Currency
    { wch: 18 }, // Price 7d Ago
    { wch: 18 }, // Price 30d Ago
    { wch: 18 }, // Price 90d Ago
    { wch: 9 },  // WoW %
    { wch: 9 },  // MoM %
    { wch: 9 },  // QoQ %
    { wch: 14 }, // WoW Abs
    { wch: 14 }, // MoM Abs
    { wch: 14 }, // QoQ Abs
    { wch: 50 }, // Source URL
    { wch: 22 }, // Scraped At
  ];

  // Freeze top row so the header stays visible while scrolling.
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CPU Universe');

  const datePart = (scrapedAt ?? new Date().toISOString()).slice(0, 10);
  const filename = `cpu-universe-${datePart}.xlsx`;
  XLSX.writeFile(wb, filename);

  return { filename, rowCount: exportRows.length };
}
