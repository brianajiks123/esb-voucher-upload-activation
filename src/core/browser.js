const puppeteer = require('puppeteer');
const path = require('path');
const logger = require('../utils/logger');

let browser = null;
let page = null;

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
 * Close all active tabs
 */
async function closeAllTabs() {
  try {
    const pages = await browser.pages();
    for (const p of pages) {
      await p.close();
    }
    logger.info(`Closed ${pages.length} active tab(s)`);
  } catch (err) {
    logger.warn(`Failed to close tabs: ${err.message}`);
  }
}

/**
 * Open browser & navigate to URL
 * - Clears history first
 * - Closes all previously active tabs
 */
async function launch(pageUrl) {
  const userDataDir = path.resolve(__dirname, '../../UserData');

  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      args: ['--start-maximized'],
      defaultViewport: null,
    });
    logger.info('Browser launched');
  }

  // Clear history & close all existing tabs before starting
  await clearBrowserHistory();
  await closeAllTabs();

  page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'networkidle2' });
  logger.info(`Navigated to ${pageUrl}`);
}

/**
 * Close browser — clear history & close all tabs first
 */
async function close() {
  if (browser) {
    await clearBrowserHistory();
    await closeAllTabs();
    await browser.close();
    browser = null;
    page = null;
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
