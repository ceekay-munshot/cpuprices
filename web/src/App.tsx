import { useCallback, useState } from 'react';
import { api } from './api';
import { useApi } from './useApi';
import Header from './components/Header';
import StatusStrip from './components/StatusStrip';
import TabNav, { TabPanel, type Tab } from './components/TabNav';
import Overview from './components/Overview';
import FullUniverse from './components/FullUniverse';
import Methodology from './components/Methodology';

export default function App() {
  const status = useApi(api.status);
  const [tab, setTab] = useState<Tab>('overview');
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const reloadAll = useCallback(() => {
    status.reload();
  }, [status]);

  /**
   * Download the entire CPU Universe (latest scrape) as .xlsx.
   *
   * Lazy-loads /api/observations AND the SheetJS module on first click so
   * the base bundle stays light. If the user never clicks the button, the
   * ~280 KB xlsx chunk never ships.
   */
  const onDownloadXlsx = useCallback(async () => {
    setXlsxBusy(true);
    try {
      const [observations, mod] = await Promise.all([
        api.observations(),
        import('./xlsx-export'),
      ]);
      await mod.exportObservationsXlsx(observations.rows, observations.latest_scraped_at);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Keep this loud — XLSX failures should not be silent.
      // eslint-disable-next-line no-alert
      window.alert(`XLSX export failed: ${msg}`);
      // eslint-disable-next-line no-console
      console.error('XLSX export failed:', err);
    } finally {
      setXlsxBusy(false);
    }
  }, []);

  return (
    <>
      <Header
        status={status.data}
        onRefresh={reloadAll}
        onDownloadXlsx={onDownloadXlsx}
        xlsxBusy={xlsxBusy}
      />
      <StatusStrip status={status.data} loading={status.loading} error={status.error} />
      <TabNav
        tab={tab}
        onChange={setTab}
        universeCount={status.data?.latest_run?.rows_found ?? null}
      />

      <main className="app-main">
        <TabPanel id="overview" active={tab === 'overview'}>
          <Overview />
        </TabPanel>

        <TabPanel id="universe" active={tab === 'universe'}>
          <FullUniverse />
        </TabPanel>

        <TabPanel id="methodology" active={tab === 'methodology'}>
          <Methodology />
        </TabPanel>
      </main>
    </>
  );
}
