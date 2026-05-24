import { useEffect, useMemo, useState } from 'react';
import type { CurrentPriceRow } from '../api';
import { api } from '../api';
import type { SkuHistoryData } from '../api';
import { fmtDateTime, fmtInt, fmtPrice } from '../format';

interface Props {
  basket: CurrentPriceRow[] | null;
}

/** Per-SKU history table. Chart deferred — table is the deliverable. */
export default function SkuHistory({ basket }: Props) {
  const [skuId, setSkuId] = useState<number | null>(null);
  const [data, setData] = useState<SkuHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to first SKU when the basket arrives.
  useEffect(() => {
    if (skuId == null && basket && basket.length > 0) {
      setSkuId(basket[0]!.sku_id);
    }
  }, [basket, skuId]);

  useEffect(() => {
    if (skuId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .skuHistory(skuId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skuId]);

  const skuOptions = useMemo(() => {
    if (!basket) return [];
    return [...basket].sort((a, b) => a.sku_name.localeCompare(b.sku_name));
  }, [basket]);

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">SKU History</h2>
          <div className="section__hint">
            Pick a tracked SKU to see its price-history rows. Chart deferred until enough daily captures land.
          </div>
        </div>
        <select
          className="filter-input"
          value={skuId ?? ''}
          onChange={(e) => setSkuId(Number(e.target.value))}
          aria-label="Pick SKU"
        >
          {skuOptions.length === 0 && <option value="">No SKUs loaded</option>}
          {skuOptions.map((s) => (
            <option key={s.sku_id} value={s.sku_id}>{s.sku_name}</option>
          ))}
        </select>
      </div>

      {loading && <div className="state-line">Loading history…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <>
          <div className="t-wrap">
            <table className="t t--dense">
              <thead>
                <tr>
                  <th>Scraped At</th>
                  <th className="num">Price</th>
                  <th className="num">Raw</th>
                  <th className="num">CPU Mark</th>
                  <th className="num">Scrape Run</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.sku_id}-${r.scrape_run_id}-${r.scraped_at}`}>
                    <td className="muted">{fmtDateTime(r.scraped_at)}</td>
                    <td className="num mono">{fmtPrice(r.price_cents)}</td>
                    <td className="num mono">{r.raw_price_text ?? '—'}</td>
                    <td className="num mono">{fmtInt(r.benchmark_score)}</td>
                    <td className="num mono">#{r.scrape_run_id}</td>
                    <td>{r.source_slug}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={6}><div className="state-line">No history rows for this SKU yet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data.rows.length < 2 && (
            <div className="history-note">
              Trend will appear after more daily captures. Currently {data.rows.length} row
              {data.rows.length === 1 ? '' : 's'} recorded for <strong>{data.sku_name ?? 'this SKU'}</strong>.
            </div>
          )}
        </>
      )}
    </section>
  );
}
