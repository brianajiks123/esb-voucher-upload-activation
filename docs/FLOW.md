# Process Flow

## Overview

CLI tool and library for managing vouchers on ESB ERP via Puppeteer browser automation.

| Operation        | Entry Point                  | CLI Available |
|------------------|------------------------------|---------------|
| CREATE           | `voucherUploadOrchestrate`   | Yes           |
| ACTIVATE (file)  | `voucherUploadOrchestrate`   | Yes           |
| ACTIVATE (code)  | `activateVoucherByCodes`     | No (library)  |
| CHECK            | `checkVoucherCodes`          | No (library)  |
| EXTEND           | `extendVoucherCodes`         | No (library)  |
| DELETE           | `deleteVoucherCodes`         | No (library)  |

---

## CREATE / ACTIVATE (file) Flow

```
node index.js create (or activate)
        │
        ▼
Read all .xlsx / .xls from files/<mode>/
        │
        ▼
checkLoginStatus() → launch browser → navigate to /voucher
        │
   ┌────┴────┐
Logged in   Not logged in
                  │
            loginAction({ username, password })
              ├─ Fill #loginform-username + #loginform-password → click #btnLogin
              ├─ Wait 2s → check for SweetAlert2 (.swal2-confirm.swal2-styled)
              ├─ Confirmation dialog (sure/continue/lanjut/konfirmasi)
              │    └─ Click OK → waitForNavigation
              ├─ Error dialog → click OK → throw isLoginError (no retry)
              └─ Verify logout link present → throw isLoginError if missing
        │
        ▼
gotoVoucherMenu() → click a[href='/master/index'] → click a[href='/voucher']
        │
        ▼
For each .xlsx / .xls file:
  1. delay(1000) → click button.btnUpload
  2. delay(1000) → clickWithEvaluate a[href='/voucher/#?mode=<codeMode>']
                   CREATE: codeMode=1 | ACTIVATE: codeMode=3
  3. delay(1000) → uploadFile(filePath, uploadEl)
                   CREATE: #fileUpload | ACTIVATE: #voucherActivate
  4. delay(1000) → clickWithEvaluate submitButton
                   CREATE: #btnSubmitUpload | ACTIVATE: #btnSubmitActivate
  5. waitForUploadProcess('#data-table-upload-queue > tbody > tr', 'process', 2000)
     → poll until row text no longer contains "process"
  6. If result contains "failed" or "error":
       → downloadErrorFile() via .upload-queue-download-btn (CDP download)
       → parseErrorExcel() → log per-row errors (row, voucherCode, branchName, messages)
  7. clickWithEvaluate('#close-upload-queue')
  8. Save result: ✓ Success / ✗ Failed (with errorFilePath if available)
        │
        ▼
close() → clearBrowserHistory() → forceCloseBrowser()
        │
        ▼
Return results[]
```

---

## ACTIVATE (code) Flow

```
activateVoucherByCodes(credentials, codes, purpose, activationDate)
        │
        ▼
checkLoginStatus() → launch browser → navigate to /voucher
        │
   ┌────┴────┐
Logged in   Not logged in → loginAction() → gotoVoucherMenu()
        │
        ▼
delay(1500)
        │
        ▼
For each code:
  1. checkVoucherByCode(code) — filter table, extract status
     └─ Not found → { success: false, reason: 'not_found' }
  2. status != 'available'
     └─ { success: false, reason: 'not_available', status }
  3. status == 'available' → activateVoucherByCode(code, purpose, activationDate)
       a. Filter table by code → verify row exists
       b. Check row checkbox (td[data-col-seq="12"] input.kv-row-checkbox)
       c. Check if a#btnActivate exists
          └─ NOT found → { found: true, buttonAvailable: false, status }
       d. clickWithEvaluate('a#btnActivate') → waitForElement('#myModalActivate')
       e. Open Select2 Purpose dropdown (native mouse click on #w4 span.select2-selection--single)
          → type `purpose` keyword → Enter to select
       f. Fill Date to Activate (#msvoucher-voucherstartdateactivate-disp, DD-MM-YYYY)
          via page.evaluate (input + change + blur events)
       g. Verify Purpose and Date fields are filled
       h. Click outside to dismiss picker
       i. Click Save (a#btnSaveModal, native mouse click via getBoundingClientRect)
       j. waitForNavigation → waitForElement(filterInput, 15000)
       k. Return { found: true, buttonAvailable: true, status, success: true }
        │
        ▼
Clear localStorage + sessionStorage → close()
        │
        ▼
Return results[]
```

---

## CHECK Flow

```
checkVoucherCodes(credentials, codes)
        │
        ▼
checkLoginStatus() → launch browser → navigate to /voucher
        │
   ┌────┴────┐
Logged in   Not logged in → loginAction() → gotoVoucherMenu()
        │
        ▼
delay(1500)
        │
        ▼
For each code:
  checkVoucherByCode(code)
    ├─ Type code into filter input (#grid-voucher-container ... input[name="MsVoucher[voucherID]"])
    ├─ Press Enter → delay(1500)
    ├─ Find row: tr[data-key="CODE"]
    │    └─ Not found → { voucherCode, found: false }
    └─ Extract columns:
         seq 3  → branch
         seq 4  → startDate
         seq 5  → endDate
         seq 7  → minSalesAmount
         seq 8  → voucherAmount
         seq 9  → voucherSalesPrice
         seq 10 → additionalInfo
         seq 11 → status
         → { voucherCode, found: true, data: { ... } }
        │
        ▼
Clear localStorage + sessionStorage → close()
        │
        ▼
Return results[]
```

---

## EXTEND Flow

```
extendVoucherCodes(credentials, codes, newEndDate)
        │
        ▼
checkLoginStatus() → launch browser → navigate to /voucher
        │
   ┌────┴────┐
Logged in   Not logged in → loginAction() → gotoVoucherMenu()
        │
        ▼
delay(1500)
        │
        ▼
For each code:
  extendVoucherExpiry(code, newEndDate)
    1. Filter table by code → verify row exists → get status
       └─ Not found → { found: false, buttonAvailable: false, status: null, success: false }
    2. Check row checkbox
    3. Check if a#btnUpdate[href="/voucher/update-voucher-length"] exists
       └─ NOT found → { found: true, buttonAvailable: false, status, success: false }
    4. clickWithEvaluate('a#btnUpdate[...]')
       → fill #msvoucher-voucherenddateupdate-disp (dispatch change event)
       → waitForElement('a#btnUpdateModal') → clickWithEvaluate('a#btnUpdateModal')
       → waitForNavigation → waitForElement(filterInput, 15000)
       → return { found: true, buttonAvailable: true, status, success: true }
        │
        ▼
Clear localStorage + sessionStorage → close()
        │
        ▼
Return results[]
```

---

## DELETE Flow

```
deleteVoucherCodes(credentials, codes, deletionDate)
        │
        ▼
checkLoginStatus() → launch browser → navigate to /voucher
        │
   ┌────┴────┐
Logged in   Not logged in → loginAction() → gotoVoucherMenu()
        │
        ▼
delay(1500)
        │
        ▼
For each code:
  deleteVoucher(code, deletionDate)
    1. Filter table by code → verify row exists → get status
       └─ Not found → { found: false, buttonAvailable: false, status: null, success: false }
    2. Check row checkbox
    3. Check if a#btnDelete exists
       └─ NOT found → { found: true, buttonAvailable: false, status, success: false }
    4. waitForElement('a#btnDelete') → clickWithEvaluate('a#btnDelete')
       → waitForElement('#myModalActivate', 10000)
    5. Open Select2 Purpose dropdown (native mouse click via getBoundingClientRect on #w4)
       → type "voucher" → Enter to select
    6. Fill Journal Date (#msvoucher-voucherstartdateactivate-disp, DD-MM-YYYY)
       via page.evaluate (input + change + blur events)
    7. Verify Purpose and Date fields are filled
    8. Click outside to dismiss picker
    9. Click Process (a#btnSaveModal, native mouse click via getBoundingClientRect)
   10. waitForNavigation → page.waitForSelector(filterInput, { timeout: 15000 })
       Note: "Execution context was destroyed" after navigation is treated as success
             (voucher already deleted server-side)
   11. Return { found: true, buttonAvailable: true, status, success: true }
        │
        ▼
Clear localStorage + sessionStorage → close()
        │
        ▼
Return results[]
```

---

## Retry Mechanism

Session-level errors (not per-file) trigger automatic retry up to **2x** with a delay of `attempt × 5s`.

Per-file errors are recorded as `✗ Failed` and the process continues to the next file.

Login errors (`isLoginError = true`) are permanent — no retry.

---

## Credential Resolution

Credentials are resolved per-branch via `src/config/credentials.js`:

```
resolveBranchKey(userInput)
  ├─ 'ideo' / 'ideologist' / 'ideologis+' → 'ideologist'
  ├─ 'ventura' / 'maari ventura'          → 'maari_ventura'
  ├─ 'bsb' / 'maari bsb'                 → 'maari_bsb'
  ├─ 'burgas gombel' / 'burjo ngegas gombel'     → 'burgas_gombel'
  └─ 'burgas pleburan' / 'burjo ngegas pleburan' → 'burgas_pleburan'

getCredentialsForBranch(branchKey)
  ├─ ideologist / maari_ventura / maari_bsb → IMVB_USERNAME / IMVB_PASSWORD
  └─ burgas_gombel / burgas_pleburan        → BURGAS_USERNAME / BURGAS_PASSWORD
```

---

## Browser Session

Puppeteer uses a persistent `UserData/` directory to preserve login cookies across runs. `checkLoginStatus()` verifies the logout link before attempting login, reducing overhead for consecutive operations.

`SHOW_BROWSER=true` → visible browser window  
`SHOW_BROWSER=false` → headless shell (default)

Browser is reused across operations within the same session. If the browser process dies or disconnects, it is automatically restarted on the next `launch()` call.

---

## Console Output (CLI)

```
╔══════════════════════════════════════════╗
║    VOUCHER UPLOAD ACTIVATION - ESB ERP   ║
╚══════════════════════════════════════════╝

Mode      : CREATE
Folder    : D:\...\files\create
Username  : esb_user

─────────────────────────────────────────
✅ Done! Total: 2 | Success: 2 | Failed: 0
─────────────────────────────────────────
  1. ✓ voucher_batch_1.xlsx
  2. ✓ voucher_batch_2.xlsx
```
