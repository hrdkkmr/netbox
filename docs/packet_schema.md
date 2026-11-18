# NetBox Packet Capture Schema Specification (v1.0)

> **Status:** Active specification for **Phase 4 (`source: "packet_capture"`)**.  
> Keeps wire-level packet records strictly separate from Phase 2's `docs/event_schema.md` (`source: "socket_api"`).

---

## 1. Design Principles

1. **Strict Layer Separation:** Every packet record has `"source": "packet_capture"` and `"is_simulated": false`. Never merges ambiguously with `"socket_api"` events.
2. **Dual Timestamps:** Preserves both libpcap's original wall-clock capture timestamp (`timestamp.pcap_timestamp_ns`) AND `CLOCK_MONOTONIC` (`timestamp.capture_monotonic_ns`) captured inside the packet callback so backend correlation never mixes clock domains.
3. **Link-Layer Awareness:** Explicitly records `link_layer.type` (`DLT_EN10MB`, `DLT_NULL`, `DLT_LOOP`, `DLT_LINUX_SLL`, `DLT_LINUX_SLL2`, `DLT_RAW`) and numeric `link_layer.dlt`.
4. **Length Fidelity:** Distinguishes `capture.captured_length` (`caplen`), `capture.original_length` (`len`), `payload.payload_length` (derived from IPv4 `total_length - ip_hlen - tcp_hlen`), and `payload.captured_bytes`.
5. **Privacy by Default:** Raw payload previews (`payload.preview_hex`, `payload.preview_utf8`) are strictly `null` by default and `payload.captured_bytes` is `0`. Opt-in bounded preview is disabled by default and scoped strictly to individual runs.
6. **Honest Missing Fields:** Unavailable fields (such as MAC addresses on loopback or truncated headers) are represented as `null` rather than fabricated values.

---

## 2. Example Packet Record (`schema_version: "1.0"`)

```json
{
  "schema_version": "1.0",
  "run_id": "run_20261118_012000_a1b2c3",
  "sequence": 1,
  "source": "packet_capture",
  "timestamp": {
    "pcap_timestamp_ns": 1794964800123456000,
    "capture_monotonic_ns": 19512345678901
  },
  "interface": "lo",
  "link_layer": {
    "type": "DLT_EN10MB",
    "dlt": 1,
    "source_mac": null,
    "destination_mac": null
  },
  "protocol": "TCP",
  "network": {
    "ip_version": 4,
    "source_ip": "127.0.0.1",
    "destination_ip": "127.0.0.1",
    "ttl": 64,
    "header_length": 20,
    "total_length": 60,
    "identification": 48123,
    "protocol_number": 6
  },
  "transport": {
    "source_port": 54321,
    "destination_port": 8080,
    "tcp": {
      "source_port": 54321,
      "destination_port": 8080,
      "sequence_number": 3104921001,
      "acknowledgement_number": 0,
      "header_length": 40,
      "window_size": 65495,
      "flags_raw": 2,
      "flags": {
        "syn": true,
        "ack": false,
        "fin": false,
        "rst": false,
        "psh": false,
        "urg": false,
        "ece": false,
        "cwr": false
      },
      "options": [
        { "name": "MSS", "value": "65495" },
        { "name": "SACK_Permitted", "value": "true" },
        { "name": "WScale", "value": "7" }
      ]
    }
  },
  "payload": {
    "captured_bytes": 0,
    "payload_length": 0,
    "preview_hex": null,
    "preview_utf8": null,
    "truncated": false
  },
  "capture": {
    "captured_length": 74,
    "original_length": 74,
    "truncated": false,
    "header_truncated": false
  },
  "is_simulated": false
}
```

---

## 3. Field Reference

| Field | Type | Description |
| :--- | :--- | :--- |
| `schema_version` | `string` | Always `"1.0"` for Phase 4. |
| `run_id` | `string` | Unique execution run identifier linking packet records to the run. |
| `sequence` | `integer` | 1-based monotonically increasing packet sequence scoped to `run_id`. |
| `source` | `string` | Always `"packet_capture"`. |
| `timestamp.pcap_timestamp_ns` | `integer` | Original libpcap wall-clock timestamp converted to nanoseconds. |
| `timestamp.capture_monotonic_ns` | `integer` | `CLOCK_MONOTONIC` timestamp recorded in the packet callback (used for correlation with Phase 2 `socket_api` events). |
| `interface` | `string` | Verified capture interface name (e.g., `"lo"`). |
| `link_layer` | `object` | `{ type, dlt, source_mac, destination_mac }`. |
| `protocol` | `string` | Decoded protocol label (`"TCP"`, `"UDP"`, `"ICMP"`, `"IPv6"`, `"ARP"`, `"OTHER"`, `"UNKNOWN"`). |
| `network` | `object \| null` | IPv4 header fields (`ip_version`, `source_ip`, `destination_ip`, `ttl`, `header_length`, `total_length`, `identification`, `protocol_number`); `null` if non-IPv4 or truncated. |
| `transport` | `object \| null` | `{ source_port, destination_port, tcp }` containing sequence/ack numbers, header length, window size, `flags_raw`, decoded 8-flag object, and decoded TCP options; `null` if non-TCP or truncated. |
| `payload` | `object` | `{ captured_bytes, payload_length, preview_hex, preview_utf8, truncated }`. Previews are `null` by default. |
| `capture` | `object` | `{ captured_length, original_length, truncated, header_truncated }`. |
| `is_simulated` | `boolean` | Strictly `false` for all live captured packets. |
| `analysis` | `object \| null` | Derived deterministic metadata attached by `tcp_analyzer.py` (`flags_list`, `flags_label`, `classification`, `flow_id`, `retransmission_status`, `explanation`). Clearly separated from raw captured headers. |
