# NetBox — Final Demonstration Guide

Use this step-by-step guide to demonstrate NetBox end-to-end as an offline classroom Computer Networks laboratory and grounded local AI tutor.

---

## Prerequisites (Host Laptop — Device A)

1. Inside Ubuntu WSL 2 (`/home/hardik_kumar/projects/netbox`):
   - C binaries built: `make all`
   - Packet capture helper built with capabilities: `getcap packet_capture/netbox_pcap` → `cap_net_admin,cap_net_raw=eip`
   - Local Ollama model pulled once while online: `ollama pull qwen2.5-coder:1.5b`
2. *(Optional for two-device demo)* Turn on **Windows Mobile Hotspot** (or connect Device A & Device B to the same Private Wi-Fi network) and **disconnect upstream Internet** to prove 100% offline operation.

---

## Live Demonstration Flow (12 Steps)

### Step 1 — Start NetBox Host in LAN Mode (Device A)
In Ubuntu WSL 2:
```bash
cd ~/projects/netbox
./scripts/start_netbox.sh --lan
```
Note the printed output:
- **Local URL:** `http://127.0.0.1:8000`
- **LAN Client URL:** e.g., `http://192.168.137.1:8000` (Hotspot) or `http://192.170.2.209:8000` (Wi-Fi)
- **Host Pairing Token:** e.g., `nbx-a1b2c3d4`

### Step 2 — Enable Windows → WSL 2 Forwarding (First Time / After WSL Restart)
In an **Administrator PowerShell** on Windows (review first with no flags, then run with `-Apply`):
```powershell
.\scripts\windows\setup_lan_forward.ps1 -Port 8000
.\scripts\windows\setup_lan_forward.ps1 -Port 8000 -Apply
```
*(To remove forwarding and firewall rule cleanly after the demo: `.\scripts\windows\setup_lan_forward.ps1 -Port 8000 -Remove`.)*

### Step 3 — Connect Second Device (Device B)
1. Connect Device B to Device A's hotspot or Wi-Fi.
2. Open a browser on Device B and visit `http://<HOST_LAN_IP>:8000/` (or scan the **Offline LAN QR** displayed on Device A's **System & LAN** tab).
3. Open **System & LAN**, enter the **Host Pairing Token** (`nbx-...`), and click **Save & Reconnect**.
4. Confirm Device B appears in **Active Connected Clients** and all components report **Running** (while Ollama remains strictly localhost-only on Device A).

### Step 4 — Execute a Real TCP Experiment
Click **Run Live TCP** in the top toolbar (or run **Module 4 — TCP** inside Curriculum Labs).

### Step 5 — Observe Real Socket API Events
In **Overview & Socket API**, step through the timeline (`Prev` / `Play` / `Next`):
- Show `socket()` → `bind(127.0.0.1:8080)` → `listen()` → `connect()` → `accept()` (new FD!) → `send()` → `recv()` → `close()`.
- Point out the **`ACTUAL SOCKET API EVENTS`** badge (`is_simulated: false`).

### Step 6 — Observe Real Captured Wire Packets
Switch to the **Packets** tab:
- Verify `Packet Capture: COMPLETED (lo)` and the real IPv4/TCP header fields (`TTL`, `seq`, `ack`, `window_size`, TCP flags).

### Step 7 — Inspect the TCP Three-Way Handshake & Flow
- Review the **Observed TCP Handshake** diagram (`SYN` → `SYN+ACK` → `ACK`).
- Switch to **TCP Flows** and **Correlations & Dual-Layer** to show how application `send()`/`recv()` map conservatively onto captured TCP segments.

### Step 8 — Ask the Grounded Local AI Assistant
Switch to the **AI Assistant** tab (confirm `Local LLM Ready (ollama: qwen2.5-coder:1.5b)`):
- Click **"Explain this execution"** or **"What happened during data transfer?"**.
- Highlight that inference executes entirely on Device A's local Ollama runtime — Device B has no LLM installed and no cloud API is called.

### Step 9 — Click a Verified Evidence Reference
Click any verified citation pill (e.g., **`Packet #4`** or **`Socket Event #7`**) inside the AI response:
- Show NetBox jumping directly to the **Packets** tab and opening the Packet Inspector for that exact packet.

### Step 10 — Open the Corresponding Curriculum Lab
Switch to **Curriculum Labs**:
- Open **Module 3 (IP & Subnetting)** to demonstrate the deterministic bitwise Subnet Calculator (`192.168.10.70/26`).
- Open **Module 4 (TCP)** or **Module 5 (UDP)** to run a live scenario (e.g., `tcp-abrupt-rst`, `udp-multi-datagram`, or offline `dns-local`).

### Step 11 — Complete an Assessment & Verify Saved Progress
Open **E. Assess** on the lab, answer the questions, click **Submit Assessment**, and show deterministic grading + updated persistent curriculum progress (`1/9`).

### Step 12 — Demonstrate Offline & Disconnect Recovery
1. Keep Internet disconnected throughout — all labs, packet capture, and local AI continue working cleanly.
2. Temporarily stop the host (`./scripts/stop_netbox.sh`) to show Device B cleanly switching to **Host: Disconnected**, then restart (`./scripts/start_netbox.sh --lan`) and watch automatic health-check reconnection!

---

## Troubleshooting Quick Reference
- **Device B times out connecting to `<HOST_LAN_IP>:8000`:** Re-run `setup_lan_forward.ps1 -Apply` in Admin PowerShell (WSL 2 `eth0` IP changes after a WSL reboot) and confirm Windows Wi-Fi/Hotspot profile is set to **Private**.
- **Device B sees `401 Unauthorized`:** Enter the current pairing token shown on Device A's **System & LAN** tab (or `./scripts/check_netbox.sh`).
- **AI Assistant shows `Unavailable`:** Run `./scripts/start_ollama.sh` on Device A and verify `ollama list` includes `qwen2.5-coder:1.5b`.
