import type { CurrentPriceRow } from '../api';
import { fmtInt, PLACEHOLDER_NOT_LIVE, PLACEHOLDER_VENDOR_DATA } from '../format';

interface Props {
  currentPrices: CurrentPriceRow[] | null;
}

/**
 * Four required hero cards. Three are honest "not live yet" — they need
 * data sources we don't have (multi-period history for QoQ deltas;
 * Server-segment SKU classification; AWS spot pricing). The fourth
 * (Server SKU Coverage) we can compute from live data, and the answer is
 * "0 of 0 server SKUs tracked" because our basket is desktop-only today.
 */
export default function HeroCards({ currentPrices }: Props) {
  const intelServerTracked = countTracked(currentPrices, 'Intel', 'Server');
  const amdServerTracked = countTracked(currentPrices, 'AMD', 'Server');
  const totalServerTracked = intelServerTracked + amdServerTracked;

  return (
    <section className="hero-row">
      <HeroCard
        label="Intel Server LFL QoQ"
        placeholder
        value={PLACEHOLDER_VENDOR_DATA}
        note="Needs direct vendor pricing + a quarter of history."
      />
      <HeroCard
        label="AMD Server LFL QoQ"
        placeholder
        value={PLACEHOLDER_VENDOR_DATA}
        note="Needs direct vendor pricing + a quarter of history."
      />
      <HeroCard
        label="Server SKU Coverage"
        value={`${fmtInt(totalServerTracked)} server SKUs tracked`}
        note={
          totalServerTracked === 0
            ? 'Basket is desktop-only today. Add server SKUs to config/tracked-skus.json.'
            : `Intel ${fmtInt(intelServerTracked)} · AMD ${fmtInt(amdServerTracked)}`
        }
      />
      <HeroCard
        label="AWS CPU Spot Pressure"
        placeholder
        value={PLACEHOLDER_NOT_LIVE}
        note="Awaiting AWS spot-pricing capture source."
      />
    </section>
  );
}

function countTracked(rows: CurrentPriceRow[] | null, vendor: string, bucketWord: string): number {
  if (!rows) return 0;
  return rows.filter((r) => r.vendor === vendor && r.bucket.toLowerCase().includes(bucketWord.toLowerCase())).length;
}

interface HeroCardProps {
  label: string;
  value: string;
  note?: string;
  placeholder?: boolean;
}
function HeroCard({ label, value, note, placeholder }: HeroCardProps) {
  return (
    <article className="hero-card">
      <div className="hero-card__label">{label}</div>
      <div className={`hero-card__value ${placeholder ? 'hero-card__value--placeholder' : ''}`}>{value}</div>
      {note && <div className="hero-card__note">{note}</div>}
    </article>
  );
}
