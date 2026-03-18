# Process Flow

## Overview

CLI tool and library for uploading vouchers to ESB ERP. Supports 2 modes:

| Mode     | Function                      | Source Folder      | ESB codeMode |
|----------|-------------------------------|--------------------|--------------|
| CREATE   | Add new vouchers              | `files/create/`    | 1            |
| ACTIVATE | Activate existing vouchers    | `files/activate/`  | 3            |

---

## CREATE / ACTIVATE Flow

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
            loginAction() → fill form → submit → dismiss alert if any
        │
        ▼
gotoVoucherMenu() → Master → Voucher
        │
        ▼
For each file:
  1. Click "Upload" button
  2. Click tab for mode (codeMode 1 or 3)
  3. Set file to upload input
  4. Click submit button
  5. Poll upload queue until status clears "process"
  6. If failed rows → download & parse error Excel
  7. Close upload queue modal
  8. Save result (✓ Success / ✗ Failed)
        │
        ▼
close() → print summary
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
  1. Filter table by voucher code
  2. Check row checkbox
  3. Look for btnUpdate (a#btnUpdate[href="/voucher/update-voucher-length"])
     ├─ NOT found → return { found: true, buttonAvailable: false, status }
     └─ Found → click btnUpdate → fill new end date → click btnUpdateModal
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
  1. Filter table by voucher code
  2. Check row checkbox
  3. Look for btnDelete (a#btnDelete)
     ├─ NOT found → return { found: true, buttonAvailable: false, status }
     └─ Found → click btnDelete → modal #myModalActivate opens
                → fill Purpose (Select2, type "voucher" → Enter)
                → fill Journal Date (DD-MM-YYYY)
                → click Process button (native mouse click)
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
