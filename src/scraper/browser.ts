import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Launch a headless Chromium browser configured for scraping.
 *
 * The caller owns the lifecycle and must call `browser.close()` when done
 * (typically in a try/finally). Sources create their own contexts off this
 * shared browser instance.
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/**
 * Create a browser context with a realistic desktop fingerprint.
 *
 * Each source should create its own context (and close it) so cookies and
 * storage are isolated between scrapes within a single run.
 */
export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}
