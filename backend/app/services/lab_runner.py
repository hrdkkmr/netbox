"""
NetBox Phase 7 — Controlled, Safe Lab Experiment Runner.
Executes allowlisted localhost-only networking experiments (TCP scenarios, C POSIX UDP,
offline RFC 1035 DNS, local HTTP, read-only L2/L3/routing inspection, and measured
throughput monitoring) integrated with RunManager, LD_PRELOAD, and libpcap.
"""

import datetime
import json
import logging
import os
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..models.runs import ProcessExecutionSummary
from .event_correlator import correlate_packets_with_socket_events
from .event_reader import EventReader
from .network_discovery import discover_default_gateway, discover_linux_interfaces
from .packet_capture_service import PacketCaptureService, PacketCaptureSession
from .packet_parser import read_packets_jsonl
from .process_runner import EXAMPLES_DIR, REPO_ROOT, TRACE_SO
from .run_manager import RUNS_BASE_DIR, RunManager, RunRecord
from .tcp_analyzer import analyze_packets_and_flows

logger = logging.getLogger("netbox.lab_runner")

PYTHON_BIN = sys.executable


def _pick_free_port(sock_type: int = socket.SOCK_STREAM) -> int:
    with socket.socket(socket.AF_INET, sock_type) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _ensure_udp_binaries() -> Tuple[Path, Path]:
    srv = EXAMPLES_DIR / "udp" / "udp_server"
    cli = EXAMPLES_DIR / "udp" / "udp_client"
    if not srv.is_file() or not cli.is_file() or not TRACE_SO.is_file():
        build = subprocess.run(
            ["make", "all"],
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
        if build.returncode != 0:
            raise RuntimeError(f"Failed to build NetBox C binaries: {build.stderr}")
    return srv, cli


def _create_managed_record(example_id: str) -> Tuple[RunRecord, Path]:
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    run_id = f"run_{now_dt.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    record = RunRecord(
        run_id=run_id,
        example_id=example_id,
        created_at=now_dt.isoformat(),
        status="running",
        payload_capture_enabled=False,
    )
    record.start_time = now_dt.isoformat()
    RunManager.get_instance()._runs[run_id] = record
    run_dir = RUNS_BASE_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return record, run_dir


def _start_loopback_pcap(record: RunRecord, run_dir: Path, bpf_filter: str) -> Optional[PacketCaptureSession]:
    iface, iface_err = PacketCaptureService.select_loopback_interface()
    if iface_err or not iface:
        record.packet_capture_status = "UNAVAILABLE"
        record.packet_capture_error = iface_err
        return None
    record.packet_capture_interface = iface
    avail = PacketCaptureService.check_availability()
    if not avail.available:
        record.packet_capture_status = "UNAVAILABLE"
        record.packet_capture_error = avail.reason
        return None

    session = PacketCaptureSession(
        run_id=record.run_id,
        interface=iface,
        output_file=run_dir / "packets.jsonl",
        bpf_filter=bpf_filter,
        capture_payload=False,
    )
    record.active_capture_session = session
    ok, err = session.start(ready_timeout=3.0)
    if ok:
        record.packet_capture_status = "CAPTURING"
        return session
    record.packet_capture_status = session.status
    record.packet_capture_error = err
    record.active_capture_session = None
    return None


def _finish_loopback_pcap(
    record: RunRecord,
    run_dir: Path,
    session: Optional[PacketCaptureSession],
    analyze_tcp: bool = True,
) -> None:
    if session is None:
        return
    time.sleep(0.15)
    stop_ok, stop_err = session.stop(graceful_timeout=2.0)
    record.active_capture_session = None
    if not stop_ok:
        record.packet_capture_status = "FAILED"
        record.packet_capture_error = stop_err
        return

    packets, _invalid = read_packets_jsonl(run_dir / "packets.jsonl")
    record.packets = packets
    if not packets:
        record.packet_capture_status = "FAILED"
        record.packet_capture_error = "Capture finished cleanly, but 0 matching packets were observed."
        return

    if analyze_tcp:
        tcp_packets = [p for p in packets if p.protocol == "TCP"]
        if tcp_packets:
            record.flows = analyze_packets_and_flows(tcp_packets, record.events)
            record.correlations = correlate_packets_with_socket_events(tcp_packets, record.events, record.flows)
    record.packet_capture_status = "COMPLETED"


def _trace_env(run_id: str, proc_name: str, event_file: Path) -> Dict[str, str]:
    env = os.environ.copy()
    if TRACE_SO.is_file():
        env["LD_PRELOAD"] = str(TRACE_SO)
        env["NETBOX_RUN_ID"] = run_id
        env["NETBOX_PROCESS_NAME"] = proc_name
        env["NETBOX_EVENT_FILE"] = str(event_file)
    return env


def _finalize_record(record: RunRecord, t0: float, event_files: List[Path], exit_code: int = 0) -> None:
    existing_files = [f for f in event_files if f.is_file()]
    if existing_files:
        record.events = EventReader.merge_and_sort_events(existing_files)
        record.socket_capture_status = "COMPLETED" if record.events else "UNAVAILABLE"
    else:
        record.socket_capture_status = "NOT_REQUESTED"
    record.exit_code = exit_code
    record.status = "completed" if exit_code == 0 else "failed"
    record.end_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record.duration_ms = round((time.monotonic() - t0) * 1000.0, 2)


# ===================== TCP Advanced Scenarios (Module 4 & 9) =====================

def run_tcp_scenario(scenario_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    params = params or {}
    if scenario_id == "tcp-echo":
        msg = str(params.get("message") or "Hello NetBox TCP Lab!")
        run_res = RunManager.get_instance().create_run(
            example_id="tcp-echo",
            client_args=[msg],
            capture_packets=True,
        )
        rec = RunManager.get_instance()._runs[run_res.run_id]
        obs = [
            f"Captured {len(rec.events)} real LD_PRELOAD socket_api events and {len(rec.packets)} wire packets.",
            f"Detected {len(rec.flows)} bidirectional TCP flow(s)."
            + (f" Handshake: {rec.flows[0].handshake.status}, Termination: {rec.flows[0].termination.status}." if rec.flows else ""),
        ]
        return {
            "status": run_res.status,
            "run_id": run_res.run_id,
            "protocol": "TCP",
            "summary": f"Completed live TCP echo run ({len(rec.events)} socket events, {len(rec.packets)} packets).",
            "socket_event_count": len(rec.events),
            "packet_count": len(rec.packets),
            "packet_capture_status": rec.packet_capture_status,
            "actual_observations": obs,
            "warnings": [rec.packet_capture_error] if rec.packet_capture_error else [],
            "measured_metrics": {"duration_ms": rec.duration_ms, "flows": len(rec.flows)},
            "raw_observations": {},
        }

    port = _pick_free_port(socket.SOCK_STREAM)
    record, run_dir = _create_managed_record(scenario_id)
    t0 = time.monotonic()
    session = _start_loopback_pcap(record, run_dir, f"tcp and port {port}")
    event_files: List[Path] = []
    warnings: List[str] = []
    metrics: Dict[str, Any] = {"port": port}
    observations: List[str] = []

    try:
        if scenario_id == "tcp-conn-refused":
            cli_ev = run_dir / "events_client.jsonl"
            event_files.append(cli_ev)
            code = (
                "import socket, sys\n"
                "s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
                f"rc = s.connect_ex(('127.0.0.1', {port}))\n"
                "print(f'connect_ex_errno={rc}')\n"
                "s.close()\n"
            )
            proc = subprocess.run(
                [PYTHON_BIN, "-c", code],
                env=_trace_env(record.run_id, "tcp_client", cli_ev),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=6.0,
            )
            record.processes = [
                ProcessExecutionSummary(
                    pid=None, name="tcp_client", exit_code=proc.returncode, stdout=proc.stdout, stderr=proc.stderr
                )
            ]
            _finish_loopback_pcap(record, run_dir, session, analyze_tcp=True)
            _finalize_record(record, t0, event_files, exit_code=0)
            rst_count = sum(1 for p in record.packets if p.analysis and "RST" in p.analysis.flags_list)
            observations = [
                f"Client attempted connect() to unbound localhost port 127.0.0.1:{port}.",
                f"Socket output: {proc.stdout.strip() or 'ECONNREFUSED'} ({len(record.events)} socket events).",
                f"Captured {len(record.packets)} TCP packets including {rst_count} RST segment(s).",
            ]
            metrics.update({"rst_packets": rst_count, "duration_ms": record.duration_ms})

        elif scenario_id in ("tcp-multi-transfer", "tcp-abrupt-rst", "tcp-multi-flow", "net-monitor-transfer"):
            srv_ev = run_dir / "events_server.jsonl"
            cli_ev = run_dir / "events_client.jsonl"
            event_files.extend([srv_ev, cli_ev])

            if scenario_id == "tcp-multi-flow":
                expected_clients = 2
            else:
                expected_clients = 1

            srv_code = f"""
import socket, threading
srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', {port}))
srv.listen(8)
srv.settimeout(4.0)
print('READY', flush=True)
def handle(conn):
    try:
        while True:
            data = conn.recv(8192)
            if not data:
                break
            conn.sendall(data)
    except Exception:
        pass
    finally:
        conn.close()
threads = []
for _ in range({expected_clients}):
    try:
        c, _ = srv.accept()
        t = threading.Thread(target=handle, args=(c,), daemon=True)
        t.start()
        threads.append(t)
    except socket.timeout:
        break
for t in threads:
    t.join(timeout=4.0)
srv.close()
"""
            srv_proc = subprocess.Popen(
                [PYTHON_BIN, "-c", srv_code],
                env=_trace_env(record.run_id, "server", srv_ev),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            ready_line = srv_proc.stdout.readline() if srv_proc.stdout else ""
            if "READY" not in ready_line:
                srv_proc.kill()
                raise RuntimeError("TCP scenario server failed to bind and listen.")

            if scenario_id == "tcp-multi-transfer":
                cli_code = f"""
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', {port}))
for i in range(1, 5):
    msg = f'Chunk-{{i}}: NetBox TCP sequence progression test'.encode()
    s.sendall(msg)
    echo = s.recv(4096)
    print(f'chunk {{i}} echoed {{len(echo)}}B')
    time.sleep(0.02)
s.close()
"""
            elif scenario_id == "tcp-abrupt-rst":
                cli_code = f"""
import socket, struct
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', {port}))
s.sendall(b'Before abrupt RST termination')
s.recv(1024)
# SO_LINGER with l_onoff=1, l_linger=0 forces immediate TCP RST on close()
s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
s.close()
print('closed_with_rst')
"""
            elif scenario_id == "tcp-multi-flow":
                cli_code = f"""
import socket, threading
def worker(idx):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(('127.0.0.1', {port}))
    payload = f'Concurrent flow {{idx}} data payload'.encode()
    s.sendall(payload)
    s.recv(1024)
    s.close()
t1 = threading.Thread(target=worker, args=(1,))
t2 = threading.Thread(target=worker, args=(2,))
t1.start(); t2.start()
t1.join(); t2.join()
print('two_flows_done')
"""
            else:  # net-monitor-transfer
                chunks = min(64, max(4, int(params.get("chunks", 16))))
                chunk_bytes = min(16384, max(256, int(params.get("chunk_bytes", 4096))))
                cli_code = f"""
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', {port}))
block = b'N' * {chunk_bytes}
total = 0
for _ in range({chunks}):
    s.sendall(block)
    recvd = 0
    while recvd < {chunk_bytes}:
        d = s.recv({chunk_bytes} - recvd)
        if not d:
            break
        recvd += len(d)
    total += recvd
s.close()
print(f'transferred_echo_bytes={{total}}')
"""

            cli_proc = subprocess.run(
                [PYTHON_BIN, "-c", cli_code],
                env=_trace_env(record.run_id, "client", cli_ev),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=8.0,
            )
            s_out, s_err = srv_proc.communicate(timeout=4.0)
            record.processes = [
                ProcessExecutionSummary(pid=srv_proc.pid, name="server", exit_code=srv_proc.returncode, stdout=s_out, stderr=s_err),
                ProcessExecutionSummary(pid=None, name="client", exit_code=cli_proc.returncode, stdout=cli_proc.stdout, stderr=cli_proc.stderr),
            ]
            _finish_loopback_pcap(record, run_dir, session, analyze_tcp=True)
            _finalize_record(record, t0, event_files, exit_code=0 if cli_proc.returncode == 0 else cli_proc.returncode)

            # Compute genuine measured monitoring metrics
            wire_bytes = sum(p.capture.original_length for p in record.packets)
            payload_bytes = sum(p.payload.payload_length for p in record.packets)
            if len(record.packets) >= 2:
                monos = [p.timestamp.capture_monotonic_ns for p in record.packets]
                span_s = max((monos[-1] - monos[0]) / 1e9, 1e-6)
                deltas_ms = [(monos[i] - monos[i - 1]) / 1e6 for i in range(1, len(monos))]
                min_delta_ms = round(min(deltas_ms), 3)
                avg_delta_ms = round(sum(deltas_ms) / len(deltas_ms), 3)
                max_delta_ms = round(max(deltas_ms), 3)
                wire_kbps = round((wire_bytes / 1024.0) / span_s, 1)
                goodput_kbps = round((payload_bytes / 1024.0) / span_s, 1)
                goodput_mbps = round((payload_bytes * 8.0 / 1e6) / span_s, 2)
            else:
                min_delta_ms = avg_delta_ms = max_delta_ms = 0.0
                wire_kbps = goodput_kbps = goodput_mbps = 0.0

            rst_count = sum(1 for p in record.packets if p.analysis and "RST" in p.analysis.flags_list)
            metrics.update(
                {
                    "duration_ms": record.duration_ms,
                    "flow_count": len(record.flows),
                    "wire_bytes": wire_bytes,
                    "payload_bytes": payload_bytes,
                    "wire_throughput_kbps": wire_kbps,
                    "application_goodput_kbps": goodput_kbps,
                    "application_goodput_mbps": goodput_mbps,
                    "inter_packet_min_ms": min_delta_ms,
                    "inter_packet_avg_ms": avg_delta_ms,
                    "inter_packet_max_ms": max_delta_ms,
                    "rst_packets": rst_count,
                }
            )
            observations = [
                f"Captured {len(record.events)} socket_api events and {len(record.packets)} real TCP packets across {len(record.flows)} flow(s).",
                f"Measured wire bytes: {wire_bytes} B | Application payload bytes: {payload_bytes} B.",
            ]
            if scenario_id == "tcp-abrupt-rst":
                observations.append(f"Observed {rst_count} real TCP RST packet(s) from SO_LINGER abrupt close.")
            if scenario_id == "net-monitor-transfer":
                observations.append(
                    f"Measured goodput: {goodput_kbps} KB/s ({goodput_mbps} Mbps); inter-packet delta avg={avg_delta_ms} ms (min={min_delta_ms} ms, max={max_delta_ms} ms)."
                )
        else:
            raise ValueError(f"Unsupported TCP scenario: {scenario_id}")
    except Exception as err:
        _finish_loopback_pcap(record, run_dir, session, analyze_tcp=True)
        record.error = str(err)
        _finalize_record(record, t0, event_files, exit_code=1)
        raise

    if record.packet_capture_error:
        warnings.append(record.packet_capture_error)

    return {
        "status": record.status,
        "run_id": record.run_id,
        "protocol": "TCP",
        "summary": f"Scenario '{scenario_id}' completed ({len(record.events)} socket events, {len(record.packets)} TCP packets).",
        "socket_event_count": len(record.events),
        "packet_count": len(record.packets),
        "packet_capture_status": record.packet_capture_status,
        "actual_observations": observations,
        "warnings": warnings,
        "measured_metrics": metrics,
        "raw_observations": {"flows": [f.model_dump() for f in record.flows]},
    }


# ===================== C POSIX UDP Scenarios (Module 5) =====================

def run_udp_scenario(scenario_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    params = params or {}
    srv_bin, cli_bin = _ensure_udp_binaries()
    port = _pick_free_port(socket.SOCK_DGRAM)
    record, run_dir = _create_managed_record(scenario_id)
    t0 = time.monotonic()
    session = _start_loopback_pcap(record, run_dir, f"udp and port {port}")

    srv_ev = run_dir / "events_udp_server.jsonl"
    cli_ev = run_dir / "events_udp_client.jsonl"
    event_files: List[Path] = [cli_ev]
    srv_proc: Optional[subprocess.Popen] = None
    warnings: List[str] = []

    if scenario_id == "udp-multi-datagram":
        messages = [
            "5BYTE",
            "Second UDP datagram (28B!)",
            "D3:" + ("A" * 61),
            "D4:" + ("B" * 125),
        ]
    elif scenario_id == "udp-unavailable":
        messages = ["UDP datagram to unbound port"]
    else:
        raw_msgs = params.get("messages")
        if isinstance(raw_msgs, list) and raw_msgs:
            messages = [str(m)[:512] for m in raw_msgs[:8]]
        else:
            messages = ["Hello NetBox UDP Datagram!"]

    try:
        if scenario_id != "udp-unavailable":
            event_files.insert(0, srv_ev)
            srv_proc = subprocess.Popen(
                [str(srv_bin), str(port), str(len(messages))],
                env=_trace_env(record.run_id, "udp_server", srv_ev),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            ready = srv_proc.stdout.readline() if srv_proc.stdout else ""
            if "UDP Listening" not in ready:
                srv_proc.kill()
                raise RuntimeError("C UDP echo server failed to start.")

        cli_proc = subprocess.run(
            [str(cli_bin), str(port), *messages],
            env=_trace_env(record.run_id, "udp_client", cli_ev),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=6.0,
        )

        procs: List[ProcessExecutionSummary] = []
        if srv_proc is not None:
            try:
                s_out, s_err = srv_proc.communicate(timeout=2.5)
            except subprocess.TimeoutExpired:
                srv_proc.send_signal(signal.SIGINT)
                s_out, s_err = srv_proc.communicate(timeout=2.0)
            procs.append(
                ProcessExecutionSummary(
                    pid=srv_proc.pid, name="udp_server", exit_code=srv_proc.returncode, stdout=s_out, stderr=s_err
                )
            )
        procs.append(
            ProcessExecutionSummary(
                pid=None, name="udp_client", exit_code=cli_proc.returncode, stdout=cli_proc.stdout, stderr=cli_proc.stderr
            )
        )
        record.processes = procs

        _finish_loopback_pcap(record, run_dir, session, analyze_tcp=False)
        # In udp-unavailable, exit code 2 (timeout waiting for reply) is the expected educational observation
        expected_ok = (cli_proc.returncode == 0) or (scenario_id == "udp-unavailable" and cli_proc.returncode == 2)
        _finalize_record(record, t0, event_files, exit_code=0 if expected_ok else cli_proc.returncode)

        sendto_events = [e for e in record.events if e.event_type == "sendto"]
        recvfrom_events = [e for e in record.events if e.event_type == "recvfrom"]
        udp_packets = [p for p in record.packets if p.protocol == "UDP"]
        observations = [
            f"C POSIX UDP execution on 127.0.0.1:{port}: {len(messages)} datagram(s) sent.",
            f"Socket calls observed: {len(sendto_events)} sendto(), {len(recvfrom_events)} recvfrom(), 0 listen()/accept().",
            f"Wire packets captured: {len(udp_packets)} UDP datagram packet(s) (total captured: {len(record.packets)}).",
        ]
        if scenario_id == "udp-unavailable":
            observations.append(
                "UDP sendto() succeeded immediately despite no server listener; client recvfrom() timed out as expected for connectionless UDP."
            )
        if record.packet_capture_error:
            warnings.append(record.packet_capture_error)

        return {
            "status": record.status,
            "run_id": record.run_id,
            "protocol": "UDP",
            "summary": f"UDP scenario '{scenario_id}' finished ({len(record.events)} socket events, {len(udp_packets)} UDP packets).",
            "socket_event_count": len(record.events),
            "packet_count": len(record.packets),
            "packet_capture_status": record.packet_capture_status,
            "actual_observations": observations,
            "warnings": warnings,
            "measured_metrics": {
                "port": port,
                "datagrams_sent": len(messages),
                "datagram_sizes": [len(m.encode("utf-8")) for m in messages],
                "sendto_calls": len(sendto_events),
                "recvfrom_calls": len(recvfrom_events),
                "udp_packets_captured": len(udp_packets),
                "duration_ms": record.duration_ms,
            },
            "raw_observations": {"client_stdout": cli_proc.stdout.strip(), "client_stderr": cli_proc.stderr.strip()},
        }
    except Exception:
        if srv_proc is not None and srv_proc.poll() is None:
            srv_proc.kill()
        _finish_loopback_pcap(record, run_dir, session, analyze_tcp=False)
        raise


# ===================== Offline RFC 1035 DNS Lab (Module 6) =====================

def _encode_dns_name(domain: str) -> bytes:
    out = bytearray()
    for label in domain.strip(".").split("."):
        b = label.encode("ascii", errors="ignore")[:63]
        out.append(len(b))
        out.extend(b)
    out.append(0)
    return bytes(out)


def _build_dns_query(txid: int, domain: str) -> bytes:
    header = struct.pack("!HHHHHH", txid, 0x0100, 1, 0, 0, 0)  # RD=1, QDCOUNT=1
    question = _encode_dns_name(domain) + struct.pack("!HH", 1, 1)  # Type A, Class IN
    return header + question


def _build_dns_response(query: bytes, answer_ip: str = "192.0.2.42", ttl: int = 120) -> bytes:
    txid = struct.unpack("!H", query[:2])[0]
    question = query[12:]
    header = struct.pack("!HHHHHH", txid, 0x8180, 1, 1, 0, 0)  # QR=1, RD=1, RA=1, ANCOUNT=1
    # Pointer to name at offset 12 (0xC00C), Type A, Class IN, TTL, RDLENGTH=4, IPv4
    rdata = socket.inet_aton(answer_ip)
    answer = struct.pack("!HHHLH", 0xC00C, 1, 1, ttl, 4) + rdata
    return header + question + answer


def run_dns_scenario(params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    params = params or {}
    domain = str(params.get("domain") or "lab.netbox.local").strip()
    if not domain or len(domain) > 120:
        domain = "lab.netbox.local"

    port = _pick_free_port(socket.SOCK_DGRAM)
    record, run_dir = _create_managed_record("dns-local")
    t0 = time.monotonic()
    session = _start_loopback_pcap(record, run_dir, f"udp and port {port}")

    cache: Dict[str, str] = {}
    stop_flag = threading.Event()
    srv_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    srv_sock.bind(("127.0.0.1", port))
    srv_sock.settimeout(0.2)

    def dns_responder():
        while not stop_flag.is_set():
            try:
                data, peer = srv_sock.recvfrom(512)
            except socket.timeout:
                continue
            except OSError:
                break
            if domain not in cache:
                # Simulated upstream recursive lookup latency on cache miss
                time.sleep(0.025)
                cache[domain] = "192.0.2.42"
            resp = _build_dns_response(data, answer_ip=cache[domain], ttl=120)
            srv_sock.sendto(resp, peer)

    srv_thread = threading.Thread(target=dns_responder, daemon=True)
    srv_thread.start()

    try:
        cli_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        cli_sock.settimeout(2.0)

        # Query 1: Uncached
        q1_tx = 0x1A2B
        t_q1 = time.monotonic()
        cli_sock.sendto(_build_dns_query(q1_tx, domain), ("127.0.0.1", port))
        r1, _ = cli_sock.recvfrom(512)
        uncached_ms = round((time.monotonic() - t_q1) * 1000.0, 2)

        # Query 2: Cached
        q2_tx = 0x1A2C
        t_q2 = time.monotonic()
        cli_sock.sendto(_build_dns_query(q2_tx, domain), ("127.0.0.1", port))
        r2, _ = cli_sock.recvfrom(512)
        cached_ms = round((time.monotonic() - t_q2) * 1000.0, 2)
        cli_sock.close()
    finally:
        stop_flag.set()
        srv_thread.join(timeout=2.0)
        srv_sock.close()

    _finish_loopback_pcap(record, run_dir, session, analyze_tcp=False)
    _finalize_record(record, t0, [], exit_code=0)

    resolved_ip = socket.inet_ntoa(r1[-4:]) if len(r1) >= 4 else "unknown"
    udp_pkts = [p for p in record.packets if p.protocol == "UDP"]
    observations = [
        f"Sent 2 real RFC 1035 binary DNS A-record queries for '{domain}' to 127.0.0.1:{port} (offline-safe).",
        f"Received A record answer: {resolved_ip} (TTL=120s, TXIDs 0x{q1_tx:04x} & 0x{q2_tx:04x}).",
        f"Measured resolution latency: uncached={uncached_ms} ms vs. cached={cached_ms} ms.",
        f"Captured {len(udp_pkts)} real UDP DNS wire packet(s) on loopback.",
    ]
    warnings = [record.packet_capture_error] if record.packet_capture_error else []

    return {
        "status": "completed",
        "run_id": record.run_id,
        "protocol": "DNS/UDP",
        "summary": f"Offline RFC 1035 DNS lookup for '{domain}' -> {resolved_ip} (uncached {uncached_ms}ms vs cached {cached_ms}ms).",
        "socket_event_count": len(record.events),
        "packet_count": len(record.packets),
        "packet_capture_status": record.packet_capture_status,
        "actual_observations": observations,
        "warnings": warnings,
        "measured_metrics": {
            "domain": domain,
            "record_type": "A",
            "resolved_ip": resolved_ip,
            "ttl_seconds": 120,
            "uncached_ms": uncached_ms,
            "cached_ms": cached_ms,
            "udp_packets_captured": len(udp_pkts),
        },
        "raw_observations": {"port": port, "txids": [f"0x{q1_tx:04x}", f"0x{q2_tx:04x}"]},
    }


# ===================== Local HTTP Lab (Module 7) =====================

def run_http_scenario(scenario_id: str = "http-local") -> Dict[str, Any]:
    port = _pick_free_port(socket.SOCK_STREAM)
    record, run_dir = _create_managed_record(scenario_id)
    t0 = time.monotonic()
    session = _start_loopback_pcap(record, run_dir, f"tcp and port {port}")

    class LabHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def do_GET(self):
            if self.path == "/":
                body = json.dumps({"lab": "netbox-http", "status": "ok"}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-NetBox-Lab", "Module-7-HTTP")
                self.end_headers()
                self.wfile.write(body)
            else:
                body = b"Resource not found on NetBox HTTP lab server"
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(min(length, 4096))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    httpd = HTTPServer(("127.0.0.1", port), LabHandler)
    srv_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    srv_thread.start()

    exchanges: List[Dict[str, Any]] = []
    try:
        if scenario_id == "http-404":
            url_target = f"http://127.0.0.1:{port}/does-not-exist"
            try:
                urllib.request.urlopen(url_target, timeout=3.0)
            except urllib.error.HTTPError as err:
                body_len = len(err.read())
                headers_dict = dict(err.headers.items())
                err.close()
                exchanges.append(
                    {
                        "method": "GET",
                        "path": "/does-not-exist",
                        "status_code": err.code,
                        "reason": err.reason,
                        "headers": headers_dict,
                        "body_bytes": body_len,
                    }
                )
        else:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3.0) as resp:
                body = resp.read()
                exchanges.append(
                    {
                        "method": "GET",
                        "path": "/",
                        "status_code": resp.status,
                        "reason": resp.reason,
                        "headers": dict(resp.headers.items()),
                        "body_bytes": len(body),
                    }
                )
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/echo",
                data=b"NetBox HTTP POST body",
                headers={"Content-Type": "text/plain"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                body = resp.read()
                exchanges.append(
                    {
                        "method": "POST",
                        "path": "/echo",
                        "status_code": resp.status,
                        "reason": resp.reason,
                        "headers": dict(resp.headers.items()),
                        "body_bytes": len(body),
                    }
                )
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv_thread.join(timeout=2.0)

    _finish_loopback_pcap(record, run_dir, session, analyze_tcp=True)
    _finalize_record(record, t0, [], exit_code=0)

    observations = [
        f"Executed {len(exchanges)} real HTTP/1.1 request(s) against ephemeral server 127.0.0.1:{port}.",
    ]
    for ex in exchanges:
        observations.append(
            f"HTTP {ex['method']} {ex['path']} -> {ex['status_code']} {ex['reason']} ({ex['body_bytes']}B body)."
        )
    observations.append(
        f"Captured {len(record.packets)} real underlying TCP wire packets across {len(record.flows)} TCP flow(s)."
    )
    observations.append(
        "TLS/HTTPS note: ordinary packet capture sees plaintext TCP headers and packet sizes, never decrypted HTTPS application payloads."
    )

    warnings = [record.packet_capture_error] if record.packet_capture_error else []
    return {
        "status": "completed",
        "run_id": record.run_id,
        "protocol": "HTTP/TCP",
        "summary": f"HTTP lab '{scenario_id}' completed ({len(exchanges)} HTTP exchange(s), {len(record.packets)} TCP packets).",
        "socket_event_count": len(record.events),
        "packet_count": len(record.packets),
        "packet_capture_status": record.packet_capture_status,
        "actual_observations": observations,
        "warnings": warnings,
        "measured_metrics": {
            "port": port,
            "exchanges": len(exchanges),
            "status_codes": [e["status_code"] for e in exchanges],
            "tcp_packets": len(record.packets),
            "tcp_flows": len(record.flows),
            "duration_ms": record.duration_ms,
        },
        "raw_observations": {"http_exchanges": exchanges},
    }


# ===================== Read-Only L2 (MAC/ARP) & L3 (IP/Routing/ICMP) Inspections =====================

def run_l2_inspection() -> Dict[str, Any]:
    links = []
    neighbors = []
    warnings: List[str] = []

    try:
        p_link = subprocess.run(["ip", "-j", "link"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3.0)
        if p_link.returncode == 0 and p_link.stdout.strip():
            for item in json.loads(p_link.stdout):
                links.append(
                    {
                        "name": item.get("ifname"),
                        "link_type": item.get("link_type"),
                        "mac": item.get("address"),
                        "broadcast": item.get("broadcast"),
                        "mtu": item.get("mtu"),
                        "state": item.get("operstate"),
                    }
                )
    except Exception as err:
        warnings.append(f"Could not read `ip -j link`: {err}")

    try:
        p_neigh = subprocess.run(["ip", "-j", "neigh"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3.0)
        if p_neigh.returncode == 0 and p_neigh.stdout.strip():
            for item in json.loads(p_neigh.stdout):
                neighbors.append(
                    {
                        "ip": item.get("dst"),
                        "dev": item.get("dev"),
                        "mac": item.get("lladdr"),
                        "state": item.get("state", []),
                    }
                )
    except Exception as err:
        warnings.append(f"Could not read `ip -j neigh`: {err}")

    observations = [
        f"Discovered {len(links)} real link-layer interface(s) via `ip -j link`.",
        f"Discovered {len(neighbors)} real OS ARP/neighbor cache entry(ies) via `ip -j neigh`.",
    ]
    for l in links:
        observations.append(f"Interface {l['name']} ({l['link_type']}): MAC={l['mac']}, MTU={l['mtu']}, state={l['state']}.")
    if not neighbors:
        warnings.append(
            "ARP/neighbor table is currently empty (no recent off-loopback L2 traffic). NetBox does not fabricate ARP entries."
        )

    return {
        "status": "completed",
        "run_id": None,
        "protocol": "Ethernet/ARP",
        "summary": f"Read-only L2 inspection complete ({len(links)} interfaces, {len(neighbors)} ARP neighbor entries).",
        "socket_event_count": 0,
        "packet_count": 0,
        "packet_capture_status": "NOT_REQUESTED",
        "actual_observations": observations,
        "warnings": warnings,
        "measured_metrics": {"interface_count": len(links), "neighbor_count": len(neighbors)},
        "raw_observations": {"links": links, "neighbors": neighbors},
    }


def run_l3_routing_inspection(include_ping: bool = True) -> Dict[str, Any]:
    ifaces = [i.model_dump() for i in discover_linux_interfaces()]
    gw = discover_default_gateway()
    routes = []
    warnings: List[str] = []
    ping_result: Dict[str, Any] = {"attempted": False}

    try:
        p_route = subprocess.run(
            ["ip", "-j", "-4", "route"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3.0
        )
        if p_route.returncode == 0 and p_route.stdout.strip():
            routes = json.loads(p_route.stdout)
    except Exception as err:
        warnings.append(f"Could not read IPv4 routing table: {err}")

    if include_ping:
        ping_result["attempted"] = True
        try:
            p_ping = subprocess.run(
                ["ping", "-c", "2", "-W", "1", "127.0.0.1"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=4.0,
            )
            ping_result["exit_code"] = p_ping.returncode
            ping_result["reachable"] = p_ping.returncode == 0
            ping_result["summary"] = (p_ping.stdout.strip().splitlines()[-1] if p_ping.stdout.strip() else p_ping.stderr.strip())
        except Exception as err:
            ping_result["reachable"] = False
            ping_result["summary"] = f"Ping unavailable/restricted: {err}"
            warnings.append(ping_result["summary"])

    observations = [
        f"Read-only IPv4 inspection: {len(ifaces)} interface(s), {len(routes)} routing table entry(ies), default gateway={gw or 'none'}.",
        "Host routing table was NOT modified.",
    ]
    if include_ping and ping_result.get("summary"):
        observations.append(f"Local ICMP loopback reachability (127.0.0.1): {ping_result['summary']}")

    return {
        "status": "completed",
        "run_id": None,
        "protocol": "IPv4/ICMP",
        "summary": f"Read-only IPv4 & routing table inspection complete ({len(routes)} routes, GW={gw or 'none'}).",
        "socket_event_count": 0,
        "packet_count": 0,
        "packet_capture_status": "NOT_REQUESTED",
        "actual_observations": observations,
        "warnings": warnings,
        "measured_metrics": {
            "interface_count": len(ifaces),
            "route_count": len(routes),
            "default_gateway": gw,
            "loopback_ping_ok": ping_result.get("reachable"),
        },
        "raw_observations": {"interfaces": ifaces, "routes": routes, "ping": ping_result},
    }


def execute_lab_scenario(scenario_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Central allowlisted dispatcher for all Phase 7 lab scenarios."""
    if scenario_id in ("tcp-echo", "tcp-conn-refused", "tcp-multi-transfer", "tcp-abrupt-rst", "tcp-multi-flow", "net-monitor-transfer"):
        return run_tcp_scenario(scenario_id, params)
    if scenario_id in ("udp-echo", "udp-multi-datagram", "udp-unavailable"):
        return run_udp_scenario(scenario_id, params)
    if scenario_id == "dns-local":
        return run_dns_scenario(params)
    if scenario_id in ("http-local", "http-404"):
        return run_http_scenario(scenario_id)
    if scenario_id == "net-inspect-l2":
        return run_l2_inspection()
    if scenario_id in ("net-inspect-l3", "routing-inspect"):
        return run_l3_routing_inspection(include_ping=(scenario_id == "routing-inspect"))
    raise ValueError(f"Unsupported or disallowed lab scenario: '{scenario_id}'.")
