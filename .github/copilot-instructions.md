# Workspace Notes

- System Monitoring Health uses a Django/Python API in `server/`, a React/Vite frontend in `client/`, MongoDB, and a PowerShell monitoring agent.
- Install the API with `python3 -m venv server/.venv`, `server/.venv/bin/python -m pip install -r server/requirements.txt`, and `cp .env.example server/.env`.
- Install frontend packages with `npm install --prefix client`.
- Start Django with `server/.venv/bin/python server/manage.py runserver 0.0.0.0:8000` and React with `npm run dev --prefix client` in separate terminals.
- Use `DJANGO_DEBUG=True` and `DEMO_MODE=true` for local fixtures; configure MongoDB and production secrets for persistent deployment.
