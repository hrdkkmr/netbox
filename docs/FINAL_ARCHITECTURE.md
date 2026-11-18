# NetBox — Final System Architecture (Phases 0–7)

> **Platform:** NetBox — Offline Computer Networks Laboratory, Network-Observation Tool & Grounded Local AI Tutor  
> **Version:** `0.7.0`  
> **Runtime Stack:** C11 (`LD_PRELOAD` + `libpcap`), Python 3 / FastAPI + Uvicorn, Ollama (Host-Local Loopback Only), TypeScript VS Code Extension + Vanilla JS/CSS Unified Webview/Browser Visualizer  

---

## 1. End-to-End Layered Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ CLIENT LAYER (Host Local OR Second Device on Wi-Fi / Mobile Hotspot)       │
│  • Browser UI served directly by FastAPI (GET / + /media/*)                │
│  • VS Code Extension Webview (extension/dist/extension.js)                 │
│  • 7 Unified Tabs: Socket API | Packets | TCP Flows | Correlations |       │
│                    AI Assistant | Curriculum Labs | System & LAN           │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ HTTP (localhost OR LAN + X-NetBox-Token)
┌───────────────────────────────▼────────────────────────────────────────────┐
│ NETBOX CORE API LAYER (backend/app/main.py — FastAPI :8000)                │
│  • Access Control & Pairing Token Policy (backend/app/core/)               │
│  • System Health, Network Discovery, Offline QR, Client Heartbeats         │
│  • Curriculum Catalog, Deterministic Subnet Calc, Grader & Progress JSON   │
│  • Run Management & Packet/Flow/Correlation Endpoints                      │
└──────────┬─────────────────────────────────────────────┬───────────────────┘
           │                                             │
┌──────────▼───────────────────────────────┐  ┌──────────▼───────────────────┐
│ LAYER A — DETERMINISTIC ENGINE           │  │ LAYER B & C — GROUNDED AI    │
│ (Immutable Source of Truth)              │  │ (Host-Local Inference Only)  │
│  • Phase 2: LD_PRELOAD libnetbox_trace.so│  │  • EvidenceRetriever &       │
│    (12 POSIX socket syscalls, JSONL)     │  │    Flow/Packet Isolation     │
│  • Phase 4: libpcap netbox_pcap helper   │  │  • ContextBuilder with       │
│    (cap_net_raw,cap_net_admin=eip)       │  │    <OBSERVED_EVIDENCE_DATA>  │
│  • TCP Flow, Handshake, Termination,     │  │  • ResponseValidator         │
│    Retransmission & 4-Tuple Correlator   │  │    (verified_references vs.  │
│  • Phase 7 Allowlisted Lab Runner        │  │    unverified + guardrails)  │
│    (TCP, C UDP, RFC1035 DNS, HTTP,       │  │  • Curriculum Tutor (5 modes)│
│     read-only L2/L3/Routing, Monitor)    │  │  • Ollama HTTP Provider      │
└──────────────────────────────────────────┘  │    STRICTLY 127.0.0.1:11434  │
                                              └──────────────────────────────┘
```

---

## 2. Core Design Invariants

1. **Ground-Truth Telemetry Only:** Live runs strictly emit `is_simulated: false`. NetBox never invents packets, ARP entries, DNS traffic, or HTTPS decrypted payloads.
2. **Strict Layer Separation:** User-space `socket_api` events (Phase 2) and wire-level `packet_capture` records (Phase 4) remain distinct schemas correlated conservatively by 4-tuple + monotonic timestamp window.
3. **Host-Local Offline AI:** Ollama runs strictly on `127.0.0.1:11434` on the host (`validate_local_url()` blocks all non-loopback hosts). Zero cloud APIs, zero Internet dependency.
4. **Controlled Experiment Safety:** All sample servers bind strictly to `127.0.0.1` on conflict-free ports, run under bounded timeouts, use allowlisted scenario IDs, never modify OS routing or firewall rules automatically, and terminate cleanly with zero orphan processes.
5. **Lightweight Persistence & Zero Database Server:** Curriculum definitions live in `curriculum/labs/*.json`; student progress persists locally in `backend/data/curriculum_progress.json` without storing raw packet payloads.
6. **Preservation of Course Materials:** All 9 original college CN lab PDFs in `cn_lab/` remain completely untouched.

---

## 3. Repository Structure Overview

- `examples/tcp/`, `examples/udp/` — Reference POSIX C11 TCP and UDP client/server programs.
- `instrumentation/` — Phase 2 `LD_PRELOAD` shared library (`libnetbox_trace.so`) + tests.
- `packet_capture/` — Phase 4 native C `libpcap` capture helper (`netbox_pcap`).
- `curriculum/` — Phase 7 structured 9-module Computer Networks lab definitions (`curriculum_index.json`, `labs/mod1..mod9.json`).
- `backend/app/` — FastAPI Core (`core/`, `models/`, `routers/`, `services/`, `ai/`, `curriculum/`).
- `extension/` — VS Code extension (`src/`) + shared vanilla JS/CSS visualizer (`media/visualizer/*.js`).
- `scripts/` — Service lifecycle & diagnostics scripts (`start_ollama.sh`, `start_backend.sh`, `start_netbox.sh`, `stop_netbox.sh`, `check_netbox.sh`, `scripts/windows/setup_lan_forward.ps1`).
- `docs/` — Complete phase architecture, schema, decisions, test report, and demonstration guide.
- `cn_lab/` — Untouched original 9 Computer Networks course lab PDFs.
