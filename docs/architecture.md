# NetBox Architecture

> **Current Status:** Phases 0–5 completed and live-verified: C TCP reference example (Phase 0), VS Code Extension (`dist/extension.js`) & FastAPI backend (Phase 1), `LD_PRELOAD` socket tracing (Phase 2), modular interactive visualizer (Phase 3), native `libpcap` loopback packet capture & TCP flow/correlation analysis (Phase 4), and the **Grounded Local AI Assistant** (`backend/app/ai/`, local Ollama `qwen2.5-coder:1.5b`, deterministic retrieval, verified clickable evidence citations, and Learning Mode — Phase 5). NetBox Core LAN integration (Phase 6) is planned next.

---

## 1. System Vision & Core Principle

NetBox combines an **offline/local classroom networking environment** with a **VS Code Computer Networks assistant** that executes student networking code, records real execution and packet events, visualizes what actually happened, and uses a local LLM to explain those observed events in the context of the course material.

### Foundational Principle: Grounded Observation Over Hallucination

> **The visualizer must be driven strictly by actual execution events, never by events imagined or fabricated by the LLM.**

The local LLM acts solely as an **interpreter and tutor** over:
1. Verified runtime telemetry (`socket_api` and `packet_capture` event logs),
2. The student's source code, and
3. Course lab specifications ([`cn_lab_index.md`](./cn_lab_index.md)).

---

## 2. High-Level Architecture

NetBox is organized into two coupled parts — **NetBox Core** (shared classroom host) and **NetBox CN Assistant** (per-student IDE experience) — keeping the backend modular in a single cohesive service rather than microservices.

```text
+-------------------------------------------------------------------------------+
|                       Student Machine (VS Code)                               |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | NetBox VS Code Extension (extension/)                                   |  |
|  | - Commands: openDashboard, openVisualizer, checkBackend, showProjectInfo|  |
|  | - Activity Bar Sidebar: NetBox Actions TreeView                         |  |
|  | - BackendService: HTTP client (netbox.backendUrl -> 127.0.0.1:8000)     |  |
|  +-------------------------------------------------------------------------+  |
|         |                                            |                        |
|         | vscode.postMessage                         | vscode.postMessage     |
|         v                                            v                        |
|  +-------------------------------+         +-------------------------------+  |
|  | Dashboard Webview             |         | Visualizer Webview            |  |
|  | - Project overview & status   |         | - Topology (Client <-> Server)|  |
|  | - Examples browser & open     |         | - Event timeline table        |  |
|  | - Phase 1 demo execution flow |         | - Step / Playback controls    |  |
|  | - Backend health & recheck    |         | - Structured JSON inspector   |  |
|  +-------------------------------+         +-------------------------------+  |
|                                                      ^                        |
|                                                      | Structured JSON Events |
|                                                      | (event_schema.md v1.0) |
+------------------------------------------------------+------------------------+
                                                       |
                                                       | Local HTTP (REST)
                                                       v
+-------------------------------------------------------------------------------+
|                       Modular Local Backend (backend/)                        |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | FastAPI Application (backend.app.main:app)                              |  |
|  | - GET /health             -> Service health status, API version         |  |
|  | - GET /api/project        -> Project overview, current phase            |  |
|  | - GET /api/examples       -> Metadata & run commands for examples       |  |
|  | - GET /api/demo/tcp       -> 12-event simulated TCP trace (SIMULATED)   |  |
|  | - POST /api/runs          -> Orchestrate live execution run             |  |
|  | - GET /api/runs/{run_id}  -> Run status, exit codes, process summaries  |  |
|  | - GET /api/runs/{id}/events -> Real recorded socket events (ACTUAL)     |  |
|  | - POST /api/runs/{id}/stop  -> Gracefully terminate active run          |  |
|  | - GET /api/runs           -> List recent execution runs                 |  |
|  | - GET /api/runs/{id}/packets       -> Real captured TCP/IP packets      |  |
|  | - GET /api/runs/{id}/packets/{pid} -> Single packet detail              |  |
|  | - GET /api/runs/{id}/flows         -> Bidirectional TCP flows & HS      |  |
|  | - GET /api/runs/{id}/correlations  -> Socket API <-> Packet links       |  |
|  +-------------------------------------------------------------------------+  |
|  | Core Backend Services:                                                  |  |
|  | - ProcessRunner: Subprocess launcher, allowlist, LD_PRELOAD injection   |  |
|  | - PacketCaptureService: Native libpcap helper (cap_net_raw/admin=eip)   |  |
|  | - RunManager: Dual-layer lifecycle & /tmp/netbox_runs/<run_id> storage  |  |
|  | - EventReader & PacketParser: Separate schema v1.0 JSONL validators     |  |
|  | - TcpAnalyzer & EventCorrelator: Handshake/flow/4-tuple monotonic match |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
                                                       |
                                                       | Local LAN / Hotspot
                                                       v
+-------------------------------------------------------------------------------+
|                    NetBox Core (Central Classroom Host)                       |
|                                                                               |
|  +------------------------------+  +---------------------------------------+  |
|  | Local Inference Runtime      |  | Shared Classroom Services             |  |
|  | (Ollama + Lightweight LLM)   |  | (Optional Lab Targets / Basic Auth)   |  |
|  +------------------------------+  +---------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 3. Main Components & Responsibilities

### A. NetBox CN Assistant (VS Code Extension)
- **Extension Host:** Scaffolds lifecycle management, registers commands (`netbox.openDashboard`, `netbox.openVisualizer`, `netbox.checkBackend`, `netbox.showProjectInfo`), and manages webview panels.
- **Backend Service:** Manages HTTP communication with the local backend via `netbox.backendUrl`, providing health checks, live run creation (`createRun`), status querying, and event retrieval.
- **Activity Bar Sidebar:** Integrates directly into VS Code's sidebar for quick one-click access to the dashboard and visualizer.
- **Dashboard Webview:** Modern dark-themed status portal showing project overview, available networking examples (with links to open source files), Phase 1 demo flow, and Phase 2 live execution triggers.
- **Visualizer Webview (Phase 3 Modular Architecture — `extension/media/visualizer/`):**
  - **Event Store (`eventStore.js`):** Immutable event storage and strict Actual (`source="socket_api"` & `is_simulated=false`) vs. Simulated telemetry classification.
  - **Socket State & Topology Engine (`socketStateEngine.js`):** Replays observed events to derive separate API-level lifecycle states for client sockets, server listening sockets, and accepted server connection sockets (without inferring kernel states like `TIME_WAIT`).
  - **Timing & Performance Engine (`timingEngine.js`):** Computes monotonic relative elapsed times (`+0.000 ms`), consecutive deltas, selected A↔B API-event intervals, and actual successful TX/RX byte totals.
  - **API-Level Sequence Mapper (`sequenceMapper.js`):** Dynamically maps Client ↔ Server socket API calls without inventing TCP 3-way handshake packets; flags unmappable events as `unresolved`.
  - **Non-Destructive Filter Engine (`eventFilter.js`):** Filters timeline by process, event type, socket FD, errors-only, and search query without mutating raw events.
  - **Timestamp-Aware Playback Engine (`playbackEngine.js`):** Replays events using actual `timestamp_ns` intervals scaled by speed (`0.5x`, `1x`, `2x`, `4x`) with readability clamping and leak-safe timer teardown.
  - **Deterministic Event Inspector (`eventInspector.js`):** Displays all 20 observed schema fields (`"Not available"` for nulls), separates Observed vs. Derived fields, and provides rule-based explanations (no LLM).

### B. User-Space Instrumentation Engine (`instrumentation/`)
- Shared library `libnetbox_trace.so` built with C11/POSIX mechanisms.
- Intercepts 12 POSIX socket functions via `LD_PRELOAD` using `dlsym(RTLD_NEXT, ...)`:
  `socket`, `bind`, `listen`, `accept`, `accept4`, `connect`, `send`, `sendto`, `recv`, `recvfrom`, `shutdown`, `close`.
- Preserves application `errno` by capturing it immediately following the real syscall.
- Thread-local recursion guard (`static __thread int in_trace_hook`) prevents infinite loops.
- Dedicated direct POSIX `write()` to `NETBOX_EVENT_FILE` file descriptor bypasses libc stdio buffering and non-socket file tracking.
- Enforces data privacy by default: logs payload sizes (`payload.bytes`), return codes, and endpoint metadata without logging raw application data.

### C. Modular Local Backend (`backend/`)
- Built with **Python + FastAPI + Uvicorn** running on `127.0.0.1:8000`.
- Lightweight and single-process: no external database, no Redis, no Docker.
- **ProcessRunner:** Launches target executables (`examples/tcp/server`, `examples/tcp/client`) under strict allowlists and timeouts, injecting `LD_PRELOAD=libnetbox_trace.so` and per-process `NETBOX_EVENT_FILE` paths. Non-intrusively detects server readiness via stdout before launching clients.
- **RunManager:** Coordinates execution runs (`/tmp/netbox_runs/<run_id>`), stores metadata, manages process lifecycles, and terminates servers cleanly using `SIGINT`.
- **EventReader:** Ingests individual process JSONL streams, merges server and client events, sorts chronologically by nanosecond monotonic timestamps (`timestamp_ns`), and normalizes sequence numbers `1..N`.
- Exposes typed REST endpoints:
  - `/health`: Health probe.
  - `/api/project`: High-level metadata.
  - `/api/examples`: Metadata and run instructions for C networking examples.
  - `/api/demo/tcp`: Returns the standard 12-event TCP echo lifecycle, tagged with `"is_simulated": true` and `"simulation_label": "SIMULATED"`.
  - `/api/runs` (POST): Executes an allowlisted example program pair under live instrumentation.
  - `/api/runs/{run_id}` (GET): Retrieves run status, duration, process exit codes, and stdout/stderr summaries.
  - `/api/runs/{run_id}/events` (GET): Retrieves unified real socket events (`is_simulated: false`, `"simulation_label": "ACTUAL SOCKET API EVENTS"`).
  - `/api/runs/{run_id}/stop` (POST): Safely terminates an active run.
  - `/api/runs` (GET): Lists recent execution runs.

### D. NetBox Core (Future Phase 5 & 6)
- **Central Classroom Host:** Runs the local LLM inference engine (e.g. Ollama) on the teacher's machine or a dedicated workstation.
- **Shared Local Services:** Provides mock endpoints for cross-student interoperability testing (such as Lab 1 classmate test or Lab 2 HTTP/SMTP/DNS servers).
- **Access Control & Queuing:** Lightweight rate limiting and session tokens.

---

## 4. Webview Security Architecture

To ensure safety inside VS Code:
1. **Strict Content Security Policy (CSP):**
   ```text
   default-src 'none';
   style-src ${webview.cspSource} 'unsafe-inline';
   script-src 'nonce-${nonce}';
   img-src ${webview.cspSource} https:;
   font-src ${webview.cspSource};
   ```
2. **Local Resource Roots:** Webviews are restricted exclusively to `extension/media`.
3. **No Inline Scripts:** All client logic lives in `media/dashboard.js` and `media/visualizer.js`, protected by cryptographic nonces generated per render.
4. **Typed Message Bridge:** All communication between Webview and Extension Host uses structured JSON messages (`WebviewToExtensionMessage` and `ExtensionToWebviewMessage`), avoiding arbitrary code evaluation (`eval`).

---

## 5. Execution & Visualization Pipeline (Phases 1–4)

```text
Phase 1 (Simulated Demo):
  FastAPI /api/demo/tcp ──> Extension BackendService ──> Webview Visualizer (SIMULATED)

Phase 2 (Live Socket Events - Implemented):
  Target C Programs (Server + Client)
    └──> LD_PRELOAD=libnetbox_trace.so (POSIX socket interception)
           └──> Atomic write() to NETBOX_EVENT_FILE (events_*.jsonl)
                  └──> Backend ProcessRunner / RunManager coordination
                         └──> EventReader (timestamp sort & sequence merge)
                                └──> GET /api/runs/{id}/events
                                       └──> Webview Visualizer (ACTUAL SOCKET API EVENTS)

Phase 4 (Live Packet Capture - Planned):
  Wire / lo traffic ──> libpcap / tcpdump ──> packet_capture JSON ──> Backend Correlator ──> Webview Visualizer (Dual-layer)
```

---

## 6. Technical Risks & Mitigation

| Risk | Mitigation in NetBox |
| :--- | :--- |
| **Simulated vs Real Confusion** | Visualizer and API explicitly label all mock telemetry with `"simulation_label": "SIMULATED"` and a prominent warning banner. |
| **Backend Downtime** | Extension checks health on startup and recheck; Webviews display clean offline badges and startup instructions instead of crashing. |
| **Webview Memory Leaks** | Webview panels use `retainContextWhenHidden: true` with clean disposal on close. |
| **Node.js Isolation** | Extension is cleanly isolated in `extension/`, built with lightweight `esbuild`, and avoids Windows-npm pollution by recommending Linux `nvm`. |


---

## Phase 6 & Phase 7 Extensions (LAN Host–Client Core & Curriculum Platform)

- **Phase 6 (NetBox Core & LAN Integration):** FastAPI serves the unified Browser Web UI at `GET /` and `/media/*`, adds component-independent health & LAN discovery APIs (`/api/system/{health,info,network,services,connection}`), lightweight host-controlled pairing token authentication (`X-NetBox-Token` / `Bearer`), offline SVG QR generation, real client session heartbeats, and service management scripts (`scripts/start_netbox.sh`, `stop_netbox.sh`, `check_netbox.sh`, `scripts/windows/setup_lan_forward.ps1`). Ollama remains strictly bound to `127.0.0.1:11434` on the host. See [`docs/PHASE6_ARCHITECTURE.md`](./PHASE6_ARCHITECTURE.md) and [`docs/PHASE6.md`](./PHASE6.md).
- **Phase 7 (Curriculum Labs & Final Hardening):** Adds 9 structured JSON Computer Networks lab modules (`curriculum/labs/`), compiled C POSIX UDP echo server/client (`examples/udp/`), allowlisted localhost experiment runners (`backend/app/services/lab_runner.py`), deterministic IPv4 Subnet Calculator (`backend/app/curriculum/subnet_calc.py`), 5-mode grounded Curriculum AI Tutor (`POST /api/ai/curriculum/interact`), deterministic assessment grading, and locally persisted JSON progress (`backend/data/curriculum_progress.json`). See [`docs/PHASE7_ARCHITECTURE.md`](./PHASE7_ARCHITECTURE.md), [`docs/PHASE7.md`](./PHASE7.md), and [`docs/FINAL_ARCHITECTURE.md`](./FINAL_ARCHITECTURE.md).
