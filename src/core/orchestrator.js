const fs = require('fs').promises;
const path = require('path');
const { close } = require('./browser');
const { checkLoginStatus, loginAction, gotoVoucherMenu, uploadVoucherExcelFile } = require('./esbServices');
const { delay } = require('../utils/delay');
const logger = require('../utils/logger');

const MAX_RETRIES = 2;

/**
 * Upload all Excel files found in `folderPath` using the given mode (CREATE or ACTIVATE).
 * Per-file errors are recorded as ✗ Failed and do not trigger a retry.
 * Session-level errors trigger a retry up to MAX_RETRIES times.
 */
async function voucherUploadOrchestrate(config, mode) {
  const { credentials, folderPath } = config;
  const startTime = new Date();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`[ATTEMPT ${attempt}/${MAX_RETRIES}] Starting voucher ${mode}...`);

      const files = await fs.readdir(folderPath);
      const excelFiles = files.filter((f) => /\.(xlsx|xls)$/i.test(f));

      if (excelFiles.length === 0) {
        logger.warn(`No Excel files found in: ${folderPath}`);
        return [];
      }

      logger.info(`Found ${excelFiles.length} file(s): ${excelFiles.join(', ')}`);

      const isLoggedIn = await checkLoginStatus();
      if (!isLoggedIn) await loginAction(credentials);

      await gotoVoucherMenu();

      const results = [];
      for (let i = 0; i < excelFiles.length; i++) {
        const file     = excelFiles[i];
        const filePath = path.join(folderPath, file);
        logger.info(`[${i + 1}/${excelFiles.length}] Processing: ${file}`);
        try {
          const result = await uploadVoucherExcelFile(filePath, mode);
          results.push({ file, status: '✓ Success', message: result || '' });
        } catch (err) {
          logger.error(`Failed to upload ${file}: ${err.message}`);
          results.push({ file, status: '✗ Failed', message: err.message, errorFilePath: err.errorFilePath || null });
        }
      }

      const duration = ((new Date() - startTime) / 1000).toFixed(2);
      await close();

      logger.info(`[SUCCESS] Voucher ${mode} completed in ${duration}s`);
      return results;
    } catch (err) {
      logger.error(`[ATTEMPT ${attempt}/${MAX_RETRIES}] Error: ${err.message}`);
      try { await close(); } catch (_) {}

      // Login errors are permanent — no point retrying
      if (err.isLoginError) {
        logger.warn('Login error detected — skipping retry.');
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const wait = attempt * 5000;
        logger.info(`Waiting ${wait}ms before retry...`);
        await delay(wait);
      } else {
        throw err;
      }
    }
  }
}

module.exports = { voucherUploadOrchestrate };
