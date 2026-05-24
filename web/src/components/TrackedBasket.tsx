import { useMemo, useState } from 'react';
import type { CurrentPriceRow } from '../api';
import { fmtDateTime, fmtInt, fmtPrice } from '../format';

interface Props {
  rows: CurrentPriceRow[] | null;
  loading: boolean;
  error: string | null;
}

/** Curated tracked-basket section with vendor / bucket / tier / search filters. */
export default function TrackedBasket({ rows, loading, error }: Props) {
  const [vendor, setVendor] = useState<string>('all');
  const [bucket, setBucket] = useState<string>('all');
  const [tier, setTier] = useState<string>('all');
  const [search, setSearch] = useState('');

  const vendors = useMemo(() => unique(rows?.map((r) => r.vendor)), [rows]);
  const buckets = useMemo(() => unique(rows?.map((r) => r.bucket)), [rows]);
  const tiers = useMemo(() => unique(rows?.map((r) => r.tier).filter(Boolean) as string[]), [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (vendor !== 'all' && r.vendor !== vendor) return false;
      if (bucket !== 'all' && r.bucket !== bucket) return false;
      if (tier !== 'all' && r.tier !== tier) return false;
      if (q && !`${r.sku_name} ${r.source_sku_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, vendor, bucket, tier, search]);

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">Tracked SKU Basket</h2>
          <div className="section__hint">
            Latest price per tracked SKU from the curated basket. Source URL opens the PassMark page.
          </div>
        </div>
        {rows && (
          <span className="badge badge--info">
            {fmtInt(filtered.length)} / {fmtInt(rows.length)} SKUs
          </span>
        )}
      </div>

      <div className="filters">
        <span className="filter-label">Vendor</span>
        <Pill value="all" active={vendor === 'all'} onClick={() => setVendor('all')}>All</Pill>
        {vendors.map((v) => (
          <Pill key={v} value={v} active={vendor === v} onClick={() => setVendor(v)}>{v}</Pill>
        ))}
        <span className="filter-label" style={{ marginLeft: 12 }}>Bucket</span>
        <Pill value="all" active={bucket === 'all'} onClick={() => setBucket('all')}>All</Pill>
        {buckets.map((b) => (
          <Pill key={b} value={b} active={bucket === b} onClick={() => setBucket(b)}>{b}</Pill>
        ))}
        <span className="filter-label" style={{ marginLeft: 12 }}>Tier</span>
        <Pill value="all" active={tier === 'all'} onClick={() => setTier('all')}>All</Pill>
        {tiers.map((t) => (
          <Pill key={t} value={t} active={tier === t} onClick={() => setTier(t)}>{t}</Pill>
        ))}
        <input
          className="filter-input"
          placeholder="Search SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto' }}
        />
      </div>

      {loading && <div className="state-line">Loading basket…</div>}
      {error && <div className="state-line state-line--error">API error: {error}</div>}

      {!loading && !error && (
        <div className="t-wrap">
          <table className="t t--dense">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>SKU</th>
                <th>Bucket</th>
                <th>Tier</th>
                <th>Source SKU Name</th>
                <th className="num">Price</th>
                <th className="num">Raw</th>
                <th className="num">CPU Mark</th>
                <th>Scraped At</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.sku_id}-${r.source_slug}`}>
                  <td><strong>{r.vendor}</strong></td>
                  <td>{r.sku_name}</td>
                  <td>{r.bucket}</td>
                  <td>{r.tier ?? <span className="muted">—</span>}</td>
                  <td className="muted">{r.source_sku_name}</td>
                  <td className="num mono">{fmtPrice(r.price_cents)}</td>
                  <td className="num mono">{r.raw_price_text ?? '—'}</td>
                  <td className="num mono">{fmtInt(r.benchmark_score)}</td>
                  <td className="muted">{fmtDateTime(r.scraped_at)}</td>
                  <td>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="cell-button">
                        Open source
                      </a>
                    ) : (
                      <span className="placeholder">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10}><div className="state-line">No SKUs match the current filters.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Pill({ active, onClick, children }: { active: boolean; value: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`filter-chip ${active ? 'filter-chip--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function unique<T>(arr: T[] | undefined): T[] {
  if (!arr) return [];
  return Array.from(new Set(arr));
}
