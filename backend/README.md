# NetBox Backend (Phase 1)

A lightweight FastAPI service powering NetBox's local development environment and visualizer.

## Prerequisites

- Python 3.10+ (tested with Python 3.14 on Ubuntu 26.04 WSL 2)
- Virtual environment (`venv`)

## Setup

From the repository root (`~/projects/netbox`):

1. **Create a virtual environment:**
   ```bash
   python3 -m venv --without-pip backend/.venv
   backend/.venv/bin/python3 -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')"
   backend/.venv/bin/python3 /tmp/get-pip.py
   ```
   *(Or if `python3-venv` is installed: `python3 -m venv backend/.venv`)*

2. **Install dependencies:**
   ```bash
   backend/.venv/bin/pip install -r backend/requirements.txt
   ```

3. **Run the backend:**
   ```bash
   backend/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

## Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status, name, and API version |
| `GET` | `/api/project` | Project overview, current phase, and example count |
| `GET` | `/api/examples` | Metadata, paths, and build instructions for networking examples |
| `GET` | `/api/demo/tcp` | Simulated TCP connection lifecycle event sequence (`is_simulated: true`) |
