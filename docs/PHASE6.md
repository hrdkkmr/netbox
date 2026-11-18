# NetBox — Phase 6 Report: NetBox Core & LAN Integration

> **Status:** Completed & Software-Verified (Physical second-device acceptance test honestly documented as **Pending Physical Device**)  
> **Version:** `0.7.0`  

---

## 1. Objective & Host–Client Architecture

Phase 6 elevates NetBox from a localhost-only developer tool into an offline-capable **Host–Client LAN Classroom Platform**:

- **Host (Device A — Windows 11 + WSL 2 Ubuntu):** Runs FastAPI (`:8000`), serves the unified Browser Web UI directly at `/` and `/media/*`, runs Ollama strictly on `127.0.0.1:11434` (never LAN-exposed), executes allowlisted experiments via `LD_PRELOAD` and `libpcap`, and performs 100% of local LLM inference.
- **Client (Device B — Browser or VS Code Extension):** Connects to `http://<HOST_LAN_IP>:8000/` over Wi-Fi or Windows Mobile Hotspot without installing Ollama, Node.js, or Python, and without Internet access.

---

## 2. Verified Windows 11 + WSL 2 Networking Investigation

Empirical tests conducted directly on this host (`ipconfig`, `ip -4 addr`, `ip route`, `netsh interface portproxy show all`, and live socket probes against port `8016`):

- **Windows Wi-Fi IPv4:** `192.170.2.209/20` (Gateway `192.170.0.1`)
- **Windows Hyper-V WSL Switch:** `172.28.48.1/20`
- **WSL 2 Ubuntu (`eth0`):** `172.28.51.17/20` (default NAT mode; no `.wslconfig`)
- **Empirical Reachability Result:**
  - `http://127.0.0.1:8016` from Windows → **Reachable** (WSL localhost forwarding)
  - `http://172.28.51.17:8016` from Windows → **Reachable** (Windows → WSL2 NAT switch)
  - `http://192.170.2.209:8016` without `netsh portproxy` → **Blocked as expected** (proves WSL 2 NAT requires explicit Windows port forwarding + Private-profile inbound firewall rule for external LAN/hotspot devices)

NetBox **never modifies Windows Firewall or `netsh portproxy` automatically**. Instead:
- `GET /api/system/network` detects WSL 2 NAT, reads Windows LAN/Hotspot IPv4 candidates via read-only `ipconfig.exe`, and surfaces exact copyable PowerShell commands.
- `scripts/windows/setup_lan_forward.ps1` runs in safe `-DryRun` mode by default and only applies/removes forwarding when explicitly invoked by the user in an Administrator PowerShell with `-Apply` or `-Remove`.

---

## 3. Implemented Components

| Component | Files | Key Capabilities |
| :--- | :--- | :--- |
| Core Config & Access Control | `backend/app/core/config.py`, `backend/app/core/security.py` | Localhost vs. LAN modes, configurable port/CORS, `X-NetBox-Token` / `Bearer` pairing token auth, host-only token rotation, `allow_remote_execution` policy toggle. |
| Network Discovery & Offline QR | `backend/app/services/network_discovery.py`, `backend/app/services/qr_svg.py` | Linux `ip -j addr` + read-only Windows `ipconfig.exe` Hotspot/Wi-Fi detection, pure-Python offline ISO/IEC 18004 SVG QR code generator. |
| System Health & Client Sessions | `backend/app/services/system_service.py`, `backend/app/routers/system.py` | Independent health reporting (`backend`, `socket_instrumentation`, `packet_capture`, `ollama`, `ai_model`, `lan`), real client heartbeat tracking (45s TTL). |
| Standalone LAN Browser UI | `backend/app/routers/web_ui.py` | Serves full NetBox Visualizer at `GET /` and static assets at `/media/*` with strict path-traversal protection. |
| Service Management Scripts | `scripts/start_ollama.sh`, `start_backend.sh`, `start_netbox.sh`, `stop_netbox.sh`, `check_netbox.sh`, `scripts/windows/setup_lan_forward.ps1` | Ordered startup, duplicate-process & port-occupancy guards, PID-tracked graceful shutdown, preserved logs in `/tmp/netbox_logs/`. |
| System & LAN Dashboard UI | `extension/media/visualizer/systemDashboard.js`, `visualizer.js`, `visualizerPanel.ts`, `backendService.ts`, `package.json` | Running / Degraded / Unavailable / Disconnected badges, QR code, pairing token management, client URL/token persistence & auto-reconnection on host IP change. |

---

## 4. Security Model & Documented Limitations

- **What is enforced:**
  - Ollama stays strictly on `127.0.0.1:11434` (never LAN-exposed).
  - Remote LAN clients must authenticate with the host's pairing token when `NETBOX_MODE=lan` (`401 Unauthorized` otherwise); raw pairing token is never returned to remote callers.
  - Host can disable remote experiment execution (`allow_remote_execution=False` → `403 Forbidden` on `POST /api/runs`) while allowing read + AI tutoring.
  - No host filesystem browsing, no environment variable exposure, no arbitrary shell execution, strict path-traversal rejection on `/media/*`.
- **Known Security Limitations:**
  - Plain HTTP over LAN/hotspot is unencrypted (no TLS/HTTPS certificate) — suitable for trusted classroom or personal hotspot networks only, NOT public untrusted Wi-Fi.
  - Shared single pairing token is lightweight classroom access control, not multi-user RBAC or OAuth.

---

## 5. Verification Status

- Automated backend LAN, auth, security, QR, and discovery tests (`backend/tests/test_phase6_lan.py`): **7 / 7 PASSED**.
- Frontend System Dashboard tests (`extension/tests/system_dashboard.test.js`): **3 / 3 PASSED**.
- Empirical Windows ↔ WSL 2 reachability & startup script tests (`start_netbox.sh --lan`, `check_netbox.sh`, `stop_netbox.sh`, `setup_lan_forward.ps1` dry-run): **PASSED**.
- **Two-Device Physical LAN Acceptance Test (Device B laptop/phone over Wi-Fi/Hotspot):** **Pending Physical Device** (exact execution steps documented in `docs/DEMO_GUIDE.md`).
