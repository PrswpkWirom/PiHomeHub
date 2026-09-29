# PiHomeHub

PiHomeHub is a private home dashboard and service control center for a Raspberry Pi or Linux home server. It brings devices, Docker services, host metrics, household tasks, and infrastructure notifications into one authenticated interface.

Use the production Docker Compose stack for an always-on server. The application runtime is already containerized; Python and Node.js are needed on the host only for direct development.

## Features

- **Overview:** host CPU, memory, root disk and temperature, devices, service status, and quick links.
- **Devices:** manual inventory, debounced reachability, Wake-on-LAN, and manual Tailscale synchronization.
- **Services:** Docker state and optional health status; restricted start, stop, and restart for AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto.
- **Notifications:** persistent per-account inboxes, unread Bell, filtered history, explicit read actions, and personal delivery preferences. The backend monitors infrastructure every 30 seconds while the browser is closed.
- **Planner:** household and maintenance tasks. Deadline notifications are deferred until tasks have real due dates.
- **Accounts:** administrator/viewer roles, personal passwords and sessions, recent authentication for sensitive actions, and audit history.

PiHomeHub is intended for trusted LAN or Tailscale access. Each person signs in with a local PiHomeHub account.

## What runs where

| Component | Deployment | Responsibility |
|---|---|---|
| Web | Container | Built React app served by Caddy; no Vite development server in production |
| Backend | Container | FastAPI, SQLite access, notification monitor, authentication, and integrations |
| Control agent | Private container | Allowlisted Docker status/start/stop/restart; the only application container with the Docker socket |
| Wake-on-LAN agent | Container with host networking | Signed requests and LAN broadcast packets |
| HTTPS ingress | Container | Caddy; only the core HTTPS listener is published, on loopback by default |
| SQLite | Persistent Docker volume | Accounts, sessions, devices, tasks, audit events, and notification history/state |
| Tailscale | Host service | Private remote access and persistent host identity |
| Docker and host metrics | Host | Container runtime; narrowly mounted read-only memory, thermal, network, and root-filesystem probes |
| Backups | Host script and optional timer | Verified snapshots and private configuration bundles |

SQLite does not need its own container. The notification monitor runs inside the backend. This single-host deployment does not require Redis, a task queue, Kubernetes, or an additional proxy.

```text
Browser -> Tailscale Serve -> loopback Caddy HTTPS
                              |-> static web container
                              |-> backend -> persistent SQLite volume
                                          |-> read-only host metrics
                                          |-> private Docker control agent
                                          |-> host-network Wake-on-LAN agent
```

## Stable home-server setup

Start with a maintained 64-bit Linux installation, such as [Raspberry Pi OS Lite (64-bit)](https://www.raspberrypi.com/documentation/computers/os.html). Use reliable power and cooling, a wired connection where practical, and a DHCP reservation for the server. An SSD is useful for persistent service data; verify the actual disk and power arrangement before enabling the optional services. The core app and the optional Git/password/DNS services have different resource needs; no load or capacity guarantee is implied.

Install Docker Engine, Docker Compose v2, Git, and Tailscale on the host. Compose 2.24.4 or newer is required by the development override. See [Docker installation](https://docs.docker.com/engine/install/) and [Tailscale installation](https://tailscale.com/docs/install/linux).

Run the commands below from the repository root. `scripts/compose.sh` always selects the production file and `infra/.env`.

1. Create configuration and generate two independent secrets:

   ```bash
   cp infra/.env.example infra/.env
   chmod 600 infra/.env
   openssl rand -hex 32
   openssl rand -hex 32
   ```

   Edit `infra/.env`: put different generated values in `PIHOMEHUB_SECRET_KEY` and `PIHOMEHUB_CONTROL_AGENT_SECRET`. Set `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS` to the exact HTTPS origin for your server. Set `DOCKER_GID` to the result of `stat -c "%g" /var/run/docker.sock`. Keep the existing Compose project name when upgrading; changing it can select a different database volume.

2. Prepare the empty host root-disk probe and enable host services at boot:

   ```bash
   sudo ./scripts/prepare-host-metrics.sh
   sudo systemctl enable --now docker tailscaled
   ```

   If you customize `PIHOMEHUB_HOST_ROOT_METRICS_PATH`, pass that same path to the preparation script. The [deployment guide](docs/production-deployment.md) explains host mounts and validation.

3. Build and initialize the database before starting the application:

   ```bash
   ./scripts/compose.sh config -q
   ./scripts/compose.sh build backend control-agent wol-agent web
   ./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
   ./scripts/compose.sh run --rm --no-deps backend python -m app.cli create-admin
   ./scripts/compose.sh up -d --wait --wait-timeout 180
   ```

   Choose a unique administrator password at the secure CLI prompt. Existing installations should follow the [backup and upgrade procedure](docs/production-deployment.md#upgrades), rather than creating another first administrator.

4. Publish the loopback listener privately through Tailscale:

   ```bash
   sudo tailscale serve --bg https+insecure://127.0.0.1:443
   tailscale serve status
   ./scripts/compose.sh ps
   ```

   Open the HTTPS URL reported by Tailscale. Configure tailnet access controls and keep Funnel disabled. For LAN HTTPS and proxy-address configuration, see [Tailscale Serve](docs/tailscale-serve.md) and the [deployment guide](docs/production-deployment.md).

5. Take a verified backup and arrange daily backups to storage that survives loss of the Pi:

   ```bash
   ./scripts/backup.sh /path/to/private/backup-storage
   ```

   The snapshot contains the PiHomeHub database, configuration, secrets, source revision, and checksums. It does not include the optional services data. Instructions for the supplied daily timer, off-device copies, retention, and a restore drill are in [Backups and restore](docs/production-deployment.md#backups-and-restore).

The Compose stack includes health checks, startup readiness checks, graceful shutdown, restart policies, and container log rotation. Docker restarts exited containers with `unless-stopped`; a health check alone does not restart a hung container. Use a monitor outside this Pi to detect a whole-server outage. PiHomeHub cannot produce notifications while its own backend or host is down.

## Daily operations

```bash
./scripts/compose.sh ps
./scripts/compose.sh logs --tail 100 backend control-agent wol-agent caddy
./scripts/compose.sh restart backend
./scripts/backup.sh /path/to/private/backup-storage
```

Enable automatic OS security updates according to your host policy, keep Docker/Tailscale current, and review pinned application images and dependency advisories before upgrading. Reboot-test the server, verify backup restores, and periodically check free space. Notification/audit history currently has no automatic retention policy. Keep one backend instance using the local SQLite volume; the persisted monitor lock prevents duplicate collectors on that database.

A stable first deployment should pass the [acceptance checks](docs/production-deployment.md#acceptance-checks): host reboot, metrics source, browser-closed outage/recovery, backend restart persistence, independent account badges, and backup restoration. This repository provides a single-host deployment; availability still depends on the Pi, its storage, power, and network.

## Optional home services

Enable optional services deliberately after the core dashboard is working:

```bash
./scripts/compose.sh --profile home-services up -d
```

The `home-services` profile enables AdGuard Home, Gitea, Uptime Kuma, and Vaultwarden. Mosquitto uses a separate `mqtt` profile:

```bash
./scripts/create-mqtt-credentials.sh sensor-bedroom
./scripts/compose.sh --profile mqtt up -d
```

Follow [MQTT security](docs/mqtt-security.md) for credentials and ACLs. Optional service ports default to loopback; choose trusted LAN addresses and firewall rules before using them from other machines. DNS, Git, MQTT, and password-manager data need their own backups. Configure those applications access controls and HTTPS as appropriate; the core dashboard ingress does not automatically proxy every optional service.

Production host-port changes are operator-managed: edit `infra/.env`, validate configuration, and recreate the affected service. The control agent starts/stops existing containers; create optional containers with Compose first.

## Local development

Direct development requires Python 3.12+, Node.js 24 LTS and npm, and separate development configuration. It sends Wake-on-LAN directly from the host.

```bash
cp apps/backend/.env.example apps/backend/.env
python3 -m venv .venv
.venv/bin/pip install -r apps/backend/requirements.txt
PYTHONPATH=apps/backend .venv/bin/alembic -c apps/backend/alembic.ini upgrade head
PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin
npm ci --prefix apps/web
./scripts/run-dev.sh
```

Open <http://localhost:5173>. Run migrations again after schema changes; `run-dev.sh` starts servers without applying migrations. Use unique credentials in each environment.

For Docker development, use both Compose files explicitly:

```bash
cp infra/.env.example infra/.env
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml build
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend alembic upgrade head
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend python -m app.cli create-admin
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up
```

The override uses Vite, source mounts, development secrets, and published 5173/8000 ports. Its `backend-dev-data` volume is separate from production `backend-data`. Older development containers stored `/data` in their writable container layer; export or copy that database before recreating them with this version. Direct Python development uses a third, local database. Use production configuration for the always-on home server.

## Repository and verification

- `apps/backend`: FastAPI, SQLAlchemy, Alembic, collectors, notifications, and SQLite backup CLI.
- `apps/control_agent`: Docker control and Wake-on-LAN agents.
- `apps/web`: React, TypeScript, TailwindCSS, and PWA shell.
- `infra`: production/development Compose, Caddy, MQTT, and optional backup timer.
- `scripts`: production Compose wrapper, backups, host-metric preparation, and development helpers.

```bash
PYTHONPATH=apps/backend .venv/bin/pytest apps/backend/app/tests
npm --prefix apps/web test -- --run
npm --prefix apps/web run build
./scripts/compose.sh config -q
./scripts/compose.sh build backend control-agent wol-agent web
```

The test environment needs the Compose v2 plugin. Production validation needs a configured `infra/.env`; keep real secrets out of source control. The build images pin exact tags/digests, and frontend dependencies use the committed lockfile.

## Documentation

- [Production deployment and operations](docs/production-deployment.md)
- [Development setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Authentication and sessions](docs/authentication.md)
- [Authorization matrix](docs/authorization-matrix.md)
- [Docker control agent](docs/control-agent.md)
- [MQTT security](docs/mqtt-security.md)
- [Tailscale Serve](docs/tailscale-serve.md)
- [Dependency security](docs/dependency-security.md)
