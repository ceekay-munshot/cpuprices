import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ObservationRow } from '../api';
import { useApi } from '../useApi';
import { deltaTone, fmtAbsCents, fmtDate, fmtDateTime, fmtInt, fmtPercent, fmtPrice } from '../format';
import UniverseDrawer from './UniverseDrawer';

/**
 * Full PassMark CPU universe browser.
 *
 * One row per CPU in the latest /cpu-list/all scrape (~5,889 today).
 * Client-side filters; IntersectionObserver-driven infinite scroll keeps the
 * DOM light while the user pages through.
 *
 * Δ columns (WoW / MoM / QoQ — % and absolute) are computed from each row's
 * historical price baselines that the API returns. With 2 days of remote
 * history today, every Δ is "—" for every row; values populate automatically
 * as the daily cron accumulates calendar coverage.
 */

const INITIAL_VISIBLE = 100;
const LOAD_STEP = 100;

// "New SKU" rolling window. Matches the qoq_price_cents 90-day convention in
// the observations API. Exported so callers can format the chip label off the
// same constant (single source of truth).
const NEW_SKU_WINDOW_DAYS = 90;

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

export default function FullUniverse() {
  const { data, loading, error } = useApi(api.observations);

  const [vendor, setVendor] = useState<string>('all');
  const [segment, setSegment] = useState<string>('all');
  const [priceFilter, setPriceFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [listed, setListed] = useState<'all' | 'new' | 'established'>('all');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [selectedRow, setSelectedRow] = useState<ObservationRow | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const vendors = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.rows.map((r) => r.vendor_inferred ?? 'Other'))).sort();
  }, [data]);

  // Fixed order so the chips don't reflow as the data changes.
  const SEGMENTS = ['Server', 'Desktop', 'Laptop', 'Other'] as const;

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    // Compute the cutoff once per pass — recomputed on each filter change so the
    // window stays accurate even if the page sits open across midnight.
    const cutoffIso = new Date(Date.now() - NEW_SKU_WINDOW_DAYS * 86_400_000).toISOString();
    return data.rows.filter((r) => {
      if (vendor !== 'all' && (r.vendor_inferred ?? 'Other') !== vendor) return false;
      if (segment !== 'all' && (r.segment_inferred ?? 'Other') !== segment) return false;
      if (priceFilter === 'yes' && r.price_cents == null) return false;
      if (priceFilter === 'no'  && r.price_cents != null) return false;
      if (listed !== 'all') {
        const isNew = r.first_seen_at != null && r.first_seen_at >= cutoffIso;
        if (listed === 'new'         && !isNew) return false;
        if (listed === 'established' &&  isNew) return false;
      }
      if (q && !r.source_sku_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, vendor, segment, priceFilter, listed, search]);

  // Reset scroll position when filters narrow the result set so the user
  // sees the new top, not a window into stale far-off rows.
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [vendor, segment, priceFilter, listed, search]);

  // IntersectionObserver-driven infinite scroll. Sentinel sits below the
  // table; when it enters the viewport (with a 400px lead so the user
  // never sees a blank gap), reveal another LOAD_STEP rows.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + LOAD_STEP, filtered.length));
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [filtered.length]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">CPU Universe</h2>
        {data && (
          <span className="badge badge--info">
            {fmtInt(filtered.length)} / {fmtInt(data.count)} rows
            {data.latest_scrape_run_id != null && ` · Run #${data.latest_scrape_run_id}`}
          </span>
        )}
      </div>

      {loading && <div className="state-line">Loading observations…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && data && (
        <>
          <div className="filters">
            <span className="filter-label">Vendor</span>
            <Pill active={vendor === 'all'} onClick={() => setVendor('all')}>All</Pill>
            {vendors.map((v) => (
              <Pill key={v} active={vendor === v} onClick={() => setVendor(v)}>{v}</Pill>
            ))}
            <span className="filter-label" style={{ marginLeft: 12 }}>Segment</span>
            <Pill active={segment === 'all'} onClick={() => setSegment('all')}>All</Pill>
            {SEGMENTS.map((s) => (
              <Pill key={s} active={segment === s} onClick={() => setSegment(s)}>{s}</Pill>
            ))}
            <span className="filter-label" style={{ marginLeft: 12 }}>Price</span>
            <Pill active={priceFilter === 'all'} onClick={() => setPriceFilter('all')}>All</Pill>
            <Pill active={priceFilter === 'yes'} onClick={() => setPriceFilter('yes')}>With price</Pill>
            <Pill active={priceFilter === 'no'}  onClick={() => setPriceFilter('no')}>No price</Pill>
            <span className="filter-label" style={{ marginLeft: 12 }}>Listed</span>
            <Pill active={listed === 'all'}         onClick={() => setListed('all')}>All</Pill>
            <Pill active={listed === 'new'}         onClick={() => setListed('new')}>New (≤3mo)</Pill>
            <Pill active={listed === 'established'} onClick={() => setListed('established')}>Established</Pill>
            <input
              className="filter-input"
              placeholder="Search CPU name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginLeft: 'auto' }}
            />
          </div>

          <div className="t-wrap">
            <table className="t t--dense t--clickable">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Segment</th>
                  <th>Source SKU Name</th>
                  <th className="num">CPU Mark</th>
                  <th className="num">Rank</th>
                  <th className="num">CPU Value</th>
                  <th className="num">Price</th>
                  <th className="num">% WoW</th>
                  <th className="num">% MoM</th>
                  <th className="num">% QoQ</th>
                  <th className="num">Abs WoW</th>
                  <th className="num">Abs MoM</th>
                  <th className="num">Abs QoQ</th>
                  <th>Scraped At</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <UniverseRow
                    key={`${r.normalized_source_name}-${i}`}
                    row={r}
                    onSelect={setSelectedRow}
                  />
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={14}><div className="state-line">No CPUs match the current filters.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Sentinel + status sit OUTSIDE the table so IntersectionObserver
              can attach to a regular block element. */}
          <div ref={sentinelRef} className="infinite-sentinel" aria-hidden="true" />
          <div className="infinite-status">
            {hasMore
              ? `Showing ${fmtInt(visible.length)} of ${fmtInt(filtered.length)} · scroll to load more · click any row for the math`
              : `End of list · ${fmtInt(filtered.length)} ${filtered.length === 1 ? 'row' : 'rows'} · click any row for the math`}
          </div>
        </>
      )}

      <UniverseDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  );
}

function UniverseRow({ row, onSelect }: { row: ObservationRow; onSelect: (r: ObservationRow) => void }) {
  const wow = computeDelta(row.price_cents, row.wow_price_cents);
  const mom = computeDelta(row.price_cents, row.mom_price_cents);
  const qoq = computeDelta(row.price_cents, row.qoq_price_cents);
  return (
    <tr onClick={() => onSelect(row)}>
      <td><strong>{row.vendor_inferred ?? 'Other'}</strong></td>
      <td>{row.segment_inferred == null
        ? <span className="muted">—</span>
        : <span className={`segment-pill segment-pill--${row.segment_inferred.toLowerCase()}`}>{row.segment_inferred}</span>}</td>
      <td title={row.first_seen_at ? `First seen: ${fmtDate(row.first_seen_at)}` : undefined}>
        {row.source_sku_name}
      </td>
      <td className="num mono">{fmtInt(row.benchmark_score)}</td>
      <td className="num mono">{fmtInt(row.rank)}</td>
      <td className="num mono">{row.cpu_value == null ? '—' : row.cpu_value.toFixed(2)}</td>
      <td className="num mono">{fmtPrice(row.price_cents)}</td>
      <td className={`num mono delta ${deltaTone(wow.pct)}`}>{fmtPercent(wow.pct)}</td>
      <td className={`num mono delta ${deltaTone(mom.pct)}`}>{fmtPercent(mom.pct)}</td>
      <td className={`num mono delta ${deltaTone(qoq.pct)}`}>{fmtPercent(qoq.pct)}</td>
      <td className={`num mono delta ${deltaTone(wow.abs)}`}>{fmtAbsCents(wow.abs)}</td>
      <td className={`num mono delta ${deltaTone(mom.abs)}`}>{fmtAbsCents(mom.abs)}</td>
      <td className={`num mono delta ${deltaTone(qoq.abs)}`}>{fmtAbsCents(qoq.abs)}</td>
      <td className="muted">{fmtDateTime(row.scraped_at)}</td>
    </tr>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`filter-chip ${active ? 'filter-chip--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
