# PiHomeHub

Local-first Raspberry Pi home dashboard and private server control center.

PiHomeHub is designed for LAN or Tailscale access. It combines system status,
service monitoring, device inventory, Wake-on-LAN controls, Tailscale device
sync, and quick links for self-hosted services.

## Stack

- `apps/backend`: FastAPI, SQLAlchemy, Alembic, SQLite
- `apps/web`: React, Vite, TypeScript, TailwindCSS, PWA shell
- `infra`: Docker Compose and Caddy

## Features

- Dashboard with Pi system metrics, active devices, service status, quick links, and planner tasks
- Manual device inventory with Wake-on-LAN support
- Tailscale API integration for syncing machines from a tailnet
- Tailscale device settings with display names, read-only machine details, and WOL configuration
- Docker service status monitoring for AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto
- Authenticated dashboard with explicit viewer/admin authorization, revocable sessions, and CSRF protection
- Restricted Docker control agent; the web-facing backend never mounts the Docker socket

## Quick Start

1. Copy `apps/backend/.env.example` to `apps/backend/.env`, generate the two secrets, and keep administrator environment fields empty.
2. Bootstrap Python dependencies and database:
   - `python3 -m venv .venv`
   - `. .venv/bin/activate`
   - `pip install -r apps/backend/requirements.txt`
   - `cd apps/backend && ../../.venv/bin/alembic upgrade head && cd ../..`
   - `PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin`
3. Start the backend:
   - `uvicorn app.main:app --app-dir apps/backend --reload`
4. Install frontend dependencies and start the web app:
   - `cd apps/web`
   - `npm install`
   - `npm run dev`

## Docker

Production requires generated secrets, an HTTPS origin, database migration, and interactive administrator creation. Follow [Production deployment](docs/production-deployment.md); do not start from the old single `docker compose up` flow.

Development uses the explicit override:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up --build
```

## Configuration

Backend settings use the `PIHOMEHUB_` environment prefix. The example file
includes session timeouts, the fixed monitored-service allowlist, allowed origins,
seeded quick links, and seeded manual devices. Production refuses environment-supplied administrator passwords and weak/default secrets.

Seeded manual devices are intended as initial defaults. If a seeded manual
device is deleted or renamed in the app, PiHomeHub records that choice and does
not recreate the old seed on later bootstraps.

## Tailscale

Open `Settings` in the web app to save a Tailscale API token and tailnet, test
the connection, and sync machines. The token is encrypted in the backend
database and is write-only in the UI.

Open `Devices` to manage synced Tailscale devices. The `Setting` action lets you
set a display name, inspect read-only Tailscale machine data, and configure
Wake-on-LAN fields.

## Useful Commands

```bash
PYTHONPATH=apps/backend ./.venv/bin/pytest apps/backend/app/tests
cd apps/web && npm run build
docker compose -f infra/docker-compose.yml config
```

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Authentication](docs/authentication.md)
- [Authorization matrix](docs/authorization-matrix.md)
- [Production deployment](docs/production-deployment.md)
- [Docker control agent](docs/control-agent.md)
- [Contributor guide](AGENTS.md)
