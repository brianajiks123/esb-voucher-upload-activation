const { launch, close } = require('./browser');
const { click, clickWithEvaluate, typeInto, uploadFile, elementExists, waitForUploadProcess, waitForNavigation, downloadErrorFile, parseErrorExcel, checkVoucherByCode } = require('./puppeteerActions');
const { delay } = require('../utils/delay');
const logger = require('../utils/logger');

const ESB_BASE_URL = process.env.ESB_BASE_URL || '';

const UPLOAD_MODES = {
  CREATE:   { codeMode: 1, uploadEl: '#fileUpload',      buttonUpload: '#btnSubmitUpload'   },
  ACTIVATE: { codeMode: 3, uploadEl: '#voucherActivate', buttonUpload: '#btnSubmitActivate' },
};

/**
 * Navigate to the login page and check whether the user is already authenticated.
 */
async function checkLoginStatus() {
  logger.info('Checking login status...');
  await launch(`${ESB_BASE_URL}/site/login`);
  return elementExists("a[href='/site/logout']");
}

/**
 * Fill in the login form and submit. Dismisses any SweetAlert2 error dialog if present.
 */
async function loginAction({ username, password }) {
  logger.info('Logging in to ESB...');
  await typeInto('#loginform-username', username);
  await typeInto('#loginform-password', password);
  await click('#btnLogin');
  await delay(2000);
  const hasAlert = await elementExists('.swal2-confirm.swal2-styled');
  if (hasAlert) {
    await click('.swal2-confirm.swal2-styled');
    await waitForNavigation();
  }
}

/**
 * Navigate to the voucher master page via the sidebar menu.
 */
async function gotoVoucherMenu() {
  logger.info('Navigating to voucher menu...');
  await click("a[href='/master/index']");
  await click("a[href='/voucher']");
}

/**
 * Upload a voucher Excel file using the given mode (CREATE or ACTIVATE).
 * If the upload result contains failed rows, downloads the error Excel file,
 * parses per-row error messages, and throws a detailed error.
 */
async function uploadVoucherExcelFile(filePath, mode) {
  if (!UPLOAD_MODES[mode]) throw new Error(`Invalid mode: ${mode}. Valid modes: CREATE, ACTIVATE`);
  const { codeMode, uploadEl, buttonUpload } = UPLOAD_MODES[mode];

  logger.info(`Uploading voucher file: ${filePath} (mode: ${mode})`);
  await delay(1000);
  await click('button.btnUpload');
  await delay(1000);
  await clickWithEvaluate(`a[href='/voucher/#?mode=${codeMode}']`);
  await delay(1000);
  await uploadFile(filePath, uploadEl);
  await delay(1000);
  await clickWithEvaluate(buttonUpload);

  const resultUpload = await waitForUploadProcess(
    '#data-table-upload-queue > tbody > tr',
    'process',
    2000
  );

  // Check whether any rows failed
  const hasFailed = resultUpload.toLowerCase().includes('failed') ||
                    resultUpload.toLowerCase().includes('error');

  let errorDetails = [];
  if (hasFailed) {
    logger.warn('Upload contains failed rows — attempting to download error file...');
    try {
      const errorFilePath = await downloadErrorFile();
      if (errorFilePath) {
        errorDetails = await parseErrorExcel(errorFilePath);
        if (errorDetails.length > 0) {
          logger.warn(`Found ${errorDetails.length} error row(s):`);
          errorDetails.forEach((e) => {
            logger.warn(`  Row ${e.row} | ${e.voucherCode} | ${e.branchName}`);
            e.errorMessages.forEach((msg, i) => logger.warn(`    ${i + 1}. ${msg}`));
          });
        }
      }
    } catch (dlErr) {
      logger.error(`Failed to download/read error file: ${dlErr.message}`);
    }
  }

  await clickWithEvaluate('#close-upload-queue');

  if (hasFailed && errorDetails.length > 0) {
    const summary = errorDetails.map((e) => {
      const errList = e.errorMessages.map((msg, i) => `  ${i + 1}. ${msg}`).join('\n');
      return `Row ${e.row} [${e.voucherCode}]:\n${errList}`;
    }).join('\n\n');
    throw new Error(`Upload completed with errors:\n${summary}`);
  }

  return resultUpload;
}

/**
 * Check one or more voucher codes against the ESB voucher table.
 * Uses the filter input in the table header to search each code individually.
 * Clears browser storage and closes the browser when done.
 */
async function checkVoucherCodes(credentials, codes) {
  const isLoggedIn = await checkLoginStatus();
  if (!isLoggedIn) await loginAction(credentials);

  await gotoVoucherMenu();
  await delay(1500);

  const results = [];
  for (const code of codes) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    logger.info(`Checking voucher: ${trimmed}`);
    const data = await checkVoucherByCode(trimmed);
    results.push(data ? { voucherCode: trimmed, found: true, data } : { voucherCode: trimmed, found: false });
  }

  // Clear browser storage then close the browser session
  try {
    const { getPage } = require('./browser');
    const page = getPage();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch (_) {}
  await close();

  return results;
}

module.exports = { checkLoginStatus, loginAction, gotoVoucherMenu, uploadVoucherExcelFile, checkVoucherCodes };
