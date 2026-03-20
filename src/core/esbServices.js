/**
 * esbServices.js
 * High-level ESB ERP actions: login, navigation, upload, check, extend, delete.
 * Delegates DOM interactions to puppeteerActions.js.
 */

const { launch, close } = require('./browser');
const {
  click, clickWithEvaluate, typeInto, uploadFile, elementExists, getTextContent,
  waitForUploadProcess, waitForNavigation, downloadErrorFile, parseErrorExcel,
  checkVoucherByCode, extendVoucherExpiry, deleteVoucher,
} = require('./puppeteerActions');
const { delay } = require('../utils/delay');
const logger = require('../utils/logger');

const ESB_BASE_URL = process.env.ESB_BASE_URL || '';

/** Upload mode config: codeMode, file input selector, submit button selector */
const UPLOAD_MODES = {
  CREATE:   { codeMode: 1, uploadEl: '#fileUpload',      buttonUpload: '#btnSubmitUpload'   },
  ACTIVATE: { codeMode: 3, uploadEl: '#voucherActivate', buttonUpload: '#btnSubmitActivate' },
};

/**
 * Navigate to /voucher and check if already logged in (logout link present).
 */
async function checkLoginStatus() {
  logger.info('Checking login status...');
  await launch(`${ESB_BASE_URL}/voucher`);
  return elementExists("a[href='/site/logout']");
}

/**
 * Fill login form and submit.
 * - Confirmation dialog ("Are you sure"): confirm and wait for navigation.
 * - Error dialog (invalid credentials): throw with isLoginError = true.
 */
async function loginAction({ username, password }) {
  logger.info('Logging in...');
  await typeInto('#loginform-username', username);
  await typeInto('#loginform-password', password);
  await click('#btnLogin');
  await delay(2000);
  const hasAlert = await elementExists('.swal2-confirm.swal2-styled');
  if (hasAlert) {
    let alertText = '';
    try {
      const text = await getTextContent('.swal2-html-container');
      if (text && text.trim()) alertText = text.trim();
    } catch (_) {}

    // Confirmation dialog — click OK and wait for navigation
    const isConfirmation = /sure|continue|lanjut|konfirmasi/i.test(alertText);
    if (isConfirmation) {
      logger.info(`Login confirmation dialog: "${alertText}" — confirming...`);
      await click('.swal2-confirm.swal2-styled');
      await waitForNavigation();
    } else {
      // Error dialog — throw immediately
      const message = alertText || 'Login gagal: username atau password salah.';
      await click('.swal2-confirm.swal2-styled');
      const err = new Error(message);
      err.isLoginError = true;
      throw err;
    }
  }
  // Verify login succeeded by checking logout link presence
  const isLoggedIn = await elementExists("a[href='/site/logout']");
  if (!isLoggedIn) {
    const err = new Error('Login gagal: tidak dapat masuk ke halaman voucher. Periksa kredensial ESB.');
    err.isLoginError = true;
    throw err;
  }
  logger.info('Login successful.');
}

/** Navigate to /voucher via sidebar menu (Master → Voucher) */
async function gotoVoucherMenu() {
  logger.info('Navigating to /voucher...');
  await click("a[href='/master/index']");
  await click("a[href='/voucher']");
}

/**
 * Upload a voucher Excel file to ESB ERP.
 * Downloads and parses the error file if any rows fail.
 */
async function uploadVoucherExcelFile(filePath, mode) {
  if (!UPLOAD_MODES[mode]) throw new Error(`Invalid mode: ${mode}. Valid: CREATE, ACTIVATE`);
  const { codeMode, uploadEl, buttonUpload } = UPLOAD_MODES[mode];

  logger.info(`Uploading [${mode}]: ${filePath}`);
  await delay(1000);
  await click('button.btnUpload');
  await delay(1000);
  await clickWithEvaluate(`a[href='/voucher/#?mode=${codeMode}']`);
  await delay(1000);
  await uploadFile(filePath, uploadEl);
  await delay(1000);
  await clickWithEvaluate(buttonUpload);

  const resultUpload = await waitForUploadProcess('#data-table-upload-queue > tbody > tr', 'process', 2000);
  const hasFailed = resultUpload.toLowerCase().includes('failed') || resultUpload.toLowerCase().includes('error');

  let errorDetails = [];
  let errorFilePath = null;
  if (hasFailed) {
    logger.warn('Upload has failed rows — downloading error file...');
    try {
      errorFilePath = await downloadErrorFile();
      if (errorFilePath) {
        errorDetails = await parseErrorExcel(errorFilePath);
        errorDetails.forEach((e) => {
          logger.warn(`Row ${e.row} | ${e.voucherCode} | ${e.branchName}`);
          e.errorMessages.forEach((msg, i) => logger.warn(`  ${i + 1}. ${msg}`));
        });
      }
    } catch (dlErr) {
      logger.error(`Error file download failed: ${dlErr.message}`);
    }
  }

  await clickWithEvaluate('#close-upload-queue');

  if (hasFailed && errorDetails.length > 0) {
    const summary = errorDetails.map((e) => {
      const errList = e.errorMessages.map((msg, i) => `  ${i + 1}. ${msg}`).join('\n');
      return `Row ${e.row} [${e.voucherCode}]:\n${errList}`;
    }).join('\n\n');
    const err = new Error(`Upload errors:\n${summary}`);
    err.errorFilePath = errorFilePath;
    throw err;
  }

  return resultUpload;
}

/**
 * Check one or more voucher codes via table filter.
 */
async function checkVoucherCodes(credentials, codes) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) {
    await loginAction(credentials);
    await gotoVoucherMenu();
  }
  await delay(1500);

  const results = [];
  for (const code of codes) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    logger.info(`Check voucher: ${trimmed}`);
    const data = await checkVoucherByCode(trimmed);
    results.push(data ? { voucherCode: trimmed, found: true, data } : { voucherCode: trimmed, found: false });
  }

  try {
    const { getPage } = require('./browser');
    await getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();
  return results;
}

/**
 * Extend expiry date for one or more voucher codes.
 * extendVoucherExpiry returns { found, buttonAvailable, status, success } — no throw for business logic errors.
 */
async function extendVoucherCodes(credentials, codes, newEndDate) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) {
    await loginAction(credentials);
    await gotoVoucherMenu();
  }
  await delay(1500);

  const results = [];
  for (const code of codes) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    logger.info(`Extend voucher: ${trimmed} → ${newEndDate}`);
    try {
      const r = await extendVoucherExpiry(trimmed, newEndDate);
      if (!r.found) {
        results.push({ voucherCode: trimmed, success: false, reason: 'not_found' });
      } else if (!r.buttonAvailable) {
        results.push({ voucherCode: trimmed, success: false, reason: 'button_unavailable', status: r.status });
      } else {
        results.push({ voucherCode: trimmed, success: true, message: `Diperpanjang hingga ${newEndDate}` });
      }
    } catch (err) {
      logger.error(`Extend ${trimmed} failed: ${err.message}`);
      results.push({ voucherCode: trimmed, success: false, reason: 'error', message: err.message });
    }
  }

  try {
    const { getPage } = require('./browser');
    await getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();
  return results;
}

/**
 * Delete one or more vouchers by code.
 * deleteVoucher returns { found, buttonAvailable, status, success } — no throw for business logic errors.
 */
async function deleteVoucherCodes(credentials, codes, deletionDate) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) {
    await loginAction(credentials);
    await gotoVoucherMenu();
  }
  await delay(1500);

  const results = [];
  for (const code of codes) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    logger.info(`Delete voucher: ${trimmed} | date: ${deletionDate}`);
    try {
      const r = await deleteVoucher(trimmed, deletionDate);
      if (!r.found) {
        results.push({ voucherCode: trimmed, success: false, reason: 'not_found' });
      } else if (!r.buttonAvailable) {
        results.push({ voucherCode: trimmed, success: false, reason: 'button_unavailable', status: r.status });
      } else {
        results.push({ voucherCode: trimmed, success: true, message: 'Berhasil dihapus' });
      }
    } catch (err) {
      logger.error(`Delete ${trimmed} failed: ${err.message}`);
      results.push({ voucherCode: trimmed, success: false, reason: 'error', message: err.message });
    }
  }

  try {
    const { getPage } = require('./browser');
    await getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();
  return results;
}

module.exports = {
  checkLoginStatus, loginAction, gotoVoucherMenu,
  uploadVoucherExcelFile, checkVoucherCodes, extendVoucherCodes, deleteVoucherCodes,
};
