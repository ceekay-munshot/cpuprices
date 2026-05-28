import { useEffect } from 'react';
import type { ObservationRow } from '../api';
import { deltaTone, fmtAbsCents, fmtDate, fmtDateTime, fmtInt, fmtPercent, fmtPrice } from '../format';

interface Props {
  row: ObservationRow | null;
  onClose: () => void;
}

/**
 * "Show me the math" drawer for the CPU Universe table.
 *
 * Opens when the user clicks any cell of a row. Spells out three things:
 *   1. The raw snapshot the source returned today.
 *   2. The historical baselines used for the Δ columns (and why they're null
 *      today — no observation exists 7+ days back yet).
 *   3. Every Δ computation with formula, substituted values, and result.
 *
 * No fabrication: if `prior` is null, the substituted form shows "—" so the
 * user can see exactly why the % / abs cell rendered as "—".
 */
export default function UniverseDrawer({ row, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (row) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    return undefined;
  }, [row, onClose]);

  if (!row) return null;

  const wow = computeDelta(row.price_cents, row.wow_price_cents);
  const mom = computeDelta(row.price_cents, row.mom_price_cents);
  const qoq = computeDelta(row.price_cents, row.qoq_price_cents);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation" />
      <aside className="drawer" role="dialog" aria-label={`Math breakdown for ${row.source_sku_name}`}>
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{row.source_sku_name}</h3>
            <div className="drawer__sub">
              {row.vendor_inferred ?? 'Other'} ·
              {' '}CPU Mark {fmtInt(row.benchmark_score)} ·
              {' '}Rank {fmtInt(row.rank)}
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close drawer">
            Close
          </button>
        </header>

        <div className="drawer__body">
          {/* 1. Raw snapshot */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Latest snapshot (this scrape)</h4>
            <dl className="drawer__kv">
              <dt>Source SKU name</dt><dd>{row.source_sku_name}</dd>
              <dt>Vendor (inferred)</dt><dd>{row.vendor_inferred ?? 'Other'}</dd>
              <dt>Segment (inferred)</dt><dd>{row.segment_inferred ?? '—'}</dd>
              <dt>Benchmark (CPU Mark)</dt><dd>{fmtInt(row.benchmark_score)}</dd>
              <dt>Rank</dt><dd>{fmtInt(row.rank)}</dd>
              <dt>CPU Value</dt><dd>{row.cpu_value == null ? '—' : row.cpu_value.toFixed(2)}</dd>
              <dt>Price (parsed)</dt><dd>{fmtPrice(row.price_cents)}</dd>
              <dt>Raw text</dt><dd>{row.raw_price_text ?? '—'}</dd>
              <dt>Currency</dt><dd>{row.currency}</dd>
              <dt>Scraped at</dt><dd>{fmtDateTime(row.scraped_at)}</dd>
              <dt>First seen</dt>
              <dd>
                {row.first_seen_at
                  ? fmtDate(row.first_seen_at)
                  : <span className="muted">—</span>}
                {' '}
                <span className="muted">
                  (earliest observation of this normalized name across all scrapes)
                </span>
              </dd>
            </dl>
          </section>

          {/* 2. Historical baselines */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Historical baselines</h4>
            <dl className="drawer__kv">
              <dt>7 days ago (WoW)</dt><dd>{fmtPrice(row.wow_price_cents)}</dd>
              <dt>30 days ago (MoM)</dt><dd>{fmtPrice(row.mom_price_cents)}</dd>
              <dt>90 days ago (QoQ)</dt><dd>{fmtPrice(row.qoq_price_cents)}</dd>
            </dl>
            <p className="drawer__note">
              Lookup rule: closest observation on or before the cutoff, matched by normalized CPU name.
              Null when no observation exists that far back yet.
            </p>
          </section>

          {/* 3. Δ math, one block per column */}
          <section className="drawer__section">
            <h4 className="drawer__section-title">Δ math (one block per Δ column)</h4>
            <DeltaExplain
              label="% WoW"
              formula="(latest − wow_prior) / wow_prior × 100"
              latest={row.price_cents} prior={row.wow_price_cents}
              result={wow.pct} kind="pct"
            />
            <DeltaExplain
              label="% MoM"
              formula="(latest − mom_prior) / mom_prior × 100"
              latest={row.price_cents} prior={row.mom_price_cents}
              result={mom.pct} kind="pct"
            />
            <DeltaExplain
              label="% QoQ"
              formula="(latest − qoq_prior) / qoq_prior × 100"
              latest={row.price_cents} prior={row.qoq_price_cents}
              result={qoq.pct} kind="pct"
            />
            <DeltaExplain
              label="Abs WoW"
              formula="latest − wow_prior"
              latest={row.price_cents} prior={row.wow_price_cents}
              result={wow.abs} kind="abs"
            />
            <DeltaExplain
              label="Abs MoM"
              formula="latest − mom_prior"
              latest={row.price_cents} prior={row.mom_price_cents}
              result={mom.abs} kind="abs"
            />
            <DeltaExplain
              label="Abs QoQ"
              formula="latest − qoq_prior"
              latest={row.price_cents} prior={row.qoq_price_cents}
              result={qoq.abs} kind="abs"
            />
          </section>

          {row.url && (
            <section className="drawer__section">
              <h4 className="drawer__section-title">Source</h4>
              <p style={{ fontSize: 'var(--fs-sm)' }}>
                <a href={row.url} target="_blank" rel="noopener noreferrer">{row.url}</a>
              </p>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

interface Delta {
  abs: number | null;
  pct: number | null;
}

function computeDelta(latestCents: number | null, priorCents: number | null): Delta {
  if (latestCents == null || priorCents == null) return { abs: null, pct: null };
  const abs = latestCents - priorCents;
  const pct = priorCents === 0 ? null : (abs / priorCents) * 100;
  return { abs, pct };
}

interface DeltaExplainProps {
  label: string;
  formula: string;
  latest: number | null;
  prior: number | null;
  result: number | null;
  kind: 'pct' | 'abs';
}

function DeltaExplain({ label, formula, latest, prior, result, kind }: DeltaExplainProps) {
  // Substitute actual values into the formula so the user sees concretely
  // why the result is what it is.
  const latestStr = fmtPrice(latest);
  const priorStr = fmtPrice(prior);
  const inputs = kind === 'pct'
    ? `(${latestStr} − ${priorStr}) / ${priorStr} × 100`
    : `${latestStr} − ${priorStr}`;
  const resultStr = kind === 'pct' ? fmtPercent(result) : fmtAbsCents(result);

  return (
    <div className="delta-explain">
      <div className="delta-explain__label">{label}</div>
      <div className="delta-explain__line">
        <span className="delta-explain__tag">formula</span>
        <code>{formula}</code>
      </div>
      <div className="delta-explain__line">
        <span className="delta-explain__tag">inputs</span>
        <code>{inputs}</code>
      </div>
      <div className="delta-explain__line">
        <span className="delta-explain__tag">result</span>
        <code className={`delta-explain__result delta ${deltaTone(result)}`}>{resultStr}</code>
      </div>
    </div>
  );
}
