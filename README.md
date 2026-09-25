# Sentinel Health Control

Central IT monitoring and authorized remote power management for Windows endpoints. The repository contains a React dashboard, an Express REST API, MongoDB schemas, and a PowerShell agent. Remote control is intentionally limited to `RESTART` and `SHUTDOWN`; arbitrary shell or PowerShell execution is not supported.

## Run locally

Requirements: Node.js 20+, npm, and optionally MongoDB 7+.

```bash
npm install
npm run install:all
npm run dev
```

Open `http://localhost:5173`. Demo mode is enabled unless `DEMO_MODE=false`.

Demo accounts:

- Administrator: `admin@sentinel.local` / `admin123`
- Viewer: `viewer@sentinel.local` / `admin123`

The API runs on `http://localhost:4000`.

## Monitoring behavior

- The PowerShell agent sends a heartbeat every 30 seconds.
- The dashboard polls systems, alerts, commands, audit logs, and settings every 30 seconds.
- The browser displays the last successful dashboard update and a next-refresh countdown.
- The server uses the agent heartbeat timestamp for status; a browser refresh never makes a machine healthy.
- Systems older than 90 seconds are `offline`.
- CPU, RAM, disk, antivirus, firewall, network, and unexpected-port checks drive `warning` and `critical` status.

## Remote power workflow

1. An Administrator confirms Restart or Shutdown in the dashboard.
2. The API authenticates the JWT, verifies the Administrator role, queues a typed command, and records an audit event.
3. The matching agent polls `POST /api/agent/commands/poll` using its device token.
4. The agent executes only `Restart-Computer -Force` or `Stop-Computer -Force`.
5. The agent posts `EXECUTED` or `FAILED` to `POST /api/agent/commands/:id/result`.

Viewer tokens can read monitoring data but receive `403` for power actions. No endpoint accepts arbitrary command text.

## Agent installation

1. Copy `agent/` to each Windows endpoint.
2. Set `serverUrl` and a unique `apiKey` in `agent/config.json`.
3. Run PowerShell as Administrator and execute `./install-agent-task.ps1`.
4. Verify the `Sentinel System Health Agent` scheduled task runs as `SYSTEM` every 30 seconds.

The agent collects hostname, IP, MAC, OS, hardware, CPU, memory, disk, uptime, antivirus, firewall profiles, gateway, DNS, listening TCP ports, and reports them to `/api/heartbeat` with `X-Agent-Key`. It does not block ports.

## API

Public: `GET /api/health`, `POST /api/auth/login`

JWT-protected: `GET /api/systems`, `GET /api/systems/:id`, `GET /api/systems/:id/metrics`, `GET /api/systems/:id/ports`, `GET /api/alerts`, `GET /api/commands`, `GET /api/audit-logs`, `GET /api/settings`

Health reports: `GET /api/systems/:id/report/pdf?period=24h|7d|30d` or pass ISO `from` and `to` query parameters. `POST /api/reports/pdf` accepts `{ "systemIds": ["pc-001"], "period": "7d" }` and returns a ZIP of individual PDFs. Reports are generated in memory with PDFKit and streamed to the caller; they are not stored permanently. Both authenticated Administrator and Viewer users may download reports.

Administrator-only: `POST /api/systems/:id/actions/restart`, `POST /api/systems/:id/actions/shutdown`

Agent-authenticated with `X-Agent-Key`: `POST /api/heartbeat`, `POST /api/agent/commands/poll`, `POST /api/agent/commands/:id/result`

## MongoDB and production

Copy `.env.example` to `.env` and configure:

```dotenv
DEMO_MODE=false
MONGO_URI=mongodb://127.0.0.1:27017/system-health-monitor
JWT_SECRET=use-a-long-random-secret
CLIENT_ORIGIN=https://monitoring.example.com
```

`server/models.js` defines the `users`, `systems`, `systemMetrics`, `alerts`, `commands`, `auditLogs`, and `settings` schemas, including indexes for metrics and command lookup. Deploy the API behind HTTPS and a VPN or private network, use unique rotating agent credentials, enable MongoDB authentication and backups, and restrict CORS to the dashboard origin. Local demo mode uses fixtures so the UI and command contract can be exercised without MongoDB.

## Validation

```bash
npm run build --prefix client
node --check server/server.js
node --check server/models.js
```

The API smoke path should verify that Viewer power actions return `403`, Administrator actions return `202`, the matching agent receives only its own pending command, and heartbeat ingestion returns `202`.