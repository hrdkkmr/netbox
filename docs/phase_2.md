# NetBox — Phase 2: C Program Execution and Real Socket Event Collection

This document defines the implementation, architecture, interception design, test results, and acceptance criteria for **Phase 2** of NetBox.

---

## 1. Objectives

- Move beyond simulated networking events by constructing a real execution-observation engine for C networking code.
- Build a user-space dynamic interception shared library (`instrumentation/libnetbox_trace.so`) using Linux `LD_PRELOAD`.
- Intercept 12 core POSIX socket APIs (`socket`, `bind`, `listen`, `accept`, `accept4`, `connect`, `send`, `sendto`, `recv`, `recvfrom`, `shutdown`, `close`) without modifying target program binaries or networking behavior.
- Output structured, validated JSONL events adhering strictly to [`docs/event_schema.md`](./event_schema.md) v1.0.
- Implement an execution run manager in the local backend (`backend/app/services/run_manager.py`) and execution runner (`process_runner.py`) to coordinate paired server-client execution.
- Add execution REST endpoints: `POST /api/runs`, `GET /api/runs/{run_id}`, `GET /api/runs/{run_id}/events`, `POST /api/runs/{run_id}/stop`, `GET /api/runs`.
- Verify the entire pipeline with the real POSIX TCP client-server example (`examples/tcp/`).

---

## 2. Architecture & Data Flow

```text
               C Networking Program (e.g. examples/tcp/server.c, client.c)
                                       |
                                       v
                                GCC Compilation
                                       |
                                       v
                              Executable Program
                                       |
                                       v
                            LD_PRELOAD Instrumentation
                          (libnetbox_trace.so in user-space)
                                       |
                                       v
                            Socket API Interception
                 (dlsym RTLD_NEXT, errno preservation, recursion guard)
                                       |
                                       v
                            Structured JSONL Events
                    (schema_version: "1.0", is_simulated: false)
                                       |
                                       v
                             NetBox Local Backend
              (RunManager, ProcessRunner coordination, EventReader merge)
                                       |
                                       v
                       REST API (/api/runs, /api/runs/{run_id}/events)
                                       |
                                       v
                            VS Code Visualizer Webview
                        (ACTUAL SOCKET API EVENTS label)
```

---

## 3. Instrumentation Library Design (`libnetbox_trace.so`)

### Intercepted Functions

| Function | Operation Recorded |
| :--- | :--- |
| `socket()` | Allocates socket descriptor, domain (`AF_INET`), type (`SOCK_STREAM`), protocol |
| `bind()` | Binds local address (`127.0.0.1`) and port (`8080`) |
| `listen()` | Marks socket as listening with configured backlog |
| `accept()`, `accept4()` | Accepts client connection; records returned `client_fd`, local port, remote IP & port |
| `connect()` | Initiates handshake; records target IP/port, ephemeral local port, success or `ECONNREFUSED` |
| `send()`, `sendto()` | Records bytes requested and transferred, endpoints, return value |
| `recv()`, `recvfrom()` | Records bytes received, endpoints, clean EOF (`0` bytes) detection |
| `shutdown()` | Records half-close direction |
| `close()` | Records release of socket file descriptor (non-socket file descriptors bypass logging) |

### Re-entrancy Prevention

A major risk in `LD_PRELOAD` interception is infinite recursion (e.g., if writing an event or resolving symbols triggers an intercepted socket call).  
NetBox prevents recursion using three coupled layers:
1. **Thread-local Guard:** `static __thread int in_trace_hook = 0;` set on entry to any wrapper. If non-zero, calls forward directly to `real_*` without logging.
2. **Dedicated Direct Output:** The event writer uses low-level POSIX `write()` directly on a dedicated file descriptor (`NETBOX_EVENT_FILE`). `write()` is not an intercepted socket function.
3. **Internal FD Exclusion:** The internal logging descriptor (`g_event_fd`) is excluded from `close()` interception.

### Data Privacy by Default

By default, NetBox **does not log application data payloads**. Sent and received data are recorded solely by byte count (`payload.bytes`), operation result, and endpoint metadata. Raw payloads can only be logged if an explicit opt-in flag is enabled in future phases.

---

## 4. Run Management & Process Coordination

Because networking code typically involves communicating processes (e.g. server and client), the execution runner (`backend/app/services/process_runner.py`) coordinates execution safely:

1. **Server Launch:** Starts `examples/tcp/server` with `LD_PRELOAD` set to `libnetbox_trace.so` and `NETBOX_EVENT_FILE` pointing to `events_server.jsonl`.
2. **Readiness Probe:** Non-intrusively monitors the server's stdout until `Listening on 127.0.0.1:8080` is emitted. This avoids connecting with fake sockets or consuming queue backlog.
3. **Client Launch:** Starts `examples/tcp/client` with `events_client.jsonl`. Client connects, transmits its payload, receives the echo, verifies equality, and exits with code 0.
4. **Clean Teardown:** Sends `SIGINT` to the server process. The server's signal handler cleanly closes the listening socket, logs the `close` event, and terminates with code 0.
5. **Event Merging:** `EventReader.merge_and_sort_events()` reads both `events_server.jsonl` and `events_client.jsonl`, sorts all events chronologically by nanosecond monotonic timestamp, and assigns unified sequence numbers `1..N`.

---

## 5. Backend REST API Endpoints (Phase 2)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/runs` | Creates and executes a monitored run (`example_id: "tcp-echo"`, optional `client_args`) |
| `GET` | `/api/runs/{run_id}` | Retrieves run status, execution duration, process exit codes, and stdout/stderr summaries |
| `GET` | `/api/runs/{run_id}/events` | Retrieves real recorded socket events (`is_simulated: false`, `ACTUAL SOCKET API EVENTS`) |
| `POST` | `/api/runs/{run_id}/stop` | Safely stops an active run |
| `GET` | `/api/runs` | Lists recent execution runs |
| `GET` | `/health` | Health probe (Phase 1 retained) |
| `GET` | `/api/project` | Project metadata (Phase 1 retained) |
| `GET` | `/api/examples` | Examples metadata (Phase 1 retained) |
| `GET` | `/api/demo/tcp` | 12-event simulated demo trace (Phase 1 retained) |

---

## 6. Verification & Test Results

All required test cases (A through H) were executed directly in Ubuntu WSL 2 and passed:

### Test Suite Execution (`instrumentation/tests/test_suite.py`)

```text
--- Test A: Basic TCP Echo (Real Event Capture) ---
Server events captured: 10, Client events captured: 5
Test A PASSED!

--- Test B: Multiple Sequential Clients ---
Server accepted connections: 2
Test B PASSED!

--- Test C: Connection Refused (Server not running) ---
Captured failed connect event: result=-1, error_code=111, error_name=ECONNREFUSED
Test C PASSED!

--- Test D: Invalid Input (Empty client message) ---
Test D PASSED!

--- Test E: Server Termination & Cleanup ---
Captured close events on server termination: 1
Test E PASSED!

--- Test F: Instrumentation Disabled Baseline ---
Program behaves identically with or without LD_PRELOAD.
Test F PASSED!

--- Test G: Event Schema & Ordering Integrity ---
All event streams conform strictly to docs/event_schema.md v1.0.
Test G PASSED!
```

### Backend Integration Tests (`scratch/test_phase2_backend.py`)

- **Phase 1 Regression:** `/health`, `/api/project`, `/api/demo/tcp` all returned HTTP 200 with matching models.
- **POST `/api/runs`:** Successfully orchestrated server + client under `LD_PRELOAD`, returning `run_id`, status `"completed"`, `exit_code: 0`.
- **GET `/api/runs/{run_id}/events`:** Successfully retrieved 15 real socket events (`socket -> bind -> listen -> accept -> socket -> connect -> send -> recv -> recv -> send -> recv -> close -> close -> accept -> close`).
- **Error Handling:** Invalid `example_id` rejected with HTTP 400; nonexistent `run_id` returned HTTP 404.

---

## 7. Sample Real JSONL Event Output

### Actual Client Socket Creation (`sequence: 1`)
```json
{
  "schema_version": "1.0",
  "run_id": "test_c_run",
  "sequence": 1,
  "timestamp_ns": 2139211422561,
  "source": "socket_api",
  "event_type": "socket",
  "process": {
    "pid": 1880,
    "tid": 1880,
    "name": "client"
  },
  "connection": null,
  "socket_fd": 4,
  "socket_domain": "AF_INET",
  "socket_type": "SOCK_STREAM",
  "payload": null,
  "result": 4,
  "error_code": null,
  "error_name": null,
  "error_message": null,
  "is_simulated": false,
  "simulation_label": "ACTUAL SOCKET API EVENTS"
}
```

### Actual Failed Connect (`ECONNREFUSED`, `sequence: 2`)
```json
{
  "schema_version": "1.0",
  "run_id": "test_c_run",
  "sequence": 2,
  "timestamp_ns": 2139211534062,
  "source": "socket_api",
  "event_type": "connect",
  "process": {
    "pid": 1880,
    "tid": 1880,
    "name": "client"
  },
  "connection": {
    "local_ip": null,
    "local_port": null,
    "remote_ip": "127.0.0.1",
    "remote_port": 8080
  },
  "socket_fd": 4,
  "socket_domain": "AF_INET",
  "socket_type": "SOCK_STREAM",
  "payload": null,
  "result": -1,
  "error_code": 111,
  "error_name": "ECONNREFUSED",
  "error_message": "Connection refused",
  "is_simulated": false,
  "simulation_label": "ACTUAL SOCKET API EVENTS"
}
```

---

## 8. Technical & Security Limitations

1. **Dynamic Linking Requirement:** `LD_PRELOAD` intercepts dynamic symbol resolution in glibc. Statically compiled C binaries (`-static`) or direct assembly `syscall` instructions bypass interception.
2. **User-Space vs Wire-Level:** This layer intercepts POSIX socket APIs (`source: "socket_api"`). It does not capture raw Ethernet/IP packets, TCP handshakes (`SYN`, `SYN-ACK`), or kernel retransmissions. Those are reserved for Phase 4 packet capture via `libpcap`.
3. **Execution Safety Boundaries:** The backend execution runner is a development tool for classroom exercises on `127.0.0.1`, not an arbitrary-code multi-tenant sandbox. Only approved project examples (`tcp-echo`) are permitted by the allowlist.

---

## 9. Phase 2 Acceptance Checklist

- [x] Shared library `instrumentation/libnetbox_trace.so` compiles with zero warnings under `-Wall -Wextra -Wpedantic`.
- [x] All 12 socket functions intercepted (`socket`, `bind`, `listen`, `accept`, `accept4`, `connect`, `send`, `sendto`, `recv`, `recvfrom`, `shutdown`, `close`).
- [x] Existing TCP server and client run cleanly under `LD_PRELOAD`.
- [x] Real socket events captured, validated, and formatted into JSONL matching schema v1.0.
- [x] Real errors (`ECONNREFUSED`) captured with accurate `errno` and symbolic names.
- [x] Multiple sequential clients handled and logged accurately.
- [x] Backend run manager and runner implemented with allowlist and timeout protection.
- [x] All Phase 2 REST endpoints (`/api/runs`, `/api/runs/{run_id}`, `/api/runs/{run_id}/events`) implemented and tested.
- [x] Visualizer integration updated with live run support and `ACTUAL SOCKET API EVENTS` label.
- [x] Phase 1 endpoints (`/health`, `/api/project`, `/api/examples`, `/api/demo/tcp`) preserved and functional.
- [x] Original `cn_lab/` PDFs and Phase 0/1 code preserved untouched.
