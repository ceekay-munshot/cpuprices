import type { StatusData } from '../api';
import { fmtRelative } from '../format';

interface Props {
  status: StatusData | null;
  onRefresh: () => void;
  onDownloadXlsx: () => void;
  xlsxBusy: boolean;
}

export default function Header({ status, onRefresh, onDownloadXlsx, xlsxBusy }: Props) {
  const fresh = status?.is_fresh_daily ?? false;
  const ago = fmtRelative(status?.last_scraped_at);

  return (
    <header className="app-header">
      <div className="app-header__row">
        <h1 className="app-header__title">CPU Pricing &amp; Supply-Tightness Tracker</h1>
        <div className="app-header__controls">
          {status && (
            <span className={`badge ${fresh ? 'badge--fresh' : 'badge--stale'}`} title={`Last scrape ${ago}`}>
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
