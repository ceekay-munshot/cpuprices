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
  /** Matched-cohort numbers — what the % cell is actually computed from. */
  cohortCount: number;
  curCohortAvgCents:   number | null;
  priorCohortAvgCents: number | null;
}

export interface PeriodSummary {
  id: string;
  label: string;
  /** Total SKUs in the scrape's full bucket — NOT the cohort the % uses. */
  skuCount: number;
  /** Standalone avg across all SKUs in the bucket — NOT the % basis. */
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

  const {
    period, priorPeriod, segment, manufacturer, granularity, priorNote, pct, isLive,
    cohortCount, curCohortAvgCents, priorCohortAvgCents,
  } = selection;
  const absCents =
    curCohortAvgCents != null && priorCohortAvgCents != null
      ? curCohortAvgCents - priorCohortAvgCents
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
          {/* 1. Snapshot context — full bucket counts/avgs per period, NOT the % basis. */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Snapshot context</h4>
            <dl className="drawer__kv">
              <dt>This period</dt>
              <dd>
                {period.label} · {fmtInt(period.skuCount)} SKUs priced · standalone avg {fmtPrice(period.avgPriceCents)}
                {isLive && <span className="muted"> · live</span>}
              </dd>
              <dt>Prior period</dt>
              <dd>
                {priorPeriod
                  ? `${priorPeriod.label} · ${fmtInt(priorPeriod.skuCount)} SKUs priced · standalone avg ${fmtPrice(priorPeriod.avgPriceCents)}`
                  : <span className="muted">— no prior period on record yet</span>}
              </dd>
            </dl>
            <p className="drawer__note">
              Each period uses the last scrape that completed inside it. The SKU mix shifts between
              scrapes (new chips listed, others delisted), so the two standalone averages above are
              apples-to-oranges — they're shown for context only. The % cell uses a matched cohort
              instead (next section).
            </p>
          </section>

          {/* 2. Matched cohort — the like-for-like basket the % is actually computed from. */}
          {priorPeriod && (
            <section className="drawer__section">
              <h4 className="drawer__section-title">Matched cohort · like-for-like basket</h4>
              <dl className="drawer__kv">
                <dt>Cohort</dt>
                <dd>
                  {fmtInt(cohortCount)} {segment.toLowerCase()} {manufacturer} SKUs priced in
                  {' '}<strong>both</strong> {period.label} and {priorPeriod.label}
                </dd>
                <dt>Avg in {period.label}</dt>
                <dd>{fmtPrice(curCohortAvgCents)} <span className="muted">(cohort-only)</span></dd>
                <dt>Avg in {priorPeriod.label}</dt>
                <dd>{fmtPrice(priorCohortAvgCents)} <span className="muted">(cohort-only)</span></dd>
              </dl>
              <p className="drawer__note">
                Joined by normalized SKU name across the two scrapes. Restricting both averages to
                the same basket strips out mix change — the only thing that moves the % is actual
                price movement on the SKUs that appear in both endpoints.
              </p>
            </section>
          )}

          {/* 3. Computation — now on cohort numbers. */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Computation</h4>

            <div className="delta-explain">
              <div className="delta-explain__label">Absolute Δ (cohort)</div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">formula</span>
                <code>cohort.this − cohort.prior</code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">inputs</span>
                <code>{fmtPrice(curCohortAvgCents)} − {fmtPrice(priorCohortAvgCents)}</code>
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
                <code>(cohort.this − cohort.prior) ÷ cohort.prior × 100</code>
              </div>
              <div className="delta-explain__line">
                <span className="delta-explain__tag">inputs</span>
                <code>
                  ({fmtPrice(curCohortAvgCents)} − {fmtPrice(priorCohortAvgCents)})
                  {' '}÷ {fmtPrice(priorCohortAvgCents)} × 100
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

          {/* 4. Why "—" if applicable */}
          {pct == null && (
            <section className="drawer__section">
              <h4 className="drawer__section-title">Why this cell shows &mdash;</h4>
              <p className="drawer__note">
                {priorPeriod == null
                  ? `No observation falls into the prior ${granularity.toLowerCase()} period yet. History accumulates daily — the cell will populate once the daily cron writes a scrape into that window.`
                  : cohortCount === 0
                    ? `No (${segment}, ${manufacturer}) SKU appears in BOTH ${period.label} and ${priorPeriod.label} — the matched cohort is empty, so the % comparison would be undefined.`
                    : curCohortAvgCents == null
                      ? `Cohort has ${fmtInt(cohortCount)} SKUs but none had a current price in ${period.label}.`
                      : priorCohortAvgCents == null
                        ? `Cohort has ${fmtInt(cohortCount)} SKUs but none had a price in ${priorPeriod.label}.`
                        : 'Prior cohort average is $0.00, which would divide by zero — guarded.'}
              </p>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
