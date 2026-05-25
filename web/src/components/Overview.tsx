import { useMemo } from 'react';
import { api, type ObservationRow } from '../api';
import { useApi } from '../useApi';
import { deltaTone, fmtAbsCents, fmtInt, fmtPercent, fmtPrice } from '../format';

/**
 * Overview tab — answers "how are average server / laptop / desktop CPU prices
 * trending across Intel vs AMD?" in a fixed 6-row table.
 *
 * All deltas are equal-weighted means of per-SKU changes (same-set: a SKU
 * only contributes to a delta if it has both a current and historical price).
 * This holds the comparison cohort constant — a new chip being added doesn't
 * shift the average artificially.
 */

const SEGMENTS = ['Server', 'Laptop', 'Desktop'] as const;
const MANUFACTURERS = ['Intel', 'AMD'] as const;

type Segment = (typeof SEGMENTS)[number];
type Manufacturer = (typeof MANUFACTURERS)[number];

interface DeltaAgg {
  absCents: number | null;
  pct: number | null;
}

interface BucketRow {
  segment: Segment;
  manufacturer: Manufacturer;
  latestAvgCents: number | null;
  skusTracked: number;
  wow: DeltaAgg;
  mom: DeltaAgg;
  qoq: DeltaAgg;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function avgDelta(
  rows: ObservationRow[],
  historicalKey: 'wow_price_cents' | 'mom_price_cents' | 'qoq_price_cents',
): DeltaAgg {
  const absDeltas: number[] = [];
  const pctDeltas: number[] = [];
  for (const r of rows) {
    const prior = r[historicalKey];
    if (r.price_cents == null || prior == null) continue;
    const abs = r.price_cents - prior;
    absDeltas.push(abs);
    if (prior !== 0) pctDeltas.push((abs / prior) * 100);
  }
  return { absCents: mean(absDeltas), pct: mean(pctDeltas) };
}

function aggregate(rows: ObservationRow[]): BucketRow[] {
  return SEGMENTS.flatMap((segment) =>
    MANUFACTURERS.map((manufacturer) => {
      const bucket = rows.filter(
        (r) => r.segment_inferred === segment && r.vendor_inferred === manufacturer,
      );
      const withPrice = bucket.filter((r) => r.price_cents != null);
      return {
        segment,
        manufacturer,
        latestAvgCents: mean(withPrice.map((r) => r.price_cents as number)),
        skusTracked: withPrice.length,
        wow: avgDelta(bucket, 'wow_price_cents'),
        mom: avgDelta(bucket, 'mom_price_cents'),
        qoq: avgDelta(bucket, 'qoq_price_cents'),
      };
    }),
  );
}

export default function Overview() {
  const { data, loading, error } = useApi(api.observations);

  const buckets = useMemo(() => (data ? aggregate(data.rows) : []), [data]);

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Average price trends by segment &amp; manufacturer</h2>
        {data && data.latest_scrape_run_id != null && (
          <span className="badge badge--info">Run #{data.latest_scrape_run_id}</span>
        )}
      </div>

      {loading && <div className="state-line">Loading observations…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Segment</th>
                <th>Manufacturer</th>
                <th className="num">Latest Avg Price</th>
                <th className="num">WoW Avg Δ</th>
                <th className="num">MoM Avg Δ</th>
                <th className="num">QoQ Avg Δ</th>
                <th className="num">SKUs Tracked</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={`${b.segment}-${b.manufacturer}`}>
                  <td>
                    <span className={`segment-pill segment-pill--${b.segment.toLowerCase()}`}>
                      {b.segment}
                    </span>
                  </td>
                  <td><strong>{b.manufacturer}</strong></td>
                  <td className="num mono">{fmtPrice(b.latestAvgCents)}</td>
                  <DeltaCell delta={b.wow} />
                  <DeltaCell delta={b.mom} />
                  <DeltaCell delta={b.qoq} />
                  <td className="num mono">{fmtInt(b.skusTracked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeltaCell({ delta }: { delta: DeltaAgg }) {
  const tone = deltaTone(delta.absCents);
  return (
    <td className={`num mono delta ${tone}`}>
      <div>{fmtAbsCents(delta.absCents)}</div>
      <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.85 }}>{fmtPercent(delta.pct)}</div>
    </td>
  );
}
