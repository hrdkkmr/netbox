#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="localhost"
PORT="${NETBOX_PORT:-8000}"
SKIP_OLLAMA=0

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
        --skip-ollama)
            SKIP_OLLAMA=1
            shift
            ;;
        *)
            echo "Usage: $0 [--localhost|--lan] [--port 8000] [--skip-ollama]"
            exit 2
            ;;
    esac
done

echo "=== Starting NetBox Platform (mode=$MODE, port=$PORT) ==="

# 1. Start Ollama first (strictly localhost-only; non-fatal if unavailable so offline deterministic lab works)
if [ "$SKIP_OLLAMA" -eq 0 ]; then
    "$SCRIPT_DIR/start_ollama.sh" || echo "[NetBox][WARN] Continuing without Ollama (deterministic networking & visualizer still work)."
fi

# 2. Start NetBox FastAPI backend
"$SCRIPT_DIR/start_backend.sh" "--$MODE" --port "$PORT"

# 3. Print live status & LAN connection summary
echo ""
"$SCRIPT_DIR/check_netbox.sh" --port "$PORT" || true
