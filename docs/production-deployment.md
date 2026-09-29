# Production deployment

1. Install Docker Engine with the Compose v2 plugin and Tailscale on the Raspberry Pi. Keep the host firewall closed to public ingress.
2. Copy `infra/.env.example` to `infra/.env`. Generate independent secrets with `openssl rand -hex 32`; set the Tailscale HTTPS URL as both public base URL and allowed origin. Pass `--env-file infra/.env` to each Compose command below.
3. Back up an existing database and configuration. Prepare host metric access:

   ```bash
   sudo scripts/prepare-host-metrics.sh
   ```

   The script creates the configured empty root disk probe directory (default
   `/.pihomehub/rootfs-metrics`) and verifies it shares a filesystem with `/`.
   Keep it empty. For a custom `PIHOMEHUB_HOST_ROOT_METRICS_PATH`, pass the
   same value with:

   ```bash
   sudo env PIHOMEHUB_HOST_ROOT_METRICS_PATH=/your/path scripts/prepare-host-metrics.sh
   ```
4. Build, migrate, and create the first administrator before starting the app:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml config -q
docker compose --env-file infra/.env -f infra/docker-compose.yml build
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm backend alembic upgrade head
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm backend python -m app.cli create-admin
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
```

5. Confirm `docker compose --env-file infra/.env -f infra/docker-compose.yml config` publishes only the loopback-bound Caddy HTTPS port. Confirm backend and control-agent ports are absent, the Wake-on-LAN agent binds only to `172.30.0.1`, and the backend has no Docker socket mount.
6. Configure Tailscale Serve as documented in [tailscale-serve.md](tailscale-serve.md). Never enable Funnel.

For a trusted-LAN-only deployment, set `PIHOMEHUB_INGRESS_BIND_ADDRESS` to the Pi's specific LAN address, not `0.0.0.0`, and install/trust Caddy's local CA on clients. Development uses both files: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up --build` and may expose 5173/8000.

Rotate secrets by stopping the stack, replacing one generated secret, restarting, and validating integrations. Rotating the application secret invalidates encrypted Tailscale credentials; replace them in Settings. Rotating the control-agent secret requires backend and agent to restart together.

The backend runs one notification monitor every 30 seconds, guarded by a
process lock beside the SQLite database. Device and service baselines are
silent; later state changes are debounced and saved across restarts. Adjust
thresholds and debounce counts with `PIHOMEHUB_NOTIFICATION_*` settings in
`infra/.env`. Monitoring continues while the browser is closed, but cannot
send alerts while PiHomeHub itself is stopped or unavailable.
