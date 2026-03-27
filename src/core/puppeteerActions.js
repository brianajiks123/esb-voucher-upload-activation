const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getPage } = require('./browser');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// ─── Wait Helpers ─────────────────────────────────────────────────────────────

/**
 * Poll for a DOM element until it appears or timeout is reached.
 */
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

/** Wait for page navigation to complete (networkidle2) */
async function waitForNavigation() {
  await getPage().waitForNavigation({ waitUntil: 'networkidle2' });
}

// ─── Click Actions ────────────────────────────────────────────────────────────

/** Wait for element then click it */
async function click(selector) {
  await waitForElement(selector);
  logger.debug(`Click: ${selector}`);
  await getPage().click(selector);
}

/**
 * Click via page.evaluate — use when native click is blocked by overlapping elements.
 */
async function clickWithEvaluate(selector) {
  logger.debug(`Click (eval): ${selector}`);
  await getPage().evaluate((sel) => document.querySelector(sel).click(), selector);
}

// ─── Input Actions ────────────────────────────────────────────────────────────

/** Clear and type text into an input field */
async function typeInto(selector, text) {
  await waitForElement(selector);
  await getPage().focus(selector);
  await getPage().evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
  await getPage().type(selector, text);
  logger.debug(`Type into: ${selector}`);
}

/** Set a file on a file input element */
async function uploadFile(filePath, selectorInput = "input[type='file']") {
  await waitForElement(selectorInput);
  const input = await getPage().$(selectorInput);
  if (!input) throw new Error(`Upload input not found: ${selectorInput}`);
  await input.uploadFile(filePath);
  logger.debug(`File uploaded: ${filePath}`);
}

// ─── Read Actions ─────────────────────────────────────────────────────────────

/** Returns true if the selector exists in the DOM */
async function elementExists(selector) {
  return getPage().evaluate((sel) => !!document.querySelector(sel), selector);
}

/** Returns innerText of the first matching element */
async function getTextContent(selector) {
  return getPage().evaluate((sel) => document.querySelector(sel).innerText, selector);
}

// ─── Upload Process ───────────────────────────────────────────────────────────

/**
 * Poll upload queue row until status clears "process", then return final row text.
 */
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

/**
 * Download ESB error Excel after a failed upload.
 * Tries the table download button first; falls back to fallbackUrl if provided.
 */
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

/** Poll directory until a complete (non-.crdownload) file appears */
async function waitForDownloadedFile(dir, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
    if (files.length > 0) return path.join(dir, files[0]);
    await delay(500);
  }
  throw new Error(`File not downloaded within ${timeout / 1000}s`);
}

/**
 * Parse ESB error Excel file.
 * Finds the header row by locating "Voucher Code" column.
 * Error message is always in the last cell of each data row (column K — no header).
 */
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

    // Error message is always the last non-empty cell in the row
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

// ─── Voucher Check ────────────────────────────────────────────────────────────

/**
 * Search voucher by code via table filter input.
 */
async function checkVoucherByCode(voucherCode) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

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

/**
 * Extend voucher expiry date.
 * Flow: search → verify exists → check checkbox → check btnUpdate → fill date → confirm
 */
async function extendVoucherExpiry(voucherCode, newEndDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

  // Step 1: verify voucher exists in table
  const rowData = await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    if (!row) return null;
    return { status: row.querySelector('td[data-col-seq="11"]')?.innerText?.trim() || 'unknown' };
  }, voucherCode);

  if (!rowData) return { found: false, buttonAvailable: false, status: null, success: false };

  // Step 2: check the row checkbox
  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  // Step 3: check if Update button is available (only shown for eligible statuses)
  const btnUpdateExists = await elementExists('a#btnUpdate[href="/voucher/update-voucher-length"]');
  if (!btnUpdateExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  // Step 4: click Update → fill new end date → confirm
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

  // Wait for page reload after update, then wait for voucher table to be ready
  await waitForNavigation().catch(() => {});
  await waitForElement(filterInput, 15000);
  await delay(500);

  logger.info(`Voucher ${voucherCode} extended → ${newEndDate}`);
  return { found: true, buttonAvailable: true, status: rowData.status, success: true };
}

// ─── Voucher Delete ───────────────────────────────────────────────────────────

/**
 * Delete a voucher.
 * Flow: search → verify exists → check checkbox → check btnDelete → fill modal (Purpose + Journal Date) → Process
 */
async function deleteVoucher(voucherCode, deletionDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  // Step 1: search and verify voucher exists
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

  // Step 2: check the row checkbox
  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  // Step 3: check if Delete button is available (only shown for eligible statuses)
  const btnDeleteExists = await elementExists('a#btnDelete');
  if (!btnDeleteExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  // Step 4: click Delete → fill modal → Process
  await waitForElement('a#btnDelete');
  await clickWithEvaluate('a#btnDelete');
  await waitForElement('#myModalActivate', 10000);
  await delay(1000);

  // Open Select2 Purpose dropdown via native mouse click (Select2 requires mousedown)
  // Multiple elements share the same id, so scope to modal form #w4
  const purposeCoords = await page.evaluate(() => {
    const sel = document.querySelector('#myModalActivate #w4 span.select2-selection--single');
    if (!sel) return null;
    const r = sel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!purposeCoords) throw new Error('Select2 Purpose trigger not found in modal #w4');

  await page.mouse.click(purposeCoords.x, purposeCoords.y);
  await delay(800);

  // Dropdown renders at body level as span.select2-container--open
  await waitForElement('span.select2-container--open', 5000);
  const searchField = 'span.select2-container--open span.select2-search--dropdown input.select2-search__field';
  await waitForElement(searchField, 3000);

  // Type "voucher" then Enter to select the VOUCHER option
  await page.type(searchField, 'voucher');
  await delay(500);
  await page.keyboard.press('Enter');
  await delay(800);

  // Fill Journal Date input (krajee datepicker, format DD-MM-YYYY)
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

  // Verify both fields are filled before submitting
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

  // Click outside fields to dismiss any open picker
  await page.evaluate(() => document.querySelector('#myModalActivate .panel-body')?.click());
  await delay(400);

  // Click Process button via native mouse click
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

  // Wait for page reload after delete, then wait for voucher table to be ready
  await waitForNavigation().catch(() => {});
  await waitForElement(filterInput, 15000);
  await delay(500);

  logger.info(`Voucher ${voucherCode} deleted | date: ${deletionDate}`);
  return { found: true, buttonAvailable: true, status: rowData.status, success: true };
}

// ─── Voucher Activate by Code ─────────────────────────────────────────────────

/**
 * Activate a single voucher by code via the ESB ERP table.
 * Flow: search → verify exists → check checkbox → click Activate → fill Purpose + Date → Save
 * Returns { found, status, buttonAvailable, success }
 */
async function activateVoucherByCode(voucherCode, purpose, activationDate) {
  const page = getPage();
  const filterInput = '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]';

  await waitForElement(filterInput);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, filterInput);
  await page.type(filterInput, voucherCode);
  await page.keyboard.press('Enter');
  await delay(1500);

  // Step 1: verify voucher exists and get status
  const rowData = await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    if (!row) return null;
    return { status: row.querySelector('td[data-col-seq="11"]')?.innerText?.trim() || 'unknown' };
  }, voucherCode);

  if (!rowData) return { found: false, buttonAvailable: false, status: null, success: false };

  // Step 2: check the row checkbox
  await page.evaluate((code) => {
    const row = document.querySelector(`#grid-voucher-container table.kv-grid-table tbody tr[data-key="${code}"]`);
    const cb = row?.querySelector('td[data-col-seq="12"] input[type="checkbox"].kv-row-checkbox');
    if (cb && !cb.checked) cb.click();
  }, voucherCode);
  await delay(500);

  // Step 3: check if Activate button is available
  const btnActivateExists = await elementExists('a#btnActivate');
  if (!btnActivateExists) {
    return { found: true, buttonAvailable: false, status: rowData.status, success: false };
  }

  // Step 4: click Activate button → wait for modal
  await clickWithEvaluate('a#btnActivate');
  await waitForElement('#myModalActivate', 10000);
  await delay(1000);

  // Step 5: open Select2 Purpose dropdown via native mouse click
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

  // Type the purpose keyword and press Enter to select
  await page.type(searchField, purpose);
  await delay(500);
  await page.keyboard.press('Enter');
  await delay(800);

  // Step 6: fill Date to Activate (krajee datepicker, format DD-MM-YYYY)
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

  // Verify both fields are filled before submitting
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

  // Click outside to dismiss any open picker
  await page.evaluate(() => document.querySelector('#myModalActivate .panel-body')?.click());
  await delay(400);

  // Step 7: click Save button via native mouse click
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

  // Wait for page reload after activation
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
};
