# NetBox — Project Status & Handoff Guide

> **Last Updated:** 2026-11-18  
> **Current State:** **Phases 0–8 Packaged & Verified (`v0.8.0`)** — Ready for Marketplace Publisher Configuration & Final Public Release Approval (Phase 8.8 / 8.9).  
> **Purpose of this File:** Single-source-of-truth status and handoff document so development or demonstration can resume seamlessly.

---

## 1. Phase Progress Overview

| Phase | Title | Status | Summary |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Foundation | **Completed** | Indexed all 9 PDFs in `cn_lab/`, audited WSL environment, wrote architecture/roadmap/schema/decisions docs, built and verified C TCP echo server & client (`examples/tcp/`). |
| **Phase 1** | VS Code Extension Foundation | **Built & Compiled** | Installed native Linux Node.js LTS (`v26.13.1`) via `nvm` in WSL 2; `npm run check-types` and `npm run build` produce `extension/dist/extension.js` cleanly; FastAPI backend verified. |
| **Phase 2** | C Program Execution & Real Socket Event Collection | **Completed & Regression-Verified** | Built `LD_PRELOAD` shared library (`instrumentation/libnetbox_trace.so`) intercepting 12 POSIX socket calls, backend `ProcessRunner` / `RunManager` / `EventReader`, REST `/api/runs` endpoints, and automated test suites (Tests A–G all passing). |
| **Phase 3** | Networking Visualizer | **Completed & Verified** | Modular frontend engines (`extension/media/visualizer/*.js`), dynamic topology with separate listening/accepted/client socket states, API-level sequence diagram, monotonic timing & A↔B interval analysis, non-destructive filters, timestamp-aware playback (`0.5x`–`4x`), and deterministic event inspector. |
| **Phase 4** | Packet Capture Layer | **Completed & Live-Verified** | Native C `libpcap` helper (`packet_capture/netbox_pcap` with `cap_net_raw,cap_net_admin=eip`), IPv4/TCP parser, handshake/termination/flow/retransmission analyzer, conservative 4-tuple monotonic correlator, header-only privacy default, and visualizer Packets/Flows/Correlations/Dual-Layer Replay tabs. |
| **Phase 5** | Grounded Local AI Assistant | **Completed & Live-Verified** | Three-layer grounded local AI architecture (`backend/app/ai/`), local Ollama provider live-verified with `qwen2.5-coder:1.5b` on `127.0.0.1:11434`, deterministic retrieval & flow isolation, compact `<OBSERVED_EVIDENCE_DATA_ONLY>` framing, citation & confidence validation, Learning Mode, and visualizer AI Assistant tab with verified clickable evidence links. |
| **Phase 6** | NetBox Core & LAN Integration | **Completed & Software-Verified** | Configurable localhost/LAN backend, Windows + WSL 2 NAT discovery & opt-in forwarding script, pairing token access control, independent component health APIs, offline SVG QR code, FastAPI-served standalone Browser UI (`GET /`), startup/stop/check management scripts, and System & LAN Dashboard tab. *(Physical second-device test pending physical device.)* |
| **Phase 7** | Curriculum Labs & Final Hardening | **Completed & Live-Verified** | 9 structured JSON CN curriculum modules (`curriculum/labs/`), compiled C POSIX UDP echo server/client (`examples/udp/`), safe allowlisted lab runner (TCP/UDP/DNS/HTTP/L2/L3/Monitoring), deterministic IPv4 Subnet Calculator, 5-mode grounded Curriculum AI Tutor, deterministic assessment grader + persisted JSON progress, polished 7-tab UI, and final docs. |
| **Phase 8** | Production Release & VS Code Marketplace Packaging | **Packaged & Verified (Awaiting Publisher & Approval)** | Release audit, `v0.8.0` Marketplace metadata & 256×256 PNG icon, VS Code `SecretStorage` token security + URL validation, 7-component Welcome & Setup Hub, 10-step Interactive Guided Tour + Step 9 live TCP experiment, Presentation / Demo Mode, `.vscodeignore`, `LICENSE`, `CHANGELOG.md`, `extension/README.md`, clean `.vsix` build (`netbox-vscode-0.8.0.vsix`) & real VS Code CLI install verification. **79/79 automated tests passing.** |

---

## 2. Core Architectural Invariants (Do Not Violate)

1. **Ground-Truth Telemetry Only:** The visualizer must **never** render fabricated or LLM-imagined events. Live runs must emit `is_simulated: false` and `simulation_label: "ACTUAL SOCKET API EVENTS"`. Only `/api/demo/tcp` is simulated (`is_simulated: true`, `simulation_label: "SIMULATED"`).
2. **Preserve `cn_lab/`:** Never modify, rename, move, or delete any of the 9 original college lab PDFs in `cn_lab/`. Never invent lab solutions.
3. **Layer Separation:** Keep `source: "socket_api"` (Phase 2 user-space POSIX interception) strictly separate from `source: "packet_capture"` (Phase 4 wire-level capture).
4. **Lightweight Stack:** No React/Next.js, no databases, no Redis, no Docker. Keep backend single-process Python/FastAPI bound to `127.0.0.1:8000`, extension TypeScript + `esbuild` + vanilla Webviews.
5. **Privacy by Default:** Record payload byte lengths (`payload.bytes`), not raw payload contents (`preview_utf8: null`), unless explicitly opted in later.
6. **Phase Gating:** Do not jump ahead to the next phase without explicit user approval.

---

## 3. What Is Built & Verified Right Now

### A. C Reference Example (`examples/tcp/`)
- `examples/tcp/server.c` & `examples/tcp/client.c` — POSIX TCP echo over `127.0.0.1:8080`, clean `SIGINT` shutdown, built with `-Wall -Wextra`.

### B. Socket Instrumentation Engine (`instrumentation/`)
- `instrumentation/src/netbox_trace.c` — `LD_PRELOAD` shared library (`libnetbox_trace.so`) intercepting 12 calls: `socket`, `bind`, `listen`, `accept`, `accept4`, `connect`, `send`, `sendto`, `recv`, `recvfrom`, `shutdown`, `close`.
- `instrumentation/src/socket_metadata.c/.h` — Thread-safe FD tracking table (up to 4096 FDs).
- `instrumentation/src/event_writer.c/.h` — Thread-safe, recursion-guarded (`__thread int in_trace_hook`) JSONL writer using direct POSIX `write()` to `NETBOX_EVENT_FILE`, preserving `errno`.
- `instrumentation/tests/test_suite.py` — Automated verification (Tests A–G: basic echo, sequential clients, `ECONNREFUSED`, invalid input, server termination, baseline parity, schema validation). **Status: All 7 tests PASS.**

### C. Local FastAPI Backend (`backend/`)
- `backend/app/main.py` — Routes:
  - Phase 1: `GET /health`, `GET /api/project`, `GET /api/examples`, `GET /api/demo/tcp`
  - Phase 2: `POST /api/runs`, `GET /api/runs`, `GET /api/runs/{run_id}`, `GET /api/runs/{run_id}/events`, `POST /api/runs/{run_id}/stop`
- `backend/app/services/process_runner.py` — Executable allowlist (`tcp-echo`), 10s timeout, non-intrusive stdout readiness check (`Listening on 127.0.0.1:8080`), `SIGINT` teardown.
- `backend/app/services/run_manager.py` — Run lifecycle management storing JSONL traces in `/tmp/netbox_runs/<run_id>/`.
- `backend/app/services/event_reader.py` — Merges server + client JSONL files, sorts chronologically by `timestamp_ns`, normalizes `sequence` `1..N`.
- **Status: Verified end-to-end (captures 15 real socket events per TCP echo run).**

### D. VS Code Extension (`extension/`)
- Commands (`extension/src/commands/`): Open Dashboard, Open Visualizer, Check Backend Connection, Show Project Info.
- Providers (`extension/src/providers/`): `DashboardPanel`, `VisualizerPanel`, `SidebarProvider`.
- Services (`extension/src/services/`): `BackendService` (supports Phase 1 & Phase 2 endpoints), `types.ts`.
- Webview Assets (`extension/media/`): `dashboard.js/.css`, `visualizer.js/.css` (updated with "Run Live TCP" trigger and `ACTUAL SOCKET API EVENTS` badge).
- **Status: Code written; needs `npm install && npm run build` once Node.js is installed inside Ubuntu WSL via `nvm`.**

---

## 4. Checklist After Moving the Project Folder

> **Important Recommendation:** Keep the project inside the **WSL 2 Linux filesystem** (e.g., `/home/<user>/...`) rather than `/mnt/c/...`. Running `gcc`, `LD_PRELOAD`, and Python virtual environments on `/mnt/c` is much slower and can hit Windows/NTFS permission issues.

After moving the folder to its new path, run these commands from the **new repository root** inside Ubuntu WSL 2:

1. **Rebuild C binaries and `libnetbox_trace.so`** (updates debug paths & ensures clean build):
   ```bash
   make clean && make all
   ```

2. **Recreate the Python virtual environment** (Python venvs hardcode their old absolute directory path in `bin/` scripts):
   ```bash
   rm -rf backend/.venv
   ./scripts/setup_backend.sh
   ```

3. **Re-verify Phase 2 instrumentation tests:**
   ```bash
   python3 instrumentation/tests/test_suite.py
   ```

4. **Start the backend to verify health & live runs:**
   ```bash
   ./scripts/run_backend.sh
   ```

5. *(Optional / Pending from Phase 1)* **Install Node.js inside Ubuntu WSL via `nvm` and build the VS Code extension:**
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # Restart terminal or source ~/.bashrc, then:
   nvm install --lts
   cd extension && npm install && npm run build
   ```

---

## 5. Key Documentation Index

- [`README.md`](./README.md) — Project overview & quickstart
- [`docs/roadmap.md`](./docs/roadmap.md) — Full Phase 0–7 plan
- [`docs/architecture.md`](./docs/architecture.md) — System architecture, security & data flow
- [`docs/event_schema.md`](./docs/event_schema.md) — Event schema v1.0 (`socket_api` & `packet_capture`)
- [`docs/decisions.md`](./docs/decisions.md) — Technical decision log (`DEC-001` through `DEC-015`)
- [`docs/cn_lab_index.md`](./docs/cn_lab_index.md) — Complete index of all 9 college CN lab PDFs
- [`docs/phase_0.md`](./docs/phase_0.md), [`docs/phase_1.md`](./docs/phase_1.md), [`docs/phase_2.md`](./docs/phase_2.md) — Detailed phase reports

---

## 6. How to Resume in the New Location

Once you open the moved folder in a new workspace/session, simply say:

> *"Read `PROJECT_STATUS.md` and verify the environment in the new folder. Then let's start Phase 3 (or finish the Phase 1 Node.js extension build first)."*
