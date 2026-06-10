import { useCallback, useMemo, useState } from 'react';
import { api, type PeriodAgg } from '../api';
import { useApi } from '../useApi';
import { deltaTone, fmtPercent, fmtPrice } from '../format';
import OverviewDrawer, { type OverviewSelection } from './OverviewDrawer';

/**
 * Overview tab — period-over-period price-trend grid.
 *
 * Y-axis: time periods (newest at top, live period bolded). The API emits a
 *         complete calendar spine through today, so the live row always
 *         exists and rows accrue with the calendar forever. Periods with no
 *         successful capture (scraper outage) arrive as ghost rows
 *         (has_data=false) and render as visible gaps, not silent holes.
 * X-axis: 6 cells per row = (Server / Laptop / Desktop) × (Intel / AMD),
 *         grouped under segment headers.
 * Cells:  % change in avg price vs the most recent prior CAPTURED period,
 *         color-coded (red = price up = bad for buyer, green = price down =
 *         good for buyer).
 *
 * Every captured cell stays clickable and opens an OverviewDrawer with the math.
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
  // priorNote says "captured" because the comparison skips gap periods — after
  // an outage, the % is vs the most recent week/month/quarter that has data.
  { id: 'weekly',    label: 'Week on Week',       live: 'WTD live', abbrev: 'WoW', liveAbbrev: 'WTD',
    priorNote: 'vs most recent captured week' },
  { id: 'monthly',   label: 'Month on Month',     live: 'MTD live', abbrev: 'MoM', liveAbbrev: 'MTD',
    priorNote: 'vs most recent captured month' },
  { id: 'quarterly', label: 'Quarter on Quarter', live: 'QTD live', abbrev: 'QoQ', liveAbbrev: 'QTD',
    priorNote: 'vs most recent captured quarter' },
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
  // Normalize has_data: edge-cached responses from before the field existed
  // can be served for ~30 min after a deploy — infer capture state from
  // scrape_run_count so those rows don't all render as "no capture".
  const periods = useMemo(
    () =>
      (data ? data[granularity] : []).map((p) => ({
        ...p,
        has_data: p.has_data ?? p.scrape_run_count > 0,
      })),
    [data, granularity],
  );
  const capturedCount = useMemo(
    () => periods.filter((p) => p.has_data).length,
    [periods],
  );

  // The % math compares against the most recent CAPTURED period — gap rows
  // (scraper outage) are skipped, matching what the API computed server-side.
  const priorCaptured = useCallback(
    (periodIdx: number) =>
      periods.slice(periodIdx + 1).find((p) => p.has_data) ?? null,
    [periods],
  );

  const selectCell = useCallback(
    (periodIdx: number, segment: Segment, manufacturer: Manufacturer) => {
      const period = periods[periodIdx];
      const prior  = priorCaptured(periodIdx);
      if (!period || !period.has_data) return;
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
    [periods, activeSpec, priorCaptured],
  );

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Average price trends · period-over-period</h2>
        {data && (
          <span className="badge badge--info">
            {capturedCount === periods.length
              ? `${periods.length} ${periods.length === 1 ? 'period' : 'periods'} on record`
              : `${periods.length} periods · ${capturedCount} captured`}
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
            <table className="t t--overview">
              <colgroup>
                <col className="t--overview__col-period" />
                <col /><col className="t--overview__col-seg-end" />
                <col /><col className="t--overview__col-seg-end" />
                <col /><col />
              </colgroup>
              <thead>
                <tr className="t--overview__group-row">
                  <th rowSpan={2} className="t--overview__period-head">Period</th>
                  <th colSpan={2}>Server</th>
                  <th colSpan={2}>Laptop</th>
                  <th colSpan={2}>Desktop</th>
                </tr>
                <tr className="t--overview__sub-row">
                  <th>Intel</th>
                  <th className="t--overview__sub-end">AMD</th>
                  <th>Intel</th>
                  <th className="t--overview__sub-end">AMD</th>
                  <th>Intel</th>
                  <th>AMD</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => {
                  // The live (current) row exists even before its first
                  // capture; an outage period renders as a visible gap row.
                  const isLive = i === 0;
                  const rowClass = [
                    isLive ? 'row--live' : '',
                    p.has_data ? '' : 'row--gap',
                  ].filter(Boolean).join(' ') || undefined;
                  const prior = priorCaptured(i);
                  return (
                    <tr key={p.period_id} className={rowClass}>
                      <td className="t--overview__period-cell">
                        {isLive && <span className="t--overview__live-tag">★ {activeSpec.liveAbbrev}</span>}
                        <strong>{p.period_label}</strong>
                        {isLive && p.has_data && (
                          <span className="muted t--overview__live-flag">live</span>
                        )}
                        {isLive && !p.has_data && (
                          <span className="muted t--overview__live-flag">live · awaiting capture</span>
                        )}
                        {!isLive && !p.has_data && (
                          <span className="t--overview__gap-tag" title="No successful scrape landed during this period">
                            no capture
                          </span>
                        )}
                      </td>
                      {SEGMENTS.flatMap((segment, segIdx) =>
                        MANUFACTURERS.map((manufacturer) => {
                          const isSegEnd = manufacturer === 'AMD' && segIdx < SEGMENTS.length - 1;
                          if (!p.has_data) {
                            return (
                              <td
                                key={`${segment}-${manufacturer}`}
                                className={`num mono delta na t--overview__cell-gap ${isSegEnd ? 't--overview__cell-seg-end' : ''}`}
                                title="No successful scrape landed during this period"
                              >
                                <div>—</div>
                              </td>
                            );
                          }
                          const math = cellMath(p, prior, segment, manufacturer);
                          return (
                            <PeriodCell
                              key={`${segment}-${manufacturer}`}
                              math={math}
                              isLive={isLive}
                              isSegEnd={isSegEnd}
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
            {capturedCount < periods.length && (
              <span className="legend__item muted">"no capture" = scraper gap; % compares across it</span>
            )}
            <span className="legend__item muted">
              Closed periods show {activeSpec.abbrev} % movement · click any cell for the math
            </span>
          </div>

          {capturedCount <= 1 && (
            <div className="caveat">
              <strong>Sparse history.</strong> Only {capturedCount === 0 ? 'no' : capturedCount}{' '}
              {activeSpec.label.toLowerCase()} {capturedCount === 1 ? 'period has' : 'periods have'} captured
              data so far, so every % change cell is &mdash;. Rows populate automatically as the
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
  isSegEnd,
  onClick,
}: {
  math: CellMath;
  isLive: boolean;
  isSegEnd: boolean;
  onClick: () => void;
}) {
  const tone = deltaTone(math.pct);
  const showAbsoluteFallback = math.pct == null && math.curStandaloneAvg != null;
  const cls = [
    'num', 'mono', 'cell-clickable', 'delta', tone,
    isLive    ? 'cell--live'                  : '',
    isSegEnd  ? 't--overview__cell-seg-end'   : '',
  ].filter(Boolean).join(' ');

  return (
    <td className={cls} onClick={onClick} title="Show the math">
      {showAbsoluteFallback ? (
        <div className="muted">{fmtPrice(math.curStandaloneAvg)}</div>
      ) : (
        <div>{fmtPercent(math.pct)}</div>
      )}
    </td>
  );
}
