import json
import logging
import socket
import struct
from pathlib import Path
from typing import List, Optional, Tuple, Union

from ..models.packets import (
    CaptureLengthInfo,
    LinkLayerInfo,
    NetworkHeaderInfo,
    PacketPayloadInfo,
    PacketRecord,
    PacketTimestamp,
    TcpFlags,
    TcpHeaderInfo,
    TcpOption,
    TransportInfo,
)

logger = logging.getLogger("netbox.packet_parser")

# Standard libpcap DLT constants
DLT_NULL = 0
DLT_EN10MB = 1
DLT_RAW = 12
DLT_LOOP = 108
DLT_LINUX_SLL = 113
DLT_LINUX_SLL2 = 276

DLT_NAMES = {
    DLT_NULL: "DLT_NULL",
    DLT_EN10MB: "DLT_EN10MB",
    DLT_RAW: "DLT_RAW",
    DLT_LOOP: "DLT_LOOP",
    DLT_LINUX_SLL: "DLT_LINUX_SLL",
    DLT_LINUX_SLL2: "DLT_LINUX_SLL2",
}

MAX_PAYLOAD_PREVIEW_BYTES = 64


def _format_mac(raw: bytes) -> Optional[str]:
    if len(raw) != 6 or all(b == 0 for b in raw):
        return None
    return ":".join(f"{b:02x}" for b in raw)


def _decode_tcp_options(opts: bytes) -> List[TcpOption]:
    decoded: List[TcpOption] = []
    i = 0
    n = len(opts)
    while i < n:
        kind = opts[i]
        if kind == 0:
            break
        if kind == 1:
            i += 1
            continue
        if i + 1 >= n:
            break
        opt_len = opts[i + 1]
        if opt_len < 2 or i + opt_len > n:
            break
        if kind == 2 and opt_len == 4:
            mss = struct.unpack("!H", opts[i + 2 : i + 4])[0]
            decoded.append(TcpOption(name="MSS", value=str(mss)))
        elif kind == 3 and opt_len == 3:
            decoded.append(TcpOption(name="WScale", value=str(opts[i + 2])))
        elif kind == 4 and opt_len == 2:
            decoded.append(TcpOption(name="SACK_Permitted", value="true"))
        elif kind == 8 and opt_len == 10:
            tsval, tsecr = struct.unpack("!II", opts[i + 2 : i + 10])
            decoded.append(TcpOption(name="Timestamp", value=f"TSval={tsval}, TSecr={tsecr}"))
        else:
            decoded.append(TcpOption(name=f"Option_{kind}", value=f"len={opt_len}"))
        i += opt_len
    return decoded


def parse_raw_packet(
    raw_bytes: bytes,
    dlt: int,
    original_length: int,
    pcap_timestamp_ns: int,
    capture_monotonic_ns: int,
    run_id: str,
    sequence: int,
    interface: str = "lo",
    capture_payload: bool = False,
    max_payload_bytes: int = MAX_PAYLOAD_PREVIEW_BYTES,
) -> PacketRecord:
    """
    Pure-Python binary decoder mirroring packet_capture/src/packet_decoder.c.
    Respects link-layer DLT, handles truncated frames safely, and enforces
    payload privacy by default (preview_hex/preview_utf8 are None unless opted in).
    """
    if dlt not in DLT_NAMES:
        raise ValueError(f"Unsupported link-layer type DLT={dlt}")

    caplen = len(raw_bytes)
    dlt_name = DLT_NAMES[dlt]
    src_mac: Optional[str] = None
    dst_mac: Optional[str] = None
    header_truncated = False
    l3_offset = 0
    protocol = "UNKNOWN"
    ethertype: Optional[int] = None

    if dlt == DLT_EN10MB:
        if caplen < 14:
            header_truncated = True
        else:
            dst_mac = _format_mac(raw_bytes[0:6])
            src_mac = _format_mac(raw_bytes[6:12])
            ethertype = struct.unpack("!H", raw_bytes[12:14])[0]
            l3_offset = 14
            if ethertype == 0x8100 and caplen >= 18:
                ethertype = struct.unpack("!H", raw_bytes[16:18])[0]
                l3_offset = 18
            if ethertype != 0x0800:
                protocol = "IPv6" if ethertype == 0x86DD else ("ARP" if ethertype == 0x0806 else "OTHER")
    elif dlt in (DLT_NULL, DLT_LOOP):
        if caplen < 4:
            header_truncated = True
        else:
            family = struct.unpack("!I" if dlt == DLT_LOOP else "@I", raw_bytes[0:4])[0]
            l3_offset = 4
            if family != 2:
                protocol = "OTHER"
                ethertype = 0
            else:
                ethertype = 0x0800
    elif dlt == DLT_LINUX_SLL:
        if caplen < 16:
            header_truncated = True
        else:
            ethertype = struct.unpack("!H", raw_bytes[14:16])[0]
            l3_offset = 16
            if ethertype != 0x0800:
                protocol = "IPv6" if ethertype == 0x86DD else "OTHER"
    elif dlt == DLT_LINUX_SLL2:
        if caplen < 20:
            header_truncated = True
        else:
            ethertype = struct.unpack("!H", raw_bytes[0:2])[0]
            l3_offset = 20
            if ethertype != 0x0800:
                protocol = "IPv6" if ethertype == 0x86DD else "OTHER"
    elif dlt == DLT_RAW:
        l3_offset = 0
        ethertype = 0x0800

    network_info: Optional[NetworkHeaderInfo] = None
    transport_info: Optional[TransportInfo] = None
    payload_info = PacketPayloadInfo(captured_bytes=0, payload_length=0, truncated=False)

    if not header_truncated and ethertype == 0x0800:
        if l3_offset + 20 > caplen:
            header_truncated = True
        else:
            v_ihl = raw_bytes[l3_offset]
            ip_ver = (v_ihl >> 4) & 0x0F
            ihl_bytes = (v_ihl & 0x0F) * 4
            if ip_ver != 4:
                protocol = "IPv6" if ip_ver == 6 else "OTHER"
            elif ihl_bytes < 20 or l3_offset + ihl_bytes > caplen:
                header_truncated = True
            else:
                total_len, ident, _flags_frag, ttl, proto_num, _csum = struct.unpack(
                    "!HHHBBH", raw_bytes[l3_offset + 2 : l3_offset + 12]
                )
                src_ip = socket.inet_ntoa(raw_bytes[l3_offset + 12 : l3_offset + 16])
                dst_ip = socket.inet_ntoa(raw_bytes[l3_offset + 16 : l3_offset + 20])
                network_info = NetworkHeaderInfo(
                    ip_version=ip_ver,
                    source_ip=src_ip,
                    destination_ip=dst_ip,
                    ttl=ttl,
                    header_length=ihl_bytes,
                    total_length=total_len,
                    identification=ident,
                    protocol_number=proto_num,
                )

                if proto_num == 6:
                    protocol = "TCP"
                    l4_offset = l3_offset + ihl_bytes
                    if l4_offset + 20 > caplen:
                        header_truncated = True
                    else:
                        src_port, dst_port, seq_num, ack_num, off_res, flags_raw, win = struct.unpack(
                            "!HHIIBBH", raw_bytes[l4_offset : l4_offset + 16]
                        )
                        tcp_hlen = ((off_res >> 4) & 0x0F) * 4
                        if tcp_hlen < 20:
                            header_truncated = True
                        else:
                            options: List[TcpOption] = []
                            if tcp_hlen > 20:
                                if l4_offset + tcp_hlen > caplen:
                                    header_truncated = True
                                opt_end = min(caplen, l4_offset + tcp_hlen)
                                options = _decode_tcp_options(raw_bytes[l4_offset + 20 : opt_end])

                            flags = TcpFlags(
                                fin=bool(flags_raw & 0x01),
                                syn=bool(flags_raw & 0x02),
                                rst=bool(flags_raw & 0x04),
                                psh=bool(flags_raw & 0x08),
                                ack=bool(flags_raw & 0x10),
                                urg=bool(flags_raw & 0x20),
                                ece=bool(flags_raw & 0x40),
                                cwr=bool(flags_raw & 0x80),
                            )
                            tcp_info = TcpHeaderInfo(
                                source_port=src_port,
                                destination_port=dst_port,
                                sequence_number=seq_num,
                                acknowledgement_number=ack_num,
                                header_length=tcp_hlen,
                                window_size=win,
                                flags_raw=flags_raw,
                                flags=flags,
                                options=options,
                            )
                            transport_info = TransportInfo(
                                source_port=src_port,
                                destination_port=dst_port,
                                tcp=tcp_info,
                            )

                            payload_length = max(0, total_len - ihl_bytes - tcp_hlen)
                            payload_offset = l4_offset + tcp_hlen
                            avail = max(0, min(payload_length, caplen - payload_offset)) if caplen > payload_offset else 0

                            if capture_payload and avail > 0:
                                limit = min(max(1, max_payload_bytes), MAX_PAYLOAD_PREVIEW_BYTES)
                                slice_bytes = raw_bytes[payload_offset : payload_offset + min(avail, limit)]
                                preview_hex = slice_bytes.hex()
                                preview_utf8 = "".join(
                                    chr(b) if 32 <= b <= 126 else "." for b in slice_bytes
                                )
                                payload_info = PacketPayloadInfo(
                                    captured_bytes=len(slice_bytes),
                                    payload_length=payload_length,
                                    preview_hex=preview_hex,
                                    preview_utf8=preview_utf8,
                                    truncated=len(slice_bytes) < payload_length,
                                )
                            else:
                                payload_info = PacketPayloadInfo(
                                    captured_bytes=0,
                                    payload_length=payload_length,
                                    preview_hex=None,
                                    preview_utf8=None,
                                    truncated=payload_length > 0,
                                )
                elif proto_num == 17:
                    protocol = "UDP"
                elif proto_num == 1:
                    protocol = "ICMP"
                else:
                    protocol = f"IP_{proto_num}"

    return PacketRecord(
        schema_version="1.0",
        run_id=run_id,
        sequence=sequence,
        source="packet_capture",
        timestamp=PacketTimestamp(
            pcap_timestamp_ns=pcap_timestamp_ns,
            capture_monotonic_ns=capture_monotonic_ns,
        ),
        interface=interface,
        link_layer=LinkLayerInfo(
            type=dlt_name,
            dlt=dlt,
            source_mac=src_mac,
            destination_mac=dst_mac,
        ),
        protocol=protocol,
        network=network_info,
        transport=transport_info,
        payload=payload_info,
        capture=CaptureLengthInfo(
            captured_length=caplen,
            original_length=original_length,
            truncated=caplen < original_length,
            header_truncated=header_truncated,
        ),
        is_simulated=False,
    )


def read_packets_jsonl(file_path: Union[str, Path]) -> Tuple[List[PacketRecord], int]:
    """
    Reads and strictly validates packet JSONL lines emitted by netbox_pcap.
    Returns (validated_packets, invalid_line_count).
    """
    path = Path(file_path)
    if not path.is_file():
        return [], 0

    packets: List[PacketRecord] = []
    invalid_count = 0

    with open(path, "r", encoding="utf-8") as fh:
        for line_num, raw_line in enumerate(fh, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                pkt = PacketRecord.model_validate(data)
                packets.append(pkt)
            except Exception as err:
                invalid_count += 1
                logger.warning("Invalid packet record at %s:%d: %s", path, line_num, err)

    # Ensure strictly monotonic per-run packet sequence 1..N preserving capture order
    for idx, pkt in enumerate(packets, start=1):
        pkt.sequence = idx

    return packets, invalid_count
