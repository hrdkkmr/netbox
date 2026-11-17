# NetBox Development Roadmap

This document is the central development plan for **NetBox**.

---

## Current Status

| Phase | Title | Status |
| :--- | :--- | :--- |
| **Phase 0** | Foundation | **Completed** (Repository setup, docs, verified TCP example, WSL 2 migration verified) |
| **Phase 1** | VS Code Extension Foundation | **Completed / Foundation Scaffolded** (Extension scaffolded, Dashboard & Visualizer Webviews implemented, FastAPI backend running; pending Node.js/nvm build verification) |
| **Phase 2** | C Program Execution and Event Collection | **Completed** (`libnetbox_trace.so` LD_PRELOAD library, run manager, process runner, REST API, visualizer integration, test suite A–G verified) |
| **Phase 3** | Networking Visualizer | **Not Started** (Next Phase) |
| **Phase 4** | Packet Capture | **Not Started** |
| **Phase 5** | Local AI Assistant | **Not Started** |
| **Phase 6** | NetBox Core and LAN Integration | **Not Started** |
| **Phase 7** | Testing and Finalization | **Not Started** |

---

## Phase 0 — Foundation

- **Objective:** Inspect the existing repository and CN lab PDFs, audit the WSL/Ubuntu environment, establish project structure and architecture documentation, define the initial event schema, and implement and test a clean POSIX TCP echo server and client in C.
- **Main Deliverables:**
  - [`docs/cn_lab_index.md`](./cn_lab_index.md) (index of all PDFs in `cn_lab/`).
  - [`docs/environment_audit.md`](./environment_audit.md) and [`scripts/check_environment.sh`](../scripts/check_environment.sh).
  - [`docs/architecture.md`](./architecture.md), [`docs/event_schema.md`](./event_schema.md), [`docs/decisions.md`](./decisions.md), [`docs/phase_0.md`](./phase_0.md), and [`docs/roadmap.md`](./roadmap.md).
  - [`examples/tcp/server.c`](../examples/tcp/server.c), [`examples/tcp/client.c`](../examples/tcp/client.c), [`examples/tcp/README.md`](../examples/tcp/README.md), and root [`Makefile`](../Makefile).
  - Updated root [`README.md`](../README.md) and [`.gitignore`](../.gitignore).
- **Dependencies:** Existing `cn_lab/` PDFs, GCC (`15.2.0`), GNU Make (`4.4.1`), Ubuntu WSL environment.
- **Acceptance Criteria:**
  - All 9 PDFs in `cn_lab/` are indexed accurately without modifying originals or inventing solutions.
  - Environment audit identifies WSL version, tool versions, stale `apt` indexes, and VS Code WSL integration state.
  - `make all` builds `server` and `client` cleanly with `-Wall -Wextra`.
  - End-to-end TCP echo tests and invalid-connection tests pass and are documented accurately.
- **Known Risks:**
  - `Ubuntu` is currently on **WSL 1**; `apt` lists are stale (`2026-09-01`); VS Code Remote-WSL extension is not installed.
- **Gate Before Next Phase:**
  - User reviews and approves Phase 0 deliverables.
  - User migrates `Ubuntu` to **WSL 2**, sets `Ubuntu` as default WSL distro, runs `sudo apt update`, and decides Node.js / VS Code Remote-WSL setup.

---

## Phase 1 — VS Code Extension Foundation

- **Objective:** Scaffold the NetBox VS Code extension, establish extension ↔ Webview messaging, and provide a basic interface to trigger C program execution from VS Code.
- **Main Deliverables:**
  - Extension project scaffolding (`package.json`, TypeScript config, activation events, commands).
  - Webview panel hosting the initial NetBox UI shell.
  - Bidirectional message bridge (`postMessage` / `onDidReceiveMessage`) between the extension host and Webview.
  - Basic execution panel to compile and run a selected C file (e.g., `examples/tcp/server.c` / `client.c`) and display stdout/stderr/exit status.
- **Dependencies:** Phase 0 approved; `Ubuntu` migrated to **WSL 2**; Node.js and npm/pnpm installed in Linux; VS Code Remote-WSL working.
- **Acceptance Criteria:**
  - Extension activates cleanly in VS Code (Extension Development Host).
  - Webview opens via command palette and exchanges typed messages with the extension host.
  - Student can trigger build & execution of the Phase 0 TCP example from the UI.
- **Known Risks:**
  - WSL 1 blocks Node.js/npm; Webview Content Security Policy (CSP) issues when loading local scripts/styles.
- **Gate Before Next Phase:** Extension scaffolding builds cleanly, Webview communication round-trip is verified, and basic process execution works from VS Code.

---

## Phase 2 — C Program Execution and Event Collection

- **Objective:** Build the C execution runner and `socket_api` instrumentation layer so real POSIX socket calls emit structured JSON events conforming to [`docs/event_schema.md`](./event_schema.md).
- **Main Deliverables:**
  - Controlled C compiler/runner with unique `run_id` assignment.
  - `LD_PRELOAD` shared library intercepting POSIX socket APIs (`socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`, `sendto`, `recvfrom`, `close`, etc.) with `errno` preservation.
  - Modular backend event collector ingesting JSONL event streams per `run_id`.
  - Automated tests verifying captured `socket_api` events against real runs of `examples/tcp` (including success and `ECONNREFUSED` / `EADDRINUSE` failures).
- **Dependencies:** Phase 1 complete; `strace` (optional for verification) installed after `sudo apt update`.
- **Acceptance Criteria:**
  - Running unmodified `examples/tcp/server` and `client` under `LD_PRELOAD` produces valid, ordered JSONL `socket_api` events matching actual syscall outcomes.
  - Works reliably for sequential connections and handles errors without crashing or altering target program behavior.
- **Known Risks:**
  - Re-entrancy inside `LD_PRELOAD` (logging functions calling libc functions), handling `fork()` (Lab 1 optional concurrency), and `MSG_NOSIGNAL`/blocking I/O edge cases.
- **Gate Before Next Phase:** Event collector produces verified `socket_api` event traces for both TCP success and error scenarios.
- **Phase 2 Status:** **Completed**. Documented in [`docs/phase_2.md`](./phase_2.md). Delivered `libnetbox_trace.so` (12 socket calls intercepted, thread-safe, recursion-guarded), backend run manager and process runner, JSONL event merger, Phase 2 REST endpoints (`/api/runs`), visualizer integration, and passed test suites A–G. Ready for Phase 3 visualizer enhancements upon user approval.

---

## Phase 3 — Networking Visualizer

- **Objective:** Render interactive, observation-grounded visualizations inside the VS Code Webview from collected `socket_api` events.
- **Main Deliverables:**
  - Node/host topology view (client ↔ server representation with IP/port bindings).
  - Socket/connection lifecycle state tracker (`LISTEN`, `ESTABLISHED`, `CLOSED`, error states).
  - Interactive sequence diagram and chronological event timeline.
  - Event inspector drawer showing raw fields (`pid`, `fd`, `bytes`, `result`, `error_code`).
- **Dependencies:** Phase 1 (Webview bridge) and Phase 2 (structured `socket_api` events).
- **Acceptance Criteria:**
  - Visualizer accurately renders topology, lifecycle, and sequence diagram from recorded `run_id` logs (no hardcoded or fabricated events).
  - Clicking an event highlights its corresponding connection/step and displays exact observed fields.
- **Known Risks:**
  - UI clutter on high-frequency `send`/`recv` loops (e.g., streaming chunks); timestamp vs. `sequence` ordering across two processes (`server` + `client`).
- **Gate Before Next Phase:** Visualizer renders multi-process client-server runs cleanly and accurately from real Phase 2 event logs.

---

## Phase 4 — Packet Capture

- **Objective:** Capture actual network packets via `tcpdump`/`libpcap`, parse protocol headers into `packet_capture` events, and display both observation layers side-by-side.
- **Main Deliverables:**
  - Investigation and setup of `libpcap` / `tcpdump` capture permissions in WSL 2 (`cap_net_raw`, `cap_net_admin` or helper).
  - Packet parser emitting `source: "packet_capture"` JSON events (TCP `SYN`, `SYN-ACK`, `ACK`, data, `FIN`, `RST`, plus UDP/ICMP/DNS metadata aligned with Lab 6).
  - Backend correlation linking `packet_capture` events with `socket_api` events by 4-tuple and timestamp.
  - Visualizer toggle/layer showing socket API calls alongside actual wire packets.
- **Dependencies:** Phase 2 & 3 complete; WSL 2 active; `tcpdump` / `libpcap-dev` installed.
- **Acceptance Criteria:**
  - Captures real TCP 3-way handshake, echo payload, and 4-way/FIN teardown on `lo` during a `examples/tcp` run.
  - Visualizer clearly distinguishes `socket_api` events from `packet_capture` events without mixing layers.
- **Known Risks:**
  - Capturing requires elevated privileges (`CAP_NET_RAW`); TCP segmentation/coalescing means 1 `send()` may not equal 1 TCP segment.
- **Gate Before Next Phase:** Dual-layer (`socket_api` + `packet_capture`) capture and visualization verified end-to-end on loopback TCP runs.

---

## Phase 5 — Local AI Assistant

- **Objective:** Integrate a lightweight local coding LLM to explain observed networking events, errors, and code behavior using real execution context and CN lab material.
- **Main Deliverables:**
  - Hardware & latency benchmark of lightweight local models (starting with Qwen2.5-Coder 3B and smaller alternatives) on the 16 GB RAM host.
  - Local inference runtime integration (e.g., Ollama or equivalent local HTTP server).
  - Context-generation layer combining selected `socket_api`/`packet_capture` events, relevant C source lines, and CN lab context.
  - Grounded Q&A / "Explain this event" UI inside the VS Code Webview.
- **Dependencies:** Phases 2–4 complete (real events to ground prompts).
- **Acceptance Criteria:**
  - LLM explanations cite observed event fields (ports, `errno`, TCP flags) rather than inventing unseen packets.
  - Host memory usage stays safely within the 16 GB RAM budget alongside VS Code and WSL 2.
- **Known Risks:**
  - Memory pressure on 16 GB RAM without discrete GPU VRAM; slow token generation if model size exceeds CPU/RAM headroom; prompt drift/hallucination if context is too large.
- **Gate Before Next Phase:** Local model benchmark documented, grounded explanation flow verified on success and failure traces, and memory footprint acceptable.

---

## Phase 6 — NetBox Core and LAN Integration

- **Objective:** Enable a central NetBox Core host on a local hotspot/LAN so multiple student machines can connect to shared LLM and classroom networking services.
- **Main Deliverables:**
  - WSL 2 networking & Windows hotspot/LAN reachability setup (`mirrored` mode or `portproxy` + firewall documentation/scripts).
  - Central NetBox Core service hosting the shared local LLM API and optional local lab test targets (e.g., echo/HTTP/DNS targets).
  - Student VS Code extension configuration to point at the central NetBox Core host IP/port.
  - Basic authentication (per-session/student API tokens) and request queueing/rate limiting for the shared LLM.
- **Dependencies:** Phase 5 complete; WSL 2 networking validated on LAN/hotspot.
- **Acceptance Criteria:**
  - At least two machines on the same local hotspot/LAN can connect to NetBox Core, run a networking test, and receive grounded LLM explanations without internet access.
  - Unauthenticated requests to the shared LLM endpoint are rejected.
- **Known Risks:**
  - College/Windows firewall blocking inbound LAN traffic; WSL 2 NAT isolation; concurrent student LLM requests queuing on one 16 GB host.
- **Gate Before Next Phase:** Multi-machine LAN connectivity, shared LLM access, and basic auth verified offline.

---

## Phase 7 — Testing and Finalization

- **Objective:** Validate NetBox end-to-end against scenarios derived from `cn_lab/` assignments, evaluate performance/memory/security, and prepare a demonstration-ready release.
- **Main Deliverables:**
  - End-to-end integration test suite covering Lab 1–style TCP client-server, error scenarios, and packet inspection (Lab 6 concepts).
  - Performance and memory evaluation report (overhead of `LD_PRELOAD`, packet capture, Webview rendering, and LLM inference).
  - Security review (LAN auth, command execution safety, avoiding arbitrary code execution via LLM or shared API).
  - Complete user & instructor documentation and reproducible demo script.
- **Dependencies:** Phases 0–6 complete.
- **Acceptance Criteria:**
  - All end-to-end scenarios pass reproducibly.
  - Resource usage, security checklist, and demo workflow are documented and verified.
- **Known Risks:**
  - Integration regressions between WSL 2 networking, capture privileges, and concurrent student demos.
- **Gate Before Next Phase:** Project ready for final demonstration and academic submission.
