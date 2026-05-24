import { useEffect } from 'react';
import type { ComputedRow } from './MainTable';
import { fmtDateTime, fmtPrice } from '../format';

interface Props {
  row: ComputedRow | null;
  onClose: () => void;
}

export default function EvidenceDrawer({ row, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (row) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    return undefined;
  }, [row, onClose]);

  if (!row) return null;

  const sourceUrls = Array.from(new Set(row.contributors.map((c) => c.url).filter(Boolean))) as string[];
  const lastCapture = row.contributors[0]?.scraped_at ?? null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation" />
      <aside className="drawer" role="dialog" aria-label="Evidence detail">
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">
              Evidence · {row.manufacturer} / {row.productType}
            </h3>
            <div className="drawer__sub">
              {row.matchedSkus} SKU{row.matchedSkus === 1 ? '' : 's'} contributed ·{' '}
              {row.dataQuality === 'proxy'
                ? 'PassMark proxy data only'
                : row.dataQuality === 'missing'
                  ? 'Tracked SKUs not yet matched'
                  : 'No SKUs tracked in this combo'}
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close evidence drawer">
            Close
          </button>
        </header>

        <div className="drawer__body">
          <section className="drawer__section">
            <h4 className="drawer__section-title">Sources contributing</h4>
            {row.matchedSkus === 0 ? (
              <div className="state-line">
                No source has live rows for this combination yet.
                {row.trackedSkus === 0 && ' Add SKUs to config/tracked-skus.json to begin tracking.'}
              </div>
            ) : (
              <ul className="prose">
                <li>
                  <strong>PassMark / CPUbenchmark</strong> — benchmark-submission + observed street-price proxy
                </li>
                {sourceUrls.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noopener noreferrer">{u}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer__section">
            <h4 className="drawer__section-title">Tracked vs matched SKUs</h4>
            <dl className="drawer__kv">
              <dt>Tracked</dt>
              <dd>{row.trackedSkus}</dd>
              <dt>Matched</dt>
              <dd>{row.matchedSkus}</dd>
              <dt>Missing</dt>
              <dd>{Math.max(0, row.trackedSkus - row.matchedSkus)}</dd>
              <dt>Last capture</dt>
              <dd>{fmtDateTime(lastCapture)}</dd>
            </dl>
          </section>

          {row.contributors.length > 0 && (
            <section className="drawer__section">
              <h4 className="drawer__section-title">SKU contributors</h4>
              <div className="t-wrap">
                <table className="t t--dense">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th className="num">Price</th>
                      <th className="num">Raw</th>
                      <th className="num">CPU Mark</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.contributors.map((c) => (
                      <tr key={`${c.sku_id}-${c.source_slug}`}>
                        <td>{c.sku_name}</td>
                        <td className="num mono">{fmtPrice(c.price_cents)}</td>
                        <td className="num mono">{c.raw_price_text ?? '—'}</td>
                        <td className="num mono">{c.benchmark_score ?? '—'}</td>
                        <td>
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noopener noreferrer">{c.source_slug}</a>
                          ) : (
                            c.source_slug
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="drawer__section">
            <h4 className="drawer__section-title">Calculation</h4>
            <div className="prose">
              <p>
                <strong>Latest Avg Price</strong> = mean(<code>price_cents</code>) across the {row.matchedSkus}{' '}
                matched SKU{row.matchedSkus === 1 ? '' : 's'} in this combination, divided by 100. Rows with
                <code> NULL </code> price are excluded from the mean.
              </p>
              <p>
                <strong>WoW / MoM / QoQ Δ</strong> require historical baselines we have not yet collected.
                They will populate as the daily scrape accumulates calendar coverage.
              </p>
              <p>
                <strong>LFL (like-for-like) Δ</strong> compares only SKUs present in both periods — excludes
                mix effects. Requires the same historical baselines as Δ columns.
              </p>
            </div>
          </section>

          <section className="drawer__section">
            <div className="drawer__caveat">
              <strong>Source caveat.</strong> PassMark / CPUbenchmark surfaces an observed street price.
              It is NOT direct vendor retail pricing from Newegg, CDW, Provantage, or Arrow. When those
              direct sources land, this drawer will list them and per-source prices.
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
