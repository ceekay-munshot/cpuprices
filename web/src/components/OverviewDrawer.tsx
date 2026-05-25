import { useEffect, useMemo } from 'react';
import type { ObservationRow } from '../api';
import { deltaTone, fmtAbsCents, fmtInt, fmtPercent, fmtPrice } from '../format';

/**
 * "Show me the math" drawer for the Overview tab.
 *
 * Opens when the user clicks any numeric cell. For each metric, it spells out:
 *   1. The formula
 *   2. The inputs (counts, sum) the formula was applied to
 *   3. The result, matching the value rendered in the cell
 *   4. Every SKU that contributed to the average, so the user can audit it
 *
 * Same-set design (delta metrics): a SKU only contributes when it has both
 * a current and a historical price. Cohort is held constant.
 */

export type OverviewMetric = 'latest' | 'wow' | 'mom' | 'qoq' | 'skus';

export interface OverviewSelection {
  segment: string;
  manufacturer: string;
  metric: OverviewMetric;
  rows: ObservationRow[];
}

interface Props {
  selection: OverviewSelection | null;
  onClose: () => void;
}

const METRIC_LABEL: Record<OverviewMetric, string> = {
  latest: 'Latest Avg Price',
  wow:    'WoW Avg Δ',
  mom:    'MoM Avg Δ',
  qoq:    'QoQ Avg Δ',
  skus:   'SKUs Tracked',
};

const HISTORICAL_KEY: Record<'wow' | 'mom' | 'qoq', 'wow_price_cents' | 'mom_price_cents' | 'qoq_price_cents'> = {
  wow: 'wow_price_cents',
  mom: 'mom_price_cents',
  qoq: 'qoq_price_cents',
};

const PRIOR_LABEL: Record<'wow' | 'mom' | 'qoq', string> = {
  wow: '7-day prior',
  mom: '30-day prior',
  qoq: '90-day prior',
};

export default function OverviewDrawer({ selection, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (selection) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    return undefined;
  }, [selection, onClose]);

  if (!selection) return null;

  const { segment, manufacturer, metric, rows } = selection;
  const label = METRIC_LABEL[metric];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation" />
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Math breakdown: ${segment} ${manufacturer} ${label}`}
      >
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{segment} · {manufacturer} — {label}</h3>
            <div className="drawer__sub">
              {metric === 'skus'
                ? 'Count of SKUs in this bucket with a current price.'
                : metric === 'latest'
                  ? 'Equal-weighted mean of current prices across the bucket.'
                  : 'Equal-weighted mean of per-SKU changes (same-set cohort).'}
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close drawer">
            Close
          </button>
        </header>

        <div className="drawer__body">
          {metric === 'latest' && <LatestBody rows={rows} />}
          {metric === 'skus' && <SkusBody rows={rows} />}
          {(metric === 'wow' || metric === 'mom' || metric === 'qoq') && (
            <DeltaBody rows={rows} metric={metric} />
          )}
        </div>
      </aside>
    </>
  );
}

function LatestBody({ rows }: { rows: ObservationRow[] }) {
  const priced = useMemo(
    () =>
      rows
        .filter((r) => r.price_cents != null)
        .sort((a, b) => (b.price_cents ?? 0) - (a.price_cents ?? 0)),
    [rows],
  );
  const sum = priced.reduce((acc, r) => acc + (r.price_cents ?? 0), 0);
  const avg = priced.length === 0 ? null : sum / priced.length;

  return (
    <>
      <section className="drawer__section">
        <h4 className="drawer__section-title">Computation</h4>
        <div className="delta-explain">
          <div className="delta-explain__label">Latest Avg Price</div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">formula</span>
            <code>Σ price_cents ÷ N  (over SKUs with a current price)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">bucket</span>
            <code>{fmtInt(rows.length)} SKUs match (segment, manufacturer)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">N</span>
            <code>{fmtInt(priced.length)} have a current price</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">Σ</span>
            <code>{fmtPrice(sum)}</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">result</span>
            <code className="delta-explain__result">{fmtPrice(avg)}</code>
          </div>
        </div>
      </section>

      <ContributingPriceTable
        title={`Contributing SKUs (${fmtInt(priced.length)}, sorted by price)`}
        rows={priced}
      />
    </>
  );
}

function SkusBody({ rows }: { rows: ObservationRow[] }) {
  const priced = useMemo(
    () =>
      rows
        .filter((r) => r.price_cents != null)
        .sort((a, b) => (b.price_cents ?? 0) - (a.price_cents ?? 0)),
    [rows],
  );
  const unpriced = rows.length - priced.length;

  return (
    <>
      <section className="drawer__section">
        <h4 className="drawer__section-title">Computation</h4>
        <div className="delta-explain">
          <div className="delta-explain__label">SKUs Tracked</div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">formula</span>
            <code>count(SKUs in bucket with price_cents ≠ null)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">bucket</span>
            <code>{fmtInt(rows.length)} SKUs match (segment, manufacturer)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">excluded</span>
            <code>{fmtInt(unpriced)} SKUs have no current price</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">result</span>
            <code className="delta-explain__result">{fmtInt(priced.length)}</code>
          </div>
        </div>
      </section>

      <ContributingPriceTable
        title={`SKUs Tracked (${fmtInt(priced.length)}, sorted by price)`}
        rows={priced}
      />
    </>
  );
}

function DeltaBody({ rows, metric }: { rows: ObservationRow[]; metric: 'wow' | 'mom' | 'qoq' }) {
  const key = HISTORICAL_KEY[metric];
  const priorLabel = PRIOR_LABEL[metric];

  const eligible = useMemo(() => {
    const out: { row: ObservationRow; cur: number; prior: number; abs: number; pct: number | null }[] = [];
    for (const r of rows) {
      const cur = r.price_cents;
      const prior = r[key];
      if (cur == null || prior == null) continue;
      const abs = cur - prior;
      const pct = prior === 0 ? null : (abs / prior) * 100;
      out.push({ row: r, cur, prior, abs, pct });
    }
    out.sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs));
    return out;
  }, [rows, key]);

  const sumAbs = eligible.reduce((acc, x) => acc + x.abs, 0);
  const avgAbs = eligible.length === 0 ? null : sumAbs / eligible.length;

  const pctEligible = eligible.filter((x) => x.pct != null);
  const sumPct = pctEligible.reduce((acc, x) => acc + (x.pct as number), 0);
  const avgPct = pctEligible.length === 0 ? null : sumPct / pctEligible.length;

  const excludedZeroPrior = eligible.length - pctEligible.length;

  return (
    <>
      <section className="drawer__section">
        <h4 className="drawer__section-title">Computation</h4>

        <div className="delta-explain">
          <div className="delta-explain__label">Absolute Δ (top line in cell)</div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">formula</span>
            <code>mean(price_cents − {key})  (over SKUs with both)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">bucket</span>
            <code>{fmtInt(rows.length)} SKUs match (segment, manufacturer)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">N</span>
            <code>{fmtInt(eligible.length)} have both a current and {priorLabel} price</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">Σ Δ</span>
            <code>{fmtAbsCents(sumAbs)}</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">result</span>
            <code className={`delta-explain__result delta ${deltaTone(avgAbs)}`}>{fmtAbsCents(avgAbs)}</code>
          </div>
        </div>

        <div className="delta-explain">
          <div className="delta-explain__label">Percent Δ (bottom line in cell)</div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">formula</span>
            <code>mean((price − {key}) ÷ {key} × 100)  (over same set, prior ≠ 0)</code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">N</span>
            <code>
              {fmtInt(pctEligible.length)} eligible
              {excludedZeroPrior > 0
                ? ` · ${fmtInt(excludedZeroPrior)} excluded (${priorLabel} = $0.00)`
                : ''}
            </code>
          </div>
          <div className="delta-explain__line">
            <span className="delta-explain__tag">result</span>
            <code className={`delta-explain__result delta ${deltaTone(avgPct)}`}>{fmtPercent(avgPct)}</code>
          </div>
        </div>

        <p className="drawer__note">
          Same-set rule: a SKU only contributes if it has both a current and {priorLabel.toLowerCase()} observation.
          Keeps the cohort constant so a newly listed SKU doesn&rsquo;t shift the average.
        </p>
      </section>

      <section className="drawer__section">
        <h4 className="drawer__section-title">
          Contributing SKUs ({fmtInt(eligible.length)}, sorted by |Δ|)
        </h4>
        {eligible.length === 0 ? (
          <p className="drawer__note">
            No SKUs in this bucket have a {priorLabel.toLowerCase()} observation yet. History accumulates daily —
            values populate automatically as calendar coverage grows.
          </p>
        ) : (
          <div className="t-wrap">
            <table className="t t--dense">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="num">Current</th>
                  <th className="num">{priorLabel}</th>
                  <th className="num">Abs Δ</th>
                  <th className="num">Pct Δ</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((x, i) => (
                  <tr key={`${x.row.normalized_source_name}-${i}`}>
                    <td>{x.row.source_sku_name}</td>
                    <td className="num mono">{fmtPrice(x.cur)}</td>
                    <td className="num mono">{fmtPrice(x.prior)}</td>
                    <td className={`num mono delta ${deltaTone(x.abs)}`}>{fmtAbsCents(x.abs)}</td>
                    <td className={`num mono delta ${deltaTone(x.pct)}`}>{fmtPercent(x.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ContributingPriceTable({ title, rows }: { title: string; rows: ObservationRow[] }) {
  return (
    <section className="drawer__section">
      <h4 className="drawer__section-title">{title}</h4>
      {rows.length === 0 ? (
        <p className="drawer__note">No SKUs in this bucket have a current price.</p>
      ) : (
        <div className="t-wrap">
          <table className="t t--dense">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.normalized_source_name}-${i}`}>
                  <td>{r.source_sku_name}</td>
                  <td className="num mono">{fmtPrice(r.price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
