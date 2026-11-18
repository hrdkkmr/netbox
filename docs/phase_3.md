# NetBox — Phase 3: Interactive Networking Visualizer

This document describes the architecture, deterministic logic engines, observed vs. derived boundaries, test results, and verification status for **Phase 3** of NetBox.

---

## 1. Objectives

Transform actual POSIX socket API events captured in Phase 2 (`LD_PRELOAD` via `libnetbox_trace.so`) into an interactive, observation-grounded visualization inside the VS Code Webview so students can:

1. Execute a real C networking program (`examples/tcp/`) directly from the visualizer.
2. Observe actual socket allocations, bindings, listening states, connection attempts, accepted server connections, data transfers, and closures.
3. Follow client-server communication through a dynamic **Network Topology**, **Chronological Event Timeline**, and **API-Level Communication Sequence Diagram**.
4. Inspect every event's directly observed schema fields alongside deterministic explanations (no LLM).
5. Filter, search, measure API-event timing intervals, and replay execution using actual monotonic timestamps.

---

## 2. Modular Visualizer Architecture

Rather than placing all logic in one monolithic script, the Phase 3 visualizer is separated into focused, testable UMD modules under `extension/media/visualizer/`, loaded with strict per-render CSP nonces inside `VisualizerPanel` (`extension/src/providers/visualizerPanel.ts`):

| Module | File | Responsibility |
| :--- | :--- | :--- |
| **Event Store** | `extension/media/visualizer/eventStore.js` | Immutable storage of raw events, null-safe formatting (`"Not available"`), and strict Actual vs. Simulated source classification. |
| **Timing Engine** | `extension/media/visualizer/timingEngine.js` | Converts `CLOCK_MONOTONIC` `timestamp_ns` into relative elapsed times (`+0.000 ms`), consecutive deltas, selected A↔B intervals, and actual successful byte totals. |
| **Socket State Engine** | `extension/media/visualizer/socketStateEngine.js` | Deterministically replays `events[0..N]` to derive separate lifecycle states for server listening sockets, accepted server sockets, and client sockets, plus dynamic topology links. |
| **Event Filter** | `extension/media/visualizer/eventFilter.js` | Non-destructive filtering by process, event type, socket FD, errors-only, and free-text search without mutating the original event array. |
| **Sequence Mapper** | `extension/media/visualizer/sequenceMapper.js` | Generates dynamic Client ↔ Server API-level communication sequence entries, flagging unmappable events as `unresolved` without inventing wire packets. |
| **Event Inspector** | `extension/media/visualizer/eventInspector.js` | Produces structured inspector view models separating Directly Observed Fields from Visualizer-Derived Fields, plus deterministic explanations. |
| **Playback Engine** | `extension/media/visualizer/playbackEngine.js` | Schedules step advancement from actual `timestamp_ns` intervals adjusted by speed (`0.5x`, `1x`, `2x`, `4x`) with leak-safe timer teardown. |
| **DOM Renderers** | `extension/media/visualizer/renderers.js` | Renders Topology, Timeline table, API Sequence Diagram, Metrics Summary Strip, and Event Inspector with HTML escaping and subtle CSS animations. |
| **Main Controller** | `extension/media/visualizer.js` | Coordinates UI events, VS Code Webview message transport, run selector, refresh, and view modes (`Split`, `Timeline`, `Sequence`). |

---

## 3. Directly Observed vs. Visualizer-Derived Values

NetBox maintains a strict epistemic boundary between what the Phase 2 instrumentation actually recorded and what the Phase 3 visualizer computes:

| Category | Directly Observed (`socket_api` JSON) | Visualizer-Derived (Computed in Phase 3) | Explicitly NOT Inferred |
| :--- | :--- | :--- | :--- |
| **Identity** | `schema_version`, `run_id`, `sequence`, `source`, `process.name`, `process.pid`, `process.tid`, `socket_fd` | Socket key (`pid:fd`), actor role (`server_listener`, `server_accepted`, `client`, `unknown`) | Process intent outside observed calls |
| **Endpoints** | `connection.local_ip`, `local_port`, `remote_ip`, `remote_port`, `socket_domain`, `socket_type` | Client ↔ Server topology link matching by 4-tuple symmetry | Underlying routing hops or MAC addresses |
| **Lifecycle** | `event_type`, `result`, `error_code`, `error_name`, `error_message` | API-derived states: `CREATED`, `BOUND`, `LISTENING`, `CONNECTING`, `CONNECTED`, `CLOSING`, `CLOSED`, `CONNECTION_FAILED`, `ERROR`, `UNKNOWN`, `UNRESOLVED` | **Kernel TCP states** (`SYN_SENT`, `FIN_WAIT`, **`TIME_WAIT`**), wire 3-way handshake (`SYN`/`SYN-ACK`/`ACK`) |
| **Data Transfer** | `result` (bytes accepted/returned by OS API), `payload.bytes` | Cumulative TX/RX byte totals (strictly summing positive `result` values, never requested buffer length) | Peer delivery confirmation from `send()` alone |
| **Timing** | `timestamp_ns` (`CLOCK_MONOTONIC`) | Relative time (`+X.XXX ms`), consecutive event delta, observed API-event interval (`#A ↔ #B`), total observed run duration | Wall-clock timestamps or wire network latency / RTT |
| **Explanations** | Raw event fields | Deterministic rule-based explanation text | LLM-generated prose (reserved for Phase 5) |

---

## 4. Key Engine Designs

### A. Socket Lifecycle Derivation (`socketStateEngine.js`)
- Replays `events[0..currentIndex]` cleanly from scratch on every step or jump, eliminating state drift when stepping backward or scrubbing.
- Keys every socket uniquely by `${pid}:${fd}` so identical FD numbers across separate processes (e.g., `server` `fd=3` and `client` `fd=3`) never collide.
- When `accept()` or `accept4()` returns a new file descriptor (`result >= 0`), the server's listening socket remains `LISTENING` while a **separate** `server_accepted` socket record is created in `CONNECTED` state.
- Failed `connect()` calls (e.g. `ECONNREFUSED`) transition to `CONNECTION_FAILED` and highlight the link in error state; `close()` transitions strictly to `CLOSED` (never `TIME_WAIT`).
- Operations on untracked descriptors without prior lifecycle evidence transition to `UNRESOLVED`; unrecognized `event_type` values transition to `UNKNOWN`.

### B. API-Level Sequence Diagram (`sequenceMapper.js`)
- Explicitly labeled: **`API-Level Communication Sequence (Observed POSIX Socket Calls — Not Wire Packets)`**.
- Maps client `connect()`, server `accept()`, client/server `send()`, `recv()`, and local lifecycle calls (`socket`, `bind`, `listen`, `shutdown`, `close`) onto Client and Server lifelines.
- Never fabricates TCP `SYN` / `SYN-ACK` / `ACK` handshake packets.
- Any event whose actor or direction cannot be mapped confidently is rendered as an explicit **Unresolved** item.

### C. Timestamp-Aware Playback (`playbackEngine.js`)
- Uses chained `setTimeout` scheduling driven by actual `timestamp_ns` deltas between consecutive events divided by speed (`0.5x`, `1x`, `2x`, `4x`).
- Applies a readability clamp (`320ms`–`2200ms` base at `1x`, scaled proportionally by speed) so microsecond-close loopback syscalls remain readable while preserving exact original `timestamp_ns` values in event data.
- Guards callbacks with a monotonic `loopToken` and clears timers on `pause()`, `reset()`, `setEvents()`, and `beforeunload` to prevent duplicate loops or leaks.

### D. Actual vs. Simulated Telemetry Guard (`eventStore.js`)
- The green **`ACTUAL SOCKET API EVENTS`** indicator appears **only** when `payload.isSimulated === false`, `events.length > 0`, and every event satisfies `ev.source === "socket_api"` and `ev.is_simulated === false`.
- Simulated traces (`/api/demo/tcp`) display an amber **`SIMULATED DATA`** badge; mixed or unverified traces are explicitly flagged as **`MIXED / UNVERIFIED TELEMETRY`**.

---

## 5. Verification & Test Results

### A. Automated Unit & Live Integration Tests (`extension/tests/`)
Executed via `cd extension && npm test` (Node.js `v26.13.1` built-in test runner):

- **16/16 unit tests passed** (`extension/tests/visualizer.test.js`):
  1. Socket creation (`CREATED`)
  2. Bind transition (`BOUND`)
  3. Listen transition (`LISTENING`, `server_listener`)
  4. Successful `connect()` (`CONNECTED`)
  5. Failed `connect()` (`ECONNREFUSED` → `CONNECTION_FAILED`, never `CONNECTED`)
  6. Separate accepted server connection tracking (`server_accepted` vs `server_listener`)
  7. Distinct client/server socket identities with identical FD numbers
  8. Actual `send`/`recv` byte accounting using positive `result` values (ignoring larger requested `payload.bytes`)
  9. `close()` → `CLOSED` (never `TIME_WAIT`)
  10. Unknown/incomplete event handling (`UNKNOWN` / `UNRESOLVED`)
  11. Non-destructive filtering by process, event type, FD, errors-only, and search
  12. Monotonic relative timestamp calculations (`+0.000 ms`, deltas, A↔B API-event interval)
  13. Sequence diagram direction mapping + unresolved event handling
  14. Playback `next`/`prev`/`reset`/`jumpTo`/speed scaling/zero duplicate timers
  15. Strict Simulated vs. Actual classification (rejecting mixed telemetry)
  16. Inspector `"Not available"` null formatting and deterministic explanations
- **1/1 live Phase 2 → Phase 3 integration test passed** (`extension/tests/live_integration.test.js`):
  - Executed real `examples/tcp/server` and `client` under `LD_PRELOAD` through `RunManager.create_run("tcp-echo", ["Phase 3 live trace test!"])`.
  - Verified all 7 Phase 3 engines consumed the real captured stream with `isActual: true`, exact 48B TX / 48B RX echo byte accounting, separate listening and accepted server sockets, and zero `TIME_WAIT` inference.

### B. Phase 2 Regression Verification
- `python3 instrumentation/tests/test_suite.py`: **All 7 suites (Tests A–G) PASSED.**

### C. Extension Build & UI Verification
- Installed native Linux Node.js LTS (`v26.13.1`) and `npm` (`v11.20.0`) inside Ubuntu WSL 2 via `nvm`.
- `cd extension && npm install && npm run check-types && npm run build`: **Passed with 0 TypeScript errors; built `extension/dist/extension.js`.**
- **Live Browser Preview Verification:** Rendered the exact `extension/media/` visualizer assets and HTML template from `visualizerPanel.ts` against the live FastAPI backend (`http://127.0.0.1:8000`), executed a real `POST /api/runs` live TCP trace (`run_20261117_191609_3d9a9e`, 15 real events), verified 0 console errors, verified Topology, Timeline, Sequence Diagram, Delta interval chip (`#5 ↔ #7`), Filtering, and Inspector visually, and fixed all layout clipping issues.
- **VS Code Extension Development Host Limitation:** Because CLI automation cannot interactively launch the desktop VS Code GUI window and press `F5`, interactive Extension Development Host launch inside desktop VS Code remains a quick manual verification step for the user (`code ~/projects/netbox` → press `F5` → run `NetBox: Open Visualizer`).

---

## 6. Known Limitations

1. **No Wire Packet Visibility Yet:** Socket API events do not expose TCP `SYN`, `SYN-ACK`, `ACK`, `FIN`, `RST`, or retransmissions. Wire-level capture is scheduled for Phase 4 (`libpcap`).
2. **No Kernel TCP State Machine:** States like `TIME_WAIT`, `CLOSE_WAIT`, or `FIN_WAIT_2` cannot be observed via user-space `LD_PRELOAD` hooks and are intentionally not inferred.
3. **Deterministic Explanations Only:** Explanations in Phase 3 are rule-based from observed fields. Grounded local LLM tutoring belongs to Phase 5.
4. **In-Memory Run History:** Older runs listed in `/api/runs` live in the backend process's in-memory `RunManager` registry for the lifetime of the backend session.
