import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from ...services.run_manager import RunRecord
from ..models import EvidenceSummary
from ..retrieval.evidence_retriever import RetrievalResult

CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_untrusted_text(value: Optional[str], max_len: int = 160) -> Optional[str]:
    """
    Sanitizes untrusted observed network strings (e.g. error messages, process names,
    or opt-in payload previews) before embedding them in LLM context so they cannot
    break framing or inject control sequences.
    """
    if value is None:
        return None
    cleaned = CONTROL_CHARS_RE.sub("", str(value))
    cleaned = cleaned.replace("</OBSERVED_EVIDENCE_DATA_ONLY>", "[redacted-tag]")
    cleaned = cleaned.replace("<OBSERVED_EVIDENCE_DATA_ONLY>", "[redacted-tag]")
    if len(cleaned) > max_len:
        return cleaned[:max_len] + "...[truncated]"
    return cleaned


@dataclass
class EvidenceBundle:
    run_id: str
    data: Dict[str, Any]
    summary: EvidenceSummary
    valid_packet_seqs: Set[int] = field(default_factory=set)
    valid_socket_seqs: Set[int] = field(default_factory=set)
    valid_flow_ids: Set[str] = field(default_factory=set)
    valid_analysis_ids: Set[str] = field(default_factory=set)
    deterministic_facts: Dict[str, Any] = field(default_factory=dict)

    def to_prompt_block(self) -> str:
        """
        Renders a compact, high-signal evidence block (~8x smaller than pretty JSON)
        so local 1.5B-3B models fit the entire execution cleanly in context without
        truncation while preserving every canonical ID, timestamp, flag, and warning.
        """
        ex = self.data.get("execution", {})
        lines: List[str] = [
            "<OBSERVED_EVIDENCE_DATA_ONLY>",
            (
                f"RUN: {ex.get('run_id')} | example={ex.get('example_id')} | status={ex.get('status')} "
                f"| socket_capture={ex.get('socket_capture_status')} ({ex.get('total_socket_events_in_run')} events) "
                f"| packet_capture={ex.get('packet_capture_status')} ({ex.get('total_packets_in_run')} packets on {ex.get('packet_capture_interface')})"
            ),
        ]
        if ex.get("packet_capture_error"):
            lines.append(f"PACKET_CAPTURE_ERROR: {ex.get('packet_capture_error')}")
        if ex.get("isolated_flow_id"):
            lines.append(f"ISOLATED_FLOW: {ex.get('isolated_flow_id')}")
        if ex.get("focused_packet_id"):
            lines.append(f"FOCUSED_PACKET: {ex.get('focused_packet_id')}")

        warnings = self.data.get("warnings_and_uncertainty") or []
        if warnings:
            lines.append("WARNINGS_AND_UNCERTAINTY:")
            for w in warnings:
                lines.append(f"- {w}")

        # High-signal deterministic anchor summary so small local models stay strictly accurate
        packets = self.data.get("packets") or []
        sockets = self.data.get("socket_events") or []
        data_pkts = [p for p in packets if (p.get("payload_length") or 0) > 0]
        ctrl_only_pkts = [p for p in packets if (p.get("payload_length") or 0) == 0]
        sock_errs = [s for s in sockets if s.get("error_code") is not None]
        lines.append("\nKEY_OBSERVED_FACTS (Layer A Deterministic Summary):")
        if data_pkts:
            dp_str = ", ".join(
                f"{p['citation']} ({p['payload_length']}B, {p['direction']}, [{p['flags_label']}])"
                for p in data_pkts
            )
            lines.append(f"- Data-bearing packets (payload > 0B): {dp_str}")
        else:
            lines.append("- Data-bearing packets (payload > 0B): NONE")
        if ctrl_only_pkts:
            cp_str = ", ".join(f"{p['citation']}[{p['flags_label']}]" for p in ctrl_only_pkts)
            lines.append(f"- Control-only packets (payload = 0B): {cp_str}")
        if sock_errs:
            se_str = ", ".join(
                f"{s['citation']} {s['event_type']}() ERR={s['error_name']}({s['error_code']})"
                for s in sock_errs
            )
            lines.append(f"- Socket API errors: {se_str}")
        else:
            lines.append("- Socket API errors: NONE")

        # Build quick lookup from packet_id -> correlation summary
        corr_by_pkt: Dict[str, Dict[str, Any]] = {}
        for c in self.data.get("correlations") or []:
            corr_by_pkt[c["packet_id"]] = c

        flows = self.data.get("flows") or []
        lines.append("\nTCP FLOWS:")
        if not flows:
            lines.append("- None captured")
        for f in flows:
            hs = f.get("handshake", {})
            tm = f.get("termination", {})
            hs_steps = ", ".join(
                f"{s['step']}={'[PACKET: ' + s['packet_id'] + ']' if s['observed'] and s['packet_id'] else 'MISSING'}"
                for s in hs.get("steps", [])
            )
            retrans = f.get("retransmissions") or []
            retrans_str = (
                "; ".join(f"{r['citation']} {r['packet_id']}={r['status']}" for r in retrans)
                if retrans
                else "none"
            )
            lines.append(
                f"- {f['citation']} client={f.get('client_endpoint')} server={f.get('server_endpoint')} "
                f"(role={f.get('role_determination')}) pkts={f.get('packet_count')} "
                f"payload_bytes={f.get('payload_bytes_a_to_b')}B/{f.get('payload_bytes_b_to_a')}B "
                f"| Handshake={hs.get('status')} {hs.get('citation')} ({hs_steps}) "
                f"| Termination={tm.get('status')} {tm.get('citation')} (FIN={tm.get('fin_packets')}, RST={tm.get('rst_packets')}) "
                f"| Retrans={retrans_str}"
            )

        packets = self.data.get("packets") or []
        lines.append("\nCAPTURED PACKETS (source=packet_capture):")
        if not packets:
            lines.append("- None captured")
        for p in packets:
            c = corr_by_pkt.get(p["id"])
            if c:
                s_tags = ",".join(f"[SOCKET: {s}]" for s in (c.get("related_socket_ids") or [])[:3])
                corr_str = f"corr={c.get('confidence')}({s_tags or 'none'}) {c.get('citation')}"
            else:
                corr_str = "corr=unresolved"
            retrans_tag = f" retrans={p['retransmission_status']}" if p.get("retransmission_status") else ""
            lines.append(
                f"- {p['citation']} +{p.get('rel_monotonic_ms')}ms {p.get('direction')} "
                f"{p.get('source_ip')}:{p.get('source_port')}->{p.get('destination_ip')}:{p.get('destination_port')} "
                f"{p.get('protocol')} [{p.get('flags_label')}] seq={p.get('seq_num')} ack={p.get('ack_num')} "
                f"win={p.get('window_size')} payload={p.get('payload_length')}B frame={p.get('original_length')}B "
                f"{corr_str}{retrans_tag}"
            )

        sockets = self.data.get("socket_events") or []
        lines.append("\nSOCKET API EVENTS (source=socket_api):")
        if not sockets:
            lines.append("- None recorded")
        for s in sockets:
            ep = ""
            if s.get("local") or s.get("remote"):
                ep = f" local={s.get('local')} remote={s.get('remote')}"
            err = f" ERR={s.get('error_name')}({s.get('error_code')})" if s.get("error_code") is not None else ""
            lines.append(
                f"- {s['citation']} +{s.get('rel_monotonic_ms')}ms {s.get('process')}(pid={s.get('pid')}) "
                f"{s.get('event_type')}() fd={s.get('socket_fd')} result={s.get('result')}{ep}{err}"
            )

        lines.append("</OBSERVED_EVIDENCE_DATA_ONLY>")
        return "\n".join(lines)


def _rel_ms(ts_ns: Optional[int], base_ns: Optional[int]) -> Optional[float]:
    if ts_ns is None or base_ns is None:
        return None
    return round((ts_ns - base_ns) / 1e6, 3)


def build_evidence_bundle(record: RunRecord, retrieval: RetrievalResult) -> EvidenceBundle:
    """
    Constructs a compact, structured, read-only EvidenceBundle strictly from
    Layer A deterministic observations. Preserves original IDs, timestamps,
    directions, confidence levels, and unresolved observations.
    """
    # Compute monotonic base across retrieved observations for clean relative ms
    mono_values: List[int] = []
    for e in retrieval.socket_events:
        mono_values.append(e.timestamp_ns)
    for p in retrieval.packets:
        mono_values.append(p.timestamp.capture_monotonic_ns)
    base_mono_ns = min(mono_values) if mono_values else None

    valid_analysis_ids: Set[str] = set()
    warnings: List[str] = []

    if record.packet_capture_status != "COMPLETED":
        warnings.append(
            f"Packet capture status is '{record.packet_capture_status}' "
            f"({sanitize_untrusted_text(record.packet_capture_error) or 'no packets captured'}). "
            "Do NOT claim wire packets were observed."
        )
    elif len(record.packets) == 0:
        warnings.append("Zero packets were captured for this run. Do NOT invent packet observations.")

    if len(record.events) == 0:
        warnings.append("Zero socket_api events were recorded for this run.")

    # Flows & deterministic analyses
    flows_ctx: List[Dict[str, Any]] = []
    any_complete_handshake = False
    any_confirmed_retrans = False
    any_possible_retrans = False

    for f in retrieval.flows:
        hs_id = f"handshake:{f.flow_id}"
        term_id = f"termination:{f.flow_id}"
        valid_analysis_ids.add(hs_id)
        valid_analysis_ids.add(term_id)

        if f.handshake.status == "COMPLETE":
            any_complete_handshake = True
        else:
            warnings.append(f"Flow {f.flow_id}: handshake is {f.handshake.status} ({f.handshake.note}).")

        if f.termination.status in ("NOT_OBSERVED", "PARTIAL_FIN_OBSERVED"):
            warnings.append(f"Flow {f.flow_id}: termination is {f.termination.status} ({f.termination.note}).")

        retrans_items = []
        for r in f.retransmissions:
            rid = f"retrans:pkt_{r.packet_sequence}"
            valid_analysis_ids.add(rid)
            if r.status == "confirmed_retransmission":
                any_confirmed_retrans = True
            else:
                any_possible_retrans = True
                warnings.append(
                    f"Packet pkt_{r.packet_sequence} is only '{r.status}' — do NOT upgrade to confirmed retransmission."
                )
            retrans_items.append(
                {
                    "analysis_id": rid,
                    "citation": f"[ANALYSIS: {rid}]",
                    "packet_id": f"pkt_{r.packet_sequence}",
                    "original_packet_id": f"pkt_{r.original_packet_sequence}",
                    "status": r.status,
                    "tcp_sequence_number": r.tcp_sequence_number,
                    "payload_length": r.payload_length,
                    "reason": sanitize_untrusted_text(r.reason, 200),
                }
            )

        flows_ctx.append(
            {
                "flow_id": f.flow_id,
                "citation": f"[FLOW: {f.flow_id}]",
                "endpoint_a": f.endpoint_a,
                "endpoint_b": f.endpoint_b,
                "client_endpoint": f.client_endpoint,
                "server_endpoint": f.server_endpoint,
                "role_determination": f.role_determination,
                "packet_count": f.packet_count,
                "packets_a_to_b": f.packets_a_to_b,
                "packets_b_to_a": f.packets_b_to_a,
                "payload_bytes_a_to_b": f.payload_bytes_a_to_b,
                "payload_bytes_b_to_a": f.payload_bytes_b_to_a,
                "observed_flags": f.observed_flags,
                "handshake": {
                    "analysis_id": hs_id,
                    "citation": f"[ANALYSIS: {hs_id}]",
                    "status": f.handshake.status,
                    "note": f.handshake.note,
                    "steps": [
                        {
                            "step": s.step,
                            "observed": s.observed,
                            "packet_id": f"pkt_{s.packet_sequence}" if s.packet_sequence else None,
                            "direction": s.direction,
                            "seq_num": s.seq_num,
                            "ack_num": s.ack_num,
                        }
                        for s in f.handshake.steps
                    ],
                },
                "termination": {
                    "analysis_id": term_id,
                    "citation": f"[ANALYSIS: {term_id}]",
                    "status": f.termination.status,
                    "note": f.termination.note,
                    "fin_packets": [f"pkt_{s}" for s in f.termination.fin_packets],
                    "rst_packets": [f"pkt_{s}" for s in f.termination.rst_packets],
                    "ack_after_fin_packets": [f"pkt_{s}" for s in f.termination.ack_after_fin_packets],
                },
                "retransmissions": retrans_items,
                "correlated_socket_ids": [f"sock_{s}" for s in f.correlated_socket_sequences],
            }
        )

    # Map flow client/server endpoints for clean packet direction labeling
    flow_roles = {f.flow_id: (f.client_endpoint, f.server_endpoint) for f in retrieval.flows}

    packets_ctx: List[Dict[str, Any]] = []
    for p in retrieval.packets:
        pid_str = f"pkt_{p.sequence}"
        net = p.network
        tcp = p.transport.tcp if p.transport else None
        src_ep = f"{net.source_ip}:{tcp.source_port}" if (net and tcp) else (net.source_ip if net else None)
        dst_ep = f"{net.destination_ip}:{tcp.destination_port}" if (net and tcp) else (net.destination_ip if net else None)
        fid = p.analysis.flow_id if p.analysis else None

        direction = "unknown"
        if fid and fid in flow_roles:
            c_ep, s_ep = flow_roles[fid]
            if c_ep and s_ep:
                if src_ep == c_ep and dst_ep == s_ep:
                    direction = "client->server"
                elif src_ep == s_ep and dst_ep == c_ep:
                    direction = "server->client"

        packets_ctx.append(
            {
                "id": pid_str,
                "citation": f"[PACKET: {pid_str}]",
                "sequence": p.sequence,
                "flow_id": fid,
                "direction": direction,
                "interface": p.interface,
                "link_layer": p.link_layer.type,
                "protocol": p.protocol,
                "rel_monotonic_ms": _rel_ms(p.timestamp.capture_monotonic_ns, base_mono_ns),
                "capture_monotonic_ns": p.timestamp.capture_monotonic_ns,
                "pcap_timestamp_ns": p.timestamp.pcap_timestamp_ns,
                "source_ip": net.source_ip if net else None,
                "destination_ip": net.destination_ip if net else None,
                "ttl": net.ttl if net else None,
                "source_port": tcp.source_port if tcp else None,
                "destination_port": tcp.destination_port if tcp else None,
                "seq_num": tcp.sequence_number if tcp else None,
                "ack_num": tcp.acknowledgement_number if tcp else None,
                "window_size": tcp.window_size if tcp else None,
                "tcp_header_length": tcp.header_length if tcp else None,
                "flags": p.analysis.flags_list if p.analysis else [],
                "flags_label": p.analysis.flags_label if p.analysis else None,
                "classification": p.analysis.classification if p.analysis else None,
                "payload_length": p.payload.payload_length,
                "captured_length": p.capture.captured_length,
                "original_length": p.capture.original_length,
                "truncated": p.capture.truncated,
                "retransmission_status": p.analysis.retransmission_status if p.analysis else None,
            }
        )

    sockets_ctx: List[Dict[str, Any]] = []
    for e in retrieval.socket_events:
        sid_str = f"sock_{e.sequence}"
        sockets_ctx.append(
            {
                "id": sid_str,
                "citation": f"[SOCKET: {sid_str}]",
                "sequence": e.sequence,
                "rel_monotonic_ms": _rel_ms(e.timestamp_ns, base_mono_ns),
                "timestamp_ns": e.timestamp_ns,
                "process": sanitize_untrusted_text(e.process.name, 64),
                "pid": e.process.pid,
                "event_type": e.event_type,
                "socket_fd": e.socket_fd,
                "socket_domain": e.socket_domain,
                "socket_type": e.socket_type,
                "local": (
                    f"{e.connection.local_ip}:{e.connection.local_port}"
                    if e.connection and (e.connection.local_ip or e.connection.local_port is not None)
                    else None
                ),
                "remote": (
                    f"{e.connection.remote_ip}:{e.connection.remote_port}"
                    if e.connection and (e.connection.remote_ip or e.connection.remote_port is not None)
                    else None
                ),
                "payload_bytes": e.payload.bytes if e.payload else None,
                "result": e.result,
                "error_code": e.error_code,
                "error_name": sanitize_untrusted_text(e.error_name, 32),
                "error_message": sanitize_untrusted_text(e.error_message, 100),
            }
        )

    corrs_ctx: List[Dict[str, Any]] = []
    unresolved_corr_count = 0
    for c in retrieval.correlations:
        cid = f"corr:pkt_{c.packet_sequence}"
        valid_analysis_ids.add(cid)
        if c.confidence == "unresolved":
            unresolved_corr_count += 1
        corrs_ctx.append(
            {
                "analysis_id": cid,
                "citation": f"[ANALYSIS: {cid}]",
                "packet_id": f"pkt_{c.packet_sequence}",
                "flow_id": c.flow_id,
                "connection_tuple": c.connection_tuple,
                "related_socket_ids": [f"sock_{s}" for s in c.related_socket_event_sequences],
                "related_processes": c.related_processes,
                "related_socket_fds": c.related_socket_fds,
                "confidence": c.confidence,
                "method": c.method,
                "monotonic_delta_ms": c.monotonic_delta_ms,
                "reason": sanitize_untrusted_text(c.reason, 180),
            }
        )

    if unresolved_corr_count > 0:
        warnings.append(
            f"{unresolved_corr_count} packet correlation(s) are 'unresolved'; keep them unresolved."
        )

    data = {
        "execution": {
            "run_id": record.run_id,
            "example_id": record.example_id,
            "status": record.status,
            "duration_ms": record.duration_ms,
            "exit_code": record.exit_code,
            "socket_capture_status": record.socket_capture_status,
            "packet_capture_status": record.packet_capture_status,
            "packet_capture_interface": record.packet_capture_interface,
            "packet_capture_error": sanitize_untrusted_text(record.packet_capture_error, 200),
            "total_socket_events_in_run": len(record.events),
            "total_packets_in_run": len(record.packets),
            "total_flows_in_run": len(record.flows),
            "isolated_flow_id": retrieval.target_flow_id,
            "focused_packet_id": f"pkt_{retrieval.target_packet_id}" if retrieval.target_packet_id else None,
            "truncated_for_budget": retrieval.truncated_for_budget,
            "retrieval_notes": retrieval.retrieval_notes,
        },
        "warnings_and_uncertainty": warnings,
        "flows": flows_ctx,
        "packets": packets_ctx,
        "socket_events": sockets_ctx,
        "correlations": corrs_ctx,
    }

    summary = EvidenceSummary(
        run_id=record.run_id,
        socket_event_count=len(record.events),
        packet_count=len(record.packets),
        flow_count=len(record.flows),
        included_socket_sequences=[e.sequence for e in retrieval.socket_events],
        included_packet_sequences=[p.sequence for p in retrieval.packets],
        included_flow_ids=[f.flow_id for f in retrieval.flows],
        packet_capture_status=record.packet_capture_status,
        truncated_for_budget=retrieval.truncated_for_budget,
    )

    return EvidenceBundle(
        run_id=record.run_id,
        data=data,
        summary=summary,
        valid_packet_seqs={p.sequence for p in record.packets},
        valid_socket_seqs={e.sequence for e in record.events},
        valid_flow_ids={f.flow_id for f in record.flows},
        valid_analysis_ids=valid_analysis_ids,
        deterministic_facts={
            "packet_count": len(record.packets),
            "packet_capture_status": record.packet_capture_status,
            "any_complete_handshake": any_complete_handshake,
            "any_confirmed_retrans": any_confirmed_retrans,
            "any_possible_retrans": any_possible_retrans,
            "unresolved_corr_count": unresolved_corr_count,
            "flow_count": len(retrieval.flows),
        },
    )
