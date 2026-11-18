# NetBox — Computer Networks Learning Environment for VS Code

An AI-assisted Computer Networks learning environment that lets students run real networking experiments, inspect socket operations and captured packets, visualize network activity, and understand concepts through an evidence-grounded local AI tutor.

---

## What Is NetBox?

Students learning Computer Networks often struggle to connect textbook diagrams (OSI layers, TCP 3-way handshakes, sequence/acknowledgement numbers, UDP datagrams, DNS, HTTP, subnetting) with what real POSIX programs actually do on the operating system and wire.

**NetBox's core educational philosophy:**
> Students perform real networking experiments. NetBox observes and visualizes actual networking activity (`LD_PRELOAD` + `libpcap`). A local AI tutor helps students understand what actually happened—citing verified captured packets and socket events—rather than replacing practical learning or hallucinating fake traces.

---

## Key Features

- **Real Socket API Instrumentation (`LD_PRELOAD`):** Captures 12 real POSIX socket calls (`socket`, `bind`, `listen`, `accept`, `connect`, `send`, `sendto`, `recv`, `recvfrom`, `shutdown`, `close`) with exact file descriptors, endpoints, byte counts, and `errno` codes.
- **Real Packet Capture & TCP Analysis (`libpcap`):** Captures actual IPv4/TCP/UDP wire packets with header-only privacy defaults, observed 3-way handshake verification, FIN/RST termination tracking, bidirectional 4-tuple flows, and conservative socket-to-packet correlation.
- **Interactive Networking Visualizer:** Dynamic client/server socket topology, API-level sequence diagram, monotonic nanosecond timing & interval comparison, non-destructive filters, and timestamp-aware playback (`0.5x`–`4x`).
- **Evidence-Grounded Local AI Tutor (Host Ollama):** Runs 100% locally with zero cloud APIs or external packet uploads. Cites verified `[PACKET: pkt_N]` and `[SOCKET: sock_N]` tags as clickable navigation pills, supports Learning Mode, progressive hints, quizzes, and rubric-grounded self-review.
- **Nine Hands-On Curriculum Modules:** Foundations, Ethernet/MAC/ARP, IP Addressing & Subnetting (with a deterministic bitwise Subnet Calculator), TCP, UDP, DNS, HTTP/HTTPS boundaries, Routing & Troubleshooting, and Network Monitoring—complete with graded assessments and local progress persistence.
- **Local & LAN Classroom Support:** Connect to your own local NetBox backend or connect securely over Wi-Fi/hotspot to a shared host running NetBox (using VS Code `SecretStorage` for pairing tokens—no local LLM installation needed on student client machines).
- **10-Step Interactive Guided Tour & Presentation Mode:** Built-in first-time onboarding walkthrough culminating in a real TCP experiment, plus an uncluttered Presentation / Demo Mode for lectures and evaluations.

---

## Architecture

```text
VS Code Extension (NetBox)
   │  HTTP(S) + X-NetBox-Token (VS Code SecretStorage)
   ▼
NetBox FastAPI Backend (Local Host or Classroom LAN Host :8000)
   ├── Layer A (Deterministic Engine):
   │     • LD_PRELOAD Socket Tracer (libnetbox_trace.so)
   │     • Native libpcap Packet Capture Helper (netbox_pcap)
   │     • TCP Flow / Handshake / Correlation Analyzer
   │     • Safe Allowlisted Lab Runner (TCP, UDP, DNS, HTTP, L2/L3, Monitoring)
   │     • Deterministic Bitwise IPv4 Subnet Calculator & Progress JSON Store
   └── Layer B & C (Grounded Local AI):
         • Deterministic Evidence Retriever & Prompt-Injection Fencing
         • Strict Citation Validator (verified clickable evidence links only)
         • Host-Local Ollama Runtime (strictly 127.0.0.1:11434 — never LAN-exposed)
```

> **Note:** Installing this VS Code extension provides the IDE client, Welcome & Setup Hub, Guided Tour, and Visualizer. To execute live experiments and local AI tutoring, connect it to a running **NetBox Backend** (local Linux/WSL 2 host or shared LAN host).

---

## Installation

### 1. Install the VS Code Extension
- **From VS Code Marketplace:** Open the **Extensions** view (`Ctrl+Shift+X`), search for **NetBox**, and click **Install**.
- **From a `.vsix` package:** Run `Extensions: Install from VSIX...` from the Command Palette (`Ctrl+Shift+P`) and select the `.vsix` file.

### 2. Set Up the NetBox Backend (Host Machine — Linux or Windows WSL 2)
```bash
git clone https://github.com/hrdkkmr/netbox.git
cd netbox
make all
./scripts/setup_backend.sh

# Optional: Enable real loopback packet capture (least-privilege capability)
sudo apt-get install -y libpcap-dev
make packet_capture
sudo setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap

# Optional: Enable host-local AI tutoring via Ollama (zero cloud APIs)
ollama pull qwen2.5-coder:1.5b

# Start NetBox locally (or add --lan to share with classroom clients over Wi-Fi/hotspot)
./scripts/start_netbox.sh
```

---

## First-Time Setup & Practical Example

1. On first launch, NetBox opens the **Welcome & Setup** panel showing independent live status for all 7 components (Extension, Backend URL, Reachability, Authentication, Socket Instrumentation, Packet Capture, and Local AI).
2. Run **`NetBox: Configure Backend & Access Token`** if connecting to a LAN host (e.g., `http://192.168.137.1:8000`). Tokens are stored securely in VS Code `SecretStorage`.
3. Run **`NetBox: Start Guided Tour`** to walk through all 7 workspace views and execute your first real TCP client-server experiment:
   - Click **Run Live TCP** to execute the C POSIX TCP echo server and client.
   - Step through `socket → bind → listen → connect → accept → send → recv → close` in **Overview & Socket API**.
   - Open **Packets** to inspect the captured `SYN → SYN+ACK → ACK` handshake, `PSH+ACK` data, and `FIN` teardown.
   - Open **AI Assistant**, ask *"What happened during data transfer?"*, and click any verified **`Packet #N`** button to jump straight to that packet in the inspector.

---

## Commands & Settings

| Command | Description |
| :--- | :--- |
| `NetBox: Open Welcome & Setup` | Opens Welcome page & 7-component readiness matrix |
| `NetBox: Open Visualizer` | Opens the unified Visualizer, Packet Inspector, Curriculum Labs & AI Tutor |
| `NetBox: Start Guided Tour` | Starts or resumes the 10-step interactive walkthrough |
| `NetBox: Start Presentation / Demo Mode` | Launches uncluttered 6-stage presenter mode for live demos |
| `NetBox: Configure Backend & Access Token` | Validates backend URL and stores LAN token in VS Code `SecretStorage` |
| `NetBox: Check Backend Connection` | Reports backend reachability, authentication, capture, and AI status |

Settings: `netbox.backendUrl`, `netbox.connectionTimeoutMs`, `netbox.healthCheckIntervalMs`, `netbox.verifyConnectionOnStartup`.

---

## Troubleshooting

- **Backend Unreachable:** Ensure the host backend is running (`./scripts/check_netbox.sh`). Under Windows + WSL 2 NAT mode, external LAN clients require Windows port forwarding (`scripts/windows/setup_lan_forward.ps1`) and a Private-network inbound firewall rule for port `8000`.
- **Authentication Failed (`401 Unauthorized`):** The LAN host requires its pairing token. Re-run `NetBox: Configure Backend & Access Token` and enter the token shown on the host's **System & LAN** tab.
- **Packet Capture Unavailable:** Install `libpcap-dev`, run `make packet_capture`, and grant `sudo setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap`. Phase 2 socket tracing continues working even without packet capture.
- **Local AI Unavailable:** Ensure Ollama is running on the host (`./scripts/start_ollama.sh`) and the configured model (`qwen2.5-coder:1.5b`) is pulled locally. All deterministic labs and visualizations remain usable offline without Ollama.

---

## License

MIT License — see [LICENSE](LICENSE). Source code & issue tracker: https://github.com/hrdkkmr/netbox
