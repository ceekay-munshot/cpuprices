import type { StatusData } from '../api';
import { fmtRelative } from '../format';

interface Props {
  status: StatusData | null;
  onRefresh: () => void;
  onDownload: () => void;
}

export default function Header({ status, onRefresh, onDownload }: Props) {
  const fresh = status?.is_fresh_daily ?? false;
  const ago = fmtRelative(status?.last_scraped_at);

  return (
    <header className="app-header">
      <div className="app-header__row">
        <div>
          <h1 className="app-header__title">CPU Pricing &amp; Supply-Tightness Tracker</h1>
          <p className="app-header__subtitle">
            Daily PassMark CPU universe capture with tracked Intel/AMD SKU basket. Direct vendor pricing
            sources (Newegg, CDW, Provantage, Arrow) coming next.
          </p>
        </div>
        <div className="app-header__controls">
          {status && (
            <span className={`badge ${fresh ? 'badge--fresh' : 'badge--stale'}`} title={`Last scrape ${ago}`}>
              <span className="badge__dot" />
              {fresh ? `Fresh · ${ago}` : `Stale · ${ago}`}
            </span>
          )}
          <button className="btn" onClick={onRefresh} type="button">Refresh</button>
          <button className="btn btn--primary" onClick={onDownload} type="button">Download CSV</button>
          <button
            className="btn"
            type="button"
            disabled
            aria-disabled="true"
            title="XLSX export coming soon — use CSV for now"
          >
            Download XLSX
            <span className="btn__soon">Soon</span>
          </button>
        </div>
      </div>
    </header>
  );
}
