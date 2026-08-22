import type { StatusData } from '../api';
import { fmtDateTime, fmtInt } from '../format';

interface Props {
  status: StatusData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Universal status strip. Shows capture-truth: when data last actually
 * landed (successful scrape), how big that capture was, how much usable
 * history exists, and — when the scraper is failing — the failure streak.
 *
 * Counts deliberately exclude failed runs: a failed run aborts mid-insert
 * and leaves orphan rows that no view uses, so including them would
 * overstate history (the pre-fix strip estimated "scrapes on record" by
 * dividing the raw row count and quietly drifted as failures piled up).
 */
export default function StatusStrip({ status, loading, error }: Props) {
  if (error) {
    return (
      <div className="status-strip">
        <div className="status-strip__inner">
          <span style={{ color: 'var(--accent-error)', fontWeight: 600 }}>API error: {error}</span>
        </div>
      </div>
    );
  }

  const success = status?.latest_success_run;
  const rowsLastCapture = success?.observations_inserted ?? success?.rows_found ?? null;
  const failures = status?.consecutive_failures ?? 0;
  const lastAttempt = status?.latest_run;

  return (
    <div className="status-strip">
      <div className="status-strip__inner">
        <Pair label="Last capture" value={loading ? '…' : fmtDateTime(status?.last_success_at)} />
        <Pair label="Rows last capture" value={loading ? '…' : fmtInt(rowsLastCapture)} />
        <Pair
          label="Usable rows on record"
          value={loading ? '…' : fmtInt(status?.source_observations_in_success_runs ?? null)}
        />
        <Pair label="Captures on record" value={loading ? '…' : fmtInt(status?.success_run_count ?? null)} />
        {!loading && failures > 0 && (
          <div
            className="status-strip__pair"
            title={lastAttempt?.error_message ?? 'Latest attempt did not record an error message'}
          >
            <span className="status-strip__label">Scraper:</span>
            <span className="status-strip__value status-strip__value--alert">
              failing · {fmtInt(failures)} attempt{failures === 1 ? '' : 's'} since last capture
            </span>
          </div>
        )}
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
