# Project Structure

```
voucher-upload-activation-esb/
├── docs/
│   ├── FLOW.md           # Process flow each mode
│   └── STRUCTURE.md      # Project structure
├── files/
│   ├── create/           # Place file .xlsx to mode CREATE
│   └── activate/         # Place file .xlsx to mode ACTIVATE
├── logs/
│   ├── combined.log      # All log (auto-generated)
│   └── error.log         # Log error only (auto-generated)
├── src/
│   ├── config/
│   │   └── credentials.js    # Read ESB_USERNAME & ESB_PASSWORD from .env
│   ├── core/
│   │   ├── browser.js         # Intiate & Puppeteer browser management
│   │   ├── esbServices.js     # Action ESB ERP: login, navigate, upload voucher
│   │   ├── orchestrator.js    # Main flow: read folder → login → upload all file
│   │   └── puppeteerActions.js # Helper action DOM: click, type, upload, wait
│   └── utils/
│       ├── delay.js           # Helper Promise-based delay
│       └── logger.js          # Winston logger (WIB timezone, file + console)
├── UserData/             # Puppeteer user data dir, save sesi browser (auto-generated)
├── .env                  # Environment variables
├── .env.example          # Template environment variables
├── .gitignore
├── index.js              # CLI entry point
├── package.json
└── README.md
```

## Description Each Modul

### `index.js`
Entry point CLI. Read argumen `create` or `activate`, choosing folder source file, then calling `voucherUploadOrchestrate`.

### `src/config/credentials.js`
Expose objek `credentials` value `username` and `password` readed from environment variable `ESB_USERNAME` and `ESB_PASSWORD`.

### `src/core/browser.js`
Manage instance Puppeteer (launch, close, getPage). Using `UserData/` to save session to no login needed.

### `src/core/puppeteerActions.js`
List helper DOM: `click`, `clickWithEvaluate`, `typeInto`, `uploadFile`, `elementExists`, `waitForElement`, `waitForUploadProcess`, dll.

### `src/core/esbServices.js`
Specific action ESB ERP: `checkLoginStatus`, `loginAction`, `gotoVoucherMenu`, `uploadVoucherExcelFile`. Define `UPLOAD_MODES` to CREATE (codeMode 1) and ACTIVATE (codeMode 3).

### `src/core/orchestrator.js`
Manage full flow: read file from folder → login check → navigate → upload 1 per 1 → retry if failed → return result.

### `src/utils/logger.js`
Winston logger with format WIB, output to console (non-production) and file (`logs/`).

### `src/utils/delay.js`
Helper `delay(ms)` based on Promise with log debug.
