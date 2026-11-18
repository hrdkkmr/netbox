# NetBox VS Code Extension Changelog

All notable changes to the **NetBox** VS Code extension are documented in this file.

## [0.8.0] — 2026-11-18

### Added
- **First-Run Welcome & 7-Component Readiness Dashboard:** Honest independent status checks for Extension, Backend URL, Reachability, SecretStorage Authentication, `LD_PRELOAD` Socket Instrumentation, `libpcap` Packet Capture, and Host-Local Ollama AI.
- **10-Step Interactive Guided Tour:** Contextual spotlight walkthrough across all 7 workspace views culminating in a real TCP client-server experiment (`NetBox: Start Guided Tour`) with persistent completion/resume state.
- **Presentation / Demo Mode:** Uncluttered 6-step presenter mode for live demonstrations (`NetBox: Start Presentation / Demo Mode`).
- **Secure Backend Configuration:** Stores LAN pairing tokens strictly in VS Code `SecretStorage` (`NetBox: Configure Backend & Access Token`), validates backend URLs, scrubs secrets from logs/errors, and separates connectivity errors from authentication errors.
- **Marketplace Distribution Readiness:** Added 256×256 PNG icon, `.vscodeignore`, MIT `LICENSE`, polished `README.md`, and verified `.vsix` packaging.

## [0.7.0] — 2026-11-18

### Added
- **Curriculum Labs Tab:** 9 structured Computer Networks modules, embedded deterministic IPv4 Subnet Calculator, safe localhost experiments (TCP, UDP, DNS, HTTP, L2/ARP, Routing, Monitoring), 5-mode grounded AI tutor, deterministic assessments, and local progress persistence.
- **System & LAN Dashboard Tab:** Host/WSL 2 interface discovery, offline SVG QR code, client heartbeats, and automatic disconnect/reconnect handling.

## [0.5.0] — 2026-11-18

### Added
- **Grounded Local AI Assistant Tab:** Connects to host-local Ollama via the NetBox backend with verified clickable `[PACKET: pkt_N]` and `[SOCKET: sock_N]` evidence links and Learning Mode.

## [0.4.0] — 2026-11-17

### Added
- **Packet Capture & Flow Analysis Tabs:** Real `libpcap` packet timeline, observed TCP 3-way handshake, bidirectional TCP flows, and dual-layer monotonic replay.

## [0.3.0] — 2026-11-17

### Added
- **Interactive Networking Visualizer:** Live socket topology, API-level sequence diagram, monotonic timing deltas, non-destructive filters, and timestamp-aware playback.

## [0.1.0] — 2026-11-17

### Added
- Initial VS Code extension scaffolding, Dashboard & Visualizer webviews, and local FastAPI backend bridge.
