# NetBox — Phase 7 Report: Curriculum Labs & Final Hardening

> **Status:** Completed & Live-Verified  
> **Version:** `0.7.0`  

---

## 1. Objective

Phase 7 integrates **structured Computer Networks curriculum labs**, **controlled real network experiments**, **deterministic protocol tools**, **evidence-grounded AI tutoring**, and **locally persisted student progress** into one cohesive offline platform.

---

## 2. Implemented Curriculum Modules (9 Modules — `curriculum/`)

All lab definitions are stored as maintainable JSON files in `curriculum/labs/` indexed by `curriculum/curriculum_index.json` (zero database server required; all 9 original college PDFs in `cn_lab/` remain completely untouched):

| # | Lab ID | Topic | Real Safe Experiment(s) |
| :--- | :--- | :--- | :--- |
| 1 | `mod1-foundations` | OSI/TCP-IP, encapsulation, sockets, ports | Live C POSIX TCP echo (`LD_PRELOAD` + `libpcap`) |
| 2 | `mod2-ethernet-arp` | MAC addresses, Ethernet frames, ARP | Read-only `ip -j link` + `ip -j neigh` inspection (honest loopback/WSL caveats; never fabricates ARP frames) |
| 3 | `mod3-ip-subnetting` | IPv4, CIDR, masks, gateways, private/public, NAT | Read-only host IP/gateway inspection + **Deterministic Bitwise IPv4 Subnet Calculator** |
| 4 | `mod4-tcp` | 3-way handshake, seq/ack, sliding window, FIN vs. RST, multi-flow | 5 live scenarios: complete echo, `ECONNREFUSED`/RST, multi-transfer, abrupt `SO_LINGER` RST, concurrent 2-flow |
| 5 | `mod5-udp` | Connectionless datagrams, 8B header, message boundaries, TCP vs. UDP | Compiled C POSIX `examples/udp/udp_server` & `udp_client`: single echo, 4 varied-size datagrams, unavailable port |
| 6 | `mod6-dns` | Domain names, A/AAAA/CNAME/NS records, recursive vs. iterative, TTL caching | Offline-safe local RFC 1035 binary UDP DNS responder + real uncached vs. cached RTT measurement + UDP capture |
| 7 | `mod7-http` | HTTP/1.1 methods, headers, status codes, HTTP vs. HTTPS/TLS | Ephemeral localhost HTTP server (`GET / 200`, `POST /echo 200`, `GET /missing 404`) + real TCP capture + explicit HTTPS encryption boundary |
| 8 | `mod8-routing` | Routing tables, longest-prefix match, ICMP, traceroute | Read-only `ip -j -4 route` inspection + bounded loopback `ping -c 2` (never modifies host routes) |
| 9 | `mod9-monitoring` | Throughput, goodput, inter-packet latency, flow symmetry | Measured 64 KB bulk TCP transfer + concurrent multi-flow analysis (strictly real monotonic metrics) |

---

## 3. Curriculum AI Tutor & Progress Persistence

- **Grounded Curriculum AI Tutor (`POST /api/ai/curriculum/interact`, `backend/app/ai/services/curriculum_ai.py`):**
  - Supports **Explain**, **Progressive Hint (Levels 1–3)**, **Quiz Me**, **Review My Understanding** (rubric + real evidence), and **Connect Theory ↔ Evidence** (explicitly separating Textbook Knowledge, Directly Captured Observation, Deterministic Analysis, and AI Interpretation).
  - Retains all Phase 5 citation validation (`verified_references` clickable links), prompt-injection fencing, and offline Ollama degradation (`503`).
- **Deterministic Assessments & Local Progress (`backend/app/curriculum/service.py`, `progress_store.py`):**
  - Supports MCQ, packet-interpretation, scenario, and deterministic rubric-keyword short-answer questions.
  - Persists attempted/completed labs, quiz scores, and current module atomically to `backend/data/curriculum_progress.json` across backend restarts without storing raw packet payloads.
- **Interactive UI (`extension/media/visualizer/labsView.js`):**
  - Unified **Curriculum Labs** tab with 9-module sidebar, completion progress bar, and 5 sub-sections (**A. Learn**, **B. Experiment**, **C. Observe**, **D. Understand (AI)**, **E. Assess**).

---

## 4. Verification Summary

- **Phase 2 Regression:** `instrumentation/tests/test_suite.py` — **Tests A–G PASSED**.
- **Backend Full Suite (Phases 4 + 5 + 6 + 7):** **45 / 45 PASSED** in `8.856s`, zero orphaned `netbox_pcap` or `udp_server` processes.
- **Extension Build & JS Suite (Phases 3–7):** `tsc --noEmit` + `esbuild` clean, **25 / 25 PASSED**.
- **Live Browser End-to-End Verification (`http://127.0.0.1:8000/`):** Verified System & LAN health dashboard, Offline QR SVG, all 9 Curriculum Labs, Module 3 Deterministic Subnet Calculator (`192.168.10.64/26`), Module 4 live TCP run (`15` socket ops, `10` packets, `1` flow), and Module 4 assessment (`100% PASSED`, progress updated to `1/9`) with **0 console errors**.
