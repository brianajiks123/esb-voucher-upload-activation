# Process Flow

## Overview

The tool running as CLI and support 2 mode upload voucher to ESB ERP:

| Mode     | Fungsi                        | Folder Sumber      | ESB codeMode |
|----------|-------------------------------|--------------------|--------------|
| CREATE   | Menambahkan voucher baru      | `files/create/`    | 1            |
| ACTIVATE | Mengaktifkan voucher existing | `files/activate/`  | 3            |

---

## CREATE Flow

```
node index.js create
        │
        ▼
Read all .xlsx / .xls from files/create/
        │
        ▼
Open browser Puppeteer → navigate to ESB login page
        │
        ▼
Login status check (search elemen logout link)
        │
   ┌────┴────┐
Logged  Not Logged
        │         │
        │    Fill username & password → click Login → confirm alert
        │
        ▼
Navigate to Master → Voucher
        │
        ▼
For each file:
  1. Click button "Upload"
  2. Click tab mode CREATE (codeMode=1)
  3. Set file to input #fileUpload
  4. Click #btnSubmitUpload
  5. Waiting process upload finish (polling tabel queue)
  6. Close modal upload queue
  7. Save result (Success / Failed)
        │
        ▼
Close browser → Show summary result in console
```

---

## ACTIVATE Flow

```
node index.js activate
        │
        ▼
Read all .xlsx / .xls from files/activate/
        │
        ▼
Open browser Puppeteer → navigate to ESB login page
        │
        ▼
Login status check
        │
   ┌────┴────┐
Logged  Not Logged
        │         │
        │    Fill username & password → click Login → confirm alert
        │
        ▼
Navigate to Master → Voucher
        │
        ▼
For each file:
  1. Click button "Upload"
  2. Click tab mode ACTIVATE (codeMode=3)
  3. Set file to input #voucherActivate
  4. Click #btnSubmitActivate
  5. Waiting process upload finish (polling tabel queue)
  6. Close modal upload queue
  7. Save result (Success / Failed)
        │
        ▼
Close browser → Show summary result in console
```

---

## Retry Mechanism

If has error in level orchestrator (not per-file), process will be automatic retried until **2x** with delay 5 second per attempt.

Error per-file not trigger retry — file failed saved called `✗ Failed` and process continue to next file.

---

## Output Console

```
╔══════════════════════════════════════════╗
║    VOUCHER UPLOAD ACTIVATION - ESB ERP   ║
╚══════════════════════════════════════════╝

Mode      : ACTIVATE
Folder    : D:\...\files\activate
Username  : burjo_user

─────────────────────────────────────────
✅ Selesai! Total: 3 | Berhasil: 3 | Gagal: 0
─────────────────────────────────────────
  1. ✓ voucher_batch_1.xlsx
  2. ✓ voucher_batch_2.xlsx
  3. ✓ voucher_batch_3.xlsx
```
