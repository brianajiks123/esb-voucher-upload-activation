const puppeteer = require('puppeteer');
const path = require('path');
const logger = require('../utils/logger');

let browser = null;
let page = null;

function isBrowserAlive() {
  try {
    return browser !== null && browser.process() !== null && browser.isConnected();
  } catch (_) {
    return false;
  }
}

async function clearBrowserHistory() {
  try {
    const targets = browser.targets().filter((t) => t.type() === 'page');
    for (const target of targets) {
      const client = await target.createCDPSession();
      await client.send('Network.clearBrowserCache');
      await client.send('Network.clearBrowserCookies');
      await client.send('Storage.clearDataForOrigin', { origin: '*', storageTypes: 'all' });
      await client.detach();
    }
    logger.info('Browser history & cache cleared');
  } catch (err) {
    logger.warn(`Failed to clear browser history: ${err.message}`);
  }
}

async function closeAllTabs() {
  try {
    const pages = await browser.pages();
    const tabsToClose = pages.slice(0, -1);
    for (const p of tabsToClose) await p.close();
    if (tabsToClose.length > 0) logger.info(`Closed ${tabsToClose.length} active tab(s), kept 1 alive`);
  } catch (err) {
    logger.warn(`Failed to close tabs: ${err.message}`);
  }
}

async function forceCloseBrowser() {
  try {
    if (browser) await browser.close();
  } catch (_) {
    try {
      const proc = browser.process();
      if (proc) proc.kill('SIGKILL');
    } catch (_) {}
  } finally {
    browser = null;
    page = null;
  }
}

async function launch(pageUrl) {
  const userDataDir = path.resolve(__dirname, '../../UserData');

  if (browser && !isBrowserAlive()) {
    logger.warn('Browser tidak responsif, melakukan restart...');
    await forceCloseBrowser();
  }

  if (!browser) {
    const headless = process.env.SHOW_BROWSER === 'true' ? false : 'shell';
    browser = await puppeteer.launch({
      headless,
      userDataDir,
      args: ['--start-maximized'],
      defaultViewport: null,
    });
    logger.info('Browser launched');
  }

  await clearBrowserHistory();
  await closeAllTabs();

  const pages = await browser.pages();
  page = pages[pages.length - 1];

  await page.goto(pageUrl, { waitUntil: 'networkidle2' });
  logger.info(`Navigated to ${pageUrl}`);
}

async function close() {
  if (browser) {
    await clearBrowserHistory();
    await forceCloseBrowser();
    logger.debug('Browser closed');
  }
}

function getPage() {
  if (!page) throw new Error('Browser belum diinisialisasi. Panggil launch() terlebih dahulu.');
  return page;
}

module.exports = { launch, close, getPage };
