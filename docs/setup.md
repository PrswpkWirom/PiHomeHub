# Setup

## Backend

1. Copy `apps/backend/.env.example` to `apps/backend/.env`.
2. Create a virtual environment and install dependencies:
   - `python3 -m venv .venv`
   - `. .venv/bin/activate`
   - `pip install -r apps/backend/requirements.txt`
3. Bootstrap the database:
   - `python apps/backend/bootstrap.py`
4. Start the API:
   - `uvicorn app.main:app --app-dir apps/backend --reload`

## Frontend

1. Install Node.js 20+.
2. In `apps/web`, run:
   - `npm install`
   - `npm run dev`

## Docker

1. Ensure `apps/backend/.env` exists.
2. From `infra`, run `docker compose up --build`.

## Bootstrap Data

- Admin username/password come from `.env`.
- Service quick links and known devices are seeded from the JSON environment variables in `.env`.

## Tailscale Sync

1. In the web app, open `Settings`.
2. Enter a Tailscale API token and tailnet.
3. Use `Test Connection` to validate the token.
4. Use `Sync Devices Now` to import Tailscale machines.
5. Open `Devices` and use `Configure WOL` on a synced machine to add MAC address, optional LAN IP, optional broadcast address, alias, and note.

The saved token is encrypted in the backend database and is not shown again after saving.
The Devices page also runs Tailscale sync when opened, refreshes every 60 seconds while open, and includes a `Sync now` button for immediate status updates.
