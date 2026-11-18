# NetBox Packet Capture Helper (`netbox_pcap`)

Dedicated native C11 packet capture helper using **libpcap** for Phase 4 of NetBox.

## Design Principles

1. **Least-Privilege Separation:** Only this small, dedicated binary receives Linux capture capabilities (`cap_net_raw,cap_net_admin=eip`). The FastAPI backend and target C programs never run as `root`.
2. **Dual Timestamps:** Records both libpcap's original wall-clock timestamp (`pcap_timestamp_ns`) and `CLOCK_MONOTONIC` (`capture_monotonic_ns`) captured inside the callback so packets can be correlated with Phase 2 `socket_api` events without mixing clock domains.
3. **Link-Layer Awareness:** Inspects `pcap_datalink()` (`DLT_EN10MB`, `DLT_NULL`, `DLT_LOOP`, `DLT_LINUX_SLL`, `DLT_LINUX_SLL2`, `DLT_RAW`) instead of assuming Ethernet headers.
4. **Privacy by Default:** Captures headers only (`snaplen=160`) with `preview_hex=null` and `preview_utf8=null` unless `--capture-payload 1` is explicitly requested per run.

## Setup & Build (Ubuntu WSL 2)

```bash
# 1. Install libpcap development headers
sudo apt update && sudo apt install -y libpcap-dev

# 2. Build the helper
make -C packet_capture

# 3. Grant least-privilege capture capability to the helper binary ONLY
sudo setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap
getcap packet_capture/netbox_pcap
```
