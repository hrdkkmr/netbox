# NetBox Event Schema Specification (v1.0)

> **Status:** Specification active and implemented for **`socket_api` (Phase 2)**. The user-space instrumentation library (`instrumentation/libnetbox_trace.so`) emits events strictly conforming to this schema. Packet capture (`packet_capture`, Phase 4) remains planned.

---

## 1. Design Goals & Layer Separation

NetBox strictly separates **two distinct observation layers**:

1. **`socket_api` (Application / OS Interface Layer — Phase 2):**
   - Represents POSIX socket calls made by the student's process:
     `socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`, `sendto`, `recvfrom`, `setsockopt`, `shutdown`, `close`.
2. **`packet_capture` (Wire / Network Layer — Phase 4):**
   - Represents actual packets observed on the network interface (`lo`, `eth0`, `wlan0`):
     TCP control segments (`SYN`, `SYN_ACK`, `ACK`, `FIN`, `RST`), TCP data segments, UDP datagrams, ICMP, DNS, etc.

**Why they are kept separate:**
- One `send()` call at the socket layer can produce zero, one, or multiple TCP segments at the wire layer (Nagle's algorithm, segmentation, retransmissions).
- Conversely, TCP `SYN` / `SYN-ACK` / `ACK` / `FIN` handshakes and retransmissions occur in the kernel TCP stack without corresponding 1-to-1 `send()`/`recv()` calls.
- Keeping `source` distinct prevents conflating OS API semantics with wire-level protocol behavior, while still allowing the backend to correlate them cleanly.

---

## 2. Example Events

### Example A: `socket_api` Event (Proposed)

```json
{
  "schema_version": "1.0",
  "run_id": "run_001",
  "sequence": 1,
  "timestamp_ns": 123456789,
  "source": "socket_api",
  "event_type": "connect",
  "process": {
    "pid": 1234,
    "name": "client"
  },
  "connection": {
    "local_ip": "127.0.0.1",
    "local_port": 50001,
    "remote_ip": "127.0.0.1",
    "remote_port": 8080
  },
  "result": 0,
  "error_code": null
}
```

### Example B: `socket_api` Data Transfer Error Event (Proposed)

```json
{
  "schema_version": "1.0",
  "run_id": "run_001",
  "sequence": 2,
  "timestamp_ns": 124900112,
  "source": "socket_api",
  "event_type": "connect",
  "process": {
    "pid": 1299,
    "name": "client"
  },
  "connection": {
    "local_ip": null,
    "local_port": null,
    "remote_ip": "127.0.0.1",
    "remote_port": 8080
  },
  "result": -1,
  "error_code": 111,
  "error_name": "ECONNREFUSED",
  "error_message": "Connection refused",
  "socket_fd": 3
}
```

### Example C: `packet_capture` Event (Proposed for Phase 4)

```json
{
  "schema_version": "1.0",
  "run_id": "run_001",
  "sequence": 1,
  "timestamp_ns": 123456910,
  "source": "packet_capture",
  "event_type": "tcp_syn",
  "connection": {
    "local_ip": "127.0.0.1",
    "local_port": 50001,
    "remote_ip": "127.0.0.1",
    "remote_port": 8080
  },
  "packet": {
    "interface": "lo",
    "protocol": "TCP",
    "ip_ttl": 64,
    "length_bytes": 74,
    "tcp_flags": ["SYN"],
    "seq_num": 3194021100,
    "ack_num": 0
  },
  "result": 0,
  "error_code": null
}
```

---

## 3. Field Reference

### Top-Level Fields

| Field | Type | Requirement | Description |
| :--- | :--- | :--- | :--- |
| `schema_version` | `string` | **Mandatory** | Semantic version of the event schema (initially `"1.0"`). |
| `run_id` | `string` | **Mandatory** | Unique identifier for a single NetBox execution run (e.g., `"run_001"` or UUID/timestamp slug). |
| `sequence` | `integer` | **Mandatory** | Monotonically increasing 1-based counter scoped to `(run_id, source)` for deterministic ordering. |
| `timestamp_ns` | `integer` | **Mandatory** | Event timestamp in nanoseconds (`CLOCK_MONOTONIC` for relative ordering within a host, or epoch ns when explicitly noted). |
| `source` | `string` | **Mandatory** | Observation layer: `"socket_api"` or `"packet_capture"`. |
| `event_type` | `string` | **Mandatory** | Specific operation or packet classification (see Section 4). |
| `process` | `object` | **Mandatory for `socket_api`** / Optional for `packet_capture` | Process metadata: `{ "pid": int, "name": string, "ppid"?: int, "tid"?: int }`. |
| `connection` | `object` | **Optional** (recommended whenever endpoints exist) | 4-tuple endpoint info: `{ "local_ip": string|null, "local_port": int|null, "remote_ip": string|null, "remote_port": int|null }`. |
| `socket_fd` | `integer` | **Optional** | File descriptor number associated with a `socket_api` call (helps link `socket()` → `bind()` → `close()`). |
| `socket_domain` / `socket_type` | `string` | **Optional** | E.g., `"AF_INET"`, `"SOCK_STREAM"` (`TCP`), or `"SOCK_DGRAM"` (`UDP`) on `socket()` events. |
| `payload` | `object` | **Optional** | Metadata for `send`/`recv`/`sendto`/`recvfrom`: `{ "bytes": int, "preview_utf8"?: string, "truncated"?: bool }`. |
| `packet` | `object` | **Mandatory for `packet_capture`** / Omitted for `socket_api` | Wire-level metadata: `interface`, `protocol`, `ip_ttl`, `length_bytes`, `tcp_flags`, `seq_num`, `ack_num`, etc. |
| `result` | `integer` | **Mandatory** | For `socket_api`: syscall return value (`>= 0` on success, `-1` on failure; byte count for `send`/`recv`). For `packet_capture`: `0` for valid captured packet. |
| `error_code` | `integer \| null` | **Mandatory** | Numeric `errno` when `result < 0` (e.g., `111` for `ECONNREFUSED`, `98` for `EADDRINUSE`); `null` on success. |
| `error_name` | `string \| null` | **Optional** | Symbolic `errno` name (e.g., `"ECONNREFUSED"`) for UI and LLM readability. |
| `error_message` | `string \| null` | **Optional** | Human-readable `strerror(errno)` text. |
| `is_simulated` | `boolean` | **Optional** (defaults to `false`) | `false` for telemetry captured from real execution; `true` for mock/demo traces. |
| `simulation_label` | `string \| null` | **Optional** | UI indicator badge (`"ACTUAL SOCKET API EVENTS"` or `"SIMULATED"`). |

---

## 4. Allowed `event_type` Values (Initial Set)

### `source: "socket_api"`
- `socket` — Socket creation (`AF_INET`, `SOCK_STREAM`/`SOCK_DGRAM`).
- `bind` — Associating socket with local IP/port.
- `listen` — Marking TCP socket as passive listener.
- `accept` — Accepting an incoming client connection (returns new `socket_fd`).
- `connect` — Initiating connection to remote IP/port.
- `send` / `recv` — Connected stream send/receive.
- `sendto` / `recvfrom` — Connectionless datagram send/receive (UDP).
- `setsockopt` — Relevant socket option calls (e.g., `SO_REUSEADDR`).
- `shutdown` — Half-close of read/write stream.
- `close` — Releasing socket file descriptor.

### `source: "packet_capture"`
- `tcp_syn`, `tcp_syn_ack`, `tcp_ack`, `tcp_data`, `tcp_fin`, `tcp_rst`
- `udp_datagram`
- `icmp_echo_request`, `icmp_echo_reply`
- `dns_query`, `dns_response`
- `http_request`, `http_response` (when parsed above TCP)

---

## 5. Run Identification, Ordering & Error Representation

- **Run Identification (`run_id`):** Every launch of a target program (or paired client+server session) is assigned a unique `run_id`. All JSONL lines written during that session carry the same `run_id`, isolating events across repeated student runs.
- **Event Ordering (`sequence` + `timestamp_ns`):**
  - `sequence` is assigned strictly monotonically per `(run_id, source)` starting at `1`. This guarantees deterministic ordering even when two events occur within the same microsecond or across concurrent `fork()`/`pthread` workers (using an atomic/locked counter).
  - `timestamp_ns` records actual elapsed timing for timeline scaling and cross-layer (`socket_api` vs. `packet_capture`) correlation.
- **Error Representation:**
  - Success: `result >= 0`, `error_code: null`.
  - Failure: `result: -1` (standard POSIX syscall convention), `error_code` set to the captured `errno` integer before any library/logging call overwrites `errno`, and optional `error_name` / `error_message`.

---

## 6. Schema Evolution Policy

- **Minor, backwards-compatible changes (`1.0` → `1.1`):** Adding new optional fields (e.g., `correlation_id`, `thread_id`) or new `event_type` values. Consumers (visualizer and backend) must ignore unknown optional fields.
- **Breaking changes (`1.0` → `2.0`):** Renaming/removing mandatory fields or changing field types. Requires bumping the major version in `schema_version` and supporting a version check in the backend parser.
