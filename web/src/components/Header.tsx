import type { StatusData } from '../api';
import { fmtRelative } from '../format';

interface Props {
  status: StatusData | null;
  onRefresh: () => void;
  onDownloadXlsx: () => void;
  xlsxBusy: boolean;
}

export default function Header({ status, onRefresh, onDownloadXlsx, xlsxBusy }: Props) {
  // Freshness tracks the last SUCCESSFUL capture — a failing scraper must
  // read as stale here even while attempts keep landing every day.
  const fresh = status?.is_fresh_daily ?? false;
  const ago = fmtRelative(status?.last_success_at);
  const failures = status?.consecutive_failures ?? 0;
  const lastAttemptAgo = fmtRelative(status?.last_scraped_at);

  return (
    <header className="app-header">
      <div className="app-header__row">
        <h1 className="app-header__title">CPU Pricing &amp; Supply-Tightness Tracker</h1>
        <div className="app-header__controls">
          {status && failures > 0 && (
            <span
              className="badge badge--alert"
              title={`${failures} consecutive failed scrape${failures === 1 ? '' : 's'} since the last good capture · last attempt ${lastAttemptAgo}${status.latest_run?.error_message ? ` · ${status.latest_run.error_message}` : ''}`}
            >
              <span className="badge__dot" />
              {failures} failed scrape{failures === 1 ? '' : 's'}
            </span>
          )}
          {status && (
            <span
              className={`badge ${fresh ? 'badge--fresh' : 'badge--stale'}`}
              title={`Last successful capture ${ago}`}
            >
              <span className="badge__dot" />
              {fresh ? `Fresh · ${ago}` : `Stale · ${ago}`}
            </span>
          )}
          <button className="btn" onClick={onRefresh} type="button">Refresh</button>
          <button
            className="btn btn--primary"
            onClick={onDownloadXlsx}
            type="button"
            disabled={xlsxBusy}
            title="Export every CPU + Δ columns + historical baselines as .xlsx"
          >
            {xlsxBusy ? 'Generating…' : 'Download XLSX'}
          </button>
        </div>
      </div>
    </header>
  );
}
