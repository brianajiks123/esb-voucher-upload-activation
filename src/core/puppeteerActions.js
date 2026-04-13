const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getPage } = require('./browser');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// ─── Wait Helpers ─────────────────────────────────────────────────────────────

async function waitForElement(selector, timeout = 10000, interval = 1000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    const found = await getPage().evaluate((sel) => !!document.querySelector(sel), selector);
    if (found) return true;
    await delay(interval);
    elapsed += interval;
  }
  throw new Error(`Element "${selector}" not found after ${timeout / 1000}s`);
}

async function waitForNavigation() {
  await getPage().waitForNavigation({ waitUntil: 'networkidle2' });
}

// ─── Click Actions ────────────────────────────────────────────────────────────

async function click(selector) {
  await waitForElement(selector);
  logger.debug(`Click: ${selector}`);
  await getPage().click(selector);
}

async function clickWithEvaluate(selector) {
  logger.debug(`Click (eval): ${selector}`);
  await getPage().evaluate((sel) => document.querySelector(sel).click(), selector);
}

// ─── Input Actions ────────────────────────────────────────────────────────────

async function typeInto(selector, text) {
  await waitForElement(selector);
  await getPage().focus(selector);
  await getPage().evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
  await getPage().type(selector, text);
  logger.debug(`Type into: ${selector}`);
}

async function uploadFile(filePath, selectorInput = "input[type='file']") {
  await waitForElement(selectorInput);
  const input = await getPage().$(selectorInput);
  if (!input) throw new Error(`Upload input not found: ${selectorInput}`);
  await input.uploadFile(filePath);
  logger.debug(`File uploaded: ${filePath}`);
}

// ─── Read Actions ─────────────────────────────────────────────────────────────

async function elementExists(selector) {
  return getPage().evaluate((sel) => !!document.querySelector(sel), selector);
}

async function getTextContent(selector) {
  return getPage().evaluate((sel) => document.querySelector(sel).innerText, selector);
}

// ─── Upload Process ───────────────────────────────────────────────────────────

async function waitForUploadProcess(selector, content, interval = 500, timeout = 10000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    const text = await getTextContent(selector);
    if (text.toLowerCase().includes('\t') && !text.toLowerCase().includes(content)) return text;
    await delay(interval);
    elapsed += interval;
  }
  throw new Error(`Upload process "${content}" not cleared after ${timeout / 1000}s`);
}

// ─── Error File Helpers ───────────────────────────────────────────────────────

async function downloadErrorFile(fallbackUrl = null) {
  const page = getPage();
  const downloadPath = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-err-'));

  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });

  const btnSelector = '.dataTables_scroll td.text-center a.upload-queue-download-btn[title="Download"]';
  const btnExists = await page.evaluate((sel) => !!document.querySelector(sel), btnSelector);

  if (btnExists) {
    logger.info('Downloading error file via table button...');
    await page.evaluate((sel) => document.querySelector(sel).click(), btnSelector);
  } else if (fallbackUrl) {
    logger.info(`Downloading error file via URL: ${fallbackUrl}`);
    await page.evaluate((url) => { window.location.href = url; }, fallbackUrl);
  } else {
    logger.warn('No download button or fallback URL found.');
    return null;
  }

  const filePath = await waitForDownloadedFile(downloadPath, 15000);
  logger.info(`Error file saved: ${filePath}`);
  return filePath;
}

async function waitForDownloadedFile(dir, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
    if (files.length > 0) return path.join(dir, files[0]);
    await delay(500);
  }
  throw new Error(`File not downloaded within ${timeout / 1000}s`);
}

async function parseErrorExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];

  let headerRowIdx = -1;
  let headers = [];
  sheet.eachRow((row, rowNumber) => {
    if (headerRowIdx !== -1) return;
    const values = row.values.slice(1).map((v) => String(v ?? '').trim().toLowerCase());
    if (values.some((v) => v.includes('voucher code'))) {
      headerRowIdx = rowNumber;
      headers = values;
    }
  });

  if (headerRowIdx === -1) {
    logger.warn('Error file format unrecognised — "Voucher Code" header not found.');
    return [];
  }

  logger.debug(`Error Excel headers: ${JSON.stringify(headers)}`);

  const colVoucherCode = headers.findIndex((h) => h.includes('voucher code'));
  const colBranch      = headers.findIndex((h) => h.includes('branch name') || (h.includes('branch') && !h.includes('can')));

  const errors = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    const vals = row.values.slice(1);

    let errorMessage = '';
    for (let i = vals.length - 1; i >= 0; i--) {
      const v = String(vals[i] ?? '').trim();
      if (v) { errorMessage = v; break; }
    }

    if (!errorMessage) return;
    errors.push({
      row: rowNumber,
      voucherCode:   String(vals[colVoucherCode] ?? '').trim(),
      branchName:    String(vals[colBranch]      ?? '').trim(),
      errorMessages: errorMessage.split(/[,;]\s*/).map((e) => e.trim()).filter(Boolean),
    });
  });

  return errors;
}

// ─── Rate Limit Helpers ───────────────────────────────────────────────────────

const VOUCHER_FILTER_SELECTOR = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';
const RATE_LIMIT_CONTAINER    = 'div.error-message';
const RATE_LIMIT_BUTTON       = 'div.error-message button[onclick="location.reload();"]';

async function isRateLimited() {
  const page = getPage();
  return page.evaluate((containerSel) => {
    const el = document.querySelector(containerSel);
    if (!el) return false;
    const h1 = el.querySelector('h1');
    return h1 ? h1.innerText.toLowerCase().includes('rate limit') : false;
  }, RATE_LIMIT_CONTAINER);
}

async function refreshAndWaitForVoucherPage(timeoutMs = 20000) {
  const page = getPage();
  logger.warn('Rate limit detected — clicking "Refresh Page" button...');
  try {
    const btnExists = await page.evaluate((sel) => !!document.querySelector(sel), RATE_LIMIT_BUTTON);
    if (btnExists) {
      logger.info('Clicking rate-limit "Refresh Page" button...');
      await page.evaluate((sel) => document.querySelector(sel).click(), RATE_LIMIT_BUTTON);
    } else {
      logger.warn('"Refresh Page" button not found — falling back to page.reload()');
      await page.reload({ waitUntil: 'networkidle2', timeout: timeoutMs });
    }

    await delay(2000);

    const hasLoginForm = await page.evaluate(() => !!document.querySelector('#loginform-username'));
    if (hasLoginForm) {
      logger.warn('Redirected to login after refresh — session expired.');
      return false;
    }

    await waitForElement(VOUCHER_FILTER_SELECTOR, timeoutMs);
    logger.info('Voucher page recovered after rate-limit refresh.');
    return true;
  } catch (err) {
    logger.error(`Failed to recover after rate-limit refresh: ${err.message}`);
    return false;
  }
}

// ─── Voucher Check ────────────────────────────────────────────────────────────

async function checkVoucherByCode(voucherCode) {
  const page = getPage();
  const filterInput = VOUCHER_FILTER_SELECTOR;
  const MAX_POLLS = 10;
  const RATE_LIMIT_CHECK_AFTER = 3;

  let polls = 0;
  while (true) {
    const found = await page.evaluate((sel) => !!document.querySelector(sel), filterInput);
    if (found) break;

    polls++;

    if (polls >= RATE_LIMIT_CHECK_AFTER) {
      const rateLimited = await isRateLimited();
      if (rateLimited) {
        const err = new Error(`Element "${filterInput}" not found after ${polls}s — rate limit detected`);
        err.isRateLimit = true;
        throw err;
      }
    }

    if (polls >= MAX_POLLS) {
      throw new Error(`Element "${filterInput}" not found after ${MAX_POLLS}s`);
    }

    await delay(1000);
  }

  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');

  for (let i = 0; i < 3; i++) {
    await delay(500);
    const rateLimited = await isRateLimited();
    if (rateLimited) {
      const err = new Error('Rate limit detected while waiting for table after filter');
      err.isRateLimit = true;
      throw err;
    }
  }

  return page.evaluate((code) => {
    const row = document.querySelector(
      `#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`
    );
    if (!row) return null;
    const td = (seq) => row.querySelector(`td[data-col-seq="${seq}"]`)?.innerText?.trim() || '-';
    return {
      voucherCode:       code,
      branch:            td('3'),
      startDate:         td('4'),
      endDate:           td('5'),
      minSalesAmount:    td('7'),
      voucherAmount:     td('8'),
      voucherSalesPrice: td('9'),
      additionalInfo:    td('10'),
      status:            td('11'),
    };
  }, voucherCode);
}

// ─── Voucher Extend ───────────────────────────────────────────────────────────

async function extendVoucherExpiry(voucherCode, newEndDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

  const rowData = await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    if (!row) return null;
    return { status: row.querySelector('td[data-col-seq="11"]')?.innerText?.trim() || 'unknown' };
  }, voucherCode);

  if (!rowData) return { found: false, buttonAvailable: false, status: null, success: false };

  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  const btnUpdateExists = await elementExists('a#btnUpdate[href="/voucher/update-voucher-length"]');
  if (!btnUpdateExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  await clickWithEvaluate('a#btnUpdate[href="/voucher/update-voucher-length"]');
  await delay(1000);

  const dateInput = '#msvoucher-voucherenddateupdate-disp';
  await waitForElement(dateInput);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, dateInput, newEndDate);
  await delay(500);

  await waitForElement('a#btnUpdateModal');
  await clickWithEvaluate('a#btnUpdateModal');

  await waitForNavigation().catch(() => {});
  await waitForElement(filterInput, 15000);
  await delay(500);

  logger.info(`Voucher ${voucherCode} extended → ${newEndDate}`);
  return { found: true, buttonAvailable: true, status: rowData.status, success: true };
}

// ─── Voucher Delete ───────────────────────────────────────────────────────────

async function deleteVoucher(voucherCode, deletionDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

  const rowData = await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    if (!row) return null;
    return { status: row.querySelector('td[data-col-seq="11"]')?.innerText?.trim() || 'unknown' };
  }, voucherCode);

  if (!rowData) return { found: false, buttonAvailable: false, status: null, success: false };

  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  const btnDeleteExists = await elementExists('a#btnDelete');
  if (!btnDeleteExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  await waitForElement('a#btnDelete');
  await clickWithEvaluate('a#btnDelete');
  await waitForElement('#myModalActivate', 10000);
  await delay(1000);

  const purposeCoords = await page.evaluate(() => {
    const sel = document.querySelector('#myModalActivate #w4 span.select2-selection--single');
    if (!sel) return null;
    const r = sel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!purposeCoords) throw new Error('Select2 Purpose trigger not found in modal #w4');

  await page.mouse.click(purposeCoords.x, purposeCoords.y);
  await delay(800);

  await waitForElement('span.select2-container--open', 5000);
  const searchField = 'span.select2-container--open span.select2-search--dropdown input.select2-search__field';
  await waitForElement(searchField, 3000);

  await page.type(searchField, 'voucher');
  await delay(500);
  await page.keyboard.press('Enter');
  await delay(800);

  const dateInput = '#myModalActivate #msvoucher-voucherstartdateactivate-disp';
  await waitForElement(dateInput, 5000);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = '';
    el.value = val;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }, dateInput, deletionDate);
  await delay(500);

  const fields = await page.evaluate((dateSel) => {
    const purposeEl = document.querySelector('#myModalActivate span#select2-purposeIDHead-container');
    const dateEl    = document.querySelector(dateSel);
    return {
      purpose: purposeEl?.textContent.trim() || '',
      date:    dateEl?.value.trim() || '',
    };
  }, dateInput);

  logger.info(`Delete modal — Purpose: "${fields.purpose}" | Date: "${fields.date}"`);

  if (!fields.purpose || fields.purpose === '- Select Purpose -')
    throw new Error(`Purpose belum terpilih: "${fields.purpose}"`);
  if (!fields.date)
    throw new Error('Journal Date belum terisi.');

  await page.evaluate(() => document.querySelector('#myModalActivate .panel-body')?.click());
  await delay(400);

  const btnProcess = '#myModalActivate .panel-footer .pull-right a#btnSaveModal';
  await waitForElement(btnProcess, 5000);
  const btnCoords = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, btnProcess);
  if (!btnCoords) throw new Error('Tombol Process tidak ditemukan.');

  await page.mouse.click(btnCoords.x, btnCoords.y);

  await waitForNavigation().catch(() => {});
  await delay(500);
  await page.waitForSelector(filterInput, { timeout: 15000 });
  await delay(500);

  logger.info(`Voucher ${voucherCode} deleted | date: ${deletionDate}`);
  return { found: true, buttonAvailable: true, status: rowData.status, success: true };
}

// ─── Voucher Activate by Code ─────────────────────────────────────────────────

async function activateVoucherByCode(voucherCode, purpose, activationDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

  const rowData = await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    if (!row) return null;
    return { status: row.querySelector('td[data-col-seq="11"]')?.innerText?.trim() || 'unknown' };
  }, voucherCode);

  if (!rowData) return { found: false, buttonAvailable: false, status: null, success: false };

  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  const btnActivateExists = await elementExists('a#btnActivate');
  if (!btnActivateExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  await clickWithEvaluate('a#btnActivate');
  await waitForElement('#myModalActivate', 10000);
  await delay(1000);

  const purposeCoords = await page.evaluate(() => {
    const sel = document.querySelector('#myModalActivate #w4 span.select2-selection--single');
    if (!sel) return null;
    const r = sel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!purposeCoords) throw new Error('Select2 Purpose trigger not found in modal #w4');

  await page.mouse.click(purposeCoords.x, purposeCoords.y);
  await delay(800);

  await waitForElement('span.select2-container--open', 5000);
  const searchField = 'span.select2-container--open span.select2-search--dropdown input.select2-search__field';
  await waitForElement(searchField, 3000);

  await page.type(searchField, purpose);
  await delay(500);
  await page.keyboard.press('Enter');
  await delay(800);

  const dateInput = '#myModalActivate #msvoucher-voucherstartdateactivate-disp';
  await waitForElement(dateInput, 5000);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = '';
    el.value = val;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }, dateInput, activationDate);
  await delay(500);

  const fields = await page.evaluate((dateSel) => {
    const purposeEl = document.querySelector('#myModalActivate span#select2-purposeIDHead-container');
    const dateEl    = document.querySelector(dateSel);
    return {
      purpose: purposeEl?.textContent.trim() || '',
      date:    dateEl?.value.trim() || '',
    };
  }, dateInput);

  logger.info(`Activate modal — Purpose: "${fields.purpose}" | Date: "${fields.date}"`);

  if (!fields.purpose || fields.purpose === '- Select Purpose -')
    throw new Error(`Purpose belum terpilih: "${fields.purpose}"`);
  if (!fields.date)
    throw new Error('Date to Activate belum terisi.');

  await page.evaluate(() => document.querySelector('#myModalActivate .panel-body')?.click());
  await delay(400);

  const btnProcess = '#myModalActivate .panel-footer .pull-right a#btnSaveModal';
  await waitForElement(btnProcess, 5000);
  const btnCoords = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, btnProcess);
  if (!btnCoords) throw new Error('Tombol Save tidak ditemukan.');

  await page.mouse.click(btnCoords.x, btnCoords.y);

  await waitForNavigation().catch(() => {});
  await waitForElement(filterInput, 15000);
  await delay(500);

  logger.info(`Voucher ${voucherCode} activated | purpose: ${purpose} | date: ${activationDate}`);
  return { found: true, buttonAvailable: true, status: rowData.status, success: true };
}

module.exports = {
  waitForElement, waitForNavigation, click, clickWithEvaluate,
  typeInto, uploadFile, elementExists, getTextContent,
  waitForUploadProcess, downloadErrorFile, parseErrorExcel,
  checkVoucherByCode, extendVoucherExpiry, deleteVoucher, activateVoucherByCode,
  isRateLimited, refreshAndWaitForVoucherPage,
};
