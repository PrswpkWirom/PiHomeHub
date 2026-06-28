#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
. .venv/bin/activate
pip install -r apps/backend/requirements.txt
python apps/backend/bootstrap.py
echo "Backend bootstrap complete. Install Node.js and run npm install in apps/web for the frontend."
