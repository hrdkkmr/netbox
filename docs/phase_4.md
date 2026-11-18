# NetBox — Phase 4: Real Network Packet Capture and Analysis

This document describes the architecture, native `libpcap` capture helper, least-privilege WSL2 permission setup, packet parsing, TCP flow/handshake/retransmission analysis, socket-to-packet correlation, payload privacy policy, and live verification results for **Phase 4** of NetBox.

---

## 1. Objectives

Extend NetBox to capture and analyze **real network packets** generated during allowlisted C TCP program execution, connecting user-space POSIX socket API operations (Phase 2) with wire-level TCP/IP behavior (Phase 4) inside the existing interactive visualizer (Phase 3) — without mixing or conflating the two observation layers.

---

## 2. Architecture & Data Flow

```text
                       NetBox FastAPI Backend
                                 |
                                 v
                            RunManager
                                 |
              +------------------+------------------+
              |                                     |
              v                                     v
        ProcessRunner                      PacketCaptureService
    (LD_PRELOAD=libnetbox_trace.so)     (packet_capture/netbox_pcap)
              |                           cap_net_raw,cap_net_admin=eip
              v                                     |
       examples/tcp/server & client                 v
              |                            libpcap on interface 'lo'
              v                            (immediate mode, BPF filter)
       events_*.jsonl                               |
      (source: socket_api)                          v
              |                             packets.jsonl
              |                          (source: packet_capture)
              |                                     |
              |                              packet_parser.py
              |                                     |
              |                               tcp_analyzer.py
              |                     (Flags, Handshake, Termination, Flows,
              |                      Retransmissions, 4-Part Explanations)
              +------------------+------------------+
                                 |
                                 v
                        event_correlator.py
             (Exact 4-Tuple + Forward/Reverse + Monotonic Window)
                                 |
                                 v
                FastAPI Endpoints (/events, /packets, /flows, /correlations)
                                 |
                                 v
                NetBox Visualizer Webview (Tabs + Dual-Layer Replay)
```

### Run Lifecycle (14 Steps)
1. Generate unique `run_id` and create `/tmp/netbox_runs/<run_id>/`.
2. Discover & verify loopback interface (`lo` with `127.0.0.1`).
3. Verify `packet_capture/netbox_pcap` availability & capabilities.
4. Start `netbox_pcap` via subprocess argument array and wait for `NETBOX_PCAP_READY` **before** launching target processes so the initial `SYN` is never missed.
5. Start `examples/tcp/server` under `LD_PRELOAD` and wait for stdout readiness.
6. Start `examples/tcp/client` under `LD_PRELOAD` and wait for completion.
7. Gracefully stop the server via `SIGINT`.
8. Allow brief flush window (~150 ms) for final loopback `FIN`/`ACK` delivery, then stop `netbox_pcap` cleanly via `SIGINT` (with process-group cleanup fallback in `finally:` so zero orphan processes remain).
9. Parse and strictly validate `packets.jsonl` (`packet_parser.py`).
10. Run deterministic TCP flow/handshake/termination/retransmission analysis (`tcp_analyzer.py`).
11. Run conservative 4-tuple + monotonic-window correlation (`event_correlator.py`).
12. Mark `packet_capture_status = "COMPLETED"` **only** when capture succeeded AND `packet_count > 0`.
13. If packet capture is unavailable or fails, still complete the Phase 2 socket API run cleanly and report `UNAVAILABLE` / `FAILED` with the exact diagnostic reason.

---

## 3. libpcap Setup, WSL2 Interface Behavior & Least-Privilege Security

### WSL2 Environment Verified
- **Kernel:** `Linux Hardik-Laptop 6.18.33.2-microsoft-standard-WSL2`
- **libpcap:** `libpcap-dev` / `libpcap0.8t64` (`1.10.6-1ubuntu1.1`)
- **Verified Loopback Interface:** `lo` (`<LOOPBACK,UP,LOWER_UP>`, `inet 127.0.0.1/8`, `mtu 65536`), reporting datalink `DLT_EN10MB` (14-byte zero-MAC Ethernet header on Linux loopback; decoded dynamically via `pcap_datalink()` rather than assumed).

### Least-Privilege Permission Model
NetBox **never runs the FastAPI backend or target C programs as `root`**. Instead, capture privileges are scoped exclusively to the small native C helper binary `packet_capture/netbox_pcap`:

```bash
sudo apt update && sudo apt install -y libpcap-dev
make packet_capture
sudo setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap
getcap packet_capture/netbox_pcap
# Output: packet_capture/netbox_pcap cap_net_admin,cap_net_raw=eip
```

**Security Notes:**
- Only `netbox_pcap` holds `cap_net_raw,cap_net_admin=eip`.
- It is invoked solely via subprocess argument arrays (no shell interpolation), restricted to allowlisted runs (`tcp-echo`), with strict timeouts and process-group teardown.
- Header-only snaplen (`160` bytes) is enforced by default.

---

## 4. Timestamp & Correlation Strategy

- **Clock Domain Safety:** Phase 2 `socket_api` events use `CLOCK_MONOTONIC` (`timestamp_ns`), whereas `libpcap` provides wall-clock-based packet timestamps (`pcap_timestamp_ns`). NetBox **never compares wall-clock timestamps against monotonic timestamps**.
- **Dual Timestamps:** Inside `netbox_pcap`'s packet callback, `clock_gettime(CLOCK_MONOTONIC)` is immediately recorded as `capture_monotonic_ns` alongside `pcap_timestamp_ns`.
- **Observation Boundary:** `capture_monotonic_ns` represents the user-space capture callback observation time, not hardware wire-arrival time; deltas between socket API calls and packet callbacks are not labeled as network latency.
- **Conservative Correlation (`event_correlator.py`):**
  - Matches TCP 4-tuples in both forward (`client -> server`) and reverse (`server -> client`) directions.
  - Compares `capture_monotonic_ns` against `ev.timestamp_ns` within a bounded window (`500 ms`) plus operation-type compatibility (`SYN` ↔ `connect`/`accept`, data ↔ `send`/`recv`, `FIN` ↔ `close`/`shutdown`).
  - Explicitly classifies unmatched packets or ambiguous mappings (>2 distinct `(pid, fd)` claiming a 4-tuple) as `confidence: "unresolved"` with a clear reason — never fabricating process or FD links.

---

## 5. Payload Privacy Policy

- **Disabled by Default:** `enable_payload_preview` defaults to `false` on `POST /api/runs`, and `netbox_pcap` uses `--capture-payload 0` with header-only `snaplen = 160`.
- Default packet records contain `payload_length` (computed from IPv4 `total_length - ip_hlen - tcp_hlen`), `captured_bytes: 0`, `preview_hex: null`, and `preview_utf8: null`.
- Optional bounded preview (`<= 64` bytes) is scoped strictly to an individual run and never transmitted to any external service.

---

## 6. Automated & Live Verification Results

### A. Backend Phase 4 Test Suite (`backend/tests/test_phase4_packets.py`)
Executed via `backend/.venv/bin/python3 -m unittest backend/tests/test_phase4_packets.py -v`:
- **19 / 19 test methods (covering all 34 checklist items) PASSED in 1.90s, 0 skipped, 0 failures:**
  - Capture service tests (1–7): interface discovery, loopback selection, startup/readiness, clean `SIGINT` shutdown, permission denied (exit 13), missing binary/libpcap, timeout & process-group cleanup.
  - Packet parsing tests (8–16): IPv4 & link-layer (`DLT_EN10MB`, `DLT_NULL`, `DLT_LINUX_SLL`, `DLT_RAW`), TCP header & options (`MSS`, `WScale`, `SACK_Permitted`, `Timestamp`), `SYN`, `SYN+ACK`, `FIN`, `RST`, payload length & privacy default vs opt-in, truncated packets, unsupported protocols/DLT.
  - TCP analysis tests (17–22): complete handshake, incomplete handshake, partial/full FIN & RST termination, bidirectional 4-tuple flow grouping, retransmission candidate detection (ignoring pure zero-length ACKs), seq/ack extraction & deterministic 4-part explanations.
  - Correlation tests (23–27): forward 4-tuple, reverse direction, monotonic timestamp window, ambiguous mapping → `unresolved`, unmatched packet → `unresolved`.
  - **Live Integration Tests (28–34):** Executed actual `examples/tcp/server` and `client` over `lo`, verified real captured `SYN`, `SYN+ACK`, `ACK`, 28–29 B data segments with `preview_utf8: null`, bidirectional `FIN+ACK` + `ACK` termination, intact Phase 2 `socket_api` events, and resolved correlations.

### B. Visualizer Build, Frontend Tests & Live UI Verification
- **Extension Build:** `cd extension && npm run check-types && npm run build` — **0 TypeScript errors; built `extension/dist/extension.js`**.
- **Frontend Tests:** `cd extension && npm test` — **19 / 19 tests PASSED** (16 Phase 3 unit tests + 1 live Phase 2→3 integration test + 2 Phase 4 `PacketView` unified timeline & flag classification tests).
- **Phase 2 Regression Suite:** `python3 instrumentation/tests/test_suite.py` — **Tests A–G PASSED**.
- **Live Browser Preview Verification:** Executed `Run Live TCP` (`run_20261117_214055_17e2c0`) against the live FastAPI backend; verified `Packet Capture: COMPLETED (lo)`, **10 real captured packets**, `COMPLETE` 3-way handshake, `COMPLETE_FIN_EXCHANGE` termination, `10 resolved / 0 unresolved` high-confidence correlations, dual-layer monotonic replay (`socket_api` + `packet_capture` badges), header-only payload privacy banner, and 0 console errors.

---

## 7. Known Limitations

1. **Initial Protocol Scope:** Phase 4 decodes IPv4 + TCP (`lo` localhost capture by default). UDP, IPv6, and multi-host LAN interface captures are left extensible for future phases.
2. **Capture Callback Timestamp Precision:** `capture_monotonic_ns` is recorded in the user-space `libpcap` callback, not hardware NIC timestamps. Sub-millisecond causal ordering between syscalls and packets should be interpreted carefully.
3. **Host Capability Prerequisite:** Real capture requires `libpcap-dev` and `setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap` on Linux/WSL2. Without capabilities, runs gracefully fall back to `packet_capture_status = "UNAVAILABLE"` while preserving Phase 2 socket capture.
4. **Desktop VS Code `F5` Launch:** `extension/dist/extension.js` compiles cleanly and the exact Webview UI was visually verified in a live browser preview against FastAPI; interactive desktop VS Code GUI launch (`F5`) remains a quick manual verification step.
