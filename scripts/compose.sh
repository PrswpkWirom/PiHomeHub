#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$repo_dir/infra/.env" ]]; then
  echo "Create infra/.env from infra/.env.example and configure production secrets first." >&2
  exit 1
fi

exec docker compose --env-file "$repo_dir/infra/.env" -f "$repo_dir/infra/docker-compose.yml" "$@"
