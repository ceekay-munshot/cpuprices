import type { ReactNode } from 'react';

export type Tab = 'tracker' | 'basket' | 'methodology';

interface Props {
  tab: Tab;
  onChange: (next: Tab) => void;
  basketCount: number | null;
}

interface TabSpec {
  id: Tab;
  label: string;
  count?: number | null;
}

export default function TabNav({ tab, onChange, basketCount }: Props) {
  const tabs: TabSpec[] = [
    { id: 'tracker',     label: 'Pricing Tracker' },
    { id: 'basket',      label: 'Tracked SKUs', count: basketCount },
    { id: 'methodology', label: 'Methodology' },
  ];

  return (
    <nav className="tabnav" role="tablist" aria-label="Primary sections">
      <div className="tabnav__inner">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            className={`tabnav__btn ${tab === t.id ? 'tabnav__btn--active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count != null && <span className="tabnav__count">{t.count}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function TabPanel({ id, active, children }: { id: Tab; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return (
    <section
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className="tabpanel"
    >
      {children}
    </section>
  );
}
