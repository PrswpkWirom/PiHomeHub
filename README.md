# PiHomeHub

PiHomeHub is a local-first home dashboard and private Raspberry Pi service
control center. It is designed for trusted LAN or Tailscale access and brings
home infrastructure into one authenticated interface.

## What it does today

- **Overview:** Raspberry Pi system metrics, active devices, service status,
  quick links, and planner tasks.
- **Devices:** Manual device inventory, status checks, Wake-on-LAN, and
  Tailscale machine synchronization.
- **Services:** Status and control for the fixed managed-service allowlist:
  AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto.
- **Planner:** Create and manage maintenance or household tasks.
- **Settings:** Tailscale credentials and sync, service links, service port
  configuration, sessions, and administrator controls.
- **Security:** Viewer/admin authorization, opaque revocable sessions, CSRF and
  origin checks, Argon2id password hashing, recent-authentication checks, login
  rate limiting, and audit events.

Production service actions go through a small HMAC-authenticated control agent.
Only that agent mounts the Docker socket; the web-facing FastAPI backend does
not.

## Architecture and stack

```text
Browser
  -> Tailscale Serve or loopback Caddy HTTPS
     -> React/Vite PWA
     -> FastAPI API
        -> SQLite, host metrics, Tailscale API, and Wake-on-LAN
        -> private HMAC-authenticated control network
           -> restricted Docker control agent
```

- `apps/backend`: FastAPI API, SQLAlchemy models, Alembic migrations, and
  service integrations
- `apps/control_agent`: restricted Docker status/start/stop/restart agent
- `apps/web`: React, Vite, TypeScript, TailwindCSS, and PWA shell
- `infra`: Docker Compose, Caddy, and optional Mosquitto configuration
- `scripts`: local development, installation, startup, and Wake-on-LAN helpers
- `docs`: setup, architecture, security, deployment, and operations guidance

## Requirements

- Python 3.12+
- Node.js 20.19.5 and npm (the same pinned release used by the frontend image)
- Docker Engine and Docker Compose for containerized development or production
- Tailscale for private remote access in a Raspberry Pi deployment

## Local development

Run these commands from the repository root.

1. Create the local configuration, Python environment, database, and frontend dependencies:

   ```bash
   cp apps/backend/.env.example apps/backend/.env
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -r apps/backend/requirements.txt
   PYTHONPATH=apps/backend .venv/bin/alembic -c apps/backend/alembic.ini upgrade head
   npm ci --prefix apps/web
   ```

2. Create the local administrator interactively:

   ```bash
   PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin
   ```

   For this local instance, use username `admin` and password
   `1234567891011`. Admin passwords are saved as Argon2id hashes in the local
   SQLite database; the CLI does not put the password in `.env`.

3. Start the frontend:

   ```bash
   npm --prefix apps/web run dev
   ```

4. In another terminal, run the API:

   ```bash
   uvicorn app.main:app --app-dir apps/backend --reload
   ```

   Open <http://localhost:5173>.

For a single command that starts both local servers, install dependencies as
above and run:

```bash
./scripts/run-dev.sh
```

## Docker development

The development override enables source mounts, Vite HMR, and local API
ports. Install Docker Engine and the Docker Compose v2 plugin first. From the
repository root, create the bind-mounted local config, then build and
initialize the persistent development database:

```bash
cp infra/.env.example infra/.env

docker compose \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.dev.yml \
  build

docker compose \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.dev.yml \
  run --rm backend alembic upgrade head

docker compose \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.dev.yml \
  run --rm backend python -m app.cli create-admin

docker compose \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.dev.yml \
  up
```

Open <http://localhost:5173>. The development backend is available at
<http://localhost:8000>. The Compose development database is separate from
the local Python database, so create its admin with the command above. The
development override credentials and secrets are for local use only. For a
quick login, enter `admin` and `1234567891011` at the CLI prompts.

## Production deployment

Production publishes only the Caddy HTTPS ingress, bound to loopback by
default. The backend, frontend, and control agent are private containers; the
frontend is served as a static build and the backend has no Docker socket
mount.

1. Install Docker Engine with the Docker Compose v2 plugin and Tailscale on
   the Raspberry Pi. Keep host firewall access limited to the trusted LAN or
   tailnet.
2. Create production configuration and generate two independent secrets:

   ```bash
   cp infra/.env.example infra/.env
   openssl rand -hex 32
   openssl rand -hex 32
   ```

   Set the generated values as `PIHOMEHUB_SECRET_KEY` and
   `PIHOMEHUB_CONTROL_AGENT_SECRET`. Set
   `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS` to the exact
   HTTPS origin you will use.

3. Build, migrate, create the first administrator, and start the stack:

   ```bash
   docker compose --env-file infra/.env -f infra/docker-compose.yml config -q
   docker compose --env-file infra/.env -f infra/docker-compose.yml build
   docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm backend alembic upgrade head
   docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm backend python -m app.cli create-admin
   docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
   ```

4. To expose the loopback-bound Caddy listener privately through Tailscale:

   ```bash
   sudo tailscale serve --bg https+insecure://127.0.0.1:443
   tailscale serve status
   ```

   Do not enable Tailscale Funnel.

5. Check service status and logs with `docker compose --env-file infra/.env -f
   infra/docker-compose.yml ps` and `docker compose --env-file infra/.env -f
   infra/docker-compose.yml logs -f backend caddy web`. Back up the Docker
   volume `backend-data` and `infra/.env` before upgrades; see the production
   runbook for restore and secret rotation.

See [Production deployment](docs/production-deployment.md) and
[Tailscale Serve](docs/tailscale-serve.md) for the complete checklist,
backups, rotation, and firewall guidance.

## Optional services

The managed home services are disabled unless the `home-services` profile is
selected:

```bash
docker compose -f infra/docker-compose.yml --profile home-services up -d
```

Mosquitto is separately disabled unless the `mqtt` profile is selected. Create
per-device credentials and ACLs before enabling it; see
[MQTT security](docs/mqtt-security.md).

Service host-port changes are operator-managed in production: edit
`infra/.env`, validate the Compose configuration, and redeploy. The API does
not directly edit production port bindings.

## Configuration

Backend settings use the `PIHOMEHUB_` environment prefix. Use
`apps/backend/.env.example` for direct local development and
`infra/.env.example` for Docker deployment. Never commit real secrets,
Tailscale tokens, generated MQTT credentials, or production passwords.

Quick links and known manual devices can be seeded with JSON environment
values. Seeded devices are initial defaults; if a user deletes or renames one,
PiHomeHub records that choice and does not recreate the old seed on later
bootstraps.

## Verification commands

```bash
# Backend tests
PYTHONPATH=apps/backend .venv/bin/pytest apps/backend/app/tests

# Frontend tests and production build
cd apps/web
npm test -- --run
npm run build

# Validate the production Compose file (after creating infra/.env)
cd ../..
docker compose --env-file infra/.env -f infra/docker-compose.yml config -q
```

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Authentication and sessions](docs/authentication.md)
- [Authorization matrix](docs/authorization-matrix.md)
- [Production deployment](docs/production-deployment.md)
- [Docker control agent](docs/control-agent.md)
- [MQTT security](docs/mqtt-security.md)
- [Tailscale Serve](docs/tailscale-serve.md)
- [Dependency security](docs/dependency-security.md)
- [Operations runbook](LOCAL_OPERATIONS_RUNBOOK.md)
- [Repository and contribution guidelines](AGENTS.md)
