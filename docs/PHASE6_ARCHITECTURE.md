# NetBox — Phase 6 Architecture: NetBox Core & LAN Integration

> **Phase:** Phase 6 — NetBox Core & LAN Integration  
> **Status:** Design & Implementation Plan  
> **Builds On:** Phases 0–5 (FastAPI backend, `LD_PRELOAD` socket instrumentation, `libpcap` packet capture, interactive Visualizer, Grounded Local AI Assistant on Ollama)  

---

## 1. Repository & Environment Audit (Verified Against Source & Host)

### 1.1 Existing Architecture Preserved
- **Layer A (Deterministic Networking Engine):**
  - `instrumentation/libnetbox_trace.so` (`LD_PRELOAD` user-space POSIX socket hook)
  - `packet_capture/netbox_pcap` (native C `libpcap` helper with `cap_net_admin,cap_net_raw=eip`)
  - `backend/app/services/`: `process_runner.py`, `run_manager.py`, `event_reader.py`, `packet_capture_service.py`, `packet_parser.py`, `tcp_analyzer.py`, `event_correlator.py`
- **Layer B & C (Grounded Local AI Assistant):**
  - `backend/app/ai/`: Ollama HTTP provider (`urllib.request`, strictly loopback `127.0.0.1:11434`), deterministic retrieval, `<OBSERVED_EVIDENCE_DATA_ONLY>` framing, citation validator, per-run conversation store
  - Verified live local model: `qwen2.5-coder:1.5b` (`986 MB`, `Q4_K_M`, CPU inference on WSL 2)
- **Frontend & Extension:**
  - `extension/media/` vanilla JS/CSS visualizer with dual transport: VS Code Webview API (`acquireVsCodeApi`) **and** standalone browser HTTP transport (`fetch`)
  - `extension/dist/extension.js` compiled via `esbuild` (`npm run check-types` + `npm run build`)
- **Uncommitted Changes Preserved:** Phases 3–5 modifications and new modules are intact in the working tree; all 9 PDFs in `cn_lab/` are untouched.

### 1.2 Verified Windows 11 + WSL 2 Networking Topology

Empirical host inspection (`ipconfig`, `ip -4 addr`, `ip route`, `netsh interface portproxy show all`, `netstat -ano`):

| Layer / Interface | Verified Address / State | Notes |
| :--- | :--- | :--- |
| Windows Wi-Fi Adapter (`Wi-Fi`) | `192.170.2.209/20` (GW `192.170.0.1`) | Primary LAN interface visible to Wi-Fi peers |
| Windows Mobile Hotspot (when enabled) | Typically `192.168.137.1/24` | Created dynamically by Windows Mobile Hotspot (`Local Area Connection*`) |
| Windows Hyper-V WSL Virtual Switch (`vEthernet (WSL)`) | `172.28.48.1/20` | NAT gateway for WSL 2 VM |
| WSL 2 Ubuntu (`eth0`) | `172.28.51.17/20` (default via `172.28.48.1`) | Private NAT address — **not directly routable from external LAN/hotspot clients** |
| WSL 2 Ubuntu (`lo`) | `127.0.0.1/8` | Localhost forwarding exposes WSL `127.0.0.1:PORT` to Windows `127.0.0.1:PORT` |
| `.wslconfig` | Not present (default NAT mode) | Confirmed WSL 2 NAT networking |
| `netsh interface portproxy` | Empty | No Windows-to-WSL port forwarding configured yet |
| Ollama (`127.0.0.1:11434`) | Listening on loopback only | Reachable by FastAPI inside WSL 2; **never exposed to LAN** |

**Critical WSL 2 Finding:**
Simply binding FastAPI to `0.0.0.0:8000` inside WSL 2 makes it reachable from Windows via `http://127.0.0.1:8000` and `http://172.28.51.17:8000`, **NOT** from a second computer on the Wi-Fi LAN (`192.170.2.209:8000`) or Windows Mobile Hotspot (`192.168.137.1:8000`). To reach WSL 2 FastAPI from a second LAN device under default WSL 2 NAT mode, Windows requires:
1. A Windows port proxy (`netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8000 connectaddress=<WSL_ETH0_IP> connectport=8000`), **and**
2. A Windows Defender Firewall inbound TCP allow rule for port `8000` on Private networks.

*(Alternatively, Windows 11 22H2+ supports `networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`, which mirrors Windows interfaces directly into WSL 2, though a Windows Firewall inbound rule for TCP `8000` is still required.)*

**Strict Policy:** NetBox **never** modifies Windows Firewall rules or `netsh portproxy` automatically. Instead, NetBox detects WSL 2 NAT mode, reports both the WSL IP and Windows LAN/Hotspot IPv4 candidates (via read-only `ipconfig` / `powershell.exe` when accessible from WSL, plus Linux `ip -j addr`), and provides exact, copy-ready administrator commands and an opt-in helper script (`scripts/windows/setup_lan_forward.ps1`) that only runs when explicitly invoked by the user.

---

## 2. Host–Client Architecture (Centralized Host, Zero Client LLM)

```
┌──────────────────────────────────────────────────────────────────────┐
│ DEVICE A — NETBOX HOST (Windows 11 + WSL 2 Ubuntu)                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ FastAPI Backend (NetBox Core)  :8000                           │  │
│  │  • Serves Browser Visualizer UI at GET / and /media/*          │  │
│  │  • System/LAN APIs: /api/system/{health,info,network,...}      │  │
│  │  • Access Control Middleware (Bearer / X-NetBox-Token)         │  │
│  │  • Client Session Heartbeat Registry (in-memory, real only)    │  │
│  │  • Layer A: RunManager + LD_PRELOAD + libpcap (localhost only) │  │
│  │  • Layer B/C: Grounded Local AI Assistant                      │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │ localhost ONLY (127.0.0.1:11434)       │
│  ┌──────────────────────────▼─────────────────────────────────────┐  │
│  │ Ollama Local Runtime (127.0.0.1:11434) — NEVER LAN-EXPOSED     │  │
│  │  • Local quantized model (e.g., qwen2.5-coder:1.5b)            │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────▲────────────────────────────────────────┘
                              │ HTTP over LAN / Wi-Fi Hotspot
                              │ (via Windows portproxy / mirrored WSL)
┌─────────────────────────────┴────────────────────────────────────────┐
│ DEVICE B — LAN CLIENT (Browser or VS Code Extension, No Local LLM)   │
│  • Opens http://<HOST_LAN_IP>:8000/ (or configures netbox.backendUrl)│
│  • Enters host pairing/access token if LAN auth is enabled           │
│  • Views system health, runs, socket events, packets, TCP flows      │
│  • Asks AI Assistant questions -> inferred on Device A's Ollama      │
│  • Clicks verified evidence references -> jumps to packet/socket     │
│  • Works 100% offline without Internet                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Phase 6 Components & Modules

### 3.1 Configuration & Access Control (`backend/app/core/config.py`, `backend/app/core/security.py`)
- Environment-driven `NetBoxCoreConfig`:
  - `NETBOX_MODE`: `"localhost"` (default) or `"lan"`
  - `NETBOX_HOST`: `"127.0.0.1"` (localhost mode) or `"0.0.0.0"` (lan mode)
  - `NETBOX_PORT`: default `8000`
  - `NETBOX_ADVERTISED_HOST`: optional explicit Windows LAN/Hotspot IP override (for WSL 2 NAT environments)
  - `NETBOX_ACCESS_TOKEN`: optional shared secret token; in `lan` mode, if unset, NetBox can auto-generate a pairing token or enforce explicit opt-in (`NETBOX_REQUIRE_AUTH=true|false`)
  - `NETBOX_ALLOW_REMOTE_EXECUTION`: default `true` when authenticated with token (host-controlled toggle so host can lock remote clients to read-only + AI mode if desired)
  - `NETBOX_CORS_ORIGINS`: configurable comma-separated allowed origins (defaults to localhost + private RFC1918 LAN origin regex when in LAN mode)
  - `NETBOX_HEALTH_INTERVAL_MS`: default `10000`
- Lightweight Access Control:
  - Header `X-NetBox-Token` or `Authorization: Bearer <token>`
  - Localhost loopback clients (`127.0.0.1`, `::1`) can operate seamlessly without friction on the host unless `NETBOX_REQUIRE_AUTH_LOCALHOST=true`, while non-loopback LAN clients must provide the valid pairing token when authentication is active.
  - Sensitive mutating endpoints (`POST /api/runs`, `POST /api/runs/{id}/stop`, `POST /api/ai/config`, `POST /api/labs/*/run`, `POST /api/system/access-control`) enforce token + host policy checks.
  - Strictly never exposes `os.environ`, arbitrary filesystem paths, shell execution, or Ollama admin ports.
  - Protected runtime endpoints never trust raw packet payloads (Phase 5 `<OBSERVED_EVIDENCE_DATA_ONLY>` fencing remains active).

### 3.2 Network Discovery & WSL 2 Diagnostics (`backend/app/services/network_discovery.py`)
- Discovers Linux/WSL interfaces via `ip -j addr` (with `/sys/class/net` fallback) and default gateway via `ip route`.
- Detects WSL 2 environment (`/proc/version` containing `microsoft` / `WSL2`), NAT vs. mirrored topology, and optionally queries Windows host IPv4 adapters via read-only `ipconfig.exe` (when on WSL 2 and available, bounded timeout, zero side effects) so the host dashboard displays the **real Windows Wi-Fi / Hotspot LAN IPv4 address** that Device B should actually browse to!
- Generates:
  - Recommended client connection URLs (`http://<lan_ip>:<port>/`)
  - Offline SVG QR code (pure deterministic inline SVG QR matrix generator — zero external CDN or Internet dependency!)
  - Exact WSL 2 NAT troubleshooting guidance & copyable PowerShell commands (never auto-executed).

### 3.3 System Health, Services & Client Sessions (`backend/app/services/system_service.py`)
- Real component-by-component health checks (never conflating a running FastAPI process with healthy subcomponents):
  1. **Backend:** `running`
  2. **Socket Instrumentation (`LD_PRELOAD`):** verifies `libnetbox_trace.so` & example binaries (`running` / `unavailable`)
  3. **Packet Capture (`libpcap`):** delegates to `PacketCaptureService.check_availability()` (`running` / `unavailable` with exact `getcap` reason)
  4. **Local AI Runtime (Ollama):** delegates to `AIAssistantService.get_status()` (`running` / `degraded` if Ollama reachable but model missing / `unavailable` if Ollama unreachable)
  5. **LAN Accessibility:** reports `localhost_only`, `lan_ready`, or `wsl2_nat_forwarding_required` with honest diagnostics
- Overall rollup status: `running` | `degraded` | `unavailable`.
- **In-Memory Client Session Tracker:** records real heartbeats (`POST /api/system/clients/heartbeat`) from connected browser/extension clients (client ID, display label, remote IP, user-agent class, last seen timestamp), expiring stale clients after 45s. Never fabricates connected client counts.

### 3.4 New Backend API Endpoints (`backend/app/main.py` & `backend/app/routers/system.py`)
- `GET /` — Serves the standalone NetBox Browser Web UI (reusing `extension/media/` assets directly so Device B needs only a web browser!).
- `GET /media/{path}` — Serves static visualizer CSS/JS assets from `extension/media/` (strict path-traversal check inside `extension/media/`).
- `GET /api/system/health` — Component-level health (`backend`, `socket_instrumentation`, `packet_capture`, `ollama`, `ai_model`, `lan`).
- `GET /api/system/info` — Backend version, host OS/WSL info, execution mode, active run count, capabilities.
- `GET /api/system/network` — Discovered Linux & Windows LAN IPv4 interfaces, default gateway, WSL 2 NAT detection, recommended client URLs, troubleshooting notes.
- `GET /api/system/services` — Detailed service inventory (FastAPI, Ollama, `libnetbox_trace.so`, `netbox_pcap`).
- `GET /api/system/connection` — Connection settings, pairing status (never returning raw secret token to unauthenticated remote callers), connection URL, offline SVG QR payload, client session list.
- `POST /api/system/clients/heartbeat` — Registers/refreshes a real client session.
- `POST /api/system/auth/verify` — Verifies a client access token cleanly.

### 3.5 Service Startup & Management Scripts (`scripts/`)
- `scripts/start_ollama.sh` — Checks Ollama binary, verifies `127.0.0.1:11434`, checks configured model (`qwen2.5-coder:1.5b`), starts Ollama without duplicates, preserves `/tmp/netbox_logs/ollama.log`.
- `scripts/start_backend.sh` — Checks Python `.venv`, port occupancy (`ss`/`lsof`), builds missing C artifacts if needed, starts FastAPI in localhost or `--lan` mode, writes PID file (`/tmp/netbox_logs/backend.pid`) and logs (`/tmp/netbox_logs/backend.log`).
- `scripts/start_netbox.sh` — Orchestrates dependencies → Ollama → Backend in strict order, prints local + LAN URLs and WSL 2 forwarding hint if needed.
- `scripts/stop_netbox.sh` — Gracefully stops only PID-tracked NetBox backend (never kills unrelated processes; optional `--include-ollama`).
- `scripts/check_netbox.sh` — Runs live health, Ollama, model, port, capability, and LAN reachability diagnostics.
- `scripts/windows/setup_lan_forward.ps1` — Opt-in, user-invoked Windows PowerShell helper displaying/applying/removing `netsh portproxy` and Windows Firewall rules (requires explicit flags, never called automatically).

### 3.6 NetBox System Dashboard (Visualizer Tab)
- Adds a **System & LAN** tab to the existing Visualizer (`extension/media/visualizer/systemDashboard.js`) without redesigning Phases 3–5 tabs.
- Displays real-time component health badges (`Running`, `Degraded`, `Unavailable`, `Disconnected`), Host IPv4 addresses, connection URL + copy button + offline QR code, client connection target URL / access token configuration (for Device B browsers), active executions, packet capture status, connected clients table, and WSL 2 LAN troubleshooting guidance.
- Periodic health-check polling with graceful offline/disconnected banner and automatic reconnection recovery.
- Also updates VS Code extension settings (`netbox.backendUrl`, `netbox.accessToken`, `netbox.connectionTimeoutMs`, `netbox.healthCheckIntervalMs`).

---

## 4. Verification & Acceptance Plan
1. Unit & API tests (`backend/tests/test_phase6_lan.py`):
   - System endpoints (`/api/system/health`, `/info`, `/network`, `/services`, `/connection`)
   - Component-level degraded/unavailable health distinction
   - Access token enforcement (localhost vs. simulated remote LAN client, missing/wrong token → `401`, valid token → `200`, remote execution lock toggle)
   - CORS & security boundary checks (Ollama stays loopback-only, no env/filesystem leaks, path traversal blocked on `/media/`)
   - Web UI serving at `GET /` and client heartbeat tracking
   - Simulated LAN client integration test via real loopback/non-loopback socket binding & host IP change handling
2. Frontend unit tests (`extension/tests/system_dashboard.test.js`): status mapping (`Running`/`Degraded`/`Unavailable`/`Disconnected`), QR/connection rendering, auth token handling, XSS safety.
3. Startup script verification (`check_netbox.sh`, `start_netbox.sh`, `stop_netbox.sh` dry/live tests).
4. Physical two-device LAN test: verify local Windows→WSL2 reachability empirically; explicitly mark external second physical computer test as **Pending Physical Device** unless a second physical device is actively tested.
