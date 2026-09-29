#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this deployment preparation script with sudo." >&2
  exit 1
fi

metric_path="${PIHOMEHUB_HOST_ROOT_METRICS_PATH:-/.pihomehub/rootfs-metrics}"
case "$metric_path" in
  /*) ;;
  *) echo "The host root metrics path must be absolute." >&2; exit 1 ;;
esac

install -d -m 0755 "$metric_path"
root_device="$(stat -c %d /)"
probe_device="$(stat -c %d "$metric_path")"
if [[ "$root_device" != "$probe_device" ]]; then
  echo "The metrics directory is not on the host root filesystem." >&2
  exit 1
fi
if [[ -n "$(find "$metric_path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "The metrics directory must remain empty." >&2
  exit 1
fi

echo "Host root metrics path is ready: $metric_path"
echo "Its filesystem device matches / (device $root_device)."
