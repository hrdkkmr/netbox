#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/backend/.venv"

echo "=== Setting up NetBox Backend Virtual Environment ==="

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment at $VENV_DIR..."
    if python3 -m venv "$VENV_DIR" 2>/dev/null; then
        echo "Created venv with ensurepip."
    else
        echo "Standard venv creation without pip..."
        python3 -m venv --without-pip "$VENV_DIR"
        echo "Bootstrapping pip via get-pip.py..."
        python3 -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')"
        "$VENV_DIR/bin/python3" /tmp/get-pip.py
    fi
fi

echo "Installing requirements from backend/requirements.txt..."
"$VENV_DIR/bin/pip" install -r "$REPO_ROOT/backend/requirements.txt"

echo "Backend setup complete."
