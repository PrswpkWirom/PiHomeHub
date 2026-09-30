# PiHomeHub

PiHomeHub is a private dashboard for your Raspberry Pi or Linux home server. Use it to check your server, manage Docker services, wake devices, save useful links, and track household tasks.

Open it from your home network or through Tailscale. Each person signs in with a PiHomeHub account.

## What you can do

| Page | What it does |
|---|---|
| Overview | Shows server health, devices, service status, and dashboard links |
| Devices | Keeps a device inventory, checks reachability, and sends Wake-on-LAN packets |
| Services | Creates, starts, stops, and restarts supported containers; opens their dashboards |
| Planner | Tracks household and maintenance tasks |
| Notifications | Shows infrastructure alerts and recovery events, with per-account read status |
| Settings | Manages your account, sessions, and notification preferences |

The backend checks infrastructure even when your browser is closed. It cannot send notifications when the server itself is down. Planner deadline notifications are not yet supported.

## Add or change dashboard links

On **Services**, find the **Dashboards** panel:

1. Click **Add quick link** to add another service, such as your aircon web page.
2. Enter a name and the complete URL, including `http://` or `https://`, any port, and any path.
3. Click **Save link**.

To change an existing link, click **Edit** beside it. Every card shows its current URL. Saved URLs take priority over automatically detected addresses and are also used on Overview. Only administrators can add or edit links.

For Vaultwarden, enter its working **HTTPS** URL. Saving an HTTPS address changes the link; it does not configure HTTPS on the service. See the setup below.

## First-time server setup

Run these commands from the repository folder. For an existing installation, use [Update the app](#update-the-app).

### 1. Install the prerequisites

The host needs:

- Docker Engine with Docker Compose v2 and Buildx
- Git, Python 3, and OpenSSL; Python runs the service-configuration helper
- Tailscale, connected to your tailnet

The application runs in containers. Node.js and backend Python dependencies are only needed for direct local development.

Check your installation:

```bash
docker compose version
docker buildx version
sudo tailscale up
tailscale ip -4
```

If Docker's Compose or Buildx plugin is missing, follow the package instructions in the [deployment guide](docs/production-deployment.md).

### 2. Configure your server address and secrets

```bash
cp infra/.env.example infra/.env
chmod 600 infra/.env
openssl rand -hex 32
openssl rand -hex 32
```

Edit `infra/.env`. Put the two different generated secrets in `PIHOMEHUB_SECRET_KEY` and `PIHOMEHUB_CONTROL_AGENT_SECRET`.

For private access through Tailscale, use the settings below. Replace **every** example IP with the address printed by `tailscale ip -4`:

```env
PIHOMEHUB_ACCESS_MODE=private-http
PIHOMEHUB_BIND_ADDRESS=100.65.234.44
PIHOMEHUB_INGRESS_BIND_ADDRESS=100.65.234.44
PIHOMEHUB_HTTPS_BIND_ADDRESS=127.0.0.1
PIHOMEHUB_HTTP_PORT=80
PIHOMEHUB_PUBLIC_BASE_URL=http://100.65.234.44
PIHOMEHUB_ALLOWED_ORIGINS=http://100.65.234.44
```

Set `DOCKER_GID` to the number printed by:

```bash
stat -c '%g' /var/run/docker.sock
```

Keep `infra/.env` private. The bind addresses contain only an IP; the public URL and allowed origin include the scheme and any nonstandard port.

### 3. Build and start PiHomeHub

```bash
sudo ./scripts/prepare-host-metrics.sh
sudo systemctl enable --now docker tailscaled
./scripts/compose.sh config -q
./scripts/compose.sh build backend control-agent wol-agent web
./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
./scripts/compose.sh run --rm --no-deps backend python -m app.cli create-admin
./scripts/compose.sh up -d --wait --wait-timeout 180
```

The administrator command asks you to choose a password. The migration command prepares the database before the app starts.

Open `http://<your-server-tailscale-ip>` from a device on the same tailnet and sign in. This setup does not require Tailscale Serve for PiHomeHub. Docker starts the containers again after a reboot unless you explicitly stopped them.

For LAN access, HTTPS for PiHomeHub, host storage, and deployment checks, see the [production deployment guide](docs/production-deployment.md).

## Manage supported services

PiHomeHub supports AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto.

On **Services**, click **Create and start** for a service that is not installed. PiHomeHub downloads its image and shows progress. Installed services show the actions available for their current state. You can reload the page and check progress again.

Service ports are configured in `infra/.env` and shown as read-only in the production UI. A dashboard URL override does not change a container's port. Keep the Compose project name `infra` when upgrading so existing service volumes are reused.

Mosquitto needs credentials and an access-control list before it can start. Follow [MQTT setup](docs/mqtt-security.md). Optional services need their own accounts and data backups.

## Give Vaultwarden HTTPS on every boot

The included script publishes Vaultwarden through Tailscale at your server's HTTPS tailnet hostname.

The script currently targets `http://100.65.234.44:3004`. If your server has a different IP or Vaultwarden port, edit `scripts/serve-vaultwarden.sh` before installing it.

Run once:

```bash
sudo bash scripts/install-vaultwarden-serve.sh
```

Enter your Linux sudo password when prompted. The installer starts the configuration immediately and enables a systemd service to run it after Tailscale starts on each boot. Failed attempts retry automatically.

Each run performs:

```bash
tailscale serve reset
tailscale serve --bg --yes --https=443 http://100.65.234.44:3004
```

**This replaces all existing Tailscale Serve routes on the server.** Port 443 will serve Vaultwarden. The `--bg` option keeps the route active after the script finishes.

Check the result:

```bash
tailscale serve status
systemctl status pihomehub-vaultwarden-serve.service
```

Copy the HTTPS URL shown by `tailscale serve status` into Vaultwarden's dashboard link in PiHomeHub. Use that hostname instead of the numeric IP. If Tailscale asks you to enable HTTPS for your tailnet, follow its authorization link, then run:

```bash
sudo systemctl restart pihomehub-vaultwarden-serve.service
```

For logs or removal instructions, see the [local operations runbook](LOCAL_OPERATIONS_RUNBOOK.md#vaultwarden-https-at-boot).

## Update the app

Back up first, then build, migrate, and restart:

```bash
./scripts/backup.sh
./scripts/compose.sh build backend control-agent wol-agent web
./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
./scripts/compose.sh up -d --wait --wait-timeout 180
```

Apply migrations before starting the new backend. Updates do not automatically install optional services. Do not use `docker compose down -v`: it deletes persistent volumes.

## Backups and troubleshooting

| Task | Command |
|---|---|
| Check containers | `./scripts/compose.sh ps` |
| Read recent logs | `./scripts/compose.sh logs --tail 100 backend control-agent web caddy` |
| Restart the backend | `./scripts/compose.sh restart backend` |
| Back up locally | `./scripts/backup.sh` |
| Back up elsewhere | `./scripts/backup.sh /path/to/private/backup-storage` |

Backups include the PiHomeHub database, control-agent operation history, private configuration, source revision, and checksums. They contain secrets. Store a copy away from this server. They do **not** include the optional services' data.

If an update is not visible, refresh the browser with **Ctrl+Shift+R**. If saving fails after you change the app's access URL, check `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS`, redeploy, and sign in again.

See [Backups and restore](docs/production-deployment.md#backups-and-restore) for scheduled backups and recovery instructions.

## Local development

Direct development needs Python 3.12+ and Node.js 24 LTS with npm:

```bash
cp apps/backend/.env.example apps/backend/.env
python3 -m venv .venv
.venv/bin/pip install -r apps/backend/requirements.txt
PYTHONPATH=apps/backend .venv/bin/alembic -c apps/backend/alembic.ini upgrade head
PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin
npm ci --prefix apps/web
./scripts/run-dev.sh
```

Open <http://localhost:5173>. Use separate development credentials and configuration. The development helper does not apply migrations automatically. For Docker development, see [Development setup](docs/setup.md) and the [local operations runbook](LOCAL_OPERATIONS_RUNBOOK.md).

Run checks:

```bash
PYTHONPATH=apps/backend .venv/bin/pytest apps/backend/app/tests
npm --prefix apps/web test -- --run
npm --prefix apps/web run build
./scripts/compose.sh config -q
```

## Project layout and further reading

| Folder | Contents |
|---|---|
| `apps/web` | React frontend |
| `apps/backend` | API, database migrations, authentication, and notification monitoring |
| `apps/control_agent` | Docker control and Wake-on-LAN agents |
| `infra` | Docker Compose, Caddy, MQTT, and systemd units |
| `scripts` | Setup, deployment, backups, and development helpers |

- [Production deployment](docs/production-deployment.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Authentication](docs/authentication.md) and [permissions](docs/authorization-matrix.md)
- [Docker control agent](docs/control-agent.md)
- [MQTT security](docs/mqtt-security.md)
- [Tailscale Serve](docs/tailscale-serve.md)
- [Dependency security](docs/dependency-security.md)
