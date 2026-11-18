#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${NETBOX_LOG_DIR:-/tmp/netbox_logs}"
mkdir -p "$LOG_DIR"
OLLAMA_LOG="$LOG_DIR/ollama.log"
OLLAMA_PID_FILE="$LOG_DIR/ollama.pid"
OLLAMA_URL="${NETBOX_LLM_BASE_URL:-http://127.0.0.1:11434}"
MODEL="${NETBOX_LLM_MODEL:-qwen2.5-coder:1.5b}"

echo "[NetBox] Checking local Ollama runtime ($OLLAMA_URL)..."

if ! command -v ollama >/dev/null 2>&1; then
    echo "[NetBox][ERROR] 'ollama' is not installed in this environment."
    echo "  Install Ollama locally on the host and pull a model (e.g., ollama pull $MODEL)."
    exit 1
fi

if curl -fsS --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
    echo "[NetBox] Ollama is already running at $OLLAMA_URL (skipping duplicate launch)."
else
    # Strictly bind Ollama to loopback only — never expose Ollama directly to LAN
    export OLLAMA_HOST="127.0.0.1:11434"
    echo "[NetBox] Starting Ollama on 127.0.0.1:11434 (log: $OLLAMA_LOG)..."
    nohup ollama serve >>"$OLLAMA_LOG" 2>&1 &
    OLLAMA_PID=$!
    echo "$OLLAMA_PID" >"$OLLAMA_PID_FILE"

    READY=0
    for _ in $(seq 1 20); do
        if curl -fsS --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 0.5
    done

    if [ "$READY" -ne 1 ]; then
        echo "[NetBox][ERROR] Ollama did not become reachable at $OLLAMA_URL. Check $OLLAMA_LOG."
        exit 1
    fi
    echo "[NetBox] Ollama is ready (PID $OLLAMA_PID)."
fi

# Verify configured model exists locally (never pulls from Internet automatically)
if curl -fsS --max-time 3 "$OLLAMA_URL/api/tags" | grep -q "\"$MODEL\""; then
    echo "[NetBox] Configured model '$MODEL' is available locally."
else
    echo "[NetBox][WARN] Model '$MODEL' was not found in local Ollama storage."
    echo "  When online, pull it once with: ollama pull $MODEL"
    echo "  NetBox backend will still start cleanly; AI endpoints will report model_available=false."
fi
