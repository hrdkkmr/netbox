# NetBox — Phase 1: VS Code Extension Foundation

This document defines the implementation, environment verification, architecture, and verification checklist for **Phase 1** of NetBox.

---

## 1. Objectives

- Establish the dedicated VS Code extension (`extension/`) for NetBox.
- Implement the NetBox Dashboard Webview with project overview, example inspection, demo execution, visualizer access, and backend health status.
- Implement the Visualizer Webview foundation displaying network topology, an interactive event timeline, and a structured JSON event inspector conforming to [`docs/event_schema.md`](./event_schema.md) v1.0.
- Implement secure, bidirectional extension ↔ Webview messaging (`postMessage` / `onDidReceiveMessage`) with strict CSP and no inline scripts.
- Implement the initial lightweight local backend (`backend/`) using Python + FastAPI exposing `/health`, `/api/project`, `/api/examples`, and `/api/demo/tcp`.
- Connect the extension to the backend with configurable URL (`netbox.backendUrl`), handling offline/reconnecting states gracefully.
- Explicitly mark all Phase 1 demonstration data as **`SIMULATED`** so simulated events are never confused with real captured socket/packet events.

---

## 2. Environment Verification Results

Executed on host `Hardik-Laptop` inside the project root (`~/projects/netbox`):

| Tool / Check | Command | Observed Result | Status |
| :--- | :--- | :--- | :--- |
| **WSL Distribution & Version** | `wsl -l -v` | `Ubuntu` Running on **WSL 2** (default `*`), `docker-desktop` Stopped | **VERIFIED (WSL 2 active)** |
| **Linux Kernel** | `uname -a` | `Linux Hardik-Laptop 6.18.33.2-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Thu Jun 18 21:54:43 UTC 2026 x86_64 GNU/Linux` | **VERIFIED** |
| **Python** | `python3 --version` | `Python 3.14.4` | **VERIFIED** |
| **Python Virtual Environment** | `backend/.venv` bootstrap | Bootstrapped via `--without-pip` + `get-pip.py`; FastAPI, Uvicorn, Pydantic installed and verified | **VERIFIED** |
| **GCC** | `gcc --version` | `gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0` | **VERIFIED** |
| **Make** | `make --version` | `GNU Make 4.4.1` | **VERIFIED** |
| **Node.js (inside Ubuntu)** | `node --version` | `bash: line 1: node: command not found` | **MISSING in Ubuntu** |
| **npm (inside Ubuntu)** | `which npm` | `/mnt/c/Program Files/nodejs//npm` (resolves to Windows binary, version 11.11.0) | **RESOLVES TO WINDOWS** |

### Node.js Recommendation & Resolution (nvm)

In accordance with Phase 1 constraints:
> *Do not install Node.js through Windows or use Windows npm from WSL.*  
> *If Node.js is missing and WSL 2 is confirmed, recommend using `nvm` and a supported Node.js LTS release.*

**Recommended Action for User:**
Install Node.js via `nvm` (Node Version Manager) inside Ubuntu WSL 2:

```bash
# 1. Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 2. Reload shell configuration
source ~/.bashrc

# 3. Install the current Node.js LTS release (e.g., Node 22 or 20)
nvm install --lts
nvm use --lts

# 4. Verify native Linux Node and npm
which node # should output /home/hardik_kumar/.nvm/versions/node/.../bin/node
node --version
npm --version
```

Once installed, build the extension:

```bash
cd ~/projects/netbox/extension
npm install
npm run build
```

---

## 3. Technology Choices

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **VS Code Extension** | TypeScript + VS Code Extension API | Official extension development standard with strong typing |
| **Extension Bundler** | `esbuild` | Zero-configuration, sub-second builds, generates standalone `dist/extension.js` |
| **Visualizer & Dashboard** | Vanilla HTML5, CSS3, JavaScript | Lightweight, zero-dependency, VS Code dark theme variables, CSP compliant |
| **Backend Framework** | Python + FastAPI + Uvicorn | Async HTTP service, fast, strict Pydantic models for schema v1.0 |
| **Backend Protocol** | HTTP + JSON over `127.0.0.1:8000` | Simple, stateless, easily inspectable, firewall-safe on loopback |
| **Event Telemetry** | `docs/event_schema.md` v1.0 | 12-event TCP echo lifecycle; strictly labeled `SIMULATED` |

*No heavy UI frameworks (React, Next.js), databases, Redis, or Docker were introduced.*

---

## 4. Architecture & Component Interaction

```text
+-------------------------------------------------------------------------------+
|                             VS Code Window                                    |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | Extension Host (src/extension.ts)                                       |  |
|  | - Commands: netbox.openDashboard, openVisualizer, checkBackend, info   |  |
|  | - Activity Bar: NetBox Sidebar TreeView (netbox.quickActions)           |  |
|  | - BackendService: HTTP client (netbox.backendUrl -> 127.0.0.1:8000)     |  |
|  +-------------------------------------------------------------------------+  |
|         ^                                                    ^                |
|         | vscode.postMessage                                 | vscode.postMessage
|         v                                                    v                |
|  +-------------------------------+         +-------------------------------+  |
|  | Dashboard Webview Panel       |         | Visualizer Webview Panel      |  |
|  | - Project Overview & Status   |         | - Topology (Client <-> Server)|  |
|  | - Examples Viewer & Launch    |         | - 12-Event Timeline Table     |  |
|  | - Simulated Execution Button  |         | - Playback Controls           |  |
|  | - Backend Health & Recheck    |         | - Structured JSON Inspector   |  |
|  +-------------------------------+         +-------------------------------+  |
+---------------------------------------+---------------------------------------+
                                        |
                                        | Local HTTP (GET /health, /api/*)
                                        v
+-------------------------------------------------------------------------------+
|                       Local FastAPI Backend (127.0.0.1:8000)                   |
|                                                                               |
|  - GET /health           -> { status: "healthy", service: "netbox-backend" }  |
|  - GET /api/project      -> { name: "NetBox", current_phase: "Phase 1" }      |
|  - GET /api/examples     -> Metadata for examples/tcp (server.c, client.c)    |
|  - GET /api/demo/tcp     -> 12 simulated events (docs/event_schema.md v1.0)   |
+-------------------------------------------------------------------------------+
```

---

## 5. Webview Security & Content Security Policy (CSP)

Both Webview panels enforce strict security:
- `Content-Security-Policy`:
  `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};`
- `localResourceRoots`: Locked exclusively to `extension/media`.
- Zero inline scripts in Webview HTML (all scripts loaded via unforgeable cryptographic per-render nonces from `media/dashboard.js` and `media/visualizer.js`).
- No `eval()`, no external CDN dependencies, and safe DOM manipulation.

---

## 6. How to Run & Verify

### Step 1: Start the Local Backend

From `~/projects/netbox`:

```bash
# Setup backend venv and install requirements (done automatically if missing)
./scripts/run_backend.sh
```

Verify backend health from another terminal:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/project
curl http://127.0.0.1:8000/api/examples
curl http://127.0.0.1:8000/api/demo/tcp
```

### Step 2: Build & Launch the Extension

After installing Node.js via `nvm`:

```bash
cd ~/projects/netbox/extension
npm install
npm run build
```

To run in VS Code Extension Development Host:
1. Open `~/projects/netbox` in VS Code (connected via Remote-WSL).
2. Press `F5` (or *Run* → *Start Debugging*).
3. In the new [Extension Development Host] window, run `Ctrl+Shift+P` → `NetBox: Open Dashboard`.

### Step 3: Verify the End-to-End Workflow

1. **Dashboard Opens:** Displays branding, "Backend Online" badge, Phase 1 overview, and TCP example cards.
2. **File Navigation:** Clicking `examples/tcp/server.c` on the dashboard opens the file in the editor.
3. **Check Backend:** Click "Refresh" or run `NetBox: Check Backend Connection` — verifies live connection to `127.0.0.1:8000`.
4. **Run Demo Flow:** Click "Run Phase 1 Demo Flow" on the dashboard — transitions status and opens the visualizer.
5. **Visualizer Lifecycle:**
   - Topology displays Client (`PID 2102`) and Server (`PID 2101`) with connection channel.
   - Timeline renders all 12 events conforming to `docs/event_schema.md` v1.0.
   - Click "Play" or "Next" — state advances through `CLOSED` → `LISTEN` → `ESTABLISHED` → `DATA TRANSFER` → `CLOSED`.
   - Packet flight indicator animates with data payload byte counts.
   - Inspector displays formatted raw JSON with `source: "socket_api"` and `"is_simulated": true`.
6. **Backend Offline Handling:** Stopping the backend causes the dashboard to display "Backend Offline" and troubleshooting commands without crashing.

---

## 7. Acceptance Checklist

- [x] Environment audit confirms **WSL 2 active** (`Linux Hardik-Laptop 6.18.33.2-microsoft-standard-WSL2`).
- [x] Python 3.14 venv bootstrapped and verified.
- [x] FastAPI backend created and all 4 endpoints (`/health`, `/api/project`, `/api/examples`, `/api/demo/tcp`) verified passing with HTTP 200.
- [x] Node.js state audited (missing in Ubuntu; Windows npm interop detected) and `nvm` LTS migration procedure documented.
- [x] Complete extension directory structure scaffolded (`extension/`).
- [x] TypeScript commands registered (`openDashboard`, `openVisualizer`, `checkBackend`, `showProjectInfo`).
- [x] Activity Bar sidebar provider created (`netbox.quickActions`).
- [x] Dashboard Webview implemented with dark theme, responsive cards, and bidirectional messaging.
- [x] Visualizer Webview foundation implemented with topology, 12-event timeline, playback controls, and JSON inspector.
- [x] All demonstration events strictly match `docs/event_schema.md` v1.0 and are prominently marked **`SIMULATED`**.
- [x] Webview security conforms to VS Code guidelines (strict CSP, nonces, localResourceRoots).
- [x] Helper scripts created: `scripts/setup_backend.sh` and `scripts/run_backend.sh`.
- [x] Original `cn_lab/` PDFs and Phase 0 TCP implementation preserved untouched.

---

## 8. Known Limitations in Phase 1

1. **Simulated Telemetry:** Events shown in the visualizer are generated from the agreed schema by the demo endpoint, not captured live from executing C binaries. Live POSIX socket interception will be implemented in **Phase 2** via `LD_PRELOAD`.
2. **Node.js in Ubuntu:** Native Linux Node.js must be installed by the user via `nvm` before running `npm run build` in `extension/`.
3. **Extension Host Execution:** Extension code is fully implemented and statically verified, but launching the interactive Extension Development Host (`F5`) requires the user to open VS Code inside WSL 2.

---

## 9. Exit Criteria

Phase 1 is complete when:
1. The user reviews and verifies the backend endpoints and extension code.
2. The user installs Node.js via `nvm` and verifies extension compilation.
3. The user approves advancing to **Phase 2 — C Program Execution and Event Collection**.
