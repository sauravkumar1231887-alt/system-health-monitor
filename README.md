# System Monitoring Health

System Monitoring Health provides central IT monitoring and authorized remote power management for Windows endpoints. The application uses a React dashboard, a Django REST API, MongoDB, and a PowerShell agent. Remote control is intentionally limited to `RESTART` and `SHUTDOWN`; arbitrary shell or PowerShell execution is not supported.

## Run locally

Requirements: Python 3.10+, Node.js 20+ and npm for the React client, and MongoDB 7+ for persistent mode. On Debian/Ubuntu, install `python3-venv` and `python3-pip` if `ensurepip` is unavailable.

```bash
python3 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
cp .env.example server/.env
npm install --prefix client
```

Set `DJANGO_DEBUG=True` and `DEMO_MODE=true` in `server/.env` for local fixture mode, or configure MongoDB and production secrets. Run Django and React in separate terminals with `server/.venv/bin/python server/manage.py runserver 0.0.0.0:8000` and `npm run dev --prefix client`. Open `http://localhost:5173`; Django serves the API on port 8000 at `http://192.168.8.63:8000` and is reachable from the LAN.

Demo accounts:

- Administrator: `admin@sentinel.local` / `admin123`
- Viewer: `viewer@sentinel.local` / `admin123`

The dashboard defaults to Django at `http://localhost:8000/api`; override it with `VITE_API_URL` in `client/.env.local`.

## Monitoring behavior

- The PowerShell agent sends the existing heartbeat every 30 seconds with system health, UPS, network, connectivity, and traffic readings where Windows exposes them.
- The Live Monitoring view fetches one aggregated Django response every 30 seconds. The existing systems, alerts, commands, audit logs, and settings refresh continues every 30 seconds.
- The browser displays the last successful dashboard update and a next-refresh countdown.
- The server uses the agent heartbeat timestamp for status; a browser refresh never makes a machine healthy.
- Systems older than 90 seconds are `offline`.
- CPU, memory, disk, antivirus, firewall, measured network state, and unexpected-port checks drive `warning` and `critical` status. Unknown hardware values are not treated as healthy or failed.
- UPS telemetry is collected only when Windows exposes an UPS battery; unsupported readings are `N/A`. CPU temperature requires an OpenHardwareMonitor/LibreHardwareMonitor CIM provider.
- New telemetry history is indexed and expires after 30 days. Existing history without `expiresAt` is unchanged.

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

The agent collects hostname, IP, MAC, OS, hardware, CPU, memory, disk, uptime, antivirus, firewall profiles, network adapters/connectivity/traffic, listening TCP ports, and optional Windows UPS readings. It reports them to `/api/heartbeat` with `X-Agent-Key`. Set `agent/config.json` `serverUrl` to the Django host (for example, `http://localhost:8000`); the agent appends `/api/...` itself. It does not block ports.

## API

Public: `GET /api/health`, `POST /api/auth/login`

JWT-protected: `GET /api/systems`, `GET /api/systems/:id`, `GET /api/systems/:id/metrics`, `GET /api/systems/:id/ports`, `GET /api/alerts`, `GET /api/commands`, `GET /api/audit-logs`, `GET /api/settings`

Live monitoring (JWT-protected): `GET /api/live-monitoring`, `GET /api/systems/:id/live`, `GET /api/systems/:id/health`, `GET /api/systems/:id/network`, `GET /api/systems/:id/ups`, and `GET /api/systems/:id/history?period=1h|6h|24h|7d|30d`.

Health reports: `GET /api/systems/:id/report/pdf?period=24h|7d|30d` or pass ISO `from` and `to` query parameters. `POST /api/reports/pdf` accepts `{ "systemIds": ["pc-001"], "period": "7d" }` and returns a ZIP of individual PDFs. Reports are generated in memory and streamed to the caller; they are not stored permanently. Both authenticated Administrator and Viewer users may download reports.

Administrator-only: `POST /api/systems/:id/actions/restart`, `POST /api/systems/:id/actions/shutdown`

Agent-authenticated with `X-Agent-Key`: `POST /api/heartbeat`, `POST /api/agent/commands/poll`, `POST /api/agent/commands/:id/result`

## MongoDB and production

Copy `.env.example` to `server/.env` and configure:

```dotenv
DEMO_MODE=false
MONGODB_URI=mongodb://127.0.0.1:27017/system-health-monitor
MONGODB_DATABASE=system-health-monitor
JWT_SECRET_KEY=use-a-long-random-secret
CORS_ALLOWED_ORIGINS=https://monitoring.example.com
```

The Django service uses PyMongo with the existing collection names and does not create SQL tables or delete collections. Back up MongoDB and inspect deployed records and indexes before production use. Configure explicit CORS origins, HTTPS, MongoDB authentication, and unique bcrypt-hashed agent keys. See [server/README.md](server/README.md) and [server/MIGRATION_MAPPING.md](server/MIGRATION_MAPPING.md) for API details and the migration map.

## Validation

```bash
npm run build --prefix client
server/.venv/bin/python server/manage.py check
DJANGO_DEBUG=True DEMO_MODE=true server/.venv/bin/python server/manage.py test
```

Demo-mode tests do not require MongoDB; configure and verify the actual MongoDB instance before relying on persistent production monitoring data. The PowerShell collector still needs acceptance testing on Windows with the target adapter, security provider, and UPS hardware; it cannot be exercised on the Linux development host.