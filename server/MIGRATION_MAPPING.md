# Backend Migration Mapping

This document records the API and component mapping from the former Express
service to the Django REST API. Express source and backend dependencies have
been removed. Sophos Firewall was not implemented and remains excluded.

## Component Mapping

| Existing Node.js component | Django/Python equivalent | Compatibility notes |
| --- | --- | --- |
| Former Express entry point | `config/` settings, URLs, and modular apps | Keep the `/api` paths and HTTP behavior. |
| Inline route handlers | App `views.py` modules | Preserve bare arrays/objects and existing status codes. |
| `auth` JWT middleware | DRF authentication class | Verify the existing HS256 JWT format and `JWT_SECRET`; 8-hour token lifetime. |
| `requireAdmin` middleware | DRF permission class | Only `Administrator` can queue restart/shutdown. |
| `agentAuth` middleware | Agent-key authentication | Keep `X-Agent-Key`; never expose it in responses. |
| Former Mongoose schemas | PyMongo repository in `common/` and app services | Preserve document field names and existing Mongo collections; no destructive migration. |
| In-memory demo fixtures and arrays | Demo-only in-memory repository | Keep existing demo behavior separate from production persistence. |
| Former PDFKit renderer | `apps/reports` ReportLab renderer | Keep PDF and ZIP routes, date windows, filenames, and one-page A4 landscape output. |
| `setInterval(..., 30_000)` offline status check | Dedicated Django management command | Run separately as one scheduler process; preserve 30-second cadence and transition alert. |
| Former CORS, Helmet, and rate limit | Django CORS, security settings, DRF throttling | Restrict origins from environment; preserve the current 180 requests/minute intent. |
| `agent/SystemHealthAgent.ps1` | Unchanged external client | Keep heartbeat and command request bodies and headers. |
| React fetch calls in `client/src/main.jsx` | Django API base URL | Continue using `VITE_API_URL`; default points to Django. |

## Existing API Contract

All routes below are served under `/api`. JSON validation errors use
`{"message":"..."}`; the API does not use a `{success,data}` envelope.

| Method and path | Access | Current behavior |
| --- | --- | --- |
| `GET /health` | Public | `{status, demoMode, database}` |
| `POST /auth/login` | Public | Email/password; 400 invalid payload, 401 invalid credentials; returns `{token,user}`. |
| `GET /systems` | JWT | Bare array of systems, with status recalculated. |
| `GET /systems/:id` | JWT | System object or 404 `{message}`. |
| `GET /systems/:id/metrics` | JWT | Bare array, newest first, max 200. |
| `GET /systems/:id/ports` | JWT | Bare array of listening ports. |
| `GET /systems/:id/report/pdf` | JWT | PDF; `period=24h|7d|30d` or ISO `from`/`to`; invalid range returns 400. |
| `POST /reports/pdf` | JWT | Body `{systemIds,period?,from?,to?}`; ZIP of per-system PDFs. |
| `GET /alerts` | JWT | Bare array. |
| `PUT /alerts/:id` | JWT | Body can update `status`; missing alert returns 404. |
| `POST /systems/:id/actions/restart` | Administrator JWT | Queues `RESTART`, returns 202. |
| `POST /systems/:id/actions/shutdown` | Administrator JWT | Queues `SHUTDOWN`, returns 202. |
| `GET /commands` | JWT | Bare array. |
| `GET /audit-logs` | JWT | Bare array. |
| `GET /settings` | JWT | Settings object. |
| `POST /agent/commands/poll` | `X-Agent-Key` | Body `{}`; returns `{commands:[{id,type}]}` for that system. |
| `POST /agent/commands/:id/result` | `X-Agent-Key` | Body `{status:EXECUTED|FAILED,error?}`; returns updated command. |
| `POST /heartbeat` | `X-Agent-Key` | Existing agent payload; 202 `{accepted,systemId,status}`. |

## Audit Findings And Constraints

- The former Express application kept systems, metrics, alerts, commands,
  and audit logs in process memory, including when MongoDB is connected. In
  production it uses MongoDB for user lookup and upserts settings only.
- Former Mongoose schemas declared the other collections, but their handlers
  did not read or write those models. MongoDB is unavailable here, so existing documents
  could not be inspected.
- Mongoose creates model collections using its pluralization rules. The Django
  repository must use those exact collection names and must not rename/drop
  collections. Collection names were confirmed against Mongoose pluralization.
- Demo login credentials are `admin@sentinel.local` and
  `viewer@sentinel.local`, both with `admin123`; demo mode is enabled by default.
- Login returns an 8-hour HS256 JWT with `sub`, `email`, and `role` claims. The
  browser's logout is client-side token removal; there is no logout endpoint.
- Heartbeats are accepted only for a known `X-Agent-Key`. Demo keys are held by
  the fixture records. No system-registration route existed in the former API.
- The offline status transition runs every 30 seconds with a 90-second stale
  threshold and creates one alert when a system first transitions offline.
- The former PDF renderer had a one-page landscape requirement. Django retains
  the A4 landscape, single-page output constraint.
- The React dashboard and PowerShell agent remain in place. The Django backend
  now occupies `server/` and is the only API backend.
- No WebSocket/SSE or Sophos Firewall implementation was found.