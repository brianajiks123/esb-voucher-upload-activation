# ESB Voucher Upload Activation

CLI tool to upload file Excel voucher to ESB ERP. Support 2 mode:
- **CREATE** — add new voucher
- **ACTIVATE** — activate exist voucher

## Requirements

- Node.js >= 18
- Access to ESB ERP

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` then fill the value:

```bash
cp .env.example .env
```

```env
ESB_BASE_URL=erp_base_url
ESB_USERNAME=your_esb_username
ESB_PASSWORD=your_esb_password
LOG_LEVEL=debug
NODE_ENV=development
```

## Prepare File

Place file `.xlsx` / `.xls` to relevant folder:

```
files/
├── create/       ← file to mode CREATE
└── activate/     ← file to mode ACTIVATE
```

## Usage

```bash
# Add new voucher
node index.js create

# Activate voucher
node index.js activate
```

Or via npm scripts:

```bash
npm run create
npm run activate
```

## Logs

Log automatic saved in folder `logs/`:
- `logs/combined.log` — all log
- `logs/error.log` — log error only

## Dokumentasi

- [`docs/FLOW.md`](docs/FLOW.md) — process flow each mode
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — project structure
