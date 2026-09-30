#!/usr/bin/env bash
# Install and immediately activate the boot-time Vaultwarden Serve configuration.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run: sudo bash scripts/install-vaultwarden-serve.sh" >&2
  exit 1
fi
if [[ ! -x /usr/bin/tailscale ]]; then
  echo "Install Tailscale at /usr/bin/tailscale before continuing." >&2
  exit 1
fi
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
install -o root -g root -m 0755 "$repo_dir/scripts/serve-vaultwarden.sh" /usr/local/sbin/pihomehub-serve-vaultwarden
install -o root -g root -m 0644 "$repo_dir/infra/systemd/pihomehub-vaultwarden-serve.service" /etc/systemd/system/pihomehub-vaultwarden-serve.service
systemctl daemon-reload
systemctl enable --now tailscaled.service
systemctl enable pihomehub-vaultwarden-serve.service
systemctl restart pihomehub-vaultwarden-serve.service
systemctl --no-pager status pihomehub-vaultwarden-serve.service
/usr/bin/tailscale serve status
