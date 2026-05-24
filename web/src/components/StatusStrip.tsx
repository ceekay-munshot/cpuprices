import type { StatusData } from '../api';
import { fmtDateTime, fmtInt } from '../format';

interface Props {
  status: StatusData | null;
  loading: boolean;
  error: string | null;
}

export default function StatusStrip({ status, loading, error }: Props) {
  if (error) {
    return (
      <div className="status-strip">
        <div className="status-strip__inner">
          <span style={{ color: 'var(--accent-up)', fontWeight: 600 }}>API error: {error}</span>
        </div>
      </div>
    );
  }

  const run = status?.latest_run;
  const observedAll = run?.rows_found ?? null;
  const inserted = status?.source_observations_count ?? null;
  // Price coverage approximation: latest run's observations vs total observations.
  // Without per-vendor breakdown here we lean on /api/passmark/vendor-summary
  // for a precise number; this strip just surfaces totals.
  const tracked = run?.tracked_skus_matched != null && run?.tracked_skus_missing != null
    ? run.tracked_skus_matched + run.tracked_skus_missing
    : null;
  const matched = run?.tracked_skus_matched ?? null;
  const missing = run?.tracked_skus_missing ?? null;

  return (
    <div className="status-strip">
      <div className="status-strip__inner">
        <Pair label="Last scrape" value={loading ? '…' : fmtDateTime(status?.last_scraped_at)} />
        <Pair label="Full CPU rows observed" value={loading ? '…' : fmtInt(observedAll)} />
        <Pair label="Source observations stored" value={loading ? '…' : fmtInt(inserted)} />
        <Pair label="Price history rows" value={loading ? '…' : fmtInt(status?.price_history_count)} />
        <Pair label="Tracked SKUs matched" value={loading ? '…' : `${fmtInt(matched)} / ${fmtInt(tracked)}`} />
        <Pair label="Tracked SKUs missing" value={loading ? '…' : fmtInt(missing)} />
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-strip__pair">
      <span className="status-strip__label">{label}:</span>
      <span className="status-strip__value">{value}</span>
    </div>
  );
}
