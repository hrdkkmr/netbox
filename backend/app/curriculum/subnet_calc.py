"""
Deterministic IPv4 Subnet Calculator for NetBox Phase 7 (Module 3).
Strictly mathematical using Python's ipaddress module — never LLM-generated.
"""

import ipaddress
from typing import Optional

from .models import SubnetCalcResponse


def _ipv4_to_binary_dotted(addr: ipaddress.IPv4Address) -> str:
    bits = f"{int(addr):032b}"
    return ".".join(bits[i : i + 8] for i in range(0, 32, 8))


def _classify_ipv4_scope(addr: ipaddress.IPv4Address) -> str:
    if addr.is_loopback:
        return "Loopback (127.0.0.0/8, RFC 1122)"
    if addr.is_link_local:
        return "Link-Local / APIPA (169.254.0.0/16, RFC 3927)"
    if addr.is_multicast:
        return "Multicast (224.0.0.0/4)"
    if addr.is_private:
        return "Private (RFC 1918 / Local)"
    if addr.is_reserved:
        return "Reserved"
    if addr.is_global:
        return "Public (Globally Routable)"
    return "Special-Purpose"


def calculate_subnet(cidr: str, compare_ip: Optional[str] = None) -> SubnetCalcResponse:
    cleaned = (cidr or "").strip()
    if "/" not in cleaned:
        raise ValueError("Input must include a CIDR prefix length (e.g., 192.168.1.42/24).")

    try:
        iface = ipaddress.IPv4Interface(cleaned)
    except ValueError as err:
        raise ValueError(f"Invalid IPv4 CIDR '{cleaned}': {err}") from err

    net = iface.network
    prefix = net.prefixlen
    total = net.num_addresses

    if prefix == 32:
        usable = 1
        first_usable = str(net.network_address)
        last_usable = str(net.network_address)
    elif prefix == 31:
        # RFC 3021 point-to-point link
        usable = 2
        first_usable = str(net.network_address)
        last_usable = str(net.broadcast_address)
    else:
        usable = max(0, total - 2)
        first_usable = str(ipaddress.IPv4Address(int(net.network_address) + 1))
        last_usable = str(ipaddress.IPv4Address(int(net.broadcast_address) - 1))

    same_subnet: Optional[bool] = None
    compare_explanation: Optional[str] = None
    cleaned_compare = compare_ip.strip() if compare_ip and compare_ip.strip() else None

    if cleaned_compare:
        try:
            other_ip = ipaddress.IPv4Address(cleaned_compare)
        except ValueError as err:
            raise ValueError(f"Invalid comparison IPv4 address '{cleaned_compare}': {err}") from err
        same_subnet = other_ip in net
        if same_subnet:
            compare_explanation = (
                f"{other_ip} belongs to {net.with_prefixlen}. "
                "Hosts in the same subnet communicate directly over Layer 2 (ARP + Ethernet) without needing the default gateway."
            )
        else:
            compare_explanation = (
                f"{other_ip} is outside {net.with_prefixlen}. "
                "Packets must be forwarded to the default gateway's MAC address for Layer 3 routing."
            )

    return SubnetCalcResponse(
        input_cidr=cleaned,
        ip_address=str(iface.ip),
        prefix_length=prefix,
        subnet_mask=str(net.netmask),
        wildcard_mask=str(net.hostmask),
        network_address=str(net.network_address),
        broadcast_address=str(net.broadcast_address),
        first_usable_host=first_usable,
        last_usable_host=last_usable,
        total_addresses=total,
        usable_host_count=usable,
        address_scope=_classify_ipv4_scope(iface.ip),
        network_binary=_ipv4_to_binary_dotted(net.network_address),
        mask_binary=_ipv4_to_binary_dotted(net.netmask),
        compare_ip=cleaned_compare,
        same_subnet=same_subnet,
        compare_explanation=compare_explanation,
    )
