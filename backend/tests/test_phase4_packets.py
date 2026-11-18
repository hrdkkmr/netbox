"""
NetBox Phase 4 — Automated Tests for Packet Capture, Parsing, TCP Analysis,
Correlation, and Live Loopback TCP Integration (Tests 1 through 34).
"""
import os
import socket
import stat
import struct
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.main import (
    create_run,
    get_run_correlations,
    get_run_events,
    get_run_flows,
    get_run_packet_detail,
    get_run_packets,
)
from app.models.events import ConnectionInfo, NetworkEvent, ProcessInfo
from app.models.runs import RunCreateRequest
from app.services.event_correlator import correlate_packets_with_socket_events
from app.services.packet_capture_service import PacketCaptureService, PacketCaptureSession
from app.services.packet_parser import (
    DLT_EN10MB,
    DLT_LINUX_SLL,
    DLT_NULL,
    DLT_RAW,
    parse_raw_packet,
)
from app.services.tcp_analyzer import analyze_packets_and_flows, explain_packet


def build_ipv4_tcp_frame(
    src_ip: str = "127.0.0.1",
    dst_ip: str = "127.0.0.1",
    src_port: int = 50001,
    dst_port: int = 8080,
    seq: int = 1000,
    ack: int = 0,
    flags: int = 0x02,  # SYN
    window: int = 65495,
    payload: bytes = b"",
    tcp_options: bytes = b"",
    dlt: int = DLT_EN10MB,
    ttl: int = 64,
    ip_id: int = 1234,
) -> bytes:
    # Pad TCP options to 4-byte boundary
    if len(tcp_options) % 4 != 0:
        tcp_options += b"\x00" * (4 - (len(tcp_options) % 4))
    tcp_hlen = 20 + len(tcp_options)
    data_offset = (tcp_hlen // 4) << 4
    tcp_hdr = struct.pack(
        "!HHIIBBHHH",
        src_port,
        dst_port,
        seq,
        ack,
        data_offset,
        flags,
        window,
        0,  # checksum
        0,  # urgent pointer
    ) + tcp_options

    ip_total_len = 20 + len(tcp_hdr) + len(payload)
    ip_hdr = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,  # v4, ihl=5
        0,
        ip_total_len,
        ip_id,
        0x4000,  # DF
        ttl,
        6,  # TCP
        0,
        socket.inet_aton(src_ip),
        socket.inet_aton(dst_ip),
    )

    l3_payload = ip_hdr + tcp_hdr + payload

    if dlt == DLT_EN10MB:
        eth = b"\x00\x00\x00\x00\x00\x00" + b"\x00\x00\x00\x00\x00\x00" + struct.pack("!H", 0x0800)
        return eth + l3_payload
    if dlt == DLT_NULL:
        return struct.pack("@I", 2) + l3_payload
    if dlt == DLT_LINUX_SLL:
        sll = b"\x00" * 14 + struct.pack("!H", 0x0800)
        return sll + l3_payload
    if dlt == DLT_RAW:
        return l3_payload
    raise ValueError(f"Unsupported test DLT {dlt}")


class TestCaptureService(unittest.TestCase):
    def test_01_interface_discovery(self):
        ifaces = PacketCaptureService.discover_interfaces()
        self.assertGreater(len(ifaces), 0)
        names = [i.name for i in ifaces]
        self.assertIn("lo", names)

    def test_02_loopback_selection_and_invalid_iface(self):
        iface, err = PacketCaptureService.select_loopback_interface()
        self.assertIsNone(err)
        self.assertEqual(iface, "lo")

        bad_iface, bad_err = PacketCaptureService.select_loopback_interface("nonexistent_net99")
        self.assertIsNone(bad_iface)
        self.assertIn("not found", bad_err)

    def test_03_04_capture_startup_and_clean_shutdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "stub_pcap.sh"
            out_file = Path(tmp) / "packets.jsonl"
            stub.write_text(
                "#!/bin/bash\n"
                "trap 'echo NETBOX_PCAP_STOPPED captured=0; exit 0' INT TERM\n"
                "echo 'NETBOX_PCAP_READY interface=lo dlt=DLT_EN10MB snaplen=160 payload_capture=0'\n"
                "while true; do sleep 0.05; done\n"
            )
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)

            session = PacketCaptureSession(
                run_id="test_run", interface="lo", output_file=out_file, helper_bin=stub
            )
            ok, err = session.start(ready_timeout=2.0)
            self.assertTrue(ok, f"Expected start ok, got error: {err}")
            self.assertEqual(session.status, "CAPTURING")
            self.assertEqual(session.dlt_name, "DLT_EN10MB")

            stop_ok, stop_err = session.stop(graceful_timeout=2.0)
            self.assertTrue(stop_ok, f"Expected clean stop, got: {stop_err}")
            self.assertIsNone(session.proc)

    def test_05_permission_failure_handling(self):
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "perm_denied.sh"
            stub.write_text("#!/bin/bash\necho 'Permission denied' >&2\nexit 13\n")
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)

            session = PacketCaptureSession(
                run_id="test_perm", interface="lo", output_file=Path(tmp) / "p.jsonl", helper_bin=stub
            )
            ok, err = session.start(ready_timeout=2.0)
            self.assertFalse(ok)
            self.assertEqual(session.status, "UNAVAILABLE")
            self.assertIn("permission denied", err.lower())

    def test_06_missing_binary_or_libpcap_handling(self):
        avail = PacketCaptureService.check_availability(helper_bin=Path("/tmp/does_not_exist_netbox_pcap"))
        self.assertFalse(avail.available)
        self.assertEqual(avail.status, "UNAVAILABLE")
        self.assertTrue(avail.reason and len(avail.reason) > 10)

    def test_07_capture_timeout_and_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "hang_pcap.sh"
            stub.write_text("#!/bin/bash\nsleep 30\n")
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)

            session = PacketCaptureSession(
                run_id="test_timeout", interface="lo", output_file=Path(tmp) / "p.jsonl", helper_bin=stub
            )
            ok, err = session.start(ready_timeout=0.4)
            self.assertFalse(ok)
            self.assertEqual(session.status, "FAILED")
            self.assertIn("Timed out", err)
            self.assertIsNone(session.proc)


class TestPacketParsing(unittest.TestCase):
    def test_08_ipv4_and_link_layer_parsing(self):
        for dlt, name in [(DLT_EN10MB, "DLT_EN10MB"), (DLT_NULL, "DLT_NULL"), (DLT_LINUX_SLL, "DLT_LINUX_SLL"), (DLT_RAW, "DLT_RAW")]:
            raw = build_ipv4_tcp_frame(dlt=dlt, ttl=64, ip_id=4321)
            pkt = parse_raw_packet(raw, dlt, len(raw), 1000, 2000, "r1", 1, "lo")
            self.assertEqual(pkt.link_layer.type, name)
            self.assertEqual(pkt.protocol, "TCP")
            self.assertEqual(pkt.network.ip_version, 4)
            self.assertEqual(pkt.network.source_ip, "127.0.0.1")
            self.assertEqual(pkt.network.destination_ip, "127.0.0.1")
            self.assertEqual(pkt.network.ttl, 64)
            self.assertEqual(pkt.network.identification, 4321)

    def test_09_tcp_header_and_options_parsing(self):
        # MSS=65495 (kind 2 len 4), SACK Permitted (kind 4 len 2), WScale=7 (kind 3 len 3)
        opts = struct.pack("!BBH", 2, 4, 65495) + b"\x04\x02" + b"\x03\x03\x07"
        raw = build_ipv4_tcp_frame(src_port=51234, dst_port=8080, seq=9001, ack=42, window=65495, tcp_options=opts)
        pkt = parse_raw_packet(raw, DLT_EN10MB, len(raw), 1000, 2000, "r1", 1, "lo")
        tcp = pkt.transport.tcp
        self.assertEqual(tcp.source_port, 51234)
        self.assertEqual(tcp.destination_port, 8080)
        self.assertEqual(tcp.sequence_number, 9001)
        self.assertEqual(tcp.acknowledgement_number, 42)
        self.assertEqual(tcp.window_size, 65495)
        self.assertEqual(tcp.header_length, 32)
        opt_map = {o.name: o.value for o in tcp.options}
        self.assertEqual(opt_map["MSS"], "65495")
        self.assertEqual(opt_map["SACK_Permitted"], "true")
        self.assertEqual(opt_map["WScale"], "7")

    def test_10_11_12_13_tcp_flags_decoding(self):
        # SYN
        p_syn = parse_raw_packet(build_ipv4_tcp_frame(flags=0x02), DLT_EN10MB, 54, 1, 1, "r", 1)
        self.assertTrue(p_syn.transport.tcp.flags.syn)
        self.assertFalse(p_syn.transport.tcp.flags.ack)
        # SYN+ACK
        p_sa = parse_raw_packet(build_ipv4_tcp_frame(flags=0x12), DLT_EN10MB, 54, 1, 1, "r", 2)
        self.assertTrue(p_sa.transport.tcp.flags.syn and p_sa.transport.tcp.flags.ack)
        # FIN+ACK
        p_fin = parse_raw_packet(build_ipv4_tcp_frame(flags=0x11), DLT_EN10MB, 54, 1, 1, "r", 3)
        self.assertTrue(p_fin.transport.tcp.flags.fin and p_fin.transport.tcp.flags.ack)
        # RST
        p_rst = parse_raw_packet(build_ipv4_tcp_frame(flags=0x04), DLT_EN10MB, 54, 1, 1, "r", 4)
        self.assertTrue(p_rst.transport.tcp.flags.rst)

    def test_14_payload_length_and_privacy_default(self):
        msg = b"SecretPassword123!"
        raw = build_ipv4_tcp_frame(flags=0x18, payload=msg)
        # Default: privacy-preserving (no payload preview stored)
        pkt_default = parse_raw_packet(raw, DLT_EN10MB, len(raw), 1, 1, "r", 1, capture_payload=False)
        self.assertEqual(pkt_default.payload.payload_length, len(msg))
        self.assertEqual(pkt_default.payload.captured_bytes, 0)
        self.assertIsNone(pkt_default.payload.preview_hex)
        self.assertIsNone(pkt_default.payload.preview_utf8)

        # Explicit opt-in: bounded preview
        pkt_optin = parse_raw_packet(raw, DLT_EN10MB, len(raw), 1, 1, "r", 1, capture_payload=True, max_payload_bytes=8)
        self.assertEqual(pkt_optin.payload.captured_bytes, 8)
        self.assertEqual(pkt_optin.payload.preview_utf8, "SecretPa")
        self.assertTrue(pkt_optin.payload.truncated)

    def test_15_truncated_packet_handling(self):
        full = build_ipv4_tcp_frame(payload=b"Hello NetBox")
        truncated = full[:25]  # Cuts into IP/TCP headers
        pkt = parse_raw_packet(truncated, DLT_EN10MB, len(full), 1, 1, "r", 1)
        self.assertTrue(pkt.capture.truncated)
        self.assertTrue(pkt.capture.header_truncated)
        self.assertIsNone(pkt.transport)

    def test_16_unsupported_packet_and_dlt_handling(self):
        # ARP Ethernet frame (EtherType 0x0806)
        arp_frame = b"\xff" * 6 + b"\x11" * 6 + struct.pack("!H", 0x0806) + b"\x00" * 28
        pkt = parse_raw_packet(arp_frame, DLT_EN10MB, len(arp_frame), 1, 1, "r", 1)
        self.assertEqual(pkt.protocol, "ARP")
        self.assertIsNone(pkt.network)
        self.assertIsNone(pkt.transport)

        # Unsupported DLT raises ValueError
        with self.assertRaises(ValueError):
            parse_raw_packet(arp_frame, 9999, len(arp_frame), 1, 1, "r", 1)


class TestTcpAnalysis(unittest.TestCase):
    def test_17_complete_handshake_and_20_bidirectional_flow_and_22_seq_ack(self):
        pkts = [
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50001, dst_port=8080, seq=100, ack=0, flags=0x02), DLT_EN10MB, 54, 1, 1000, "r", 1),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=8080, dst_port=50001, seq=500, ack=101, flags=0x12), DLT_EN10MB, 54, 2, 2000, "r", 2),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50001, dst_port=8080, seq=101, ack=501, flags=0x10), DLT_EN10MB, 54, 3, 3000, "r", 3),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50001, dst_port=8080, seq=101, ack=501, flags=0x18, payload=b"hello"), DLT_EN10MB, 59, 4, 4000, "r", 4),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=8080, dst_port=50001, seq=501, ack=106, flags=0x18, payload=b"hello"), DLT_EN10MB, 59, 5, 5000, "r", 5),
        ]
        flows = analyze_packets_and_flows(pkts)
        self.assertEqual(len(flows), 1)
        f = flows[0]
        self.assertEqual(f.handshake.status, "COMPLETE")
        self.assertEqual(f.client_endpoint, "127.0.0.1:50001")
        self.assertEqual(f.server_endpoint, "127.0.0.1:8080")
        self.assertEqual(f.role_determination, "observed_syn")
        self.assertEqual(f.packet_count, 5)
        self.assertEqual(f.payload_bytes_a_to_b + f.payload_bytes_b_to_a, 10)
        self.assertIn("SYN", f.observed_flags)
        self.assertIn("PSH", f.observed_flags)

        # Deterministic explanation check
        exp = explain_packet(pkts[0])
        self.assertIn("SYN", exp.flags_meaning)
        self.assertIn("Cannot conclude", exp.cannot_conclude)

    def test_18_incomplete_handshake_detection(self):
        # Missing final ACK
        pkts = [
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50002, dst_port=8080, seq=10, ack=0, flags=0x02), DLT_EN10MB, 54, 1, 1000, "r", 1),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=8080, dst_port=50002, seq=20, ack=11, flags=0x12), DLT_EN10MB, 54, 2, 2000, "r", 2),
        ]
        flows = analyze_packets_and_flows(pkts)
        self.assertEqual(flows[0].handshake.status, "INCOMPLETE")
        self.assertIn("ACK", flows[0].handshake.note)

    def test_19_termination_observations(self):
        # Partial FIN (only client sends FIN)
        pkts_partial = [
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50003, dst_port=8080, seq=200, ack=300, flags=0x11), DLT_EN10MB, 54, 1, 1000, "r", 1),
        ]
        self.assertEqual(analyze_packets_and_flows(pkts_partial)[0].termination.status, "PARTIAL_FIN_OBSERVED")

        # Complete bidirectional FIN + ACK
        pkts_full = [
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50003, dst_port=8080, seq=200, ack=300, flags=0x11), DLT_EN10MB, 54, 1, 1000, "r", 1),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=8080, dst_port=50003, seq=300, ack=201, flags=0x11), DLT_EN10MB, 54, 2, 2000, "r", 2),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50003, dst_port=8080, seq=201, ack=301, flags=0x10), DLT_EN10MB, 54, 3, 3000, "r", 3),
        ]
        self.assertEqual(analyze_packets_and_flows(pkts_full)[0].termination.status, "COMPLETE_FIN_EXCHANGE")

        # RST termination
        pkts_rst = [
            parse_raw_packet(build_ipv4_tcp_frame(src_port=8080, dst_port=50003, seq=0, ack=1, flags=0x14), DLT_EN10MB, 54, 1, 1000, "r", 1),
        ]
        self.assertEqual(analyze_packets_and_flows(pkts_rst)[0].termination.status, "RESET_OBSERVED")

    def test_21_retransmission_candidate_detection(self):
        pkts = [
            # Pure ACK repeated should NOT be flagged as retransmission
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50004, dst_port=8080, seq=101, ack=501, flags=0x10), DLT_EN10MB, 54, 1, 1000, "r", 1),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50004, dst_port=8080, seq=101, ack=501, flags=0x10), DLT_EN10MB, 54, 2, 2000, "r", 2),
            # Data segment transmitted once, then repeated with identical seq & payload length
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50004, dst_port=8080, seq=101, ack=501, flags=0x18, payload=b"abcdef"), DLT_EN10MB, 60, 3, 3000, "r", 3),
            parse_raw_packet(build_ipv4_tcp_frame(src_port=50004, dst_port=8080, seq=101, ack=501, flags=0x18, payload=b"abcdef"), DLT_EN10MB, 60, 4, 4000, "r", 4),
        ]
        flows = analyze_packets_and_flows(pkts)
        self.assertEqual(len(flows[0].retransmissions), 1)
        self.assertEqual(flows[0].retransmissions[0].packet_sequence, 4)
        self.assertEqual(flows[0].retransmissions[0].status, "confirmed_retransmission")
        self.assertIsNone(pkts[1].analysis.retransmission_status)


class TestCorrelation(unittest.TestCase):
    def _make_sock_event(self, seq, etype, pid, name, fd, lip, lport, rip, rport, ts_ns):
        return NetworkEvent(
            run_id="run_corr",
            sequence=seq,
            timestamp_ns=ts_ns,
            source="socket_api",
            event_type=etype,
            process=ProcessInfo(pid=pid, name=name),
            connection=ConnectionInfo(local_ip=lip, local_port=lport, remote_ip=rip, remote_port=rport),
            socket_fd=fd,
            result=5 if etype in ("send", "recv") else 0,
            is_simulated=False,
        )

    def test_23_24_25_forward_reverse_and_timestamp_window(self):
        # Forward packet: client(50010) -> server(8080)
        p_fwd = parse_raw_packet(
            build_ipv4_tcp_frame(src_port=50010, dst_port=8080, seq=10, ack=20, flags=0x18, payload=b"hello"),
            DLT_EN10MB, 59, 999999999, 1_001_000_000, "run_corr", 1,
        )
        # Reverse packet: server(8080) -> client(50010)
        p_rev = parse_raw_packet(
            build_ipv4_tcp_frame(src_port=8080, dst_port=50010, seq=20, ack=15, flags=0x18, payload=b"hello"),
            DLT_EN10MB, 59, 999999999, 1_002_000_000, "run_corr", 2,
        )
        # Out-of-window packet (10 seconds later)
        p_late = parse_raw_packet(
            build_ipv4_tcp_frame(src_port=50010, dst_port=8080, seq=15, ack=25, flags=0x10),
            DLT_EN10MB, 54, 999999999, 11_000_000_000, "run_corr", 3,
        )
        pkts = [p_fwd, p_rev, p_late]
        flows = analyze_packets_and_flows(pkts)

        sock_events = [
            self._make_sock_event(1, "send", 2001, "client", 3, "127.0.0.1", 50010, "127.0.0.1", 8080, 1_000_500_000),
            self._make_sock_event(2, "recv", 2000, "server", 4, "127.0.0.1", 8080, "127.0.0.1", 50010, 1_001_200_000),
            self._make_sock_event(3, "send", 2000, "server", 4, "127.0.0.1", 8080, "127.0.0.1", 50010, 1_001_800_000),
        ]

        corrs = correlate_packets_with_socket_events(pkts, sock_events, flows)
        self.assertEqual(corrs[0].confidence, "high")
        self.assertIn(1, corrs[0].related_socket_event_sequences)
        self.assertEqual(corrs[1].confidence, "high")
        self.assertIn(3, corrs[1].related_socket_event_sequences)
        self.assertEqual(corrs[2].confidence, "low")  # Outside monotonic window

    def test_26_27_ambiguous_and_unresolved_handling(self):
        p_ambig = parse_raw_packet(
            build_ipv4_tcp_frame(src_port=50020, dst_port=8080, flags=0x18, payload=b"hi"),
            DLT_EN10MB, 56, 1, 1_000_000, "run_corr", 1,
        )
        p_unmatched = parse_raw_packet(
            build_ipv4_tcp_frame(src_port=59999, dst_port=9999, flags=0x02),
            DLT_EN10MB, 54, 2, 2_000_000, "run_corr", 2,
        )
        # Three distinct (pid, fd) claiming the exact same 4-tuple -> ambiguous
        sock_events = [
            self._make_sock_event(1, "send", 3001, "procA", 3, "127.0.0.1", 50020, "127.0.0.1", 8080, 1_000_000),
            self._make_sock_event(2, "recv", 3002, "procB", 4, "127.0.0.1", 8080, "127.0.0.1", 50020, 1_000_100),
            self._make_sock_event(3, "send", 3003, "procC", 5, "127.0.0.1", 50020, "127.0.0.1", 8080, 1_000_200),
        ]
        corrs = correlate_packets_with_socket_events([p_ambig, p_unmatched], sock_events)
        self.assertEqual(corrs[0].confidence, "unresolved")
        self.assertIn("Ambiguous", corrs[0].reason)
        self.assertEqual(corrs[1].confidence, "unresolved")
        self.assertIn("No observed", corrs[1].reason)


class TestLiveIntegration(unittest.TestCase):
    def test_28_through_34_live_tcp_capture_and_api_endpoints(self):
        avail = PacketCaptureService.check_availability()

        run_res = create_run(
            RunCreateRequest(
                example_id="tcp-echo",
                client_args=["Phase 4 live packet capture!"],
                capture_packets=True,
                enable_payload_preview=False,
            )
        )
        run_id = run_res.run_id

        # Test 33: Phase 2 socket API events MUST always remain available even if pcap is unavailable
        self.assertEqual(run_res.socket_capture_status, "COMPLETED")
        ev_res = get_run_events(run_id)
        self.assertGreaterEqual(ev_res.event_count, 12)

        pkt_res = get_run_packets(run_id)
        flow_res = get_run_flows(run_id)
        corr_res = get_run_correlations(run_id)

        if not avail.available:
            # Verify honest UNAVAILABLE reporting when libpcap/setcap not yet configured
            self.assertEqual(run_res.packet_capture_status, "UNAVAILABLE")
            self.assertEqual(run_res.packet_count, 0)
            self.assertTrue(run_res.packet_capture_error)
            self.assertEqual(pkt_res.packet_capture_status, "UNAVAILABLE")
            self.skipTest(
                f"Live packet capture not yet enabled on host ({avail.reason}); "
                "graceful UNAVAILABLE fallback verified."
            )

        # Full live verification assertions (Tests 28-34)
        self.assertEqual(run_res.packet_capture_status, "COMPLETED", run_res.packet_capture_error)
        self.assertEqual(run_res.packet_capture_interface, "lo")
        self.assertGreater(run_res.packet_count, 0)

        self.assertFalse(pkt_res.is_simulated)
        self.assertEqual(pkt_res.packet_capture_status, "COMPLETED")
        packets = pkt_res.packets

        # Test 30: Verify real SYN, SYN+ACK, ACK observed
        flows = flow_res.flows
        self.assertGreaterEqual(len(flows), 1)
        self.assertEqual(flows[0].handshake.status, "COMPLETE")

        # Test 31: Verify data-bearing packets captured & privacy default enforced
        data_pkts = [p for p in packets if p.payload.payload_length > 0]
        self.assertGreaterEqual(len(data_pkts), 2)
        for dp in data_pkts:
            self.assertEqual(dp.payload.captured_bytes, 0)
            self.assertIsNone(dp.payload.preview_utf8)

        # Test 32: Verify termination packets observed
        self.assertIn(
            flows[0].termination.status,
            ("COMPLETE_FIN_EXCHANGE", "PARTIAL_FIN_OBSERVED", "RESET_OBSERVED"),
        )

        # Test 34: Verify single packet detail & correlations
        single = get_run_packet_detail(run_id, 1)
        self.assertEqual(single.sequence, 1)
        self.assertGreater(corr_res.resolved_count, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
