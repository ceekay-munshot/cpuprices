import { useEffect } from 'react';
import { deltaTone, fmtAbsCents, fmtInt, fmtPercent, fmtPrice } from '../format';

/**
 * "Show me the math" drawer for the period-over-period Overview grid.
 *
 * Each Overview cell represents a (period, segment, manufacturer) average,
 * compared to the same (segment, manufacturer) average in the immediately
 * prior period. The drawer spells out:
 *   - which two periods feed the cell
 *   - the SKU counts in each
 *   - the formula and substituted values
 *   - the resulting % movement
 *
 * When the prior period is missing (sparse history), the drawer surfaces the
 * absolute current avg and explains why the % cell renders "—".
 */

export interface OverviewSelection {
  period: PeriodSummary;
  priorPeriod: PeriodSummary | null;
  segment: string;
  manufacturer: string;
  granularity: string;     // 'WoW' | 'MoM' | 'QoQ'
  priorNote: string;       // human-readable "vs prior ISO week" etc
  pct: number | null;
  isLive: boolean;
}

export interface PeriodSummary {
  id: string;
  label: string;
  skuCount: number;
  avgPriceCents: number | null;
}

interface Props {
  selection: OverviewSelection | null;
  onClose: () => void;
}

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

  const { period, priorPeriod, segment, manufacturer, granularity, priorNote, pct, isLive } = selection;
  const absCents =
    period.avgPriceCents != null && priorPeriod?.avgPriceCents != null
      ? period.avgPriceCents - priorPeriod.avgPriceCents
      : null;

  const titleSuffix = priorPeriod
    ? `${period.label} vs ${priorPeriod.label}`
    : `${period.label}${isLive ? ' (live)' : ''}`;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation" />
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Math breakdown: ${segment} ${manufacturer} ${titleSuffix}`}
      >
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{segment} · {manufacturer} — {titleSuffix}</h3>
            <div className="drawer__sub">
              {granularity} % movement · {priorNote}
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close drawer">
            Close
          </button>
        </header>

        <div className="drawer__body">
          {/* 1. Period endpoints */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Period endpoints</h4>
            <dl className="drawer__kv">
              <dt>This period</dt>
              <dd>
                {period.label} · avg {fmtPrice(period.avgPriceCents)} across {fmtInt(period.skuCount)} SKUs
                {isLive && <span className="muted"> · live</span>}
              </dd>
              <dt>Prior period</dt>
              <dd>
                {priorPeriod
                  ? `${priorPeriod.label} · avg ${fmtPrice(priorPeriod.avgPriceCents)} across ${fmtInt(priorPeriod.skuCount)} SKUs`
                  : <span className="muted">— no prior period on record yet</span>}
              </dd>
            </dl>
            <p className="drawer__note">
              Each period uses the last scrape that completed inside it. Buckets are recomputed
              independently per period — when the SKU mix shifts (new chips listed, others delisted),
              the cohort can change between the two endpoints.
            </p>
          </section>

          {/* 2. Computation */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Computation</h4>

            <div className="delta-explain">
              <div className="delta-explain__label">Absolute Δ</div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">formula</span>
                <code>this.avg − prior.avg</code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">inputs</span>
                <code>{fmtPrice(period.avgPriceCents)} − {fmtPrice(priorPeriod?.avgPriceCents ?? null)}</code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">result</span>
                <code className={`delta-explain__result delta ${deltaTone(absCents)}`}>
                  {fmtAbsCents(absCents)}
                </code>
              </div>
            </div>

            <div className="delta-explain">
              <div className="delta-explain__label">% movement (what the cell shows)</div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">formula</span>
                <code>(this.avg − prior.avg) ÷ prior.avg × 100</code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">inputs</span>
                <code>
                  ({fmtPrice(period.avgPriceCents)} − {fmtPrice(priorPeriod?.avgPriceCents ?? null)})
                  {' '}÷ {fmtPrice(priorPeriod?.avgPriceCents ?? null)} × 100
                </code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">result</span>
                <code className={`delta-explain__result delta ${deltaTone(pct)}`}>
                  {fmtPercent(pct)}
                </code>
              </div>
            </div>
          </section>

          {/* 3. Why "—" if applicable */}
          {pct == null && (
            <section className="drawer__section">
              <h4 className="drawer__section-title">Why this cell shows &mdash;</h4>
              <p className="drawer__note">
                {priorPeriod == null
                  ? `No observation falls into the prior ${granularity.toLowerCase()} period yet. History accumulates daily — the cell will populate once the daily cron writes a scrape into that window.`
                  : period.avgPriceCents == null
                    ? `No SKU in this (${segment}, ${manufacturer}) bucket had a current price in ${period.label}.`
                    : priorPeriod.avgPriceCents == null
                      ? `No SKU in this (${segment}, ${manufacturer}) bucket had a price in ${priorPeriod.label}.`
                      : 'Prior period average is $0.00, which would divide by zero — guarded.'}
              </p>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
