# NetBox — Phase 7 Architecture: Curriculum Labs & Final Hardening

> **Phase:** Phase 7 — Curriculum Labs & Polish  
> **Status:** Design & Implementation Plan  
> **Builds On:** Phases 0–6 (Deterministic Engine, Packet Capture, Grounded Local AI Assistant, LAN Host/Client Platform)  

---

## 1. Educational Philosophy & Integration Goals

NetBox Phase 7 unifies three pillars into a single interactive Computer Networks laboratory:
1. **Theoretical Concepts:** Structured, concise explanations grounded in undergraduate Computer Networks curricula.
2. **Real Network Experiments & Observations:** Controlled, safe, localhost-default C/Python experiments captured with Phase 2 `LD_PRELOAD` and Phase 4 `libpcap` + real OS network inspection tools (`ip`, `ip route`, `ip neigh`, deterministic DNS/HTTP/ICMP probes).
3. **Evidence-Grounded Local AI Tutoring:** Context-aware **Explain**, **Hint**, **Quiz Me**, **Review My Understanding**, and **Connect Theory to Evidence** interactions that strictly preserve Phase 5 grounding rules (never grading fabricated observations as facts).

**Strict Invariants:**
- Never modify or delete any of the 9 original PDFs in `cn_lab/`.
- Never fabricate Ethernet, ARP, DNS, ICMP, or HTTPS payload observations if the environment did not capture them.
- Never introduce a database server; persist lab definitions as structured JSON files (`curriculum/labs/*.json`) and student progress as a lightweight local JSON store (`backend/data/progress.json` or configurable `NETBOX_PROGRESS_FILE`).
- Keep all experiment execution strictly allowlisted, localhost-bound by default, timeout-guarded, and cleanly torn down.

---

## 2. Curriculum Architecture (`curriculum/`)

### 2.1 File Layout (No Database Required)
```
curriculum/
├── curriculum_index.json          # Ordered module catalog (Modules 1–9)
└── labs/
    ├── mod1_networking_foundations.json
    ├── mod2_ethernet_mac_arp.json
    ├── mod3_ip_subnetting.json
    ├── mod4_tcp_deep_dive.json
    ├── mod5_udp_datagrams.json
    ├── mod6_dns_resolution.json
    ├── mod7_http_web.json
    ├── mod8_routing_troubleshooting.json
    └── mod9_network_monitoring.json
```

### 2.2 Lab Schema (`backend/app/curriculum/models.py`)
Every lab JSON conforms to a strict Pydantic model:
- `lab_id`, `module_number`, `module_title`, `title`, `topic`, `difficulty` (`beginner` | `intermediate` | `advanced`), `estimated_minutes`
- `learning_objectives`: list of measurable technical outcomes
- `prerequisites`: list of prerequisite lab IDs or concepts
- `concept_explanation`: structured sections (`title`, `summary`, `key_points`, `protocol_layers`)
- `experiment`:
  - `experiment_id` (maps strictly to an allowlisted safe runner)
  - `title`, `instructions`, `required_setup`, `execution_steps`
  - `supported_scenarios`: list of selectable scenario presets (e.g., `tcp-echo`, `tcp-conn-refused`, `tcp-multi-transfer`, `tcp-abrupt-rst`, `tcp-multi-flow`, `udp-echo`, `udp-multi-datagram`, `udp-unreachable`, `http-local`, `http-404`, `dns-lookup`, `iface-arp-inspect`, `routing-inspect`, `monitoring-transfer`)
  - `expected_observations`: deterministic list of what students should look for
  - `observation_caveats`: honest notes about WSL 2 / loopback / encryption limitations (e.g., loopback has zero MACs; HTTPS application data is encrypted and unreadable)
- `assessment`:
  - `questions`: mix of `multiple_choice`, `short_answer`, `packet_interpretation`, and `scenario` questions with deterministic grading keys/rubrics and conceptual explanations
- `completion_criteria`: structured checklist (experiment executed, minimum assessment score, reflection/AI review)

---

## 3. Core 9 Curriculum Modules & Real Safe Experiments

| Module | Topic | Safe Real Experiment(s) | Deterministic Tools / Engine Used |
| :--- | :--- | :--- | :--- |
| **1. Networking Foundations** | OSI, TCP/IP, encapsulation, interfaces, sockets, ports | `tcp-echo` under `LD_PRELOAD` + `libpcap` | Phase 2 `libnetbox_trace.so` + Phase 4 `netbox_pcap` |
| **2. Ethernet, MAC & ARP** | MAC addresses, Ethernet frames, ARP, switching, broadcast/unicast | Read-only interface & ARP/neighbor cache inspection (`ip -j link`, `ip -j neigh`) + optional non-loopback capture check | Real Linux `ip` output; explicitly warns when loopback (`00:00:00:00:00:00`) or WSL NAT limits Ethernet/ARP visibility |
| **3. IP Addressing & Subnetting** | IPv4, CIDR, masks, private/public, gateways, DHCP, NAT | Read-only host IP/gateway inspection + **Deterministic Subnet Calculator** (`backend/app/curriculum/subnet_calc.py`) | Pure mathematical bitwise IPv4/CIDR engine (zero LLM math!) |
| **4. TCP** | 3-way handshake, seq/ack, sliding window, retransmissions, FIN/RST | Controlled C/Python TCP scenarios: complete echo, connection refused (`ECONNREFUSED`), multi-message transfer, abrupt `RST` (`SO_LINGER`), concurrent multi-flow | Phase 2 `LD_PRELOAD` + Phase 4 `netbox_pcap` + `tcp_analyzer.py` |
| **5. UDP** | Connectionless datagrams, headers, message boundaries, TCP vs UDP | New C POSIX UDP echo server/client (`examples/udp/udp_server.c`, `examples/udp/udp_client.c`): single datagram, multi-datagram boundary preservation, unreachable port, varied payload sizes | Phase 2 `LD_PRELOAD` (`socket`, `bind`, `sendto`, `recvfrom`, `close`) + Phase 4 `netbox_pcap` (`udp` BPF filter) |
| **6. DNS** | Domain names, records, recursive/iterative resolution, caching | Local deterministic UDP DNS responder on `127.0.0.1` (offline-safe!) + optional system resolver lookup (`socket.getaddrinfo`) + packet capture on the local DNS port | Offline-guaranteed real DNS wire packets (RFC 1035 query/response) + honest cached vs. uncached latency timing |
| **7. HTTP & Web Communication** | Methods, headers, status codes, HTTP vs HTTPS, TLS basics | Ephemeral local Python `http.server` on `127.0.0.1` + real HTTP client requests (`GET /`, `GET /missing` 404, `POST /echo`) captured via `LD_PRELOAD` + `netbox_pcap` | Real HTTP headers, status codes, TCP handshake + explicit educational note that HTTPS/TLS encrypts payload bytes |
| **8. Routing & Troubleshooting** | Routing tables, default/static routes, ICMP, traceroute, unreachable hosts | Read-only `ip -j route` inspection + safe loopback/local ICMP reachability probe (`ping -c 2` when permitted) + unreachable port diagnostic (never modifies routes!) | Real OS routing table & measured RTT; honest reporting if ICMP/traceroute is restricted |
| **9. Network Monitoring** | Throughput, latency, packet loss, flow direction, utilization | Measured multi-chunk & multi-flow TCP data transfer on `127.0.0.1` computing real throughput (KB/s, Mbps), packet counts, inter-packet latency, and directional byte totals | Strictly measured values from real captured `RunRecord` timestamps & byte lengths |

---

## 4. Safe Experiment Runner Architecture (`backend/app/services/lab_runner.py` & `examples/udp/`)

- Extends `ProcessRunner` / `RunManager` cleanly without breaking `tcp-echo`:
  - Adds compiled C POSIX UDP example (`examples/udp/udp_server.c`, `examples/udp/udp_client.c`, wired into `Makefile`).
  - Adds controlled experiment scenarios under an explicit `ALLOWED_EXAMPLES` allowlist:
    - `tcp-echo` (existing Phase 2/4 C binary)
    - `tcp-conn-refused` (C client connecting to closed localhost port → real `ECONNREFUSED` + `RST`)
    - `tcp-multi-transfer` (multiple sequential data chunks over one TCP connection)
    - `tcp-abrupt-rst` (TCP transfer followed by `SO_LINGER` `RST` termination)
    - `tcp-multi-flow` (two concurrent TCP client connections to isolate multiple 4-tuple flows)
    - `udp-echo` (C UDP echo server & client under `LD_PRELOAD` + `libpcap` `udp` filter)
    - `udp-multi-datagram` (C UDP client sending multiple distinct datagrams of varied payload sizes)
    - `udp-unavailable` (C UDP client sending to an unbound localhost port)
    - `http-local` (ephemeral localhost HTTP server + real GET/POST/404 client requests with TCP capture)
    - `dns-local` (ephemeral offline-capable RFC 1035 local UDP DNS responder + real DNS query/cache comparison with UDP capture)
    - `net-inspect-l2` (read-only interface/MAC/ARP table observation)
    - `net-inspect-l3` (read-only IP/gateway/routing table + safe local ping observation)
    - `net-monitor-transfer` (measured TCP throughput & latency monitoring run)
  - Every experiment uses dynamic/ephemeral or conflict-checked localhost ports (`127.0.0.1`), strict timeouts (`<= 10s`), process group cleanup, and zero background leaks.
  - Preserves `packet_capture/netbox_pcap` binary untouched (preserving existing `cap_net_admin,cap_net_raw=eip`).

---

## 5. Curriculum AI Tutor Integration (`backend/app/ai/` extension)

Adds `POST /api/ai/curriculum/interact` supporting five explicit pedagogical modes while preserving all Phase 5 grounding and validation rules:
1. **`explain`**: Explains the observed execution or packet in the context of the active lab and learning objective.
2. **`hint`**: Gives a progressive scaffolded hint (levels 1–3) without spoiling the full solution.
3. **`quiz_me`**: Generates a concept + capture-grounded check question tied to the current lab (and real run if selected).
4. **`review_understanding`**: Evaluates a student's written explanation against the lab's deterministic rubric and actual captured `EvidenceBundle` facts (never grading fabricated packet observations as true).
5. **`connect_theory`**: Maps a selected packet/event (e.g., `SYN`, `UDP datagram`, `HTTP 200`, `RST`) explicitly across **Textbook Theory**, **Directly Captured Observation**, **Deterministic Analysis**, and **AI Interpretation**.

---

## 6. Deterministic Subnet Calculator & Progress Persistence

- **Subnet Calculator (`POST /api/curriculum/tools/subnet`):**
  - Uses Python's `ipaddress.IPv4Interface` / bitwise math (100% deterministic, never LLM-generated).
  - Returns network address, broadcast address, subnet mask, wildcard mask, CIDR prefix, usable host range, total/usable host count, RFC1918 private/public classification, and optional same-subnet check between two IPv4 addresses.
- **Progress Store (`backend/app/curriculum/progress_store.py`):**
  - Persists to a lightweight local JSON file (`backend/data/curriculum_progress.json`, overrideable via `NETBOX_PROGRESS_FILE` for tests).
  - Tracks attempted labs, completed labs, quiz scores/attempts per lab, current module, and overall completion percentage — never stores raw packet payloads.
  - Recoverable across backend restarts.

---

## 7. Interactive Lab UI & Final UX Polish (`extension/media/visualizer/labsView.js`)

- Adds a **Curriculum Labs** tab inside the unified NetBox Visualizer with five clear sub-sections per lab:
  - **A. Learn** (objectives, concept breakdown, protocol layer tags)
  - **B. Experiment** (scenario selector, Run Experiment button, embedded deterministic Subnet Calculator for Module 3, live run status & caveats)
  - **C. Observe** (live summary of captured socket events, packets, flows, measured metrics, plus 1-click "Inspect in Packets / Socket API / Flows" buttons)
  - **D. Understand (AI Tutor)** (Explain / Progressive Hint / Quiz Me / Connect Theory / Review My Understanding grounded in the active lab + run, with clickable verified evidence links)
  - **E. Assess** (interactive MCQ, packet-interpretation, scenario, and short-answer assessment with instant deterministic grading, explanations, and saved progress)
- Final UX polish across all tabs: consistent status badges, clear empty/loading/error states, responsive layouts, accessible ARIA roles/labels, and zero fabricated metrics.

---

## 8. Comprehensive Test Campaign & Final Documentation

- Full automated tests covering all TCP scenarios (1–9), UDP scenarios (1–5), network/LAN scenarios, AI scenarios (1–10), and reliability checks (`backend/tests/test_phase6_lan.py`, `backend/tests/test_phase7_curriculum.py`, `backend/tests/test_phase7_system_reliability.py`, `extension/tests/*.test.js`).
- Deliverables: `docs/PHASE6.md`, `docs/PHASE7.md`, `docs/FINAL_ARCHITECTURE.md`, `docs/TEST_REPORT.md`, `docs/DEMO_GUIDE.md`, plus updated `README.md`, `PROJECT_STATUS.md`, `docs/roadmap.md`, `docs/architecture.md`, and `docs/decisions.md`.
