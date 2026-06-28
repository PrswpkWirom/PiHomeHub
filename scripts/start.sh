#!/usr/bin/env bash
set -euo pipefail

. .venv/bin/activate
uvicorn app.main:app --app-dir apps/backend --reload
