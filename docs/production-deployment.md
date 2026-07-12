# Production deployment

1. Install Docker Engine/Compose and Tailscale on the Raspberry Pi. Keep the host firewall closed to public ingress.
2. Copy `infra/.env.example` to `infra/.env`. Generate independent secrets with `openssl rand -hex 32`; set the Tailscale HTTPS URL as both public base URL and allowed origin.
3. Back up an existing database and configuration.
4. Build, migrate, and create the first administrator before starting the app:

```bash
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml run --rm backend alembic upgrade head
docker compose -f infra/docker-compose.yml run --rm backend python -m app.cli create-admin
docker compose -f infra/docker-compose.yml up -d
```

5. Confirm `docker compose ... config` publishes only the loopback-bound Caddy HTTPS port. Confirm backend and control-agent ports are absent and the backend has no Docker socket mount.
6. Configure Tailscale Serve as documented in [tailscale-serve.md](tailscale-serve.md). Never enable Funnel.

For a trusted-LAN-only deployment, set `PIHOMEHUB_INGRESS_BIND_ADDRESS` to the Pi's specific LAN address, not `0.0.0.0`, and install/trust Caddy's local CA on clients. Development uses both files: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up --build` and may expose 5173/8000.

Rotate secrets by stopping the stack, replacing one generated secret, restarting, and validating integrations. Rotating the application secret invalidates encrypted Tailscale credentials; replace them in Settings. Rotating the control-agent secret requires backend and agent to restart together.
