#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
. .venv/bin/activate
pip install -r apps/backend/requirements.txt
(cd apps/backend && ../../.venv/bin/alembic upgrade head)
echo "Database migrated. Run 'PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin' interactively."
echo "Then install frontend dependencies with 'cd apps/web && npm ci'."
