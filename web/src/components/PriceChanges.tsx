import { useApi } from '../useApi';
import { api, type PriceChangeRow } from '../api';
import { deltaTone, fmtAbsCents, fmtDateTime, fmtPercent, fmtPrice } from '../format';

/**
 * Latest-vs-previous per tracked SKU. Status logic handles one-point
 * history gracefully (no spurious "broken" rendering when only one
 * scrape exists in the DB).
 */
export default function PriceChanges() {
  const { data, loading, error } = useApi(api.priceChanges);

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">Price Changes</h2>
          <div className="section__hint">
            Latest vs. previous scrape per tracked SKU. Need at least two daily captures for non-null deltas.
          </div>
        </div>
      </div>

      {loading && <div className="state-line">Loading price changes…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <div className="t-wrap">
          <table className="t t--dense">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>SKU</th>
                <th className="num">Latest Price</th>
                <th className="num">Previous Price</th>
                <th className="num">Abs Δ</th>
                <th className="num">% Δ</th>
                <th>Latest Capture</th>
                <th>Previous Capture</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.sku_id}>
                  <td><strong>{r.vendor}</strong></td>
                  <td>{r.sku_name}</td>
                  <td className="num mono">{fmtPrice(r.latest_price_cents)}</td>
                  <td className="num mono">{fmtPrice(r.previous_price_cents)}</td>
                  <td className={`num mono delta ${deltaTone(r.absolute_change_cents)}`}>
                    {fmtAbsCents(r.absolute_change_cents)}
                  </td>
                  <td className={`num mono delta ${deltaTone(r.percentage_change)}`}>
                    {fmtPercent(r.percentage_change)}
                  </td>
                  <td className="muted">{fmtDateTime(r.latest_scraped_at)}</td>
                  <td className="muted">{fmtDateTime(r.previous_scraped_at)}</td>
                  <td>{statusLabel(r)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={9}><div className="state-line">No tracked SKU price changes yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function statusLabel(r: PriceChangeRow) {
  if (r.previous_price_cents == null && r.previous_scraped_at == null) {
    return <span className="quality-pill pending">Need 2nd scrape</span>;
  }
  if (r.latest_price_cents == null || r.previous_price_cents == null) {
    return <span className="quality-pill missing">No price</span>;
  }
  if (r.latest_price_cents > r.previous_price_cents) {
    return <span className="delta up" style={{ fontWeight: 600 }}>Price Up</span>;
  }
  if (r.latest_price_cents < r.previous_price_cents) {
    return <span className="delta down" style={{ fontWeight: 600 }}>Price Down</span>;
  }
  return <span className="delta flat">Unchanged</span>;
}
