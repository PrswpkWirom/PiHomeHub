# Production deployment and operations

This guide runs PiHomeHub as one persistent Docker Compose stack on a 64-bit Linux home server. The backend, frontend, Docker control agent, Wake-on-LAN agent, and Caddy ingress already run in containers. Tailscale and Docker are host services. SQLite is a database file in the backend volume; the notification monitor runs inside the backend.

## Host preparation

Use a maintained 64-bit OS, adequate power/cooling, and storage suitable for continuous writes. Prefer a wired link and reserve the server address in your router. Start with the core stack and measure resource use before adding optional applications. Keep physical/network recovery access available.

Install Docker Engine with Compose v2, Git, and Tailscale using their official instructions. The development override requires [Compose 2.24.4+](https://docs.docker.com/reference/compose-file/merge/) because it uses `!override`. Python and Node are provided by build/runtime images for production.

```bash
docker version
docker compose version
sudo systemctl enable --now docker tailscaled
```

Choose a persistent checkout location, for example `/opt/PiHomeHub`. Run commands from that checkout. `./scripts/compose.sh` is the production wrapper; it supplies the correct Compose file and environment file even when called by a timer.

### Configuration

```bash
cp infra/.env.example infra/.env
chmod 600 infra/.env
openssl rand -hex 32
openssl rand -hex 32
stat -c "%g" /var/run/docker.sock
```

Set the two independent secret values, the exact HTTPS public origin, its matching allowed origin, and the Docker socket group ID in `infra/.env`. Keep the application secret with backups: the database contains encrypted Tailscale credentials that depend on it. Store administrator passwords separately in your password manager; the CLI stores Argon2id hashes in SQLite.

Keep `PIHOMEHUB_INGRESS_BIND_ADDRESS=127.0.0.1` for Tailscale Serve. Keep backend/control-agent ports private. For trusted LAN HTTPS, bind ingress to the Pi specific LAN address, install Caddy local CA on clients, and choose the matching HTTPS origin. Configure host firewall and tailnet access controls for the actual deployment.

The default Compose project is `infra` because the Compose file lives there. If you set `COMPOSE_PROJECT_NAME`, choose it before first deployment and keep it identical in manual commands, timers, upgrades, and restores. A different project name selects different named volumes. The fixed `172.30.0.0/24` edge network must not overlap your LAN/VPN; changing it requires matching proxy/WOL addresses too.

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

Tailscale Serve publishes the loopback listener privately:

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:443
tailscale serve status
```

`--bg` makes the Serve configuration persistent. The insecure certificate option applies only to the loopback hop to Caddy; browser-facing HTTPS is terminated by Tailscale. See [Tailscale Serve](tailscale-serve.md) for proxy-address configuration and [the official command reference](https://tailscale.com/docs/reference/tailscale-cli/serve). Keep Funnel disabled.

### Health, restart, and logs

Core containers have 30-second health checks. Backend readiness checks database connectivity; agents check HTTP liveness; the web checks static serving; ingress checks its local Caddy admin configuration. Ingress waits for the backend and web to become healthy, and the backend waits for its agents. Health endpoints return fixed status without account or host details. Agent liveness does not prove Docker socket permissions or successful Wake-on-LAN delivery; test those integrations separately.

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

Inspect the incoming revision and migrations before running this sequence. Build before stopping the backend to reduce downtime. If migration fails, keep the backend stopped, inspect the error, and recover from the verified snapshot with the compatible revision. Confirm HTTPS access, accounts, history, and integrations after upgrades. Optional profiles must be explicitly included when updating their containers.

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

1. Sign in over the intended HTTPS origin; confirm only the intended core ingress is published and protected writes work.
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

The builds used the classic Docker builder because this development host's BuildKit exporter had previously failed. This changes the validation environment, not the production container configuration. Temporary smoke-test containers and volumes were removed afterward. No live deployment, systemd timer installation, host reboot, physical Wake-on-LAN test, production host-mount validation, or optional-service data restore was performed here; complete the acceptance checks on the target server.
