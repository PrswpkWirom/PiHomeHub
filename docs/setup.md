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
