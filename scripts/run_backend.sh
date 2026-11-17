#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/backend/.venv"

if [ ! -f "$VENV_DIR/bin/uvicorn" ]; then
    echo "Virtual environment not initialized. Running scripts/setup_backend.sh first..."
    "$REPO_ROOT/scripts/setup_backend.sh"
fi

cd "$REPO_ROOT"
echo "Starting NetBox FastAPI backend on http://127.0.0.1:8000..."
exec "$VENV_DIR/bin/uvicorn" backend.app.main:app --host 127.0.0.1 --port 8000 --reload
