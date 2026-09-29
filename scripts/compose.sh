#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 plugin is missing. Verify: docker compose version" >&2
  echo "For Ubuntu's docker.io package: sudo apt install docker-compose-v2" >&2
  echo "For Docker's official repository: sudo apt install docker-compose-plugin" >&2
  exit 1
fi
if [[ ! -f "$repo_dir/infra/.env" ]]; then
  echo "Create infra/.env from infra/.env.example and configure production secrets first." >&2
  exit 1
fi

exec docker compose --env-file "$repo_dir/infra/.env" -f "$repo_dir/infra/docker-compose.yml" "$@"
