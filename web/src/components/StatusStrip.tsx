import type { StatusData } from '../api';
import { fmtDateTime, fmtInt } from '../format';

interface Props {
  status: StatusData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Universal status strip. After the basket tab was removed, this shows only
 * universe-scoped facts: when the source was scraped, how many CPUs that
 * scrape returned, and the cumulative observation count across every scrape
 * on record.
 */
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
  const rowsThisScrape = run?.rows_found ?? null;
  const totalStored = status?.source_observations_count ?? null;
  // "Scrapes on record" lets the user spot whether they're looking at 2 days
  // of history vs 90, without needing to do arithmetic on the two row counts.
  const totalScrapes =
    rowsThisScrape != null && totalStored != null && rowsThisScrape > 0
      ? Math.round(totalStored / rowsThisScrape)
      : null;

  return (
    <div className="status-strip">
      <div className="status-strip__inner">
        <Pair label="Last scrape" value={loading ? '…' : fmtDateTime(status?.last_scraped_at)} />
        <Pair label="Rows this scrape" value={loading ? '…' : fmtInt(rowsThisScrape)} />
        <Pair label="Total rows on record" value={loading ? '…' : fmtInt(totalStored)} />
        <Pair label="Scrapes on record" value={loading ? '…' : fmtInt(totalScrapes)} />
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
