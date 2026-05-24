import { useMemo, useState } from 'react';
import type { CurrentPriceRow } from '../api';
import { fmtInt, fmtPrice } from '../format';

/**
 * Customer-facing supply-tightness tracker table.
 *
 * Two views over the same row set:
 *   Manufacturer-first: groups by (Manufacturer, Product Type)
 *   Product-type-first: groups by (Product Type, Manufacturer)
 *
 * The row catalogue is fixed per the customer brief. SKUs Tracked counts are
 * hardcoded against config/tracked-skus.json (also fixed today). Latest Avg
 * Price comes from /api/current-prices when SKUs exist; everything that
 * needs direct vendor pricing or multi-period baselines shows an honest
 * placeholder rather than a fabricated number.
 */

export type Manufacturer = 'Intel' | 'AMD' | 'Nvidia';
export type ProductType = 'Server' | 'Desktop' | 'Laptop';

export interface MainRow {
  manufacturer: Manufacturer;
  productType: ProductType;
  trackedSkus: number;
  bucketKey: string | null; // matches skus.bucket; null = nothing tracked in this combo
}

// Customer-fixed catalogue
const ROWS: MainRow[] = [
  { manufacturer: 'Intel',  productType: 'Server',  trackedSkus: 0, bucketKey: null },
  { manufacturer: 'Intel',  productType: 'Desktop', trackedSkus: 6, bucketKey: 'Desktop Intel' },
  { manufacturer: 'Intel',  productType: 'Laptop',  trackedSkus: 0, bucketKey: null },
  { manufacturer: 'AMD',    productType: 'Server',  trackedSkus: 0, bucketKey: null },
  { manufacturer: 'AMD',    productType: 'Desktop', trackedSkus: 8, bucketKey: 'Desktop AMD' },
  { manufacturer: 'AMD',    productType: 'Laptop',  trackedSkus: 0, bucketKey: null },
  { manufacturer: 'Nvidia', productType: 'Server',  trackedSkus: 0, bucketKey: null },
];

export interface ComputedRow extends MainRow {
  matchedSkus: number;
  latestAvgCents: number | null;
  vendorsCovered: string;
  dataQuality: 'proxy' | 'pending' | 'missing';
  contributors: CurrentPriceRow[];
}

export function computeRows(currentPrices: CurrentPriceRow[]): ComputedRow[] {
  return ROWS.map((row) => {
    const contributors = row.bucketKey
      ? currentPrices.filter(
          (r) => r.vendor === row.manufacturer && r.bucket === row.bucketKey,
        )
      : [];
    const matched = contributors.length;
    const priced = contributors.filter((r) => r.price_cents != null);
    const latestAvg =
      priced.length > 0
        ? Math.round(priced.reduce((s, r) => s + (r.price_cents ?? 0), 0) / priced.length)
        : null;
    const vendors = matched > 0 ? 'PassMark proxy only' : '—';
    const quality: ComputedRow['dataQuality'] =
      matched > 0 ? 'proxy' : row.trackedSkus > 0 ? 'missing' : 'pending';
    return {
      ...row,
      matchedSkus: matched,
      latestAvgCents: latestAvg,
      vendorsCovered: vendors,
      dataQuality: quality,
      contributors,
    };
  });
}

interface Props {
  currentPrices: CurrentPriceRow[] | null;
  loading: boolean;
  error: string | null;
  onEvidence: (row: ComputedRow) => void;
}

type View = 'mfr' | 'type';

export default function MainTable({ currentPrices, loading, error, onEvidence }: Props) {
  const [view, setView] = useState<View>('mfr');
  const computed = useMemo(() => (currentPrices ? computeRows(currentPrices) : []), [currentPrices]);

  const sortedRows = useMemo(() => {
    if (view === 'mfr') return computed; // catalogue order is already manufacturer-first
    const order: ProductType[] = ['Server', 'Desktop', 'Laptop'];
    return [...computed].sort((a, b) => {
      const t = order.indexOf(a.productType) - order.indexOf(b.productType);
      if (t !== 0) return t;
      const mfr: Manufacturer[] = ['Intel', 'AMD', 'Nvidia'];
      return mfr.indexOf(a.manufacturer) - mfr.indexOf(b.manufacturer);
    });
  }, [computed, view]);

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">CPU Pricing Tracker</h2>
          <div className="section__hint">
            Click <em>Evidence</em> to see which SKUs created the number, source URLs, and the calculation
            method. Δ columns and direct-vendor columns are placeholders until those sources go live.
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Table view">
          <button
            type="button"
            className={`tabs__btn ${view === 'mfr' ? 'tabs__btn--active' : ''}`}
            onClick={() => setView('mfr')}
            role="tab"
            aria-selected={view === 'mfr'}
          >
            Manufacturer ▸ Type
          </button>
          <button
            type="button"
            className={`tabs__btn ${view === 'type' ? 'tabs__btn--active' : ''}`}
            onClick={() => setView('type')}
            role="tab"
            aria-selected={view === 'type'}
          >
            Type ▸ Manufacturer
          </button>
        </div>
      </div>

      {loading && <div className="state-line">Loading current prices…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && (
        <div className="t-wrap">
          <table className="t t--dense">
            <thead>
              <tr>
                {view === 'mfr' ? (
                  <>
                    <th>Manufacturer</th>
                    <th>Product Type</th>
                  </>
                ) : (
                  <>
                    <th>Product Type</th>
                    <th>Manufacturer</th>
                  </>
                )}
                <th className="num">Latest Avg Price</th>
                <th className="num">WoW Avg Δ</th>
                <th className="num">MoM Avg Δ</th>
                <th className="num">QoQ Avg Δ</th>
                <th className="num">WoW LFL Δ</th>
                <th className="num">MoM LFL Δ</th>
                <th className="num">QoQ LFL Δ</th>
                <th className="num">SKUs Tracked</th>
                <th className="num">Matched SKUs</th>
                <th>Vendors Covered</th>
                <th>Data Quality</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={`${r.manufacturer}-${r.productType}`}>
                  {view === 'mfr' ? (
                    <>
                      <td><strong>{r.manufacturer}</strong></td>
                      <td>{r.productType}</td>
                    </>
                  ) : (
                    <>
                      <td><strong>{r.productType}</strong></td>
                      <td>{r.manufacturer}</td>
                    </>
                  )}
                  <td className="num mono">
                    {r.latestAvgCents != null ? (
                      fmtPrice(r.latestAvgCents)
                    ) : (
                      <span className="placeholder">{r.trackedSkus === 0 ? 'No SKUs tracked' : 'No data'}</span>
                    )}
                  </td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num"><Placeholder reason={r.trackedSkus === 0 ? 'no SKUs' : 'vendor pricing'} /></td>
                  <td className="num mono">{fmtInt(r.trackedSkus)}</td>
                  <td className="num mono">{fmtInt(r.matchedSkus)}</td>
                  <td>
                    {r.vendorsCovered === '—' ? (
                      <span className="placeholder">{r.trackedSkus === 0 ? 'Not tracked yet' : '—'}</span>
                    ) : (
                      r.vendorsCovered
                    )}
                  </td>
                  <td>
                    {r.dataQuality === 'proxy' && <span className="quality-pill proxy">Proxy only</span>}
                    {r.dataQuality === 'missing' && <span className="quality-pill missing">Missing</span>}
                    {r.dataQuality === 'pending' && <span className="quality-pill pending">Not tracked yet</span>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cell-button"
                      onClick={() => onEvidence(r)}
                      aria-label={`View evidence for ${r.manufacturer} ${r.productType}`}
                    >
                      Evidence
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Placeholder({ reason }: { reason: string }) {
  const label = reason === 'no SKUs' ? '—' : 'Vendor data';
  const title = reason === 'no SKUs'
    ? 'No SKUs tracked in this combo'
    : 'Requires direct vendor pricing sources (Newegg/CDW/Provantage/Arrow) — not live yet';
  return <span className="placeholder" title={title}>{label}</span>;
}
