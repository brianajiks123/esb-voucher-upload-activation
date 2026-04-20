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
│   │   └── credentials.js        # Multi-branch credential resolver
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

> Note: imports `{ credentials }` from `credentials.js` for the CLI path. When used as a library by `bot-voucher-esb`, credentials are resolved per-branch via `getCredentialsForBranch`.

### `src/config/credentials.js`
Multi-branch credential resolver. Exports:

| Export | Type | Description |
|---|---|---|
| `resolveBranchKey(input)` | function | Normalizes user input to a canonical branch key (e.g. `'ideo'` → `'ideologist'`) |
| `BRANCH_DISPLAY` | object | Human-readable branch names shown in ERP |
| `BRANCH_CRED_GROUP` | object | Maps each branch key to its credential group (`imvb` or `burgas`) |
| `getCredentialsForBranch(branchKey)` | function | Returns `{ username, password }` for the given branch key, or `null` if unknown |
| `BRANCH_LIST` | string | Formatted list of valid branch names for user-facing hints |

Supported branches and their credential groups:

| Branch Key | Display Name | Credential Group |
|---|---|---|
| `ideologist` | IDEOLOGIS+ | `imvb` |
| `maari_ventura` | MAARI VENTURA | `imvb` |
| `maari_bsb` | MAARI BSB | `imvb` |
| `burgas_gombel` | BURJO NGEGAS GOMBEL | `burgas` |
| `burgas_pleburan` | BURJO NGEGAS PLEBURAN | `burgas` |

Credential values are loaded from env vars: `IMVB_USERNAME` / `IMVB_PASSWORD` and `BURGAS_USERNAME` / `BURGAS_PASSWORD`.

### `src/core/browser.js`
Manages the Puppeteer browser instance:
- `launch(url)` — reuses existing browser if alive, restarts if dead; clears history, closes extra tabs, navigates to URL
- `close()` — clears history then force-closes browser
- `getPage()` — returns active page instance
- `isBrowserAlive()` — checks browser process and connection state (internal)
- `clearBrowserHistory()` — clears cache, cookies, and storage via CDP (internal)
- `closeAllTabs()` — closes all tabs except the last one (internal)
- `forceCloseBrowser()` — kills browser process and resets state (internal)

Browser is launched with a persistent `UserData/` directory to preserve login session across runs.  
`SHOW_BROWSER=true` → visible browser window; `false` → headless shell (default).

### `src/core/puppeteerActions.js`
Low-level DOM helpers and voucher-specific actions:

**Wait / Navigation Helpers:**
- `waitForElement(selector, timeout, interval)` — polls until element appears in DOM
- `waitForNavigation()` — waits for `networkidle2`

**Click Actions:**
- `click(selector)` — wait for element then native click
- `clickWithEvaluate(selector)` — click via `page.evaluate` (bypasses overlapping elements)

**Input Actions:**
- `typeInto(selector, text)` — clear field then type
- `uploadFile(filePath, selector)` — set file on `<input type="file">`

**Read Actions:**
- `elementExists(selector)` — returns boolean
- `getTextContent(selector)` — returns `innerText` of first matching element

**Upload Process:**
- `waitForUploadProcess(selector, content, interval, timeout)` — polls upload queue row until status clears "process", returns final row text

**Error File Helpers:**
- `downloadErrorFile(fallbackUrl?)` — triggers download via table button (`.upload-queue-download-btn`) or fallback URL; uses CDP `Browser.setDownloadBehavior`
- `waitForDownloadedFile(dir, timeout)` — polls temp directory until a complete file appears (internal)
- `parseErrorExcel(filePath)` — parses ESB error Excel; locates header row by "Voucher Code" column; error message is always the last non-empty cell per row

**Voucher Actions:**
- `checkVoucherByCode(code)` — filter table → extract row data (branch, startDate, endDate, minSalesAmount, voucherAmount, voucherSalesPrice, additionalInfo, status)
- `extendVoucherExpiry(code, newEndDate)` — checkbox → btnUpdate → fill date → confirm → waitForNavigation
- `deleteVoucher(code, deletionDate)` — checkbox → btnDelete → modal (Purpose via Select2 "voucher" + Journal Date) → Process → waitForNavigation
- `restoreVoucher(code, restoreDate)` — checkbox → btnRestore → modal (Purpose via Select2 "voucher" + Journal Date) → Process → waitForNavigation
- `activateVoucherByCode(code, purpose, activationDate)` — checkbox → btnActivate → modal (Purpose via Select2 keyword + Date to Activate) → Save → waitForNavigation

All voucher action functions return `{ found, buttonAvailable, status, success }`.

### `src/core/esbServices.js`
High-level ESB operations that manage login, navigation, and delegate to `puppeteerActions.js`:

| Function | Signature | Description |
|---|---|---|
| `checkLoginStatus()` | `() → bool` | Navigate to /voucher, check logout link presence |
| `loginAction(credentials)` | `({ username, password }) → void` | Fill and submit login form; handles SweetAlert2 confirmation and error dialogs |
| `gotoVoucherMenu()` | `() → void` | Navigate via sidebar: Master → Voucher |
| `uploadVoucherExcelFile(filePath, mode)` | `(string, 'CREATE'\|'ACTIVATE') → string` | Upload file, poll result, download + parse error file if rows failed |
| `checkVoucherCodes(credentials, codes)` | `(creds, string[]) → result[]` | Check one or more codes, return array of results |
| `extendVoucherCodes(credentials, codes, newEndDate)` | `(creds, string[], string) → result[]` | Extend expiry for one or more codes |
| `deleteVoucherCodes(credentials, codes, deletionDate)` | `(creds, string[], string) → result[]` | Delete one or more codes |
| `restoreVoucherCodes(credentials, codes, restoreDate)` | `(creds, string[], string) → result[]` | Restore one or more codes (Purpose + Journal Date modal) |
| `activateVoucherByCodes(credentials, codes, purpose, activationDate)` | `(creds, string[], string, string) → result[]` | Check status per code → activate if `available` |

`activateVoucherByCodes` performs a silent status check before activation:
- Status `available` → proceeds with `activateVoucherByCode`
- Other status → records `{ reason: 'not_available', status }` and skips

Upload mode config (`UPLOAD_MODES`):

| Mode | codeMode | Upload Input | Submit Button |
|---|---|---|---|
| CREATE | 1 | `#fileUpload` | `#btnSubmitUpload` |
| ACTIVATE | 3 | `#voucherActivate` | `#btnSubmitActivate` |

### `src/core/orchestrator.js`
Manages the full upload session:
- Reads all `.xlsx` / `.xls` files from `folderPath`
- Checks login status, navigates to voucher menu
- Uploads each file sequentially via `uploadVoucherExcelFile`
- Per-file errors are recorded as `✗ Failed` (process continues to next file)
- Session-level errors trigger retry up to **2x** (`attempt × 5s` delay)
- Login errors (`isLoginError = true`) are permanent — no retry

### `src/utils/logger.js`
Winston logger with WIB timezone (UTC+7). Outputs to:
- Console (non-production only, colorized)
- `logs/combined.log` — all log levels
- `logs/error.log` — error level only

Log level is controlled by `LOG_LEVEL` env var (default: `debug`).

### `src/utils/delay.js`
`delay(ms)` — Promise-based delay with a debug log entry.
