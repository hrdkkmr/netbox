import re
from dataclasses import dataclass, field
from typing import List, Optional, Set

from ...models.events import NetworkEvent
from ...models.packets import CorrelationRecord, PacketRecord, TcpFlowSummary
from ...services.run_manager import RunRecord

DEFAULT_MAX_PACKETS = 40
DEFAULT_MAX_SOCKETS = 40


@dataclass
class RetrievalResult:
    run_id: str
    flows: List[TcpFlowSummary] = field(default_factory=list)
    packets: List[PacketRecord] = field(default_factory=list)
    socket_events: List[NetworkEvent] = field(default_factory=list)
    correlations: List[CorrelationRecord] = field(default_factory=list)
    target_packet_id: Optional[int] = None
    target_flow_id: Optional[str] = None
    truncated_for_budget: bool = False
    retrieval_notes: List[str] = field(default_factory=list)


def _extract_referenced_numbers(query: str) -> Set[int]:
    if not query:
        return set()
    nums: Set[int] = set()
    for match in re.finditer(r"(?:pkt_|packet\s*#?|sock_|socket\s*#?|event\s*#?|#)(\d+)", query, re.IGNORECASE):
        try:
            nums.add(int(match.group(1)))
        except ValueError:
            pass
    # Also recognize ordinal references like "first", "second", "third", "fourth"
    lower = query.lower()
    ordinals = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
    for word, idx in ordinals.items():
        if re.search(rf"\b{word}\b", lower):
            nums.add(idx)
    return nums


def _packet_matches_query(pkt: PacketRecord, query_lower: str, query_nums: Set[int]) -> bool:
    if pkt.sequence in query_nums:
        return True
    if not query_lower:
        return False
    cls = (pkt.analysis.classification if pkt.analysis else "").lower()
    flags = (pkt.analysis.flags_label if pkt.analysis else "").lower()

    if "syn" in query_lower and ("syn" in flags or "handshake" in query_lower):
        return True
    if "handshake" in query_lower and cls in ("syn", "syn+ack", "ack"):
        return True
    if ("fin" in query_lower or "terminat" in query_lower or "close" in query_lower) and ("fin" in flags or "rst" in flags):
        return True
    if "rst" in query_lower or "reset" in query_lower:
        if "rst" in flags:
            return True
    if ("data" in query_lower or "payload" in query_lower or "echo" in query_lower or "psh" in query_lower) and pkt.payload.payload_length > 0:
        return True
    if ("retrans" in query_lower or "duplicate" in query_lower) and pkt.analysis and pkt.analysis.retransmission_status:
        return True
    if "ack" in query_lower and "ack" in flags:
        return True
    return False


def _is_essential_packet(pkt: PacketRecord, flows: List[TcpFlowSummary]) -> bool:
    """Identifies high-signal packets that should not be silently dropped during budgeting."""
    if pkt.analysis:
        if pkt.analysis.classification in ("SYN", "SYN+ACK", "FIN", "FIN+ACK", "RST"):
            return True
        if pkt.analysis.retransmission_status:
            return True
    for f in flows:
        for step in f.handshake.steps:
            if step.observed and step.packet_sequence == pkt.sequence:
                return True
        if pkt.sequence in f.termination.fin_packets or pkt.sequence in f.termination.rst_packets:
            return True
    return False


def retrieve_evidence(
    record: RunRecord,
    question: Optional[str] = None,
    flow_id: Optional[str] = None,
    packet_id: Optional[int] = None,
    max_packets: int = DEFAULT_MAX_PACKETS,
    max_sockets: int = DEFAULT_MAX_SOCKETS,
) -> RetrievalResult:
    """
    Deterministically retrieves the relevant subset of flows, packets, socket events,
    and correlations from a single RunRecord while maintaining strict flow isolation
    and respecting context-window budgets without silently dropping key anchors.
    """
    notes: List[str] = []
    truncated = False

    all_flows = list(record.flows or [])
    all_packets = list(record.packets or [])
    all_sockets = list(record.events or [])
    all_corrs = list(record.correlations or [])

    # Step 1: If packet_id is specified and flow_id is not, infer its owning flow_id
    selected_flow_id = flow_id
    if packet_id is not None and not selected_flow_id:
        target_pkt = next((p for p in all_packets if p.sequence == packet_id), None)
        if target_pkt and target_pkt.analysis and target_pkt.analysis.flow_id:
            selected_flow_id = target_pkt.analysis.flow_id

    # Step 2: Strict flow isolation when a specific flow_id is active
    if selected_flow_id:
        flows = [f for f in all_flows if f.flow_id == selected_flow_id]
        allowed_pkt_seqs = {seq for f in flows for seq in f.packet_sequences}
        packets = [
            p for p in all_packets
            if (p.analysis and p.analysis.flow_id == selected_flow_id) or p.sequence in allowed_pkt_seqs
        ]
        corrs = [
            c for c in all_corrs
            if c.flow_id == selected_flow_id or c.packet_sequence in {p.sequence for p in packets}
        ]
        corr_sock_seqs: Set[int] = set()
        for c in corrs:
            corr_sock_seqs.update(c.related_socket_event_sequences)
        for f in flows:
            corr_sock_seqs.update(f.correlated_socket_sequences)

        if corr_sock_seqs:
            # Keep correlated socket events + lifecycle events on those same (pid, fd) sockets
            corr_pid_fds = {
                (e.process.pid, e.socket_fd)
                for e in all_sockets
                if e.sequence in corr_sock_seqs and e.socket_fd is not None
            }
            sockets = [
                e for e in all_sockets
                if e.sequence in corr_sock_seqs
                or (e.socket_fd is not None and (e.process.pid, e.socket_fd) in corr_pid_fds)
            ]
        else:
            sockets = list(all_sockets)
        notes.append(f"Isolated retrieval to flow '{selected_flow_id}'.")
    else:
        flows = all_flows
        packets = all_packets
        corrs = all_corrs
        sockets = all_sockets

    # Step 3: Focused packet window (selected packet + neighbors) when explaining a specific packet
    query_lower = (question or "").strip().lower()
    query_nums = _extract_referenced_numbers(question or "")

    if packet_id is not None:
        neighbor_seqs = {packet_id - 2, packet_id - 1, packet_id, packet_id + 1, packet_id + 2}
        focused_pkts = [
            p for p in packets
            if p.sequence in neighbor_seqs or _is_essential_packet(p, flows)
        ]
        if len(focused_pkts) > max_packets:
            # Always keep target + direct neighbors first
            must_keep = [p for p in focused_pkts if p.sequence in neighbor_seqs]
            others = [p for p in focused_pkts if p.sequence not in neighbor_seqs]
            packets = sorted(
                must_keep + others[: max(0, max_packets - len(must_keep))],
                key=lambda p: p.sequence,
            )
            truncated = True
        else:
            packets = focused_pkts
        notes.append(f"Focused packet retrieval on packet #{packet_id} with neighboring context.")
    elif len(packets) > max_packets:
        # Budget large captures without silently dropping essential handshake/termination/query packets
        must_keep_seqs: Set[int] = set()
        for p in packets:
            if _is_essential_packet(p, flows) or _packet_matches_query(p, query_lower, query_nums):
                must_keep_seqs.add(p.sequence)

        selected_pkts = [p for p in packets if p.sequence in must_keep_seqs]
        remaining_slots = max(0, max_packets - len(selected_pkts))
        if remaining_slots > 0:
            extras = [p for p in packets if p.sequence not in must_keep_seqs][:remaining_slots]
            selected_pkts.extend(extras)
        elif len(selected_pkts) > max_packets:
            selected_pkts = selected_pkts[:max_packets]

        selected_pkts.sort(key=lambda p: p.sequence)
        packets = selected_pkts
        truncated = True
        notes.append(
            f"Budgeted packet context to {len(packets)} of {len(all_packets)} packets "
            "(preserved handshake, termination, retransmission, and query-matched packets)."
        )

    # Step 4: Filter correlations to the included packets
    included_pkt_seqs = {p.sequence for p in packets}
    corrs = [c for c in corrs if c.packet_sequence in included_pkt_seqs]

    # Step 5: Budget socket events if large capture
    if len(sockets) > max_sockets:
        corr_seqs = {seq for c in corrs for seq in c.related_socket_event_sequences}
        essential_socks = [
            e for e in sockets
            if e.sequence in corr_seqs
            or e.sequence in query_nums
            or e.result < 0
            or e.error_code is not None
            or e.event_type in ("bind", "listen", "connect", "accept", "accept4", "close")
        ]
        if len(essential_socks) >= max_sockets:
            sockets = essential_socks[:max_sockets]
        else:
            seen_s = {e.sequence for e in essential_socks}
            fill = [e for e in sockets if e.sequence not in seen_s][: max_sockets - len(essential_socks)]
            sockets = sorted(essential_socks + fill, key=lambda e: e.sequence)
        truncated = True
        notes.append(f"Budgeted socket context to {len(sockets)} of {len(all_sockets)} events.")

    return RetrievalResult(
        run_id=record.run_id,
        flows=flows,
        packets=packets,
        socket_events=sockets,
        correlations=corrs,
        target_packet_id=packet_id,
        target_flow_id=selected_flow_id,
        truncated_for_budget=truncated,
        retrieval_notes=notes,
    )
