# Architecture

PiHomeHub v0.1 is a local-first monorepo with a FastAPI backend, React PWA frontend, SQLite persistence, and Docker-based local deployment.

## Subsystems

- `apps/backend`: authenticated REST API for system metrics, Docker service state, manual devices, Tailscale devices, Wake-on-LAN, and tasks
- `apps/web`: installable PWA for dashboard, devices, services, planner, and settings
- `infra`: Docker Compose and Caddy reverse proxy

## Data Flow

1. The browser authenticates against `POST /api/auth/login`.
2. The backend issues an HTTP-only session cookie backed by the `sessions` table.
3. Authenticated pages call REST endpoints for metrics, manual devices, synced Tailscale devices, services, and tasks.
4. The backend reads local host metrics via `psutil`, service state via the Docker CLI, syncs Tailscale machines through the Tailscale API, and sends WOL packets directly.
5. Structured app data is stored in SQLite.

## Tailscale Devices

Tailscale machines are stored separately from manual devices. Sync updates machine identity, hostname, Tailscale addresses, OS, online status, last seen, tags, and sync status by stable Tailscale ID.

Local Wake-on-LAN details stay in PiHomeHub because the Tailscale API does not provide LAN MAC or broadcast metadata. If a synced machine disappears from the API, PiHomeHub marks it `missing_from_tailnet` and keeps its local WOL configuration.
