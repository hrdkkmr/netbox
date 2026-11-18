# Changelog

All notable changes to **NetBox** are documented in this file.

## [0.8.0] — 2026-11-18 — Phase 8: Production Release, Onboarding & Marketplace Packaging

### Added
- **First-Time Onboarding & Welcome Experience:** Upgraded Welcome & Setup Dashboard showing an honest 7-component readiness matrix (Extension, Backend URL, Backend Reachability, Authentication, `LD_PRELOAD` Socket Instrumentation, `libpcap` Packet Capture, Host-Local Ollama & Model).
- **10-Step Interactive Guided Tour:** Contextual UI spotlight walkthrough covering workspace navigation, backend setup, curriculum labs, socket visualization, packet inspection, AI tutoring, assessments, and a real live TCP experiment with persistent completion/resume state (`NetBox: Start Guided Tour`).
- **Presentation / Demo Mode:** Clean, uncluttered 6-stage presenter bar (`NetBox: Start Presentation / Demo Mode`) built on genuine captured telemetry for live classroom and evaluation demonstrations.
- **Secure Backend Configuration (`SecretStorage`):** New command `NetBox: Configure Backend & Access Token`, strict URL validation, secret redaction in logs/errors, and clear distinction between connectivity errors and `401`/`403` authentication errors.
- **VS Code Marketplace Packaging:** Added 256×256 PNG extension icon, `.vscodeignore`, Marketplace metadata, MIT `LICENSE`, polished `extension/README.md`, and verified `.vsix` package generation.

## [0.7.0] — 2026-11-18 — Phase 6 & Phase 7: Core LAN Integration & 9-Module Curriculum

### Added
- **Phase 6 (Core & LAN Integration):** Configurable localhost and LAN modes, Windows + WSL 2 NAT discovery with opt-in forwarding script, lightweight host-controlled pairing token authentication, independent `/api/system/*` health APIs, offline ISO/IEC 18004 SVG QR code, FastAPI-served Browser Web UI (`GET /`), service startup/stop/check scripts, and System & LAN Dashboard tab.
- **Phase 7 (Curriculum Labs & Hardening):** Nine structured JSON Computer Networks lab modules (Foundations, Ethernet/ARP, IP/Subnetting, TCP, UDP, DNS, HTTP, Routing, Monitoring), compiled C11 POSIX UDP echo server/client (`examples/udp/`), allowlisted safe localhost experiment runner, deterministic bitwise IPv4 Subnet Calculator, 5-mode grounded Curriculum AI Tutor (`explain`, `hint`, `quiz_me`, `review_understanding`, `connect_theory`), deterministic assessment grader, and locally persisted JSON progress.

## [0.5.0] — 2026-11-18 — Phase 5: Grounded Local AI Assistant

### Added
- Local-only Ollama provider (`127.0.0.1:11434`, zero cloud fallback), deterministic evidence retrieval with flow isolation, compact `<OBSERVED_EVIDENCE_DATA_ONLY>` prompt-injection fencing, citation verification & confidence guardrails, Learning Mode, and clickable verified evidence links in the Visualizer AI Assistant tab.

## [0.4.0] — 2026-11-17 — Phase 4: Real Packet Capture & TCP Analysis

### Added
- Native C11 `libpcap` capture helper (`packet_capture/netbox_pcap`, least-privilege `cap_net_raw,cap_net_admin=eip`), IPv4/TCP decoder, handshake/termination/flow/retransmission analyzer, conservative 4-tuple monotonic correlator, header-only privacy default, and Packets/Flows/Correlations/Dual-Layer Replay visualizer tabs.

## [0.3.0] — 2026-11-17 — Phase 3: Interactive Networking Visualizer

### Added
- Modular visualizer engines (`eventStore`, `timingEngine`, `socketStateEngine`, `eventFilter`, `sequenceMapper`, `eventInspector`, `playbackEngine`, `renderers`) supporting live topology, API-level sequence diagram, monotonic interval timing, non-destructive filters, and timestamp-aware playback.

## [0.2.0] — 2026-11-17 — Phase 2: `LD_PRELOAD` Socket Instrumentation

### Added
- Thread-safe, recursion-guarded `LD_PRELOAD` shared library (`libnetbox_trace.so`) intercepting 12 POSIX socket calls, FastAPI `ProcessRunner`/`RunManager`/`EventReader`, `/api/runs` REST endpoints, and automated regression suite (Tests A–G).

## [0.1.0] — 2026-11-17 — Phases 0–1: Foundation & Extension Scaffolding

### Added
- Repository foundation, reference POSIX C TCP echo server/client, CN lab index, FastAPI backend shell, and initial VS Code extension scaffolding.
