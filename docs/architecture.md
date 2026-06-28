# Architecture

PiHomeHub v0.1 is a local-first monorepo with a FastAPI backend, React PWA frontend, SQLite persistence, and Docker-based local deployment.

## Subsystems

- `apps/backend`: authenticated REST API for system metrics, Docker service state, devices, Wake-on-LAN, and tasks
- `apps/web`: installable PWA for dashboard, devices, services, planner, and settings
- `infra`: Docker Compose and Caddy reverse proxy

## Data Flow

1. The browser authenticates against `POST /api/auth/login`.
2. The backend issues an HTTP-only session cookie backed by the `sessions` table.
3. Authenticated pages call REST endpoints for metrics, device state, services, and tasks.
4. The backend reads local host metrics via `psutil`, service state via the Docker CLI, and sends WOL packets directly.
5. Structured app data is stored in SQLite.
