# ESB Voucher Upload Activation

CLI tool to upload voucher Excel files to ESB ERP. Supports 2 modes:
- **CREATE** — add new vouchers
- **ACTIVATE** — activate existing vouchers

Also used as a library by `bot-voucher-esb` for extend and delete operations.

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
ESB_USERNAME=your_esb_username
ESB_PASSWORD=your_esb_password
SHOW_BROWSER=false
LOG_LEVEL=debug
NODE_ENV=development
```

`SHOW_BROWSER=true` shows the browser window during automation. `false` runs headless (default).

## Prepare Files

Place `.xlsx` / `.xls` files in the relevant folder:

```
files/
├── create/       ← files for CREATE mode
└── activate/     ← files for ACTIVATE mode
```

## Usage

```bash
node index.js create
node index.js activate
```

Or via npm scripts:

```bash
npm run create
npm run activate
```

> `extendVoucherCodes` and `deleteVoucherCodes` are not exposed as CLI commands — they are called directly by `bot-voucher-esb` at runtime.

## Logs

```
logs/combined.log   — all logs
logs/error.log      — error logs only
```

## Documentation

- [`docs/FLOW.md`](docs/FLOW.md) — process flow
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — project structure
