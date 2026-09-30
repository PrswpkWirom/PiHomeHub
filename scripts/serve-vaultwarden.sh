#!/usr/bin/env bash
# Reapply the Vaultwarden HTTPS endpoint. This replaces all existing Serve routes.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo, or use pihomehub-vaultwarden-serve.service." >&2
  exit 1
fi

/usr/bin/tailscale serve reset
/usr/bin/tailscale serve --bg --yes --https=443 http://100.65.234.44:3004
