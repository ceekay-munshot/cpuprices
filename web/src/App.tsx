import { useCallback, useState } from 'react';
import { api } from './api';
import { useApi } from './useApi';
import { downloadCsv } from './csv';
import { fmtDateTime, fmtPrice } from './format';
import Header from './components/Header';
import StatusStrip from './components/StatusStrip';
import TabNav, { TabPanel, type Tab } from './components/TabNav';
import HeroCards from './components/HeroCards';
import MainTable, { computeRows, type ComputedRow } from './components/MainTable';
import EvidenceDrawer from './components/EvidenceDrawer';
import PassmarkModule from './components/PassmarkModule';
import TrackedBasket from './components/TrackedBasket';
import PriceChanges from './components/PriceChanges';
import SkuHistory from './components/SkuHistory';
import Methodology from './components/Methodology';

export default function App() {
  const status = useApi(api.status);
  const prices = useApi(api.currentPrices);
  const [tab, setTab] = useState<Tab>('tracker');
  const [evidence, setEvidence] = useState<ComputedRow | null>(null);

  const reloadAll = useCallback(() => {
    status.reload();
    prices.reload();
  }, [status, prices]);

  // Tab switches close any open evidence drawer — drawer rows live on the
  // Pricing Tracker tab and would otherwise float over unrelated content.
  const onTabChange = useCallback((next: Tab) => {
    setTab(next);
    setEvidence(null);
  }, []);

  const onDownload = useCallback(() => {
    if (!prices.data) return;
    const rows = computeRows(prices.data.rows);
    const headers = [
      'Manufacturer', 'Product Type',
      'Latest Avg Price (USD)', 'WoW Avg Δ', 'MoM Avg Δ', 'QoQ Avg Δ',
      'WoW LFL Δ', 'MoM LFL Δ', 'QoQ LFL Δ',
      'SKUs Tracked', 'Matched SKUs', 'Vendors Covered', 'Data Quality',
    ];
    const csvRows = rows.map((r) => [
      r.manufacturer,
      r.productType,
      r.latestAvgCents != null ? fmtPrice(r.latestAvgCents) : '',
      '', '', '', '', '', '',
      r.trackedSkus,
      r.matchedSkus,
      r.vendorsCovered,
      r.dataQuality === 'proxy' ? 'Proxy only' : r.dataQuality === 'missing' ? 'Missing' : 'Not tracked yet',
    ]);
    const stamp = fmtDateTime(status.data?.last_scraped_at).replace(/[:\s]/g, '-');
    downloadCsv(`cpu-pricing-tracker-${stamp}.csv`, headers, csvRows);
  }, [prices.data, status.data]);

  const basketCount = prices.data?.count ?? null;

  return (
    <>
      <Header status={status.data} onRefresh={reloadAll} onDownload={onDownload} />
      <StatusStrip status={status.data} loading={status.loading} error={status.error} />
      <TabNav tab={tab} onChange={onTabChange} basketCount={basketCount} />

      <main className="app-main">
        <TabPanel id="tracker" active={tab === 'tracker'}>
          <HeroCards currentPrices={prices.data?.rows ?? null} />
          <MainTable
            currentPrices={prices.data?.rows ?? null}
            loading={prices.loading}
            error={prices.error}
            onEvidence={setEvidence}
          />
          <PassmarkModule />
        </TabPanel>

        <TabPanel id="basket" active={tab === 'basket'}>
          <TrackedBasket
            rows={prices.data?.rows ?? null}
            loading={prices.loading}
            error={prices.error}
          />
          <PriceChanges />
          <SkuHistory basket={prices.data?.rows ?? null} />
        </TabPanel>

        <TabPanel id="methodology" active={tab === 'methodology'}>
          <Methodology />
        </TabPanel>
      </main>

      <EvidenceDrawer row={evidence} onClose={() => setEvidence(null)} />
    </>
  );
}
