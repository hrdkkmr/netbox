# NetBox Architecture

> **Current Status:** Foundation established in **Phase 0**; VS Code Extension structure, Webview Dashboard, Visualizer foundation, and local FastAPI Backend established in **Phase 1**; C Program Execution and Real Socket Event Collection (`LD_PRELOAD` instrumentation library `libnetbox_trace.so`, run manager, and process runner) implemented and verified in **Phase 2**. Packet capture (Phase 4) and local LLM integration (Phase 5) are planned.

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
|  +-------------------------------------------------------------------------+  |
|  | Core Backend Services:                                                  |  |
|  | - ProcessRunner: Subprocess launcher, allowlist, LD_PRELOAD injection   |  |
|  | - RunManager: Run lifecycle state machine & directory storage           |  |
|  | - EventReader: JSONL parser, multi-process timestamp sorting & merging  |  |
|  | - Packet Correlator (Phase 4): Correlates libpcap frames with sockets   |  |
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
- **Visualizer Webview:** Interactive networking inspector displaying:
  - **Network Topology:** Real-time client and server node representation, local/remote ports, socket file descriptors, and packet flight animation.
  - **Chronological Timeline:** Ordered list of execution events conforming to `docs/event_schema.md` v1.0, with clear distinction between `SIMULATED DATA` and `ACTUAL SOCKET API EVENTS`.
  - **Structured JSON Inspector:** Formatted inspection of event fields, return values, errors, and process metadata.
  - **Playback Controls:** Step-by-step or automated progression (Play/Pause, Step Next/Prev, Restart, Speed Control).

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
