# Project Structure

```
esb-voucher-upload-activation/
├── docs/
│   ├── FLOW.md               # Process flow for each mode
│   └── STRUCTURE.md          # This file
├── files/
│   ├── create/               # Place .xlsx files for CREATE mode
│   └── activate/             # Place .xlsx files for ACTIVATE mode
├── logs/
│   ├── combined.log          # All logs (auto-generated)
│   └── error.log             # Error logs only (auto-generated)
├── src/
│   ├── config/
│   │   └── credentials.js        # Reads ESB_USERNAME & ESB_PASSWORD from .env
│   ├── core/
│   │   ├── browser.js            # Puppeteer browser lifecycle (launch, close, health check)
│   │   ├── esbServices.js        # ESB ERP actions: login, navigate, upload, check, extend, delete
│   │   ├── orchestrator.js       # Main flow: read folder → login → upload all files → retry
│   │   └── puppeteerActions.js   # DOM helpers: click, type, upload, wait, voucher operations
│   └── utils/
│       ├── delay.js              # Promise-based delay helper
│       └── logger.js             # Winston logger (WIB timezone, file + console)
├── UserData/                 # Puppeteer user data dir — persists browser session (auto-generated)
├── .env                      # Environment variables
├── .env.example              # Environment variables template
├── .gitignore
├── index.js                  # CLI entry point
├── package.json
└── README.md
```

## Module Descriptions

### `index.js`
CLI entry point. Reads `create` or `activate` argument, resolves source folder, calls `voucherUploadOrchestrate`, prints summary.

### `src/config/credentials.js`
Exposes `credentials` object with `username` and `password` from `ESB_USERNAME` / `ESB_PASSWORD` env vars.

### `src/core/browser.js`
Manages the Puppeteer browser instance:
- `launch(url)` — reuses existing browser if alive, restarts if dead; clears history, closes extra tabs, navigates to URL
- `close()` — clears history then force-closes browser
- `getPage()` — returns active page instance
- `SHOW_BROWSER=true` → visible browser; `false` → headless shell

### `src/core/puppeteerActions.js`
Low-level DOM helpers:
- `click`, `clickWithEvaluate`, `typeInto`, `uploadFile`, `elementExists`, `waitForElement`
- `waitForUploadProcess` — polls upload queue until status clears
- `downloadErrorFile`, `parseErrorExcel` — download and parse ESB error Excel
- `checkVoucherByCode` — search voucher via table filter, return row data
- `extendVoucherExpiry` — search → checkbox → check btnUpdate → fill date → confirm; returns `{ found, buttonAvailable, status, success }`
- `deleteVoucher` — search → checkbox → check btnDelete → fill modal (Purpose + Journal Date) → Process; returns `{ found, buttonAvailable, status, success }`

### `src/core/esbServices.js`
High-level ESB actions:
- `checkLoginStatus` — navigate to /voucher, check logout link
- `loginAction` — fill and submit login form, dismiss SweetAlert2 if present
- `gotoVoucherMenu` — navigate via sidebar (Master → Voucher)
- `uploadVoucherExcelFile` — upload file, poll result, download error file if needed
- `checkVoucherCodes` — check one or more codes, return array of results
- `extendVoucherCodes` — extend expiry for one or more codes; no status pre-check, delegates to `extendVoucherExpiry`
- `deleteVoucherCodes` — delete one or more codes; no status pre-check, delegates to `deleteVoucher`

### `src/core/orchestrator.js`
Manages the full upload session: read files → login check → navigate → upload per file → retry on session error → return results array.

### `src/utils/logger.js`
Winston logger with WIB timezone, outputs to console (non-production) and `logs/` files.

### `src/utils/delay.js`
`delay(ms)` helper based on `Promise` with a debug log.
