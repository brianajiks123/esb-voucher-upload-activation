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
  logger.debug(`Clicking: ${selector}`);
  await getPage().click(selector);
}

async function clickWithEvaluate(selector) {
  logger.debug(`Clicking via evaluate: ${selector}`);
  await getPage().evaluate((sel) => document.querySelector(sel).click(), selector);
}

// ─── Input Actions ────────────────────────────────────────────────────────────

async function typeInto(selector, text) {
  await waitForElement(selector);
  await getPage().focus(selector);
  await getPage().evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
  await getPage().type(selector, text);
  logger.debug(`Typed into ${selector}`);
}

async function uploadFile(filePath, selectorInput = "input[type='file']") {
  await waitForElement(selectorInput);
  const input = await getPage().$(selectorInput);
  if (!input) throw new Error(`Upload input not found: ${selectorInput}`);
  await input.uploadFile(filePath);
  logger.debug(`Uploaded file "${filePath}" to ${selectorInput}`);
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
    if (text.toLowerCase().includes('\t') && !text.toLowerCase().includes(content)) {
      return text;
    }
    await delay(interval);
    elapsed += interval;
  }
  throw new Error(`Upload process content "${content}" not found after ${timeout / 1000}s`);
}

// ─── Error File Helpers ───────────────────────────────────────────────────────

/**
 * Download error Excel file from the upload queue table.
 * Tries the download button first; falls back to a direct URL if provided.
 * Returns the local file path of the downloaded file.
 */
async function downloadErrorFile(fallbackUrl = null) {
  const page = getPage();
  const downloadPath = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-err-'));

  // Configure Puppeteer CDP to save downloads to temp dir
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });

  let downloaded = false;

  // Try clicking the download button inside the upload queue table
  const btnSelector = '.dataTables_scroll td.text-center a.upload-queue-download-btn[title="Download"]';
  const btnExists = await page.evaluate((sel) => !!document.querySelector(sel), btnSelector);

  if (btnExists) {
    logger.info('Mengunduh file error via tombol Download di tabel...');
    await page.evaluate((sel) => document.querySelector(sel).click(), btnSelector);
    downloaded = true;
  } else if (fallbackUrl) {
    logger.info(`Mengunduh file error via URL: ${fallbackUrl}`);
    await page.evaluate((url) => { window.location.href = url; }, fallbackUrl);
    downloaded = true;
  }

  if (!downloaded) {
    logger.warn('Tombol download tidak ditemukan dan tidak ada fallback URL.');
    return null;
  }

  // Wait for file to appear in download folder (max 15s)
  const filePath = await waitForDownloadedFile(downloadPath, 15000);
  logger.info(`File error berhasil diunduh: ${filePath}`);
  return filePath;
}

/**
 * Poll download folder until a file appears, then return its full path.
 */
async function waitForDownloadedFile(dir, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
    if (files.length > 0) return path.join(dir, files[0]);
    await delay(500);
  }
  throw new Error(`File error tidak berhasil diunduh dalam ${timeout / 1000}s`);
}

/**
 * Parse the downloaded error Excel file and extract row-level error messages.
 * File format (row 4 = header):
 *   # | Voucher Code | Branch Name | Voucher Amount | Start Date | End Date | Additional Information | <error message>
 * The error message lives in the column AFTER "Additional Information" (indicated by red arrow in screenshot).
 * Returns array of { row, voucherCode, branchName, additionalInfo, errorMessage }
 */
async function parseErrorExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];

  // Find header row (contains "Voucher Code")
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
    logger.warn('Format file error tidak dikenali — header "Voucher Code" tidak ditemukan.');
    return [];
  }

  const colVoucherCode = headers.findIndex((h) => h.includes('voucher code'));
  const colBranch      = headers.findIndex((h) => h.includes('branch'));
  const colAdditional  = headers.findIndex((h) => h.includes('additional'));
  // Error message is in the column right after "Additional Information"
  const colErrorMsg    = colAdditional + 1;

  const errors = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    const vals = row.values.slice(1);

    // A row is an error row if it has an error message in the column after Additional Information
    const errorMessage = String(vals[colErrorMsg] ?? '').trim();
    if (!errorMessage) return;

    errors.push({
      row: rowNumber,
      voucherCode:    String(vals[colVoucherCode] ?? '').trim(),
      branchName:     String(vals[colBranch]      ?? '').trim(),
      additionalInfo: String(vals[colAdditional]  ?? '').trim(),
      // Split multiple errors separated by comma+space or just comma
      errorMessages: errorMessage.split(/,\s*/).map((e) => e.trim()).filter(Boolean),
    });
  });

  return errors;
}

module.exports = {
  waitForElement,
  waitForNavigation,
  click,
  clickWithEvaluate,
  typeInto,
  uploadFile,
  elementExists,
  getTextContent,
  waitForUploadProcess,
  downloadErrorFile,
  parseErrorExcel,
};
