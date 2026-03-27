# Project Structure

```
esb-voucher-upload-activation/
├── docs/
│   ├── FLOW.md               # Process flow for each operation
│   └── STRUCTURE.md          # This file
├── files/
│   ├── create/               # Place .xlsx files for CREATE mode (CLI)
│   └── activate/             # Place .xlsx files for ACTIVATE mode (CLI)
├── logs/
│   ├── combined.log          # All logs (auto-generated)
│   └── error.log             # Error logs only (auto-generated)
├── src/
│   ├── config/
│   │   └── credentials.js        # Credential sets loaded from .env
│   ├── core/
│   │   ├── browser.js            # Puppeteer browser lifecycle
│   │   ├── esbServices.js        # High-level ESB ERP operations
│   │   ├── orchestrator.js       # Upload session orchestration with retry
│   │   └── puppeteerActions.js   # Low-level DOM helpers and voucher actions
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
Exposes a single `credentials` object with `username` and `password` loaded from env vars (`IMVB_USERNAME` / `IMVB_PASSWORD` or `BURGAS_USERNAME` / `BURGAS_PASSWORD`).

> When used as a library by `bot-voucher-esb`, credentials are resolved per-branch by that project's own `credentials.js` and passed directly to service functions.

### `src/core/browser.js`
Manages the Puppeteer browser instance:
- `launch(url)` — reuses existing browser if alive, restarts if dead; clears history, closes extra tabs, navigates to URL
- `close()` — clears history then force-closes browser
- `getPage()` — returns active page instance
- `isBrowserAlive()` — checks browser process and connection state
- `SHOW_BROWSER=true` → visible browser; `false` → headless shell

### `src/core/puppeteerActions.js`
Low-level DOM helpers and voucher-specific actions:

**Helpers:**
- `waitForElement(selector, timeout)` — polls until element appears
- `waitForNavigation()` — waits for `networkidle2`
- `click(selector)` — wait + native click
- `clickWithEvaluate(selector)` — click via `page.evaluate` (bypasses overlapping elements)
- `typeInto(selector, text)` — clear + type
- `uploadFile(filePath, selector)` — set file on `<input type="file">`
- `elementExists(selector)` — returns boolean
- `getTextContent(selector)` — returns `innerText`
- `waitForUploadProcess(selector, content)` — polls upload queue until status clears

**Error file:**
- `downloadErrorFile()` — triggers download via table button or fallback URL
- `parseErrorExcel(filePath)` — parses ESB error Excel, extracts per-row error messages

**Voucher actions:**
- `checkVoucherByCode(code)` — filter table → extract row data (branch, dates, amounts, status)
- `extendVoucherExpiry(code, newEndDate)` — checkbox → btnUpdate → fill date → confirm
- `deleteVoucher(code, deletionDate)` — checkbox → btnDelete → modal (Purpose + Journal Date) → Process
- `activateVoucherByCode(code, purpose, activationDate)` — checkbox → btnActivate → modal (Purpose + Date to Activate) → Save

All voucher action functions return `{ found, buttonAvailable, status, success }`.

### `src/core/esbServices.js`
High-level ESB operations that manage login, navigation, and delegate to `puppeteerActions.js`:

| Function | Description |
|---|---|
| `checkLoginStatus()` | Navigate to /voucher, check logout link presence |
| `loginAction(credentials)` | Fill and submit login form, handle SweetAlert2 dialogs |
| `gotoVoucherMenu()` | Navigate via sidebar: Master → Voucher |
| `uploadVoucherExcelFile(filePath, mode)` | Upload file, poll result, download error file if needed |
| `checkVoucherCodes(credentials, codes)` | Check one or more codes, return array of results |
| `extendVoucherCodes(credentials, codes, newEndDate)` | Extend expiry for one or more codes |
| `deleteVoucherCodes(credentials, codes, deletionDate)` | Delete one or more codes |
| `activateVoucherByCodes(credentials, codes, purpose, activationDate)` | Check status per code → activate if available |

`activateVoucherByCodes` performs a silent status check before activation:
- Status `available` → proceeds with `activateVoucherByCode`
- Other status → records `{ reason: 'not_available', status }` and skips

### `src/core/orchestrator.js`
Manages the full upload session:
- Reads all `.xlsx` / `.xls` files from `folderPath`
- Checks login, navigates to voucher menu
- Uploads each file via `uploadVoucherExcelFile`
- Per-file errors are recorded as `✗ Failed` (process continues)
- Session-level errors trigger retry up to **2x** (`attempt × 5s` delay)
- Login errors are permanent — no retry

### `src/utils/logger.js`
Winston logger with WIB timezone, outputs to console (non-production) and `logs/` files.

### `src/utils/delay.js`
`delay(ms)` helper based on `Promise` with a debug log.
