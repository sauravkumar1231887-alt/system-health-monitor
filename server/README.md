# Django Backend

This is the project's only API backend. It uses Django REST Framework and
PyMongo with the existing MongoDB collections. Node.js remains only for the
React build tooling; there is no Node.js API server or backend dependency tree.
Sophos integration is not implemented and is intentionally out of scope.

See [MIGRATION_MAPPING.md](MIGRATION_MAPPING.md) for the historical API mapping
and observed contract.

## Development

Requirements: Python 3.10+, Node.js/npm for the React client, and a reachable
MongoDB for persistent mode.
On Debian/Ubuntu installs where `venv` reports missing `ensurepip`, install the
distribution packages `python3-venv` and `python3-pip` first.

```bash
cd server
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set a private `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=True`, and `DEMO_MODE=true` to exercise
the existing demo accounts/fixtures without Mongo. If `JWT_SECRET` is not
provided in demo mode, Django uses the local `development-secret` default.
Run Django on port 8000:

```bash
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

The React app defaults to Django and can override its API URL with
`client/.env.local`, for example `VITE_API_URL=http://127.0.0.1:8000/api`.
Start it separately with `npm run dev --prefix client`.

## Live Monitoring

The agent preserves the 30-second `POST /api/heartbeat` and adds nested
`systemHealth`, `ups`, `network`, and collection-time fields. Windows CIM,
Defender, firewall, adapter, TCP, and adapter-statistics queries are used where
supported. UPS telemetry is reported only when Windows exposes an UPS battery;
unsupported UPS values are `N/A`. CPU temperature requires an
OpenHardwareMonitor or LibreHardwareMonitor CIM provider and is otherwise
`N/A`.

The React Live Monitoring view polls the authenticated `GET /api/live-monitoring`
endpoint every 10 seconds. Per-system endpoints are `/api/systems/:id/live`,
`/health`, `/network`, `/ups`, and `/history?period=1h|6h|24h|7d|30d`. Offline
systems do not expose an old sample as current; the last received sample and
timestamp are returned separately.

History is stored in the existing `systemmetrics` collection and grouped into
time buckets on query. Newly written telemetry receives a 30-day TTL expiry;
legacy records without `expiresAt` remain untouched. After configuring MongoDB,
run `python manage.py ensure_mongodb_indexes`.

The collector targets Windows PowerShell 5.1 and needs acceptance testing on a
real Windows endpoint. WMI/CIM support varies by UPS and adapter vendor, so
unsupported measurements remain unavailable instead of being inferred.

## MongoDB Preparation

Set `DEMO_MODE=false`, `MONGODB_URI`, `MONGODB_DATABASE`, and `JWT_SECRET_KEY`.
MongoDB must remain the same database. Django uses
PyMongo directly, does not create SQL tables, and does not delete, rename, or
rewrite existing collections.

Before enabling Django in production, back up MongoDB and verify collection
contents/field types in the target environment. MongoDB was unavailable in this
workspace, so existing production records could not be inspected here.
Collection names identified from the previous schemas are `systems`,
`systemmetrics`, `commands`, `alerts`, `auditlogs`, `users`, and `settings`.
The Django code preserves Mongoose ObjectId IDs and string IDs where found.

Create only missing indexes (duplicate data can prevent a unique index):

```bash
python manage.py ensure_mongodb_indexes
```

Provision each Windows agent once. This command prompts for the secret without
echoing it and stores only a bcrypt hash in the existing `systems` collection:

```bash
python manage.py provision_agent_system --hostname ENG-WS-014
```

Use that same key in the agent's existing `config.json` `apiKey` field. The
agent script and HTTP contract remain unchanged. Existing production agents
must have their key hash provisioned in `systems.agentTokenHash`; plaintext
agent keys are never stored.

## API

All existing dashboard API paths are retained. Requests require `Authorization:
Bearer <token>` except where noted. JWTs use HS256, `JWT_SECRET_KEY`,
claims `sub`, `email`, `role`, and the existing eight-hour lifetime. Login
response and raw response shapes are documented in the mapping.

| Method | Endpoint | Authentication / permission | Request |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | None |
| `POST` | `/api/auth/login` | Public | `{ "email": "...", "password": "..." }` |
| `GET` | `/api/systems` | Dashboard JWT | None |
| `GET` | `/api/systems/:id` | Dashboard JWT | None |
| `GET` | `/api/systems/:id/metrics` | Dashboard JWT | None |
| `GET` | `/api/systems/:id/ports` | Dashboard JWT | None |
| `GET` | `/api/alerts` | Dashboard JWT | None |
| `PUT` | `/api/alerts/:id` | Dashboard JWT | Optional `{ "status": "..." }` |
| `GET` | `/api/commands` | Dashboard JWT | None |
| `GET` | `/api/audit-logs` | Dashboard JWT | None |
| `GET` | `/api/settings` | Dashboard JWT | None |
| `POST` | `/api/systems/:id/actions/restart` | Administrator JWT | `{}` |
| `POST` | `/api/systems/:id/actions/shutdown` | Administrator JWT | `{}` |
| `POST` | `/api/agent/commands/poll` | `X-Agent-Key` | `{}` |
| `POST` | `/api/agent/commands/:id/result` | `X-Agent-Key` | `{ "status": "EXECUTED"|"FAILED", "error": "..." }` |
| `POST` | `/api/heartbeat` | `X-Agent-Key` | Existing PowerShell agent heartbeat JSON |
| `GET` | `/api/systems/:id/report/pdf` | Dashboard JWT | `period=24h|7d|30d`, or ISO `from` and `to` |
| `POST` | `/api/reports/pdf` | Dashboard JWT | `{ "systemIds": ["..."], "period": "7d" }` |

Viewer users can read data and generate reports but cannot queue remote commands.
Agent commands are restricted to `RESTART` and `SHUTDOWN`; arbitrary shell
execution is not supported. JSON errors retain the existing `{ "message":
"..." }` shape. Reports are a one-page A4 landscape PDF; bulk reports are ZIPs.

## Background Process

The offline transition check runs as a separate Django process, avoiding
per-request work and duplicate timers in multi-worker deployments:

```bash
python manage.py sync_offline_status
```

Run exactly one monitor process per environment under systemd, Supervisor, or
the deployment platform's process manager. The 90-second threshold and
transition alert are retained. Celery/Redis is not added because the existing
job is one small fixed timer and does not require a task broker.

## Tests And Validation

```bash
python manage.py test
python manage.py check
python -m compileall -q .
```

Tests cover login/invalid payloads, JWT-protected reads, heartbeat/metric
creation, command authorization/agent polling, and PDF/ZIP output. Run Django
in demo mode for these isolated API tests; live MongoDB persistence and an
actual Windows agent require the target environment. The configured test
runner does not create a SQL test database.

## Cutover Checklist

- [ ] Install dependencies and run `python manage.py check`.
- [ ] Run `python manage.py test` in demo mode.
- [ ] Back up MongoDB; inspect current records, BSON ID/reference types, and indexes.
- [ ] Verify the configured Mongo URI and database name point at the existing database.
- [ ] Verify login tokens from Django work with the existing React dashboard using the same JWT secret.
- [ ] Verify Administrator and Viewer permissions, including `403` for Viewer restart/shutdown.
- [ ] Provision each production agent key as a bcrypt hash and verify the unchanged PowerShell heartbeat request.
- [ ] Verify full heartbeat data, metrics, unexpected-port alerts, and command-result ownership.
- [ ] Run exactly one offline monitor and verify the 30-second cadence, 90-second threshold, and transition alert.
- [ ] Verify alerts/settings/audit endpoints and existing Mongo documents remain readable.
- [ ] Verify PDF dimensions, one-page count, ZIP entries, custom periods, and date validation.
- [ ] Test connection failures, bad JWTs, unknown agent keys, invalid input, and duplicate index handling.
- [ ] Verify the frontend build and all dashboard workflows while Django runs on its separate port.
- [ ] Verify the frontend and Windows agents against Django after these checks pass.
- [ ] Keep Sophos out of scope; no Sophos integration was implemented.

The checklist includes live-environment verification. Demo-mode checks pass,
but the existing MongoDB database and physical Windows agent were unavailable
in this workspace.

## Production Deployment

1. Back up MongoDB and inspect existing collection names, indexes, and BSON
   types. No database migration or destructive collection operation is run.
2. Install dependencies from `requirements.txt`; configure `.env` securely and
   keep `DEBUG=False`, a private `DJANGO_SECRET_KEY`, the existing JWT secret,
   allowed hosts, and explicit frontend CORS origins.
3. Run `python manage.py check`, the test suite, and the optional index command.
4. Run Django behind HTTPS with Gunicorn, for example
   `gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3`.
5. Run one `sync_offline_status` worker and provision agent key hashes.
6. Test the React app against Django via `VITE_API_URL`. Verify dashboard reads,
   Viewer/Admin behavior, both agent command
   paths, heartbeats, report PDF page count, ZIP generation, and stale status.
7. Confirm the MongoDB backup and ensure the Windows agent target URL points to
   the Django host.

The previous API kept much of its demo monitoring state in process memory.
Django persists monitoring, alert, command, and audit records to MongoDB; it
cannot recover records that were never persisted by the previous service.