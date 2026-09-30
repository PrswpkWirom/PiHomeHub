#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [backup-directory]" >&2
  exit 1
fi
if [[ ! -f "$repo_dir/infra/.env" ]]; then
  echo "Production infra/.env is required to locate the configured database volume." >&2
  exit 1
fi
backup_root="${1:-${PIHOMEHUB_BACKUP_DIR:-$repo_dir/backups}}"
mkdir -p -- "$backup_root"
backup_dir="$(mktemp -d "$backup_root/pihomehub-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
temporary_database="$backup_dir/pihomehub.db.incomplete"
trap 'rm -f -- "$temporary_database"' EXIT

"$repo_dir/scripts/compose.sh" run --rm --no-deps -T backend \
  python -m app.backup export --stdout > "$temporary_database"
mv -- "$temporary_database" "$backup_dir/pihomehub.db"
docker exec infra-control-agent-1 python -m app.export_operations > "$backup_dir/control-agent-operations.db"

configuration=(infra/.env infra/docker-compose.yml infra/caddy/Caddyfile infra/mosquitto/mosquitto.conf)
if [[ -d "$repo_dir/infra/mosquitto/generated" ]]; then
  configuration+=(infra/mosquitto/generated)
fi
if [[ -d "$repo_dir/infra/generated" ]]; then
  configuration+=(infra/generated)
fi
tar -czf "$backup_dir/configuration.tar.gz" -C "$repo_dir" -- "${configuration[@]}"
git -C "$repo_dir" rev-parse HEAD > "$backup_dir/revision.txt"
(
  cd -- "$backup_dir"
  sha256sum pihomehub.db control-agent-operations.db configuration.tar.gz revision.txt > SHA256SUMS
)
echo "Verified PiHomeHub database and configuration backup: $backup_dir"
echo "This includes secrets. Keep it private and copy it to storage outside the Pi."
