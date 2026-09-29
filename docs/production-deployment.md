# Production deployment and operations

This guide runs PiHomeHub as one persistent Docker Compose stack on a 64-bit Linux home server. The backend, frontend, Docker control agent, Wake-on-LAN agent, and Caddy ingress already run in containers. Tailscale and Docker are host services. SQLite is a database file in the backend volume; the notification monitor runs inside the backend.

## Host preparation

Use a maintained 64-bit OS, adequate power/cooling, and storage suitable for continuous writes. Prefer a wired link and reserve the server address in your router. Start with the core stack and measure resource use before adding optional applications. Keep physical/network recovery access available.

Install Docker Engine with Compose v2, Git, and Tailscale using their official instructions. The development override requires [Compose 2.24.4+](https://docs.docker.com/reference/compose-file/merge/) because it uses `!override`. Python and Node are provided by build/runtime images for production.

```bash
docker version
docker compose version
docker buildx version
sudo systemctl enable --now docker tailscaled
```

If Compose or Buildx reports an unknown command, install the plugins matching your Docker installation. Ubuntu's `docker.io` package uses `sudo apt install docker-compose-v2 docker-buildx`; Docker's official repository uses `sudo apt install docker-compose-plugin docker-buildx-plugin`. The wrapper checks Compose availability before running deployment commands. Plugins manually installed in `~/.docker/cli-plugins` are available only to that user and must be updated manually; prefer system packages on the production server, including for the root-run backup timer.

Choose a persistent checkout location, for example `/opt/PiHomeHub`. Run commands from that checkout. `./scripts/compose.sh` is the production wrapper; it supplies the correct Compose file and environment file even when called by a timer.

### Configuration

```bash
cp infra/.env.example infra/.env
chmod 600 infra/.env
openssl rand -hex 32
openssl rand -hex 32
stat -c "%g" /var/run/docker.sock
```

Set the two independent secret values, the direct private address and matching public/allowed origin, and the Docker socket group ID in `infra/.env`. Keep the application secret with backups: the database contains encrypted Tailscale credentials that depend on it. Store administrator passwords separately in your password manager; the CLI stores Argon2id hashes in SQLite.

Join the server to the tailnet using `sudo tailscale up` once. For convenient direct access, run `tailscale ip -4` and set the example values below to that server IP:

```env
PIHOMEHUB_ACCESS_MODE=private-http
PIHOMEHUB_INGRESS_BIND_ADDRESS=100.108.62.50
PIHOMEHUB_HTTPS_BIND_ADDRESS=127.0.0.1
PIHOMEHUB_HTTP_PORT=80
PIHOMEHUB_PUBLIC_BASE_URL=http://100.108.62.50
PIHOMEHUB_ALLOWED_ORIGINS=http://100.108.62.50
```

Open `http://100.108.62.50` from another tailnet machine. Replace that example with the actual server address. No Tailscale Serve or certificate setup is needed. For LAN access, substitute the host's fixed LAN IP in all three address fields. The bind address must exist on the host before containers start; include this check in reboot acceptance. Keep backend and control-agent ports private, and choose host firewall/tailnet rules appropriate to the selected interface.

Private HTTP is an explicit production mode. It retains authentication, authorization, rate limiting, HttpOnly/host-only/SameSite cookies, and CSRF checks. Its distinct cookie names omit `Secure` so browsers can send them over HTTP; HTTPS mode continues to use Secure `__Host-` cookies. Configuration rejects public-IP/hostname HTTP origins. Tailscale encrypts traffic between tailnet machines; LAN HTTP does not supply transport encryption. Use HTTPS mode for browser TLS or PWA/service-worker support.

The default Compose project is `infra` because the Compose file lives there. If you set `COMPOSE_PROJECT_NAME`, choose it before first deployment and keep it identical in manual commands, timers, upgrades, and restores. A different project name selects different named volumes. The fixed `172.30.0.0/24` edge network must not overlap your LAN/VPN; changing it requires matching proxy/WOL addresses too.

Automatic edge addresses use `172.30.0.128/25`, leaving Caddy's `.2` and development Vite's `.3` outside the automatic pool. The gateway is `.1` for the Wake-on-LAN agent. Before updating a network created without this pool, take a backup using the old configuration. Then update the configuration, run `./scripts/compose.sh down` (without `-v`), then `./scripts/compose.sh up -d --wait --wait-timeout 180`. Docker must recreate the network to apply its IPAM settings; the named database volume is retained. See [Compose IPAM configuration](https://docs.docker.com/reference/compose-file/networks/#ipam).

### Host metric mounts

Production binds `/proc/meminfo`, `/sys/class/thermal`, and `/proc/net` read-only at narrow backend paths. For disk capacity, create an empty directory on the host root filesystem:

```bash
sudo ./scripts/prepare-host-metrics.sh
```

The default is `/.pihomehub/rootfs-metrics`. The script verifies that it is empty and shares the filesystem device of `/`. Compose refuses to silently create a missing root probe. A custom path must match `infra/.env`:

```bash
sudo env PIHOMEHUB_HOST_ROOT_METRICS_PATH=/your/rootfs/probe ./scripts/prepare-host-metrics.sh
```

Confirm that `PIHOMEHUB_HOST_MEMINFO_SOURCE` and `PIHOMEHUB_HOST_THERMAL_SOURCE` exist on the host. An unavailable thermal sensor yields an unknown reading. This probe measures the root filesystem only; data on a separate USB/NVMe filesystem needs a separate disk monitor. Do not substitute container overlay capacity for the Pi root disk.

## First deployment

Validate configuration, build images, then apply migrations and provision the first administrator before starting the app:

```bash
./scripts/compose.sh config -q
./scripts/compose.sh build backend control-agent wol-agent web
./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
./scripts/compose.sh run --rm --no-deps backend python -m app.cli create-admin
./scripts/compose.sh up -d --wait --wait-timeout 180
./scripts/compose.sh ps
```

`--no-deps` keeps migration/account jobs from starting the normal app stack. Choose a unique password at the interactive CLI prompt. Do not deploy with the development override, Vite, Uvicorn reload, or development secrets.

### Optional HTTPS and Tailscale Serve

For browser HTTPS with a trusted Tailscale hostname, use the original loopback proxy mode instead:

```env
PIHOMEHUB_ACCESS_MODE=https
PIHOMEHUB_INGRESS_BIND_ADDRESS=127.0.0.1
PIHOMEHUB_PUBLIC_BASE_URL=https://your-server.your-tailnet.ts.net
PIHOMEHUB_ALLOWED_ORIGINS=https://your-server.your-tailnet.ts.net
PIHOMEHUB_TRUSTED_INGRESS_PROXY_IPS=172.30.0.1
```

```bash
./scripts/compose.sh up -d --wait --wait-timeout 180
sudo tailscale serve --bg https+insecure://127.0.0.1:443
tailscale serve status
```

Use the actual HTTPS hostname reported by Serve in both URL settings. `--bg` persists its configuration. Browser-facing HTTPS is terminated by Tailscale, while the loopback hop uses Caddy's internal certificate. See [Tailscale Serve](tailscale-serve.md) and [its official command reference](https://tailscale.com/docs/reference/tailscale-cli/serve). Keep Funnel disabled.

For direct LAN HTTPS, set `PIHOMEHUB_HOST` to the LAN IP/hostname, set `PIHOMEHUB_HTTPS_BIND_ADDRESS` to that interface, use matching HTTPS origins, and trust Caddy's local CA on clients. In HTTPS mode, port 80 redirects to HTTPS; in private HTTP mode, it serves the application directly.

### Health, restart, and logs

Core containers have 30-second health checks. Backend readiness checks database connectivity; agents check HTTP liveness; the web checks static serving; ingress checks actual HTTPS serving through its loopback listener. Ingress waits for the backend and web to become healthy, and the backend waits for its agents. Health endpoints return fixed status without account or host details. Agent liveness does not prove Docker socket permissions or successful Wake-on-LAN delivery; test those integrations separately.

Docker `unless-stopped` restarts exited containers and starts them after a daemon/host restart, unless an operator explicitly stopped them. A failing health check marks a container unhealthy; it does not automatically restart a hung process. Startup dependency ordering is applied by Compose, not re-run by Docker for every host reboot. Verify the eventual healthy state after reboot. [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/) and [Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/) explain these boundaries.

Container stdout/stderr rotates at 10 MB per file with three files per container. Persistent application data, audit/notification rows, and application-managed log files still need free-space/retention monitoring. See [Docker log rotation](https://docs.docker.com/engine/logging/drivers/json-file/).

```bash
./scripts/compose.sh ps
./scripts/compose.sh logs --tail 100 backend control-agent wol-agent caddy
./scripts/compose.sh restart backend
```

Use a monitor on another machine for the actual HTTPS endpoint and host availability. A same-Pi Uptime Kuma instance can check local services, but cannot detect or send alerts while that Pi is powered off. Keep OS, Docker, Tailscale, and pinned application dependencies current through reviewed updates. Do not attach a privileged automatic restart/updater container merely to hide repeated failures.

## Backups and restore

### Create and verify backups

```bash
./scripts/backup.sh /path/to/private/backup-storage
```

The script runs a one-shot backend container and uses the [SQLite Online Backup API](https://www.sqlite.org/backup.html), so the app may keep running and committed WAL/journal transactions are included. It performs an integrity check before writing the final snapshot and adds checksums. It does not run migrations or start a monitor.

Each private `pihomehub-<UTC timestamp>.<suffix>` directory contains:

- `pihomehub.db`: verified application database, including sessions and notification state/history.
- `configuration.tar.gz`: `infra/.env`, Compose/Caddy/MQTT configuration, and generated MQTT credentials when present.
- `revision.txt`: Git checkout revision used to create the backup.
- `SHA256SUMS`: transfer-verification checksums; a failed backup has no completed checksum manifest.

Configuration contains secrets. New directories/files are private; copy bundles to storage outside the Pi and encrypt them there. A local directory is useful for recovery from a bad update, but does not protect against disk or whole-host loss. Keep several dated restore points and manage retention on the backup destination; this script never automatically deletes completed snapshots. Verify a copied bundle:

```bash
cd /absolute/path/to/the/snapshot
sha256sum -c SHA256SUMS
```

The Git revision is checkout state, not proof of a currently running image revision. Deploy reviewed commits and retain the previously deployed revision for rollback. The backup utility must be present in the backend image; when upgrading a pre-utility release, build the new backend image before exporting the old database with its one-shot backup command.

### Daily timer

The provided systemd files assume a checkout at `/opt/PiHomeHub` and a local destination `/var/backups/pihomehub`. Edit both paths in the service before installing them if your locations differ. The service uses the same production environment/project and runs as root to reach Docker and private config.

```bash
sudo cp infra/systemd/pihomehub-backup.service infra/systemd/pihomehub-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start pihomehub-backup.service
sudo systemctl enable --now pihomehub-backup.timer
systemctl list-timers pihomehub-backup.timer
sudo journalctl -u pihomehub-backup.service --no-pager -n 30
```

The timer runs daily around 03:15 local time, with a small randomized delay and catch-up after downtime. Arrange a separate encrypted off-device copy and monitor failed/missing backups; the local timer alone does not supply those.

### Restore a snapshot

A restore replaces the current database. First take a snapshot of the current state, verify the selected backup checksums, and select compatible application code. Keep the old database/configuration backup until the restore is accepted.

Stop the backend and restore matching `infra/.env` privately if secrets or origins differ. Inspect the configuration archive before manually extracting selected files; do not blindly replace current deployment paths. To restore the database:

```bash
./scripts/compose.sh stop backend
./scripts/compose.sh run --rm --no-deps -T --user 0:0 \
  --volume /absolute/path/to/the/snapshot:/backup:ro \
  backend python -m app.backup restore /backup/pihomehub.db --confirm-replace
./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
./scripts/compose.sh up -d --wait --wait-timeout 180
```

Only the one-shot restore job runs as root, so it can read the private backup mount. The utility verifies the source database, refuses an active monitor lock, restores transactionally, and retains destination ownership (or the data directory owner for a new database). The normal backend continues as its unprivileged UID. It is still the operator responsibility to stop every backend accessing that database. Do not remove the monitor lock file to bypass the check.

Test this procedure on a separate test project/volume before depending on backups. SQLite restores also restore saved sessions; after an incident, revoke sessions and rotate the appropriate secrets/passwords. Image-only rollback may be insufficient after a schema migration; restore matching data/code together.

### Other persistent data

The core backup does not include `gitea-data`, `vaultwarden-data`, `adguard-work`, `adguard-conf`, `uptime-kuma-data`, or Mosquitto data/log volumes. Back these applications up using their own supported exports or quiesced volume snapshots. Preserve `caddy-data` separately if LAN clients trust its local certificate authority. Host Tailscale identity and OS configuration need separate host recovery planning. Record which storage mounts and volumes each service uses.

## Upgrades

Back up before changing code/schema and retain a known-good revision:

```bash
./scripts/backup.sh /path/to/private/backup-storage
git rev-parse HEAD
git pull --ff-only
./scripts/compose.sh config -q
./scripts/compose.sh build backend control-agent wol-agent web
./scripts/compose.sh stop backend
./scripts/compose.sh run --rm --no-deps backend alembic upgrade head
./scripts/compose.sh up -d --wait --wait-timeout 180
./scripts/compose.sh ps
```

Inspect the incoming revision and migrations before running this sequence. Build before stopping the backend to reduce downtime. If migration fails, keep the backend stopped, inspect the error, and recover from the verified snapshot with the compatible revision. Confirm configured browser access, accounts, history, and integrations after upgrades. Optional profiles must be explicitly included when updating their containers.

`docker compose restart` does not apply image or environment changes; recreate with `up -d`. Keep `.env` private and rotate independent application/control-agent secrets deliberately. Rotating the application secret requires re-entering encrypted Tailscale credentials; rotating the control-agent secret requires recreating backend and both agents together.

## Notification monitoring

The backend maintains a single in-process collector guarded by a process lock beside the local SQLite file. It persists confirmed states and incident keys across restarts, establishes device/service baselines silently, and discards unfinished debounce windows after gaps. Use one backend container for this home-server configuration. The monitor cannot notify while PiHomeHub itself is down.

All supported delivery preferences default on, independently per account. They affect future deliveries; they do not stop collectors or rewrite history. Tailscale synchronization remains manual. No external push, deadline alerts, or security-event notification producers are enabled.

| Signal | Default trigger | Default recovery |
|---|---|---|
| Manual device | 3 failed probes | 2 successful probes |
| Docker service | 3 stopped/missing/unhealthy observations | 2 good observations |
| Temperature | Above 75 °C for 5 minutes | At or below 70 °C for 2 minutes |
| Root disk | Above 85% warning / 95% critical for 2 minutes | At or below 90% downgrade / 80% recovery for 2 minutes |
| Memory | Above 90% for 5 minutes | At or below 85% for 2 minutes |
| Monitoring availability | A collector fails for 3 cycles | All collectors succeed for 2 cycles |

Tune the documented `PIHOMEHUB_NOTIFICATION_*` values in `infra/.env`, including `PIHOMEHUB_NOTIFICATION_METRIC_RECOVERY_SECONDS=120`, then recreate the backend. Missing measurements interrupt an unfinished confirmation window. Optional containers remain quiet until first seen running. Service actions suppress expected transition noise for up to three minutes; a restart that completes entirely between polls may be reported as unconfirmed because recovery was not observed. The request audit event remains separate from the confirmed monitor outcome.

## Acceptance checks

Before treating this server as dependable, verify on the actual host:

1. Sign in over the configured direct HTTP or HTTPS origin; confirm only the intended core ingress is published and protected writes work.
2. Confirm Docker socket group access, allowlisted service controls, and Wake-on-LAN on the physical LAN.
3. Compare dashboard memory, temperature, and root disk with host measurements. Confirm a separate data disk has its own monitoring.
4. Close the browser, cause an outage in a disposable test device/service, wait for the configured debounce, then restore it and check one alert/recovery pair. Avoid disrupting home DNS or the password manager for this test.
5. Restart the backend during a confirmed incident; verify history/state persist and unfinished windows restart.
6. Use two accounts to verify independent badges, read state, and delivery preferences.
7. Reboot the host in a maintenance window; verify Docker/Tailscale autostart, container health, HTTPS access, and the backup timer.
8. Restore a verified backup into an isolated test volume/project and confirm account, task, and notification data.

## Troubleshooting

| Symptom | First checks |
|---|---|
| Backend exits immediately | Production secrets/origin, database permissions, migrations, active administrator; sanitized backend logs |
| Agent reachable but controls fail | `DOCKER_GID`, socket ownership, existing allowlisted containers, matching agent secret |
| Root disk is unknown / mount error | Empty host probe exists on `/` filesystem and matches configured bind source |
| Empty database after moving checkout | Same Compose project name and volume; inspect volumes before creating new accounts |
| Core container is unhealthy | Health-check result and logs; restart after diagnosing cause, then test actual HTTPS endpoint |
| Backup job fails | Built backend includes `app.backup`, correct `.env`/project, free space, Docker access, host mounts; inspect service journal |
| Read-only backup cannot be restored | Use the documented offline root one-shot job; check snapshot integrity and stop every backend |
| High disk usage | Docker logs, optional service volumes, backup retention, growing notification/audit history |

Stop containers with `./scripts/compose.sh down` when needed; volumes remain. `down -v` deletes named-volume data and is not part of normal maintenance.

## Repository verification

The deployment polish was verified on the development host on 2026-09-29:

- Backend: 134 tests pass, with one existing Passlib/Python `crypt` deprecation warning.
- Frontend: 49 tests pass; TypeScript and the production Vite build pass on Node 24.21.0.
- Full npm audit: zero known vulnerabilities at verification time.
- Production and merged development Compose configuration parse successfully. These checks used `--env-file /dev/null`; they do not validate your production secrets.
- Images: backend, control-agent, wol-agent, and web build successfully. The web image also runs its frontend suite and build during image creation.
- Isolated container smoke checks: backend/database health, both agent health endpoints, static web serving, and the ingress Caddy admin health command pass.
- An isolated SQLite volume passes binary online export and integrity checks, refuses restore with an active monitor lock, and starts successfully as the normal unprivileged backend after an offline root restore.
- The pinned MQTT image can read the helper's private credentials as UID/GID 1883; host file ownership is retained.
- Shell syntax, staged systemd unit validation, documentation file links, and `git diff --check` pass.

The builds used the classic Docker builder because this development host's BuildKit exporter had previously failed. This changes the validation environment, not the production container configuration. Temporary smoke-test containers and volumes were removed afterward. Those initial checks did not roll out the stack, install the systemd timer, reboot the host, test physical Wake-on-LAN, validate the production host mounts, or restore optional-service data. Complete the acceptance checks on the target server.

### First startup correction

During the operator's first production startup, Docker's automatic edge address
allocation occupied Caddy's fixed `.2` address. The corrected pool separates
automatic addresses from the fixed addresses; the network was recreated without
deleting volumes. A verified SQLite snapshot and a full configuration/database
backup were taken, and the provisioned administrator remains present. All five
core containers now report healthy on this host.

The first HTTPS request also exposed a missing ingress certificate: a bare
`:443` site did not provision any certificate. Ingress now explicitly manages
an internal certificate for `127.0.0.1` and `PIHOMEHUB_HOST` (default `localhost`),
with `127.0.0.1` as the default SNI for the loopback Tailscale hop. The catch-all
listener still proxies the external hostname. The health check now tests actual
HTTPS serving instead of the admin API. Verified frontend HTTPS returns 200,
and the unauthenticated account API returns 401. See [Caddy default SNI](https://caddyserver.com/docs/caddyfile/options#default-sni).
Tailscale Serve was not yet configured at that point; its publication and the
matching public/allowed origin settings remain operator setup steps.

### Direct private HTTP access verification

The running server was subsequently switched to explicit `private-http` mode,
publishing `100.108.62.50:80` and retaining the optional HTTPS hop on
`127.0.0.1:443`. Accounts and database records were preserved. The existing
Tailscale Serve configuration was left intact, but direct HTTP does not depend
on it. The new public/allowed origin is `http://100.108.62.50`.

Verified on the host: direct HTTP frontend returns 200 without redirect/HSTS;
the account API returns 401 before login; a protected write with the configured
HTTP Origin passes the origin check and still requires login. Production-mode
tests verify login, cookies, session persistence, rejection of untrusted Origins,
and rejection of missing CSRF tokens. All 136 backend tests and 50 frontend
tests pass; the production frontend build, rebuilt backend/web images, both
Compose configurations, and npm audit pass (zero known npm vulnerabilities).
All five core containers are healthy. An actual request from a second machine
was not available in this workspace; that client must be connected to the same
tailnet and permitted by its access rules.
