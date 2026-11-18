#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/backend/.venv"
LOG_DIR="${NETBOX_LOG_DIR:-/tmp/netbox_logs}"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"

MODE="${NETBOX_MODE:-localhost}"
PORT="${NETBOX_PORT:-8000}"
FOREGROUND=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --lan)
            MODE="lan"
            shift
            ;;
        --localhost)
            MODE="localhost"
            shift
            ;;
        --port)
            PORT="${2:?Missing value for --port}"
            shift 2
            ;;
        --foreground|-f)
            FOREGROUND=1
            shift
            ;;
        *)
            echo "Usage: $0 [--localhost|--lan] [--port 8000] [--foreground]"
            exit 2
            ;;
    esac
done

export NETBOX_MODE="$MODE"
export NETBOX_PORT="$PORT"
if [ "$MODE" = "lan" ]; then
    export NETBOX_HOST="${NETBOX_HOST:-0.0.0.0}"
else
    export NETBOX_HOST="${NETBOX_HOST:-127.0.0.1}"
fi

# 1. Check virtual environment
if [ ! -f "$VENV_DIR/bin/uvicorn" ]; then
    echo "[NetBox][ERROR] Python virtualenv not found at $VENV_DIR."
    echo "  Run ./scripts/setup_backend.sh first."
    exit 1
fi

# 2. Prevent duplicate backend process
if [ -f "$BACKEND_PID_FILE" ]; then
    OLD_PID="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[NetBox] NetBox backend is already running (PID $OLD_PID)."
        echo "  Stop it first with ./scripts/stop_netbox.sh if you want to restart."
        exit 0
    fi
    rm -f "$BACKEND_PID_FILE"
fi

# 3. Check port occupancy before launching
if ss -ltn 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"; then
    echo "[NetBox][ERROR] Port $PORT is already occupied by another process."
    ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true
    echo "  Free port $PORT or choose another port with --port <PORT>."
    exit 1
fi

# 4. Ensure C binaries and LD_PRELOAD library exist
if [ ! -f "$REPO_ROOT/instrumentation/libnetbox_trace.so" ] || [ ! -f "$REPO_ROOT/examples/tcp/server" ]; then
    echo "[NetBox] Building missing C binaries / LD_PRELOAD library..."
    make -C "$REPO_ROOT" all >/dev/null
fi

cd "$REPO_ROOT"
echo "[NetBox] Starting FastAPI backend in '$NETBOX_MODE' mode on http://${NETBOX_HOST}:${NETBOX_PORT}..."

if [ "$FOREGROUND" -eq 1 ]; then
    exec "$VENV_DIR/bin/uvicorn" backend.app.main:app --host "$NETBOX_HOST" --port "$NETBOX_PORT"
fi

nohup "$VENV_DIR/bin/uvicorn" backend.app.main:app --host "$NETBOX_HOST" --port "$NETBOX_PORT" >>"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >"$BACKEND_PID_FILE"

READY=0
for _ in $(seq 1 25); do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "[NetBox][ERROR] Backend exited prematurely. Last log lines ($BACKEND_LOG):"
        tail -n 20 "$BACKEND_LOG" || true
        rm -f "$BACKEND_PID_FILE"
        exit 1
    fi
    if curl -fsS --max-time 2 "http://127.0.0.1:${NETBOX_PORT}/health" >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 0.4
done

if [ "$READY" -ne 1 ]; then
    echo "[NetBox][ERROR] Backend did not respond on http://127.0.0.1:${NETBOX_PORT}/health. Check $BACKEND_LOG."
    exit 1
fi

echo "[NetBox] Backend is running (PID $BACKEND_PID, log: $BACKEND_LOG)."
echo "[NetBox] Local UI: http://127.0.0.1:${NETBOX_PORT}/"
