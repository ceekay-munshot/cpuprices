import { useApi } from '../useApi';
import { api } from '../api';
import { fmtCoverage, fmtDateTime, fmtInt, fmtPrice } from '../format';

/**
 * Supporting module, NOT the landing-page centerpiece. Caveat banner is
 * non-dismissible — PassMark is a benchmark-submission + observed-price
 * proxy, not vendor shipments or direct retail.
 */
export default function PassmarkModule() {
  const { data, loading, error } = useApi(api.vendorSummary);

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">PassMark Insight · Market-Share Proxy</h2>
          <div className="section__hint">
            Supporting module. Vendor breakdown from the latest scrape of <code>/cpu-list/all</code>.
          </div>
        </div>
        {data?.latest_scrape_run_id != null && (
          <span className="badge badge--info">
            Run #{data.latest_scrape_run_id} · {fmtDateTime(data.latest_scraped_at)}
          </span>
        )}
      </div>

      <div className="caveat">
        <strong>Caveat.</strong> This uses PassMark benchmark submissions / observed street-price fields.
        It reflects CPUs tested or in use by submitting users — <strong>not</strong> actual vendor
        shipments, and <strong>not</strong> direct vendor retail pricing like Newegg, CDW, Provantage, or
        Arrow.
      </div>

      {loading && <div className="state-line">Loading vendor summary…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <div className="t-wrap">
          <table className="t t--dense">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="num">Rows Observed</th>
                <th className="num">Rows With Price</th>
                <th className="num">Price Coverage</th>
                <th className="num">Avg Observed Price</th>
                <th className="num">Median Observed Price</th>
                <th className="num">Avg CPU Mark</th>
                <th>Latest Scrape</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.vendor_inferred}>
                  <td><strong>{v.vendor_inferred}</strong></td>
                  <td className="num mono">{fmtInt(v.rows_observed)}</td>
                  <td className="num mono">{fmtInt(v.rows_with_price)}</td>
                  <td className="num mono">{fmtCoverage(v.rows_with_price, v.rows_observed)}</td>
                  <td className="num mono">{fmtPrice(v.avg_price_cents)}</td>
                  <td className="num mono">{fmtPrice(v.median_price_cents)}</td>
                  <td className="num mono">{fmtInt(v.avg_benchmark_score)}</td>
                  <td className="muted">{fmtDateTime(v.latest_scraped_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
