import { useCallback, useMemo, useState } from 'react';
import { api, type PeriodAgg } from '../api';
import { useApi } from '../useApi';
import { deltaTone, fmtPercent, fmtPrice } from '../format';
import OverviewDrawer, { type OverviewSelection } from './OverviewDrawer';

/**
 * Overview tab — period-over-period price-trend grid.
 *
 * Y-axis: time periods (newest at top, live period bolded).
 * X-axis: 6 cells per row = (Server / Laptop / Desktop) × (Intel / AMD),
 *         grouped under segment headers.
 * Cells:  % change in avg price vs the immediately prior period in the
 *         chosen granularity, color-coded (red = price up = bad for buyer,
 *         green = price down = good for buyer).
 *
 * Three granularity tabs (Week / Month / Quarter on Quarter) drive which
 * dataset feeds the rows. With sparse history (current state: ~5 days of
 * remote scrapes), most cells render "—" — they populate automatically
 * as the daily cron accumulates calendar coverage.
 *
 * Every cell stays clickable and opens an OverviewDrawer with the math.
 */

type Granularity = 'weekly' | 'monthly' | 'quarterly';

interface GranularitySpec {
  id: Granularity;
  label: string;
  live: string;
  abbrev: string;        // "WoW" — used in copy ("WoW % movement")
  liveAbbrev: string;    // "WTD" — used as the live-row prefix
  priorNote: string;
}

const GRANULARITIES: GranularitySpec[] = [
  { id: 'weekly',    label: 'Week on Week',       live: 'WTD live', abbrev: 'WoW', liveAbbrev: 'WTD',
    priorNote: 'vs prior ISO week' },
  { id: 'monthly',   label: 'Month on Month',     live: 'MTD live', abbrev: 'MoM', liveAbbrev: 'MTD',
    priorNote: 'vs prior calendar month' },
  { id: 'quarterly', label: 'Quarter on Quarter', live: 'QTD live', abbrev: 'QoQ', liveAbbrev: 'QTD',
    priorNote: 'vs prior calendar quarter' },
];

const SEGMENTS      = ['Server', 'Laptop', 'Desktop'] as const;
const MANUFACTURERS = ['Intel',  'AMD']               as const;

type Segment = (typeof SEGMENTS)[number];
type Manufacturer = (typeof MANUFACTURERS)[number];

interface CellMath {
  /** Standalone averages across each scrape's full bucket — context, not the % basis. */
  curStandaloneAvg:   number | null;
  priorStandaloneAvg: number | null;
  curStandaloneCount:   number;
  priorStandaloneCount: number;
  /** Matched-cohort averages — same set of SKUs in both scrapes. The % is computed from these. */
  curCohortAvg:   number | null;
  priorCohortAvg: number | null;
  cohortCount:    number;
  pct: number | null;
}

function findBucket(p: PeriodAgg | null, segment: Segment, manufacturer: Manufacturer) {
  if (!p) return null;
  return p.buckets.find(
    (b) => b.segment === segment && b.manufacturer === manufacturer,
  ) ?? null;
}

function findMatched(p: PeriodAgg | null, segment: Segment, manufacturer: Manufacturer) {
  if (!p || !p.matched_vs_prior) return null;
  return p.matched_vs_prior.find(
    (m) => m.segment === segment && m.manufacturer === manufacturer,
  ) ?? null;
}

function cellMath(
  current: PeriodAgg,
  prior:   PeriodAgg | null,
  segment: Segment,
  manufacturer: Manufacturer,
): CellMath {
  const curBucket   = findBucket(current, segment, manufacturer);
  const priorBucket = findBucket(prior,   segment, manufacturer);
  const matched     = findMatched(current, segment, manufacturer);

  const curCohortAvg   = matched?.current_avg_cents ?? null;
  const priorCohortAvg = matched?.prior_avg_cents   ?? null;
  const pct =
    curCohortAvg == null || priorCohortAvg == null || priorCohortAvg === 0
      ? null
      : ((curCohortAvg - priorCohortAvg) / priorCohortAvg) * 100;

  return {
    curStandaloneAvg:   curBucket?.avg_price_cents   ?? null,
    priorStandaloneAvg: priorBucket?.avg_price_cents ?? null,
    curStandaloneCount:   curBucket?.sku_count   ?? 0,
    priorStandaloneCount: priorBucket?.sku_count ?? 0,
    curCohortAvg,
    priorCohortAvg,
    cohortCount: matched?.cohort_sku_count ?? 0,
    pct,
  };
}

export default function Overview() {
  const { data, loading, error } = useApi(api.periodAggregates);
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [selection, setSelection]     = useState<OverviewSelection | null>(null);

  const activeSpec = GRANULARITIES.find((g) => g.id === granularity)!;
  const periods    = data ? data[granularity] : [];

  const selectCell = useCallback(
    (periodIdx: number, segment: Segment, manufacturer: Manufacturer) => {
      const period = periods[periodIdx];
      const prior  = periods[periodIdx + 1] ?? null;
      if (!period) return;
      const math = cellMath(period, prior, segment, manufacturer);
      setSelection({
        period:        { id: period.period_id, label: period.period_label, skuCount: math.curStandaloneCount,   avgPriceCents: math.curStandaloneAvg },
        priorPeriod:   prior ? { id: prior.period_id, label: prior.period_label, skuCount: math.priorStandaloneCount, avgPriceCents: math.priorStandaloneAvg } : null,
        segment,
        manufacturer,
        granularity:   activeSpec.abbrev,
        priorNote:     activeSpec.priorNote,
        pct:           math.pct,
        isLive:        periodIdx === 0,
        cohortCount:   math.cohortCount,
        curCohortAvgCents:   math.curCohortAvg,
        priorCohortAvgCents: math.priorCohortAvg,
      });
    },
    [periods, activeSpec],
  );

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Average price trends · period-over-period</h2>
        {data && (
          <span className="badge badge--info">
            {periods.length} {periods.length === 1 ? 'period' : 'periods'} on record
          </span>
        )}
      </div>

      {/* Granularity sub-tab strip (mirrors the UBS Compare inspiration). */}
      <div className="filters" role="tablist" aria-label="Granularity">
        {GRANULARITIES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={granularity === g.id}
            className={`filter-chip ${granularity === g.id ? 'filter-chip--active' : ''}`}
            onClick={() => setGranularity(g.id)}
          >
            {g.label}
            <span className="muted" style={{ marginLeft: 6 }}>· {g.live}</span>
          </button>
        ))}
      </div>

      {loading && <div className="state-line">Loading period aggregates…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <>
          <div className="t-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th rowSpan={2}>Period</th>
                  <th className="num" colSpan={2}>Server</th>
                  <th className="num" colSpan={2}>Laptop</th>
                  <th className="num" colSpan={2}>Desktop</th>
                </tr>
                <tr>
                  <th className="num">Intel</th>
                  <th className="num">AMD</th>
                  <th className="num">Intel</th>
                  <th className="num">AMD</th>
                  <th className="num">Intel</th>
                  <th className="num">AMD</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => {
                  const prior = periods[i + 1] ?? null;
                  const isLive = i === 0;
                  return (
                    <tr key={p.period_id} className={isLive ? 'row--live' : undefined}>
                      <td>
                        {isLive && <>★ {activeSpec.liveAbbrev} · </>}
                        <strong>{p.period_label}</strong>
                        {isLive && <span className="muted" style={{ marginLeft: 6 }}>live</span>}
                      </td>
                      {SEGMENTS.flatMap((segment) =>
                        MANUFACTURERS.map((manufacturer) => {
                          const math = cellMath(p, prior, segment, manufacturer);
                          return (
                            <PeriodCell
                              key={`${segment}-${manufacturer}`}
                              math={math}
                              isLive={isLive}
                              onClick={() => selectCell(i, segment, manufacturer)}
                            />
                          );
                        }),
                      )}
                    </tr>
                  );
                })}
                {periods.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="state-line">
                        No {activeSpec.label.toLowerCase()} data yet. The daily scrape needs at
                        least one observation in this {activeSpec.abbrev.toLowerCase()} window.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="legend">
            <span className="legend__item"><span className="legend__swatch legend__swatch--up" /> Price increase</span>
            <span className="legend__item"><span className="legend__swatch legend__swatch--down" /> Price decrease</span>
            <span className="legend__item">★ Live row updates with each daily capture</span>
            <span className="legend__item muted">
              Closed periods show {activeSpec.abbrev} % movement · click any cell for the math
            </span>
          </div>

          {periods.length <= 1 && (
            <div className="caveat">
              <strong>Sparse history.</strong> Only {periods.length} {activeSpec.label.toLowerCase()} period
              has data so far, so every % change cell is &mdash;. Rows populate automatically as the
              daily cron accumulates calendar coverage.
            </div>
          )}
        </>
      )}

      <OverviewDrawer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}

function PeriodCell({
  math,
  isLive,
  onClick,
}: {
  math: CellMath;
  isLive: boolean;
  onClick: () => void;
}) {
  const tone = deltaTone(math.pct);
  const showAbsoluteFallback = math.pct == null && math.curStandaloneAvg != null;

  return (
    <td
      className={`num mono cell-clickable delta ${tone} ${isLive ? 'cell--live' : ''}`}
      onClick={onClick}
      title="Show the math"
    >
      {showAbsoluteFallback ? (
        <div className="muted">{fmtPrice(math.curStandaloneAvg)}</div>
      ) : (
        <div>{fmtPercent(math.pct)}</div>
      )}
    </td>
  );
}
