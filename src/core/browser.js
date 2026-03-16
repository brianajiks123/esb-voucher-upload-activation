const puppeteer = require('puppeteer');
const path = require('path');
const logger = require('../utils/logger');

let browser = null;
let page = null;

/**
 * Check if browser process is still alive and connected
 */
function isBrowserAlive() {
  try {
    return browser !== null && browser.process() !== null && browser.isConnected();
  } catch (_) {
    return false;
  }
}

/**
 * Clear browser history & cache via Chrome DevTools Protocol
 */
async function clearBrowserHistory() {
  try {
    const targets = browser.targets().filter((t) => t.type() === 'page');
    for (const target of targets) {
      const client = await target.createCDPSession();
      await client.send('Network.clearBrowserCache');
      await client.send('Network.clearBrowserCookies');
      await client.send('Storage.clearDataForOrigin', {
        origin: '*',
        storageTypes: 'all',
      });
      await client.detach();
    }
    logger.info('Browser history & cache cleared');
  } catch (err) {
    logger.warn(`Failed to clear browser history: ${err.message}`);
  }
}

/**
 * Close all active tabs except one (keep at least 1 to avoid unstable state)
 */
async function closeAllTabs() {
  try {
    const pages = await browser.pages();
    // Keep the last tab alive — closing ALL tabs can crash Chrome
    const tabsToClose = pages.slice(0, -1);
    for (const p of tabsToClose) {
      await p.close();
    }
    if (tabsToClose.length > 0) {
      logger.info(`Closed ${tabsToClose.length} active tab(s), kept 1 alive`);
    }
  } catch (err) {
    logger.warn(`Failed to close tabs: ${err.message}`);
  }
}

/**
 * Force kill browser and reset state
 */
async function forceCloseBrowser() {
  try {
    if (browser) {
      await browser.close();
    }
  } catch (_) {
    // Force kill the process if close() fails
    try {
      const proc = browser.process();
      if (proc) proc.kill('SIGKILL');
    } catch (_) {}
  } finally {
    browser = null;
    page = null;
  }
}

/**
 * Open browser & navigate to URL
 * - Validates browser health before reuse
 * - Restarts browser if dead/disconnected
 * - Clears history first, closes extra tabs
 */
async function launch(pageUrl) {
  const userDataDir = path.resolve(__dirname, '../../UserData');

  // If browser exists but is dead/disconnected, force close and restart
  if (browser && !isBrowserAlive()) {
    logger.warn('Browser tidak responsif, melakukan restart...');
    await forceCloseBrowser();
  }

  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      args: ['--start-maximized'],
      defaultViewport: null,
    });
    logger.info('Browser launched');
  }

  // Clear history & close extra tabs (keep 1 alive)
  await clearBrowserHistory();
  await closeAllTabs();

  // Reuse the surviving tab instead of creating a new one
  const pages = await browser.pages();
  page = pages[pages.length - 1];

  await page.goto(pageUrl, { waitUntil: 'networkidle2' });
  logger.info(`Navigated to ${pageUrl}`);
}

/**
 * Close browser — clear history first, then force close
 */
async function close() {
  if (browser) {
    await clearBrowserHistory();
    await forceCloseBrowser();
    logger.debug('Browser closed');
  }
}

/**
 * Get active page instance
 */
function getPage() {
  if (!page) throw new Error('Browser belum diinisialisasi. Panggil launch() terlebih dahulu.');
  return page;
}

module.exports = { launch, close, getPage };
