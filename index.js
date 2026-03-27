/**
 * Usage:
 *   node index.js create
 *   node index.js activate
 *
 * Excel files are read from:
 *   ./files/create/   — for CREATE mode
 *   ./files/activate/ — for ACTIVATE mode
 */
require('dotenv').config();
const path = require('path');
const logger = require('./src/utils/logger');
const { credentials } = require('./src/config/credentials');
const { voucherUploadOrchestrate } = require('./src/core/orchestrator');

const VALID_MODES = ['create', 'activate'];
const command = process.argv[2]?.toLowerCase();

if (!command || !VALID_MODES.includes(command)) {
  console.log('\nUsage:');
  console.log('  node index.js create');
  console.log('  node index.js activate');
  process.exit(1);
}

const mode       = command.toUpperCase();
const folderPath = path.resolve(__dirname, 'files', command);

console.log('\n╔══════════════════════════════════════════╗');
console.log('║    VOUCHER UPLOAD ACTIVATION - ESB ERP   ║');
console.log('╚══════════════════════════════════════════╝\n');
console.log(`Mode      : ${mode}`);
console.log(`Folder    : ${folderPath}`);
console.log(`Username  : ${credentials.username || '(not set)'}\n`);

voucherUploadOrchestrate({ credentials, folderPath }, mode)
  .then((results) => {
    const success = results.filter((r) => r.status.includes('Success')).length;
    const failed  = results.length - success;

    console.log('\n─────────────────────────────────────────');
    console.log(`✅ Done! Total: ${results.length} | Success: ${success} | Failed: ${failed}`);
    console.log('─────────────────────────────────────────');

    results.forEach((r, i) => {
      const icon = r.status.includes('Success') ? '✓' : '✗';
      console.log(`  ${i + 1}. ${icon} ${r.file}${r.message ? ` — ${r.message}` : ''}`);
    });

    console.log('');
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    logger.error(`Fatal error: ${err.message}`);
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  });
