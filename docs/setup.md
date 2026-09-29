# Setup

## Local development

Use Python 3.12+ and Node.js 24 LTS (the frontend version is recorded in `apps/web/.nvmrc`).

1. Copy `apps/backend/.env.example` to `apps/backend/.env` for local settings. Development-only secret defaults are provided; production secrets are required only for deployment.
2. Create the Python environment and database:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r apps/backend/requirements.txt
PYTHONPATH=apps/backend .venv/bin/alembic -c apps/backend/alembic.ini upgrade head
PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin
```

3. Run the API and frontend in separate terminals:

Terminal 1:

```bash
.venv/bin/uvicorn app.main:app --app-dir apps/backend --reload --no-proxy-headers
```

Terminal 2:

```bash
npm ci --prefix apps/web
npm --prefix apps/web run dev
```

Open <http://localhost:5173>. For a single command that starts both servers,
install frontend dependencies and run `./scripts/run-dev.sh` from the repo
root. The API health endpoint at <http://localhost:8000/health> checks HTTP and database connectivity; it does not require authentication or report host details.

The development cookie is deliberately non-Secure and uses a separate name. Never use the development override as production.

## Docker production

Use [production-deployment.md](production-deployment.md). Create
`infra/.env`, generate the required independent secrets, and pass the file with
`--env-file infra/.env` to Compose. Production uses direct private HTTP on the chosen Tailscale/LAN IP, or optional
HTTPS on loopback with Tailscale Serve, with static frontend assets, no backend/control-agent host ports, no
Docker socket in FastAPI, and no environment-supplied administrator password.

For an explicit Docker development stack, first copy
`infra/.env.example` to `infra/.env`. Initialize the database and create the
administrator before starting the stack:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml build
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend alembic upgrade head
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend python -m app.cli create-admin
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up
```

## Bootstrap data and Tailscale

Quick links and known devices may be seeded from JSON environment values. In Settings, administrators can store an encrypted Tailscale token, test it, and sync devices. The token is write-only. Device aliases and WOL metadata stay local. For Wake-on-LAN, use the target LAN's directed broadcast address (for example, `192.168.1.255`) when the default limited broadcast does not reach the device. A restricted Wake-on-LAN agent uses host networking so production wake packets leave Docker through the Pi's LAN interface. Production service port bindings are changed only by editing `infra/.env` and redeploying; the web apply endpoint is disabled.

The Docker development override uses `backend-dev-data`, separate from production
`backend-data`. Back up any older development container database before recreating
it: earlier versions kept `/data` in the container writable layer.
