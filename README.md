# NetBox

**NetBox** is a Computer Networks learning and debugging project designed to pair a local/offline classroom networking environment with a VS Code extension that runs student networking programs, captures real execution events, visualizes what actually happens, and uses a local LLM to explain observed behavior using course context.

> **Current Phase:** **Phase 2 — C Program Execution and Real Socket Event Collection** (Completed / In Review).  
> The repository foundation, architecture, C TCP example, event schema, VS Code extension, Webview dashboard, visualizer foundation, FastAPI local backend, and `LD_PRELOAD` socket instrumentation engine (`libnetbox_trace.so`) are implemented and verified. Ready for Phase 3 visualizer enhancements.

---

## Problem Statement

When learning Computer Networks (socket programming, transport protocols, and packet analysis), students often see only opaque terminal errors (`Connection refused`, `Address already in use`, blocked `recv()`) without visibility into how POSIX socket calls map to connection states and network packets. Meanwhile, cloud AI tools are unavailable offline and frequently hallucinate packet traces instead of inspecting what the student's code actually did.

NetBox addresses this by grounding all visualizations and AI explanations strictly in **actual recorded execution telemetry** and the course's own lab assignments (`cn_lab/`).

---

## Features by Phase

- **Phase 0 (Foundation - Done):** Complete CN lab PDF index, environment audit, reference POSIX C TCP echo implementation (`examples/tcp/`), and foundational documentation.
- **Phase 1 (Extension & Backend - Done):** VS Code Extension scaffolding, Webview Dashboard and Visualizer panels, lightweight FastAPI backend (`127.0.0.1:8000`), and simulated demo trace.
- **Phase 2 (C Socket Interception - Done):** Dynamic user-space socket interception library (`instrumentation/libnetbox_trace.so`) capturing 12 POSIX socket APIs, backend run manager and process runner, JSONL event merger, and live visualizer integration (`ACTUAL SOCKET API EVENTS`).
- **Phase 3 (Networking Visualizer - Next):** Advanced visualizer enhancements: state machine tracking (`LISTEN`, `ESTABLISHED`, `CLOSED`), interactive sequence diagrams, payload inspection, and timing analysis.
- **Phase 4 (Packet Capture - Planned):** Wire-level packet capture (`libpcap`/`tcpdump`) correlated with socket API events.
- **Phase 5 (Local AI Assistant - Planned):** Lightweight local LLM explaining real recorded telemetry grounded in course context.
- **Phase 6 (Classroom Core - Planned):** Offline LAN/hotspot sharing of LLM API and mock lab targets.

---

## High-Level Architecture

```text
Student Machine (VS Code)
  ├──> NetBox VS Code Extension (extension/)
  │      ├──> Dashboard Webview (Status, examples, live run triggers)
  │      └──> Visualizer Webview (Topology, timeline, JSON inspector, ACTUAL vs SIMULATED badges)
  └──> Local Backend (backend/ — FastAPI on 127.0.0.1:8000)
         ├──> RunManager & ProcessRunner (Orchestrates C programs with LD_PRELOAD)
         ├──> EventReader (Merges multi-process JSONL logs by nanosecond timestamp)
         ├──> /health, /api/project, /api/examples, /api/demo/tcp
         └──> /api/runs, /api/runs/{run_id}, /api/runs/{run_id}/events
```

For full architectural details, see [`docs/architecture.md`](docs/architecture.md), [`docs/event_schema.md`](docs/event_schema.md), and [`docs/phase_2.md`](docs/phase_2.md).

---

## Repository Structure

```text
netbox/
├── backend/                    # Local Python + FastAPI backend service
│   ├── app/
│   │   ├── models/             # Pydantic models for events, runs, processes
│   │   ├── services/           # ProcessRunner, RunManager, EventReader
│   │   └── main.py             # REST API routes (/api/runs, /api/demo/tcp, /health)
│   ├── requirements.txt
│   └── README.md
├── cn_lab/                     # Original Computer Networks lab assignment PDFs (unmodified)
├── docs/
│   ├── architecture.md         # System architecture, data flow & security
│   ├── cn_lab_index.md         # Index of all 9 CN lab PDFs and NetBox mappings
│   ├── decisions.md            # Technical and provisional decision log (DEC-001 - DEC-015)
│   ├── environment_audit.md    # WSL, toolchain, apt, and VS Code audit
│   ├── event_schema.md         # Schema specification (socket_api vs packet_capture v1.0)
│   ├── phase_0.md              # Phase 0 checklist, verification, and exit criteria
│   ├── phase_1.md              # Phase 1 documentation, setup, and checklist
│   ├── phase_2.md              # Phase 2 C socket interception & run engine guide
│   └── roadmap.md              # Phase 0–7 development plan and current status
├── examples/
│   └── tcp/
│       ├── server.c            # POSIX TCP echo server (127.0.0.1:8080)
│       ├── client.c            # POSIX TCP echo client
│       └── README.md           # Build, usage, and error behavior notes
├── extension/                  # NetBox VS Code Extension
│   ├── media/
│   │   ├── dashboard.css / dashboard.js
│   │   ├── visualizer.css / visualizer.js
│   │   └── netbox-icon.svg
│   ├── src/
│   │   ├── commands/           # openDashboard, openVisualizer, checkBackend, projectInfo
│   │   ├── providers/          # DashboardPanel, VisualizerPanel, SidebarProvider
│   │   ├── services/           # BackendService, types
│   │   └── extension.ts        # Main activation entry point
│   ├── esbuild.js
│   ├── package.json
│   └── tsconfig.json
├── instrumentation/            # Phase 2 LD_PRELOAD Socket Observation Engine
│   ├── src/
│   │   ├── netbox_trace.c      # Intercepts 12 POSIX socket functions via dlsym RTLD_NEXT
│   │   ├── event_writer.c/h    # Thread-safe JSONL writer using direct POSIX write()
│   │   └── socket_metadata.c/h # Thread-safe socket FD metadata tracking table
│   ├── tests/
│   │   └── test_suite.py       # Automated test suite (Tests A through G)
│   ├── Makefile                # Builds libnetbox_trace.so
│   └── README.md               # Architecture, design principles, and usage
├── scripts/
│   ├── check_environment.sh    # Read-only WSL/toolchain diagnostic script
│   ├── setup_backend.sh        # Creates backend venv & installs dependencies
│   └── run_backend.sh          # Launches FastAPI backend on 127.0.0.1:8000
├── Makefile                    # Builds examples and instrumentation shared library
├── .gitignore
└── README.md
```

---

## Phase 1 Quickstart

### 1. Start the Local Backend

From the repository root (`~/projects/netbox`):

```bash
./scripts/run_backend.sh
```

The backend starts at `http://127.0.0.1:8000`. Test it anytime:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/demo/tcp
```

### 2. Set Up the VS Code Extension

Ensure Node.js is installed inside Ubuntu via `nvm` (see [`docs/phase_1.md`](docs/phase_1.md)):

```bash
cd extension
npm install
npm run build
```

Then in VS Code:
1. Open the NetBox project in WSL (`code ~/projects/netbox`).
2. Press `F5` to open the Extension Development Host.
3. Open the Command Palette (`Ctrl+Shift+P`) and run **`NetBox: Open Dashboard`** or **`NetBox: Open Visualizer`**.

---

## Compiling & Running with Phase 2 Instrumentation

### 1. Compile Everything (Binaries and Shared Library)

```bash
make all
```

This compiles:
- `examples/tcp/server`
- `examples/tcp/client`
- `instrumentation/libnetbox_trace.so`

### 2. Manual Tracing with `LD_PRELOAD`

Run the server with instrumentation:
```bash
NETBOX_RUN_ID=manual_run NETBOX_EVENT_FILE=server_events.jsonl \
  LD_PRELOAD=./instrumentation/libnetbox_trace.so ./examples/tcp/server
```

In another terminal, run the client:
```bash
NETBOX_RUN_ID=manual_run NETBOX_EVENT_FILE=client_events.jsonl \
  LD_PRELOAD=./instrumentation/libnetbox_trace.so ./examples/tcp/client "Hello NetBox"
```

Inspect the real captured events:
```bash
cat server_events.jsonl
cat client_events.jsonl
```

### 3. Orchestrated Execution via NetBox Backend

With the backend running (`./scripts/run_backend.sh`):

Trigger a coordinated live run:
```bash
curl -X POST http://127.0.0.1:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"example_id": "tcp-echo", "client_args": ["Hello NetBox"]}'
```

Retrieve real recorded events:
```bash
# Replace RUN_ID with the returned run_id (e.g. run_20261117_...)
curl http://127.0.0.1:8000/api/runs/RUN_ID/events
```

### 4. Running the Phase 2 Test Suite

```bash
python3 instrumentation/tests/test_suite.py
```

All 7 test suites (Tests A through G) will execute against the compiled binaries and verify event capture, sequencing, schema conformance, error states (`ECONNREFUSED`), and clean termination.

---

## Documentation Links

- **Current Project Status & Handoff:** [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- **Roadmap:** [`docs/roadmap.md`](docs/roadmap.md)
- **Phase 0 Checklist:** [`docs/phase_0.md`](docs/phase_0.md)
- **Phase 1 Guide:** [`docs/phase_1.md`](docs/phase_1.md)
- **Phase 2 Report:** [`docs/phase_2.md`](docs/phase_2.md)
- **Architecture:** [`docs/architecture.md`](docs/architecture.md)
- **Event Schema (v1.0):** [`docs/event_schema.md`](docs/event_schema.md)
- **CN Lab Index:** [`docs/cn_lab_index.md`](docs/cn_lab_index.md)
- **Decisions Log:** [`docs/decisions.md`](docs/decisions.md)
