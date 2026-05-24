export default function Methodology() {
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">Methodology</h2>
          <div className="section__hint">What's live, what's not, and how the numbers are computed.</div>
        </div>
      </div>
      <div className="section__body prose">
        <h3>What is live now</h3>
        <ul>
          <li>Daily PassMark <code>/cpu-list/all</code> capture into <code>source_observations</code> (full universe).</li>
          <li>Tracked SKU basket matching into <code>price_history</code> (curated 14 Intel + AMD desktop SKUs).</li>
          <li>Read API with status, vendor summary, current prices, SKU history, and price-changes endpoints.</li>
        </ul>

        <h3>What PassMark / CPUbenchmark is useful for</h3>
        <ul>
          <li>Full CPU universe coverage — Intel, AMD, Apple, Qualcomm, ARM, and the long tail.</li>
          <li>Benchmark scores (CPU Mark) for performance tiers.</li>
          <li>A directional <em>observed</em> street-price signal where users submit price data.</li>
        </ul>

        <h3>What PassMark is NOT</h3>
        <ul>
          <li>NOT direct vendor retail pricing — Newegg, CDW, Provantage, and Arrow remain the canonical
            sources for those numbers and are not yet captured.</li>
          <li>NOT vendor shipment volume — the corpus reflects what submitters tested, not what shipped.</li>
          <li>NOT AWS rental pricing — that requires a separate spot/on-demand capture source.</li>
        </ul>

        <h3>Two-table architecture</h3>
        <ul>
          <li><code>source_observations</code> — append-only full corpus from every daily scrape. Used by the
            PassMark Insight module and any market-share / proxy analysis.</li>
          <li><code>price_history</code> — append-only curated-basket table. Each row links to a canonical
            <code>sku_id</code> from <code>config/tracked-skus.json</code>. Used by the main tracker table,
            price changes, and SKU history.</li>
        </ul>

        <h3>What comes next</h3>
        <ul>
          <li>Newegg, CDW, Provantage, Arrow direct vendor pricing + inventory capture.</li>
          <li>Server / Desktop / Laptop classification (<code>segment_inferred</code> is reserved but null).</li>
          <li>WoW / MoM / QoQ baselines once enough calendar coverage exists.</li>
          <li>AWS spot / on-demand CPU rental proxy.</li>
          <li>Nvidia Vera tracking module.</li>
        </ul>

        <h3>Calculation definitions</h3>
        <div className="defn">
          <strong>Aggregate Avg Price Δ.</strong> Average price of all observed SKUs in the current
          period vs. the prior period. Includes mix effects — a tilt toward higher-tier SKUs raises
          the average even when no individual SKU moved.
        </div>
        <div className="defn">
          <strong>Like-for-like SKU Price Δ.</strong> Only SKUs present in <em>both</em> the current
          and comparison periods. Compute per-SKU percentage change, then average those changes.
          Excludes mix distortion — the cleanest "did prices actually move?" signal.
        </div>
        <div className="defn">
          <strong>Latest Avg Price (current display).</strong> Mean of <code>price_cents</code> across
          the matched SKUs for that combination in the latest scrape, divided by 100. Rows with NULL
          price are excluded from the mean.
        </div>
      </div>
    </section>
  );
}
