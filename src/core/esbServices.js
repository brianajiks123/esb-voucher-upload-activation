const { launch, close } = require('./browser');
const {
  click, clickWithEvaluate, typeInto, uploadFile, elementExists, getTextContent,
  waitForUploadProcess, waitForNavigation, downloadErrorFile, parseErrorExcel,
  checkVoucherByCode, extendVoucherExpiry, deleteVoucher, activateVoucherByCode,
  refreshAndWaitForVoucherPage,
} = require('./puppeteerActions');
const { delay } = require('../utils/delay');
const logger = require('../utils/logger');

const ESB_BASE_URL = process.env.ESB_BASE_URL || '';

const UPLOAD_MODES = {
  CREATE:   { codeMode: 1, uploadEl: '#fileUpload',      buttonUpload: '#btnSubmitUpload'   },
  ACTIVATE: { codeMode: 3, uploadEl: '#voucherActivate', buttonUpload: '#btnSubmitActivate' },
};

async function checkLoginStatus() {
  logger.info('Checking login status...');
  await launch(`${ESB_BASE_URL}/voucher`);
  return elementExists("a[href='/site/logout']");
}

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

    const isConfirmation = /sure|continue|lanjut|konfirmasi/i.test(alertText);
    if (isConfirmation) {
      logger.info(`Login confirmation dialog: "${alertText}" — confirming...`);
      await click('.swal2-confirm.swal2-styled');
      await waitForNavigation();
    } else {
      const message = alertText || 'Login gagal: username atau password salah.';
      await click('.swal2-confirm.swal2-styled');
      const err = new Error(message);
      err.isLoginError = true;
      throw err;
    }
  }
  const isLoggedIn = await elementExists("a[href='/site/logout']");
  if (!isLoggedIn) {
    const err = new Error('Login gagal: tidak dapat masuk ke halaman voucher. Periksa kredensial ESB.');
    err.isLoginError = true;
    throw err;
  }
  logger.info('Login successful.');
}

async function gotoVoucherMenu() {
  logger.info('Navigating to /voucher...');
  await click("a[href='/master/index']");
  await click("a[href='/voucher']");
}

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
  await delay(2000);

  const resultUpload = await waitForUploadProcess('#data-table-upload-queue > tbody > tr', 'process', 2000, 120000);
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

async function checkVoucherCodes(credentials, codes) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) {
    await loginAction(credentials);
    await gotoVoucherMenu();
  }
  await delay(1500);

  const results = [];
  const MAX_RATE_LIMIT_RETRIES = 3;

  for (let i = 0; i < codes.length; i++) {
    const trimmed = codes[i].trim();
    if (!trimmed) continue;

    let rateLimitRetries = 0;
    let success = false;

    while (!success && rateLimitRetries <= MAX_RATE_LIMIT_RETRIES) {
      try {
        logger.info(`Check voucher: ${trimmed}`);
        const data = await checkVoucherByCode(trimmed);
        results.push(data
          ? { voucherCode: trimmed, found: true, data }
          : { voucherCode: trimmed, found: false }
        );
        success = true;
      } catch (err) {
        if (err.isRateLimit) {
          rateLimitRetries++;
          logger.warn(`Rate limit on "${trimmed}" (attempt ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES}) — refreshing page...`);

          const recovered = await refreshAndWaitForVoucherPage();
          if (!recovered) {
            logger.info('Session expired after rate limit — re-logging in...');
            try {
              const { launch: launchBrowser } = require('./browser');
              await launchBrowser(`${process.env.ESB_BASE_URL || ''}/voucher`);
              const stillLoggedIn = await elementExists("a[href='/site/logout']");
              if (!stillLoggedIn) {
                await loginAction(credentials);
                await gotoVoucherMenu();
              }
              await delay(1500);
            } catch (loginErr) {
              logger.error(`Re-login failed: ${loginErr.message}`);
              results.push({ voucherCode: trimmed, found: false, error: `Rate limit + re-login gagal: ${loginErr.message}` });
              success = true;
            }
          }

          if (!success && rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
            logger.error(`Max rate limit retries reached for "${trimmed}"`);
            results.push({ voucherCode: trimmed, found: false, error: 'Rate limit: max retries exceeded' });
            success = true;
          }
        } else {
          logger.error(`Check voucher "${trimmed}" failed: ${err.message}`);
          results.push({ voucherCode: trimmed, found: false, error: err.message });
          success = true;
        }
      }
    }
  }

  try {
    const { getPage } = require('./browser');
    await getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();
  return results;
}

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

async function deleteVoucherCodes(credentials, codes, deletionDate) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) {
    await loginAction(credentials);
    await gotoVoucherMenu();
  }
  await delay(1500);

  const results = [];
  const MAX_RATE_LIMIT_RETRIES = 3;

  for (let i = 0; i < codes.length; i++) {
    const trimmed = codes[i].trim();
    if (!trimmed) continue;

    let rateLimitRetries = 0;
    let success = false;

    while (!success && rateLimitRetries <= MAX_RATE_LIMIT_RETRIES) {
      try {
        logger.info(`Delete voucher: ${trimmed} | date: ${deletionDate}`);
        const r = await deleteVoucher(trimmed, deletionDate);
        if (!r.found) {
          results.push({ voucherCode: trimmed, success: false, reason: 'not_found' });
        } else if (!r.buttonAvailable) {
          results.push({ voucherCode: trimmed, success: false, reason: 'button_unavailable', status: r.status });
        } else {
          results.push({ voucherCode: trimmed, success: true, message: 'Berhasil dihapus' });
        }
        success = true;
      } catch (err) {
        if (err.message && err.message.includes('Execution context was destroyed')) {
          logger.warn(`Delete ${trimmed}: context destroyed after navigation (voucher likely deleted successfully)`);
          results.push({ voucherCode: trimmed, success: true, message: 'Berhasil dihapus' });
          try {
            const { getPage } = require('./browser');
            await getPage().waitForSelector(
              '#grid-voucher-container thead tr#grid-voucher-filters input[name="MsVoucher[voucherID]"]',
              { timeout: 15000 }
            );
            await delay(2000);
          } catch (_) {}
          success = true;
        } else if (err.isRateLimit) {
          rateLimitRetries++;
          logger.warn(`Rate limit on delete "${trimmed}" (attempt ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES}) — refreshing page...`);

          const recovered = await refreshAndWaitForVoucherPage();
          if (!recovered) {
            logger.info('Session expired after rate limit (delete) — re-logging in...');
            try {
              const { launch: launchBrowser } = require('./browser');
              await launchBrowser(`${process.env.ESB_BASE_URL || ''}/voucher`);
              const stillLoggedIn = await elementExists("a[href='/site/logout']");
              if (!stillLoggedIn) {
                await loginAction(credentials);
                await gotoVoucherMenu();
              }
              await delay(1500);
            } catch (loginErr) {
              logger.error(`Re-login failed (delete): ${loginErr.message}`);
              results.push({ voucherCode: trimmed, success: false, reason: 'error', message: `Rate limit + re-login gagal: ${loginErr.message}` });
              success = true;
            }
          }

          if (!success && rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
            logger.error(`Max rate limit retries reached for delete "${trimmed}"`);
            results.push({ voucherCode: trimmed, success: false, reason: 'error', message: 'Rate limit: max retries exceeded' });
            success = true;
          }
        } else {
          logger.error(`Delete ${trimmed} failed: ${err.message}`);
          results.push({ voucherCode: trimmed, success: false, reason: 'error', message: err.message });
          success = true;
        }
      }
    }
  }

  try {
    const { getPage } = require('./browser');
    await getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();
  return results;
}

async function activateVoucherByCodes(credentials, codes, purpose, activationDate) {
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
    logger.info(`Activate voucher by code: ${trimmed}`);
    try {
      const data = await checkVoucherByCode(trimmed);
      if (!data) {
        results.push({ voucherCode: trimmed, success: false, reason: 'not_found' });
        continue;
      }

      const status = (data.status || '').toLowerCase().trim();
      if (status !== 'available') {
        results.push({ voucherCode: trimmed, success: false, reason: 'not_available', status: data.status });
        continue;
      }

      const r = await activateVoucherByCode(trimmed, purpose, activationDate);
      if (!r.found) {
        results.push({ voucherCode: trimmed, success: false, reason: 'not_found' });
      } else if (!r.buttonAvailable) {
        results.push({ voucherCode: trimmed, success: false, reason: 'button_unavailable', status: r.status });
      } else {
        results.push({ voucherCode: trimmed, success: true, message: 'Berhasil diaktivasi' });
      }
    } catch (err) {
      logger.error(`Activate ${trimmed} failed: ${err.message}`);
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
  uploadVoucherExcelFile, checkVoucherCodes, extendVoucherCodes, deleteVoucherCodes, activateVoucherByCodes,
};
