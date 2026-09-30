#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
umask 077

username="${1:-}"
if [[ -z "$username" || ! "$username" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
  echo "Usage: $0 <device-username>" >&2
  exit 2
fi

mkdir -p infra/mosquitto/generated
touch infra/mosquitto/generated/passwords
if [[ ! -f infra/mosquitto/generated/acl ]]; then
  cp infra/mosquitto/acl.example infra/mosquitto/generated/acl
fi
chmod 700 infra/mosquitto/generated
chmod 600 infra/mosquitto/generated/passwords infra/mosquitto/generated/acl
docker run --rm -it --entrypoint sh \
  -v "$PWD/infra/mosquitto/generated:/mosquitto/config/generated" \
  eclipse-mosquitto:2.1.2-alpine@sha256:6f8d8a947c506f8a2290ec65cd4bd2bc7cb4d43fb5f6271f861cb013e2ef9797 \
  -ec 'mosquitto_passwd /mosquitto/config/generated/passwords "$1"
    chown "$2:1883" /mosquitto/config/generated /mosquitto/config/generated/passwords /mosquitto/config/generated/acl
    chmod 750 /mosquitto/config/generated
    chmod 640 /mosquitto/config/generated/passwords /mosquitto/config/generated/acl' \
  sh "$username" "$(id -u)"
echo "Now add an allowlisted 'user $username' block to infra/mosquitto/generated/acl."
python3 scripts/generate-service-config.py
echo "PiHomeHub service setup status refreshed."
