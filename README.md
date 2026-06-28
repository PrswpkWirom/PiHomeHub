# PiHomeHub

Local-first Raspberry Pi home dashboard and private server control center.

## Stack

- `apps/backend`: FastAPI, SQLAlchemy, Alembic, SQLite
- `apps/web`: React, Vite, TypeScript, TailwindCSS, PWA shell
- `infra`: Docker Compose and Caddy

## Quick Start

1. Copy `apps/backend/.env.example` to `apps/backend/.env`.
2. Bootstrap Python dependencies and database:
   - `python3 -m venv .venv`
   - `. .venv/bin/activate`
   - `pip install -r apps/backend/requirements.txt`
   - `python apps/backend/bootstrap.py`
3. Start the backend:
   - `uvicorn app.main:app --app-dir apps/backend --reload`
4. Install frontend dependencies and start the web app:
   - `cd apps/web`
   - `npm install`
   - `npm run dev`

See [docs/setup.md](/home/popsatorn/Documents/PiHomeHub_Project/PiHomeHub/docs/setup.md), [docs/architecture.md](/home/popsatorn/Documents/PiHomeHub_Project/PiHomeHub/docs/architecture.md), and [docs/security.md](/home/popsatorn/Documents/PiHomeHub_Project/PiHomeHub/docs/security.md).
