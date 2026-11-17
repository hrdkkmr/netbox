# NetBox Technical Decision Log

This log records key architectural and engineering decisions for **NetBox**, their rationale, and whether they are **Accepted** or **Provisional** (subject to evaluation in later phases).

---

## DEC-001: C as the Initial Language for Networking Program Support
- **Status:** Accepted (Phase 0–2 scope)
- **Context:** The CN course uses both Python (Labs 2–4, 7–9, Lab 5 Task 3) and C (explicitly allowed in Lab 1 with `fork()` and Lab 5 Tasks 1, 2, 4).
- **Decision:** NetBox will initially support C networking programs using standard POSIX socket APIs.
- **Reasoning:** C maps 1-to-1 to POSIX system calls (`socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`, `close`), making it ideal for demonstrating low-level socket mechanics and building `LD_PRELOAD` instrumentation in Phase 2. Python support can be added later without changing the core event schema.
- **Consequences:** Phase 0 examples use C11/POSIX sockets compiled with `gcc`; Python lab experiments in `cn_lab/` are indexed now and deferred for future runtime hooks.

## DEC-002: WSL 2 Ubuntu as the Intended Development Environment
- **Status:** Accepted (Pending manual migration from WSL 1)
- **Context:** The current Ubuntu 26.04 LTS distribution is running on **WSL 1** (`4.4.0-26100-Microsoft`), while `docker-desktop` is on WSL 2 and set as default. Windows `npm` explicitly fails on WSL 1 (`WSL 1 is not supported`).
- **Decision:** Ubuntu on **WSL 2** is the target Linux development and execution environment for NetBox.
- **Reasoning:** Real Linux kernel features (packet capture via `libpcap`/`tcpdump`, reliable `ptrace`/`LD_PRELOAD` behavior, Linux Node.js, and VS Code Remote-WSL) require WSL 2. Phase 0 C compilation and loopback TCP testing still work on WSL 1, so Phase 0 is not blocked, but Phase 1+ requires migrating `Ubuntu` to WSL 2.
- **Consequences:** User must manually run `wsl --set-version Ubuntu 2` and `wsl --set-default Ubuntu` in Windows PowerShell before Phase 1.

## DEC-003: First Networking Example Uses TCP over Loopback (`127.0.0.1:8080`)
- **Status:** Accepted
- **Context:** Phase 0 needs a simple, reliable, testable baseline program before building instrumentation or packet capture.
- **Decision:** Build a POSIX TCP echo server and client communicating over `127.0.0.1:8080`.
- **Reasoning:** Loopback TCP requires no external network, matches Lab 1's core client-server TCP model (port `> 5000`, socket cleanup), and cleanly exercises connection establishment, bidirectional I/O, sequential client handling, and error paths (`ECONNREFUSED`, `EADDRINUSE`).
- **Consequences:** Provides the reference workload for Phase 1 execution, Phase 2 `LD_PRELOAD` tracing, and Phase 4 `lo` packet capture.

## DEC-004: Modular Monolith Backend Instead of Microservices
- **Status:** Provisional (Revisit only if scaling requires separation in Phase 6)
- **Context:** NetBox includes execution management, event collection, correlation, visualization serving, and LLM context building.
- **Decision:** Keep the local backend modular inside a single cohesive process/codebase rather than splitting into Dockerized microservices, Redis queues, or external databases.
- **Reasoning:** The target host has 16 GB RAM and is an academic desktop/laptop tool. Avoiding Docker, Redis, and multi-service orchestration minimizes setup friction, latency, and memory overhead while keeping module boundaries clean.
- **Consequences:** Modules must communicate through clean internal interfaces and JSONL/in-memory event structures so components remain decoupled without network IPC overhead.

## DEC-005: Separate `socket_api` and `packet_capture` Observation Layers
- **Status:** Accepted
- **Context:** Students need to understand both application-level socket calls and wire-level TCP/IP behavior (as taught in Lab 1 and Lab 6).
- **Decision:** Keep `socket_api` events (Phase 2) and `packet_capture` events (Phase 4) as strictly separate `source` streams in [`docs/event_schema.md`](./event_schema.md), correlated by the backend rather than merged at capture time.
- **Reasoning:** OS socket calls and wire packets do not have a 1-to-1 correspondence (e.g., `connect()` triggers `SYN` / `SYN-ACK` / `ACK`; one `send()` may segment or coalesce). Separating them preserves ground-truth accuracy and teaches the boundary between user space and the kernel network stack.
- **Consequences:** Visualizer and schema include explicit `source` tags (`"socket_api"` vs. `"packet_capture"`) and an explicit backend correlation step.

## DEC-006: LLM Explains Observed Events Rather Than Generating Execution Data
- **Status:** Accepted (Core architectural invariant)
- **Context:** LLMs can hallucinate plausible-looking packet traces or network states that never actually occurred during a student's run.
- **Decision:** The NetBox visualizer will render **only** recorded execution events; the local LLM will only generate natural-language explanations grounded in those observed events, source code, and course lab context.
- **Reasoning:** Prevents misleading students with fabricated network behavior when debugging real socket bugs (`ECONNREFUSED`, missing `htons()`, partial `recv()`, port reuse errors).
- **Consequences:** Phase 5 Context Builder must pass serialized real event slices and explicitly instruct the model not to extrapolate unrecorded packets.

## DEC-007: Local LLM Model & Runtime Selection Deferred to Benchmark Phase
- **Status:** Provisional (To be finalized in Phase 5)
- **Context:** NetBox Core will run a local LLM on a 16 GB physical RAM Windows 11 / WSL 2 laptop while sharing memory with the OS and VS Code.
- **Decision:** Defer final choice of model and quantization (evaluating `Qwen2.5-Coder 3B` and smaller alternatives on `Ollama` or another local runtime) until Phase 5 benchmarking on actual hardware.
- **Reasoning:** Selecting a model now without measuring memory headroom, tokens/sec, and explanation quality under real WSL 2 + VS Code load risks unusable latency or out-of-memory swapping.
- **Consequences:** Phase 0–4 do not install or depend on any LLM runtime or model weights.

## DEC-008: VS Code Extension Implementation via TypeScript and esbuild
- **Status:** Accepted (Phase 1)
- **Context:** The extension needs reliable typing against `@types/vscode`, fast compilation, and an unbloated bundle.
- **Decision:** Implement the extension in TypeScript and bundle using `esbuild` (`esbuild.js` producing `dist/extension.js`).
- **Reasoning:** `esbuild` provides sub-second build times, simple configuration, and produces a single clean CJS bundle suitable for the VS Code extension host without Webpack or complex build chains.
- **Consequences:** Extension source lives in `extension/src/`, outputs to `extension/dist/`, and depends only on `@types/vscode`, `@types/node`, `typescript`, and `esbuild` as devDependencies.

## DEC-009: Webview Architecture & Content Security Policy
- **Status:** Accepted (Phase 1)
- **Context:** The Dashboard and Visualizer panels require interactive UIs inside VS Code without compromising editor security.
- **Decision:** Build the Webview panels using vanilla HTML5, CSS3, and JavaScript, styled using VS Code dark theme CSS variables (`--vscode-*`), and protected with strict per-render CSP nonces and `localResourceRoots: [media]`.
- **Reasoning:** Avoids heavy external UI frameworks (React, Next.js, Vue) which add significant bundle weight and build complexity, while maintaining strict isolation, fast rendering, and native developer-tool feel.
- **Consequences:** Webview scripts in `extension/media/` communicate with the extension exclusively via structured `vscode.postMessage` payloads.

## DEC-010: Initial Modular Backend Using Python & FastAPI
- **Status:** Accepted (Phase 1)
- **Context:** The backend service needs to serve metadata, run execution flows, and eventually correlate socket and packet traces and interface with local AI models.
- **Decision:** Use Python with FastAPI and Uvicorn bound to loopback (`127.0.0.1:8000`).
- **Reasoning:** Python is already a core requirement for course lab assignments (Labs 2, 3, 4, 7, 8, 9) and Python 3.14 is installed in WSL. FastAPI offers native async support, automated OpenAPI docs, and strict Pydantic model validation.
- **Consequences:** Backend runs as a lightweight local process via `scripts/run_backend.sh` with a dedicated virtual environment in `backend/.venv`.

## DEC-011: Simulated Event Representation for Phase 1
- **Status:** Accepted (Phase 1)
- **Context:** Visualizer development requires realistic event data before live `LD_PRELOAD` socket interception is built in Phase 2.
- **Decision:** The demo endpoint (`GET /api/demo/tcp`) provides a 12-event simulated TCP trace adhering strictly to `docs/event_schema.md` v1.0, with `"is_simulated": true` and `"simulation_label": "SIMULATED"`.
- **Reasoning:** Enables validating the visualizer topology, timeline, and inspector UI against the exact schema without mixing simulated data with future captured data or creating incompatible temporary formats.
- **Consequences:** The Webview visualizer displays a prominent "SIMULATED DATA" warning banner whenever rendering simulated telemetry.

## DEC-012: User-Space Socket API Interception via `LD_PRELOAD`
- **Status:** Accepted (Phase 2)
- **Context:** NetBox must observe real C socket operations without requiring kernel privileges (`root`), modifying student code, or adding debug compilation flags.
- **Decision:** Build a dynamic shared library (`libnetbox_trace.so`) that intercepts POSIX socket APIs using `LD_PRELOAD` and `dlsym(RTLD_NEXT, ...)`.
- **Reasoning:** `LD_PRELOAD` runs entirely in user-space without `sudo`, intercepts the exact 12 socket calls taught in the CN curriculum, preserves `errno`, and introduces minimal overhead (~microseconds per call). Wire packet capture is deferred to Phase 4 via `libpcap`.
- **Consequences:** Statically compiled binaries (`gcc -static`) cannot be intercepted. Target binaries must be dynamically linked against glibc.

## DEC-013: Dedicated File-Based Event Transport (`NETBOX_EVENT_FILE`)
- **Status:** Accepted (Phase 2)
- **Context:** Intercepted socket events must be recorded without perturbing the target program's own I/O streams or causing re-entrant socket calls.
- **Decision:** Have `libnetbox_trace.so` write JSONL records to a dedicated file descriptor specified via `NETBOX_EVENT_FILE` using low-level POSIX `write()`.
- **Reasoning:** Using stdout/stderr would mix telemetry with student program output and break automated parsing. Using sockets or network IPC inside `libnetbox_trace.so` would create recursive interception loops. Using direct POSIX `write()` avoids libc stdio buffer allocations and thread deadlocks.
- **Consequences:** Each process writes to its own dedicated file (e.g. `/tmp/netbox_runs/<run_id>/events_server.jsonl`), and the backend merges and sorts events chronologically using monotonic timestamps.

## DEC-014: Subprocess Runner Allowlist and Non-Intrusive Readiness Probe
- **Status:** Accepted (Phase 2)
- **Context:** Launching client-server pairs requires knowing when the server is listening before the client connects, while preventing arbitrary process execution.
- **Decision:** Use a strict executable allowlist (`examples/tcp/server`, `examples/tcp/client`) and detect server readiness by monitoring server stdout for the startup banner (`Listening on 127.0.0.1:8080`) rather than probing port 8080 with a dummy connection.
- **Reasoning:** Probing port 8080 with a TCP connection would consume an `accept()` queue slot, altering the target program's execution trace and generating spurious connection events. An allowlist prevents arbitrary command injection.
- **Consequences:** Target server programs must flush their startup message (already standard in NetBox examples). Process execution is bounded by a 10-second timeout.

## DEC-015: Payload Data Privacy by Default
- **Status:** Accepted (Phase 2)
- **Context:** Capturing full payloads during `send()` and `recv()` can log sensitive data, student passwords, or large binaries, bloating telemetry logs.
- **Decision:** NetBox records payload byte counts (`payload.bytes`), operation result, and endpoints, but leaves raw payload previews null by default (`"payload": {"bytes": N, "preview_utf8": null}`).
- **Reasoning:** Computer Networks education focuses on protocol mechanics (connection establishment, transfer lengths, flow control, teardown) rather than application payload inspection. Privacy-by-default avoids accidental leakage.
- **Consequences:** Payload inspection can be selectively enabled in future phases as an opt-in configuration for specific application-layer labs (e.g. HTTP headers in Lab 2).
