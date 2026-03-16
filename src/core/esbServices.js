const { launch } = require('./browser');
const { click, clickWithEvaluate, typeInto, uploadFile, elementExists, waitForUploadProcess, waitForNavigation } = require('./puppeteerActions');
const { delay } = require('../utils/delay');
const logger = require('../utils/logger');

const ESB_BASE_URL = process.env.ESB_BASE_URL || 'https://erp.esb.co.id';

const UPLOAD_MODES = {
  CREATE:   { codeMode: 1, uploadEl: '#fileUpload',      buttonUpload: '#btnSubmitUpload'   },
  ACTIVATE: { codeMode: 3, uploadEl: '#voucherActivate', buttonUpload: '#btnSubmitActivate' },
};

/**
 * Check if user is already logged in
 */
async function checkLoginStatus() {
  logger.info('Memeriksa status login...');
  await launch(`${ESB_BASE_URL}/site/login`);
  return elementExists("a[href='/site/logout']");
}

/**
 * Login to ESB ERP
 */
async function loginAction({ username, password }) {
  logger.info('Login ke ESB...');
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
 * Navigate to voucher master menu
 */
async function gotoVoucherMenu() {
  logger.info('Menuju halaman voucher...');
  await click("a[href='/master/index']");
  await click("a[href='/voucher']");
}

/**
 * Upload voucher Excel file with given mode (CREATE or ACTIVATE)
 */
async function uploadVoucherExcelFile(filePath, mode) {
  if (!UPLOAD_MODES[mode]) throw new Error(`Invalid mode: ${mode}. Valid modes: CREATE, ACTIVATE`);
  const { codeMode, uploadEl, buttonUpload } = UPLOAD_MODES[mode];

  logger.info(`Upload file voucher: ${filePath} (mode: ${mode})`);
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
  await clickWithEvaluate('#close-upload-queue');
  return resultUpload;
}

module.exports = { checkLoginStatus, loginAction, gotoVoucherMenu, uploadVoucherExcelFile };
