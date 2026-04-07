# ESB Voucher Upload Activation

CLI tool and library for managing vouchers on ESB ERP via Puppeteer browser automation.

Supports the following operations:
- **CREATE** — upload new vouchers via Excel file
- **ACTIVATE (file)** — activate vouchers via Excel file
- **ACTIVATE (code)** — activate individual vouchers by code with Purpose + Date
- **CHECK** — check voucher status and info by code
- **EXTEND** — extend voucher expiry date
- **DELETE** — delete vouchers

> Used as a library by `bot-voucher-esb`. The CREATE and ACTIVATE (file) modes are also available as CLI commands.

## Requirements

- Node.js >= 18
- Access to ESB ERP

## Installation

```bash
npm install
```

## Configuration

```bash
cp .env.example .env
```

```env
ESB_BASE_URL=erp_base_url

# Credentials for IMVB branches (IDEOLOGIS+, MAARI VENTURA, MAARI BSB)
IMVB_USERNAME=your_imvb_username
IMVB_PASSWORD=your_imvb_password

# Credentials for BURGAS branches (BURJO NGEGAS GOMBEL, BURJO NGEGAS PLEBURAN)
BURGAS_USERNAME=your_burgas_username
BURGAS_PASSWORD=your_burgas_password

SHOW_BROWSER=false
LOG_LEVEL=debug
NODE_ENV=development
```

`SHOW_BROWSER=true` shows the browser window during automation. `false` runs headless (default).

## Supported Branches

Credentials are resolved per-branch. The following branches are supported:

| Branch | Alias | Credential Group |
|---|---|---|
| IDEOLOGIS+ | `ideo` | IMVB |
| MAARI VENTURA | `ventura` | IMVB |
| MAARI BSB | `bsb` | IMVB |
| BURJO NGEGAS GOMBEL | `burgas gombel` | BURGAS |
| BURJO NGEGAS PLEBURAN | `burgas pleburan` | BURGAS |

## CLI Usage

Place `.xlsx` / `.xls` files in the relevant folder:

```
files/
├── create/       ← files for CREATE mode
└── activate/     ← files for ACTIVATE mode
```

Then run:

```bash
node index.js create
node index.js activate
```

Or via npm scripts:

```bash
npm run create
npm run activate
```

## Library Usage

When used as a library by `bot-voucher-esb`, the following functions are available from `src/core/esbServices.js`:

| Function | Description |
|---|---|
| `checkVoucherCodes(credentials, codes)` | Check status and info for one or more voucher codes |
| `extendVoucherCodes(credentials, codes, newEndDate)` | Extend expiry date for one or more vouchers |
| `deleteVoucherCodes(credentials, codes, deletionDate)` | Delete one or more vouchers |
| `activateVoucherByCodes(credentials, codes, purpose, activationDate)` | Activate vouchers by code with Purpose + Date |
| `uploadVoucherExcelFile(filePath, mode)` | Upload a single Excel file (used by orchestrator) |

And from `src/core/orchestrator.js`:

| Function | Description |
|---|---|
| `voucherUploadOrchestrate(config, mode)` | Full upload session: read folder → login → upload all files → retry |

Credentials are resolved per-branch using helpers from `src/config/credentials.js`:

```js
const { resolveBranchKey, getCredentialsForBranch } = require('./src/config/credentials');

const branchKey  = resolveBranchKey('ventura');       // → 'maari_ventura'
const creds      = getCredentialsForBranch(branchKey); // → { username, password }
```

## Logs

```
logs/combined.log   — all logs
logs/error.log      — error logs only
```

## Documentation

- [`docs/FLOW.md`](docs/FLOW.md) — process flow for each operation
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — project structure and module descriptions
