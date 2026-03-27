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
            loginAction()
              ├─ Fill username + password → submit
              ├─ Confirmation dialog → confirm + waitForNavigation
              └─ Error dialog → throw isLoginError (no retry)
        │
        ▼
gotoVoucherMenu() → Master → Voucher
        │
        ▼
For each file:
  1. Click "Upload" button (button.btnUpload)
  2. Click mode tab: codeMode 1 (CREATE) or 3 (ACTIVATE)
  3. Set file to upload input (#fileUpload or #voucherActivate)
  4. Click submit (#btnSubmitUpload or #btnSubmitActivate)
  5. Poll upload queue (#data-table-upload-queue > tbody > tr) until status clears "process"
  6. If failed rows → downloadErrorFile() → parseErrorExcel()
  7. Close upload queue modal (#close-upload-queue)
  8. Save result: ✓ Success / ✗ Failed (with errorFilePath if available)
        │
        ▼
close() → return results[]
```

---

## ACTIVATE (code) Flow

```
activateVoucherByCodes(credentials, codes, purpose, activationDate)
        │
        ▼
Login check → navigate to /voucher
        │
        ▼
For each code:
  1. checkVoucherByCode() — get current status from table
  2. Status != 'available'
     └─ Record { reason: 'not_available', status } — skip activation
  3. Status == 'available'
     └─ activateVoucherByCode(code, purpose, activationDate)
           ├─ Filter table by voucher code
           ├─ Check row checkbox
           ├─ Check if btnActivate (a#btnActivate) is available
           │    └─ NOT found → { found: true, buttonAvailable: false, status }
           └─ Found → click btnActivate → modal #myModalActivate opens
                    → fill Purpose (Select2, type keyword → Enter)
                    → fill Date to Activate (DD-MM-YYYY)
                    → verify both fields filled
                    → click Save (a#btnSaveModal, native mouse click)
                    → waitForNavigation → waitForElement (table ready)
                    → return { success: true }
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
Login check → navigate to /voucher
        │
        ▼
For each code:
  checkVoucherByCode(code)
    ├─ Type code into filter input → Enter → wait 1.5s
    ├─ Find row: tr[data-key="CODE"]
    └─ Extract columns:
         seq 3  → branch
         seq 4  → startDate
         seq 5  → endDate
         seq 7  → minSalesAmount
         seq 8  → voucherAmount
         seq 9  → voucherSalesPrice
         seq 10 → additionalInfo
         seq 11 → status
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
Login check → navigate to /voucher
        │
        ▼
For each code:
  extendVoucherExpiry(code, newEndDate)
    1. Filter table by voucher code
    2. Verify row exists → get current status
    3. Check row checkbox
    4. Look for btnUpdate (a#btnUpdate[href="/voucher/update-voucher-length"])
       ├─ NOT found → { found: true, buttonAvailable: false, status }
       └─ Found → click btnUpdate
                → fill new end date (#msvoucher-voucherenddateupdate-disp)
                → click btnUpdateModal
                → waitForNavigation → waitForElement (table ready)
                → return { success: true }
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
Login check → navigate to /voucher
        │
        ▼
For each code:
  deleteVoucher(code, deletionDate)
    1. Filter table by voucher code
    2. Verify row exists → get current status
    3. Check row checkbox
    4. Look for btnDelete (a#btnDelete)
       ├─ NOT found → { found: true, buttonAvailable: false, status }
       └─ Found → click btnDelete → modal #myModalActivate opens
                → fill Purpose (Select2, type "voucher" → Enter)
                → fill Journal Date (#msvoucher-voucherstartdateactivate-disp, DD-MM-YYYY)
                → verify both fields filled
                → click Process (a#btnSaveModal, native mouse click)
                → waitForNavigation → waitForElement (table ready)
                → return { success: true }
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

## Browser Session

Puppeteer uses a persistent `UserData/` directory to preserve login cookies across runs. `checkLoginStatus()` verifies the logout link before attempting login, reducing overhead for consecutive operations.

`SHOW_BROWSER=true` → visible browser window  
`SHOW_BROWSER=false` → headless shell (default)

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
