# Setup

## Local development

1. Copy `apps/backend/.env.example` to `apps/backend/.env`; generate independent secrets with `openssl rand -hex 32`.
2. Create the Python environment and database:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r apps/backend/requirements.txt
(cd apps/backend && ../../.venv/bin/alembic upgrade head)
PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin
```

3. Run `uvicorn app.main:app --app-dir apps/backend --reload`.
4. Run `cd apps/web && npm ci && npm run dev`.

The development cookie is deliberately non-Secure and uses a separate name. Never use the development override as production.

## Docker production

Use [production-deployment.md](production-deployment.md). Production has one loopback-bound HTTPS ingress, static frontend assets, no backend/control-agent host ports, no Docker socket in FastAPI, and no environment-supplied administrator password.

For an explicit Docker development stack:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up --build
```

## Bootstrap data and Tailscale

Quick links and known devices may be seeded from JSON environment values. In Settings, administrators can store an encrypted Tailscale token, test it, and sync devices. The token is write-only. Device aliases and WOL metadata stay local. Production service port bindings are changed only by editing `infra/.env` and redeploying; the web apply endpoint is disabled.
