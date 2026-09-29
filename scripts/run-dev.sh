#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -x "$ROOT_DIR/.tools/node/bin/node" ]]; then
  PATH="$ROOT_DIR/.tools/node/bin:$PATH"
  export PATH
fi
BACKEND_PORT="${PIHOMEHUB_BACKEND_PORT:-8000}"
FRONTEND_PORT="${PIHOMEHUB_FRONTEND_PORT:-5173}"
HOST="${PIHOMEHUB_DEV_HOST:-0.0.0.0}"
BACKEND_URL="${PIHOMEHUB_BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"

cd "$ROOT_DIR"

if [[ ! -x ".venv/bin/uvicorn" ]]; then
  echo "Missing backend virtualenv. Run: ./scripts/install.sh"
  exit 1
fi

if [[ ! -d "apps/web/node_modules" ]]; then
  echo "Missing frontend dependencies. Run: cd apps/web && npm install"
  exit 1
fi

require_free_port() {
  local port="$1"
  local label="$2"

  if python3 - "$HOST" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((host, port))
    except OSError:
        sys.exit(1)
PY
  then
    return
  fi

  echo "${label} port ${port} is already in use on ${HOST}."
  echo "Stop the process using it, or run with a different port:"
  echo "  PIHOMEHUB_${label^^}_PORT=$((port + 1)) ./scripts/run-dev.sh"
  exit 1
}

print_frontend_urls() {
  if [[ "$HOST" != "0.0.0.0" ]]; then
    echo "Frontend: http://${HOST}:${FRONTEND_PORT}"
    return
  fi

  echo "Frontend URLs:"
  echo "  Local:   http://localhost:${FRONTEND_PORT}"

  local address
  for address in $(hostname -I 2>/dev/null || true); do
    if [[ "$address" == *:* ]]; then
      echo "  Network: http://[${address}]:${FRONTEND_PORT}"
    else
      echo "  Network: http://${address}:${FRONTEND_PORT}"
    fi
  done
}

require_free_port "$BACKEND_PORT" "backend"
require_free_port "$FRONTEND_PORT" "frontend"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting PiHomeHub backend on http://${HOST}:${BACKEND_PORT}"
".venv/bin/uvicorn" app.main:app \
  --app-dir apps/backend \
  --host "$HOST" \
  --port "$BACKEND_PORT" \
  --no-proxy-headers \
  --reload &
BACKEND_PID=$!

echo "Starting PiHomeHub frontend on http://${HOST}:${FRONTEND_PORT}"
PIHOMEHUB_BACKEND_URL="$BACKEND_URL" npm --prefix apps/web run dev -- \
  --host "$HOST" \
  --port "$FRONTEND_PORT" \
  --strictPort &
FRONTEND_PID=$!

echo
echo "PiHomeHub is starting."
echo "Backend:  http://${HOST}:${BACKEND_PORT}"
print_frontend_urls
echo "Press Ctrl-C to stop both servers."
echo

wait -n "$BACKEND_PID" "$FRONTEND_PID"
