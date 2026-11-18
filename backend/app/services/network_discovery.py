import ipaddress
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple

from ..core.config import NetBoxCoreConfig, get_core_config
from ..models.system import NetworkInterfaceRecord, SystemNetworkResponse

logger = logging.getLogger("netbox.network_discovery")


def detect_wsl2() -> Tuple[bool, str]:
    """
    Detects whether NetBox is running inside WSL 2 and infers NAT vs mirrored networking.
    Never modifies host configuration.
    """
    try:
        version_text = Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False, "native_linux"

    is_wsl2 = "microsoft" in version_text and ("wsl2" in version_text or "microsoft-standard" in version_text)
    if not is_wsl2:
        return False, "native_linux"

    # Check if eth0 has a typical WSL Hyper-V NAT subnet (172.16-31.x.x) vs mirrored Windows LAN
    linux_ifaces = discover_linux_interfaces()
    for iface in linux_ifaces:
        if iface.name == "eth0" and iface.ipv4_addresses:
            ip_str = iface.ipv4_addresses[0]
            try:
                ip_obj = ipaddress.IPv4Address(ip_str)
                if ip_obj in ipaddress.IPv4Network("172.16.0.0/12"):
                    return True, "wsl2_nat"
            except ValueError:
                pass
    return True, "wsl2_mirrored_or_custom"


def _prefix_to_mask(prefixlen: int) -> str:
    try:
        return str(ipaddress.IPv4Network(f"0.0.0.0/{prefixlen}").netmask)
    except ValueError:
        return ""


def _is_lan_candidate_ipv4(ip_str: str, iface_name: str) -> bool:
    try:
        ip_obj = ipaddress.IPv4Address(ip_str)
    except ValueError:
        return False
    if ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
        return False
    lower_name = iface_name.lower()
    if "vethernet (wsl" in lower_name or "docker" in lower_name or "br-" in lower_name:
        return False
    return True


def discover_linux_interfaces() -> List[NetworkInterfaceRecord]:
    """Discovers active Linux/WSL network interfaces via `ip -j addr`."""
    results: List[NetworkInterfaceRecord] = []
    try:
        proc = subprocess.run(
            ["ip", "-j", "addr"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3.0,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            items = json.loads(proc.stdout)
            for item in items:
                name = item.get("ifname", "")
                if not name:
                    continue
                flags = item.get("flags", [])
                is_up = "UP" in flags
                is_lo = "LOOPBACK" in flags
                mac = item.get("address")
                if mac == "00:00:00:00:00:00":
                    mac = None
                ipv4s: List[str] = []
                masks: List[str] = []
                for addr in item.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local"):
                        ipv4s.append(addr["local"])
                        if isinstance(addr.get("prefixlen"), int):
                            masks.append(_prefix_to_mask(addr["prefixlen"]))
                is_lan = any(_is_lan_candidate_ipv4(ip, name) for ip in ipv4s) and not is_lo and is_up
                hint = "WSL 2 virtual interface" if name == "eth0" else ("Loopback" if is_lo else "Linux interface")
                results.append(
                    NetworkInterfaceRecord(
                        name=name,
                        source="linux_wsl",
                        ipv4_addresses=ipv4s,
                        subnet_masks=masks,
                        mac_address=mac,
                        is_up=is_up,
                        is_loopback=is_lo,
                        is_lan_candidate=is_lan,
                        adapter_hint=hint,
                    )
                )
            return results
    except Exception as err:
        logger.debug("discover_linux_interfaces fallback: %s", err)

    return results


def discover_default_gateway() -> Optional[str]:
    """Reads the Linux/WSL default IPv4 gateway via `ip route`."""
    try:
        proc = subprocess.run(
            ["ip", "-4", "route", "show", "default"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=2.5,
        )
        if proc.returncode == 0:
            match = re.search(r"default\s+via\s+(\d+\.\d+\.\d+\.\d+)", proc.stdout)
            if match:
                return match.group(1)
    except Exception:
        pass
    return None


def parse_windows_ipconfig(output: str) -> List[NetworkInterfaceRecord]:
    """
    Parses read-only `ipconfig.exe` text output into structured Windows adapter records.
    Identifies Wi-Fi, Ethernet, and Windows Mobile Hotspot (192.168.137.x) candidates
    while excluding Hyper-V vEthernet (WSL) NAT adapters from LAN candidates.
    """
    records: List[NetworkInterfaceRecord] = []
    current_name: Optional[str] = None
    current_ips: List[str] = []
    current_masks: List[str] = []

    def flush() -> None:
        if current_name and current_ips:
            lower = current_name.lower()
            is_wsl_veth = "vethernet (wsl" in lower or "hyper-v" in lower
            is_hotspot = any(ip.startswith("192.168.137.") for ip in current_ips) or "local area connection*" in lower
            if is_hotspot:
                hint = "Windows Mobile Hotspot"
            elif "wi-fi" in lower or "wireless" in lower:
                hint = "Windows Wi-Fi LAN"
            elif is_wsl_veth:
                hint = "Windows Hyper-V WSL Switch (internal NAT)"
            else:
                hint = "Windows Network Adapter"

            is_lan = (not is_wsl_veth) and any(_is_lan_candidate_ipv4(ip, current_name) for ip in current_ips)
            records.append(
                NetworkInterfaceRecord(
                    name=current_name,
                    source="windows_host",
                    ipv4_addresses=list(current_ips),
                    subnet_masks=list(current_masks),
                    mac_address=None,
                    is_up=True,
                    is_loopback=False,
                    is_lan_candidate=is_lan,
                    adapter_hint=hint,
                )
            )

    for raw_line in output.splitlines():
        line = raw_line.rstrip("\r\n")
        if line and not line.startswith(" ") and line.endswith(":"):
            flush()
            current_name = line[:-1].strip()
            current_ips = []
            current_masks = []
            continue

        if current_name:
            ip_match = re.search(r"IPv4 Address[^:]*:\s*(\d+\.\d+\.\d+\.\d+)", line)
            if ip_match:
                current_ips.append(ip_match.group(1))
            mask_match = re.search(r"Subnet Mask[^:]*:\s*(\d+\.\d+\.\d+\.\d+)", line)
            if mask_match:
                current_masks.append(mask_match.group(1))

    flush()
    return records


def discover_windows_host_interfaces() -> List[NetworkInterfaceRecord]:
    """
    When running under WSL 2, attempts read-only `ipconfig.exe` lookup to identify
    real Windows Wi-Fi / Mobile Hotspot IPv4 addresses reachable by LAN clients.
    Fails gracefully on native Linux or when Windows interop is disabled.
    """
    for exe in ("/mnt/c/Windows/System32/ipconfig.exe", "ipconfig.exe"):
        try:
            proc = subprocess.run(
                [exe],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3.0,
            )
            if proc.returncode == 0 and proc.stdout:
                return parse_windows_ipconfig(proc.stdout)
        except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired):
            continue
        except Exception as err:
            logger.debug("Windows ipconfig interop skipped: %s", err)
            break
    return []


def build_network_overview(config: Optional[NetBoxCoreConfig] = None) -> SystemNetworkResponse:
    cfg = config or get_core_config()
    is_wsl2, wsl_mode = detect_wsl2()
    linux_ifaces = discover_linux_interfaces()
    win_ifaces = discover_windows_host_interfaces() if is_wsl2 else []
    all_ifaces = win_ifaces + linux_ifaces

    wsl_eth0_ip: Optional[str] = None
    for iface in linux_ifaces:
        if iface.name == "eth0" and iface.ipv4_addresses:
            wsl_eth0_ip = iface.ipv4_addresses[0]
            break

    default_gw = discover_default_gateway()
    local_url = f"http://127.0.0.1:{cfg.port}"

    # Collect unique LAN IPv4 candidates in priority order:
    # 1. Explicit NETBOX_ADVERTISED_HOST
    # 2. Windows Mobile Hotspot (192.168.137.x)
    # 3. Windows Wi-Fi / Ethernet LAN adapters
    # 4. Linux non-WSL LAN interfaces (or eth0 if native Linux / mirrored)
    candidate_ips: List[str] = []
    if cfg.advertised_host:
        candidate_ips.append(cfg.advertised_host)

    # Prefer Windows Hotspot first, then other Windows LAN adapters
    win_candidates = [i for i in win_ifaces if i.is_lan_candidate]
    win_candidates.sort(key=lambda r: (0 if r.adapter_hint == "Windows Mobile Hotspot" else 1))
    for iface in win_candidates:
        for ip in iface.ipv4_addresses:
            if ip not in candidate_ips:
                candidate_ips.append(ip)

    if not is_wsl2 or wsl_mode != "wsl2_nat":
        for iface in linux_ifaces:
            if iface.is_lan_candidate:
                for ip in iface.ipv4_addresses:
                    if ip not in candidate_ips:
                        candidate_ips.append(ip)
    elif not candidate_ips and wsl_eth0_ip:
        # Fallback informational IP if Windows ipconfig interop was unavailable
        candidate_ips.append(wsl_eth0_ip)

    lan_urls = [f"http://{ip}:{cfg.port}" for ip in candidate_ips]
    recommended_ip = candidate_ips[0] if candidate_ips else None
    recommended_url = lan_urls[0] if lan_urls else None

    portproxy_cmd: Optional[str] = None
    firewall_cmd: Optional[str] = None
    troubleshooting: List[str] = []

    if cfg.mode == "localhost":
        troubleshooting.append(
            "NetBox is currently running in localhost-only mode (127.0.0.1). "
            "Start with './scripts/start_netbox.sh --lan' to accept LAN/hotspot connections."
        )

    if is_wsl2 and wsl_mode == "wsl2_nat" and wsl_eth0_ip:
        portproxy_cmd = (
            f"netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 "
            f"listenport={cfg.port} connectaddress={wsl_eth0_ip} connectport={cfg.port}"
        )
        firewall_cmd = (
            f"New-NetFirewallRule -DisplayName 'NetBox LAN Port {cfg.port}' "
            f"-Direction Inbound -Protocol TCP -LocalPort {cfg.port} -Profile Private -Action Allow"
        )
        troubleshooting.extend(
            [
                f"WSL 2 NAT mode detected (WSL eth0={wsl_eth0_ip}). External hotspot/Wi-Fi devices cannot reach {wsl_eth0_ip} directly.",
                "Run the portproxy and Windows Defender Firewall commands in an elevated PowerShell prompt (or run scripts/windows/setup_lan_forward.ps1 -Apply) to forward Windows LAN traffic to WSL 2.",
                "After a WSL restart, WSL eth0 IP may change — re-run setup_lan_forward.ps1 if clients lose access.",
                "Ollama remains strictly bound to 127.0.0.1:11434 inside WSL 2 and must NEVER be exposed to the LAN.",
            ]
        )
    elif is_wsl2:
        firewall_cmd = (
            f"New-NetFirewallRule -DisplayName 'NetBox LAN Port {cfg.port}' "
            f"-Direction Inbound -Protocol TCP -LocalPort {cfg.port} -Profile Private -Action Allow"
        )
        troubleshooting.append(
            "WSL 2 mirrored/custom networking detected. Ensure Windows Firewall allows inbound TCP traffic on the configured NetBox port for Private networks."
        )
    else:
        troubleshooting.append(
            f"Ensure host firewall permits inbound TCP port {cfg.port} on the local Wi-Fi/hotspot interface."
        )

    return SystemNetworkResponse(
        mode=cfg.mode,
        bind_host=cfg.bind_host,
        port=cfg.port,
        is_wsl2=is_wsl2,
        wsl_network_mode=wsl_mode,
        wsl_eth0_ip=wsl_eth0_ip,
        default_gateway=default_gw,
        advertised_host=cfg.advertised_host,
        recommended_lan_ip=recommended_ip,
        recommended_lan_url=recommended_url,
        local_url=local_url,
        lan_urls=lan_urls,
        interfaces=all_ifaces,
        wsl_portproxy_command=portproxy_cmd,
        wsl_firewall_command=firewall_cmd,
        troubleshooting=troubleshooting,
    )
