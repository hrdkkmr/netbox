#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${NETBOX_LOG_DIR:-/tmp/netbox_logs}"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"
OLLAMA_PID_FILE="$LOG_DIR/ollama.pid"
STOP_OLLAMA=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --include-ollama)
            STOP_OLLAMA=1
            shift
            ;;
        *)
            echo "Usage: $0 [--include-ollama]"
            exit 2
            ;;
    esac
done

stop_tracked_pid() {
    local name="$1"
    local pid_file="$2"
    if [ ! -f "$pid_file" ]; then
        echo "[NetBox] $name is not running (no PID file at $pid_file)."
        return 0
    fi

    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        echo "[NetBox] $name PID file was stale; cleaning up."
        rm -f "$pid_file"
        return 0
    fi

    echo "[NetBox] Stopping $name (PID $pid) gracefully..."
    kill -TERM "$pid" 2>/dev/null || true

    for _ in $(seq 1 15); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pid_file"
            echo "[NetBox] $name stopped cleanly."
            return 0
        fi
        sleep 0.2
    done

    echo "[NetBox][WARN] $name did not exit after SIGTERM; sending SIGKILL..."
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "$pid_file"
}

stop_tracked_pid "NetBox Backend" "$BACKEND_PID_FILE"

if [ "$STOP_OLLAMA" -eq 1 ]; then
    stop_tracked_pid "Ollama" "$OLLAMA_PID_FILE"
else
    echo "[NetBox] Leaving Ollama untouched (pass --include-ollama to stop a NetBox-started Ollama process)."
fi
