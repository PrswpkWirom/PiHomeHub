#!/usr/bin/env bash
set -euo pipefail

username="${1:-}"
if [[ -z "$username" || ! "$username" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
  echo "Usage: $0 <device-username>" >&2
  exit 2
fi

mkdir -p infra/mosquitto/generated
touch infra/mosquitto/generated/passwords
chmod 700 infra/mosquitto/generated
chmod 600 infra/mosquitto/generated/passwords
docker run --rm -it \
  -v "$PWD/infra/mosquitto/generated:/mosquitto/config/generated" \
  eclipse-mosquitto:2 mosquitto_passwd /mosquitto/config/generated/passwords "$username"
echo "Now add an allowlisted 'user $username' block to infra/mosquitto/generated/acl."
