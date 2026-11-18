from typing import Any, Dict, List, Optional, Set, Tuple

from ..models.events import NetworkEvent
from ..models.packets import CorrelationRecord, PacketRecord, TcpFlowSummary

# Default monotonic correlation window (500 ms in nanoseconds)
DEFAULT_WINDOW_NS = 500_000_000


def _event_endpoints(ev: NetworkEvent) -> Tuple[Optional[Tuple[str, int]], Optional[Tuple[str, int]]]:
    if not ev.connection:
        return None, None
    loc = (
        (ev.connection.local_ip, ev.connection.local_port)
        if ev.connection.local_ip is not None and ev.connection.local_port is not None
        else None
    )
    rem = (
        (ev.connection.remote_ip, ev.connection.remote_port)
        if ev.connection.remote_ip is not None and ev.connection.remote_port is not None
        else None
    )
    return loc, rem


def _matches_four_tuple(
    pkt_src: Tuple[str, int],
    pkt_dst: Tuple[str, int],
    ev: NetworkEvent,
) -> Optional[str]:
    """
    Returns match direction ('forward' or 'reverse') when a socket event's
    4-tuple matches the packet's (src, dst) endpoints in either direction,
    or None if they do not match.
    """
    loc, rem = _event_endpoints(ev)
    if not loc or not rem:
        return None
    if loc == pkt_src and rem == pkt_dst:
        return "forward"
    if loc == pkt_dst and rem == pkt_src:
        return "reverse"
    return None


def _is_operation_compatible(pkt: PacketRecord, ev: NetworkEvent) -> bool:
    if not pkt.transport or not pkt.transport.tcp:
        return False
    flags = pkt.transport.tcp.flags
    plen = pkt.payload.payload_length
    etype = ev.event_type

    if flags.syn:
        return etype in ("connect", "accept", "accept4")
    if flags.rst:
        return etype in ("connect", "accept", "accept4", "send", "recv", "close")
    if flags.fin:
        return etype in ("close", "shutdown", "recv")
    if plen > 0:
        return etype in ("send", "sendto", "recv", "recvfrom")
    if flags.ack:
        return etype in ("connect", "accept", "accept4", "send", "recv", "close", "shutdown")
    return False


def correlate_packets_with_socket_events(
    packets: List[PacketRecord],
    socket_events: List[NetworkEvent],
    flows: Optional[List[TcpFlowSummary]] = None,
    window_ns: int = DEFAULT_WINDOW_NS,
) -> List[CorrelationRecord]:
    """
    Correlates captured TCP packets with Phase 2 socket_api events using:
    1. Exact TCP four-tuple matching (handling forward & reverse directions).
    2. Monotonic timestamp proximity (capture_monotonic_ns vs. ev.timestamp_ns;
       NEVER compares wall-clock pcap_timestamp_ns against CLOCK_MONOTONIC).
    3. Operation-type compatibility.

    Important invariants:
    - Never fabricates process or FD links without supporting 4-tuple evidence.
    - Explicitly marks unmatched or ambiguous packets as confidence="unresolved".
    """
    correlations: List[CorrelationRecord] = []
    flow_socket_map: Dict[str, Set[int]] = {}

    for pkt in packets:
        if pkt.protocol != "TCP" or not pkt.network or not pkt.transport or not pkt.transport.tcp:
            correlations.append(
                CorrelationRecord(
                    packet_sequence=pkt.sequence,
                    flow_id=pkt.analysis.flow_id if pkt.analysis else None,
                    connection_tuple=None,
                    confidence="unresolved",
                    method="none",
                    reason="Packet does not contain complete IPv4/TCP four-tuple headers.",
                )
            )
            continue

        tcp = pkt.transport.tcp
        pkt_src = (pkt.network.source_ip, tcp.source_port)
        pkt_dst = (pkt.network.destination_ip, tcp.destination_port)
        conn_tuple_str = f"{pkt_src[0]}:{pkt_src[1]} -> {pkt_dst[0]}:{pkt_dst[1]}"
        flow_id = pkt.analysis.flow_id if pkt.analysis else None
        pkt_mono = pkt.timestamp.capture_monotonic_ns

        # Step 1: Find all socket events matching this exact 4-tuple (either direction)
        tuple_matches: List[Tuple[NetworkEvent, str, int]] = []
        for ev in socket_events:
            direction = _matches_four_tuple(pkt_src, pkt_dst, ev)
            if direction is not None:
                delta_ns = abs(pkt_mono - ev.timestamp_ns)
                tuple_matches.append((ev, direction, delta_ns))

        if not tuple_matches:
            # Check for failed connect() where client local_port was null (e.g., ECONNREFUSED RST)
            partial_matches: List[Tuple[NetworkEvent, int]] = []
            for ev in socket_events:
                if ev.event_type == "connect" and ev.connection:
                    rem_ip = ev.connection.remote_ip
                    rem_port = ev.connection.remote_port
                    if (rem_ip, rem_port) in (pkt_dst, pkt_src):
                        delta_ns = abs(pkt_mono - ev.timestamp_ns)
                        if delta_ns <= window_ns:
                            partial_matches.append((ev, delta_ns))

            if len(partial_matches) == 1:
                ev, delta_ns = partial_matches[0]
                correlations.append(
                    CorrelationRecord(
                        packet_sequence=pkt.sequence,
                        flow_id=flow_id,
                        connection_tuple=conn_tuple_str,
                        related_socket_event_sequences=[ev.sequence],
                        related_processes=[{"pid": ev.process.pid, "name": ev.process.name}],
                        related_socket_fds=[ev.socket_fd] if ev.socket_fd is not None else [],
                        confidence="low",
                        method="remote_endpoint_and_monotonic_window",
                        reason=(
                            f"Matched connect() event #{ev.sequence} by remote endpoint and monotonic window "
                            f"({delta_ns / 1e6:.3f} ms); client ephemeral port was unavailable in failed connect()."
                        ),
                        monotonic_delta_ms=round(delta_ns / 1e6, 3),
                    )
                )
                continue

            correlations.append(
                CorrelationRecord(
                    packet_sequence=pkt.sequence,
                    flow_id=flow_id,
                    connection_tuple=conn_tuple_str,
                    confidence="unresolved",
                    method="four_tuple_lookup",
                    reason="No observed Phase 2 socket_api event matched this packet's TCP four-tuple.",
                )
            )
            continue

        # Detect ambiguity: check if multiple distinct runs/unrelated client-server pairs share tuple
        # (For a single TCP connection, 2 processes — client + server — legitimately share the 4-tuple.)
        distinct_proc_pairs: Dict[Tuple[int, Optional[int]], NetworkEvent] = {}
        for ev, _dir, _d in tuple_matches:
            distinct_proc_pairs[(ev.process.pid, ev.socket_fd)] = ev

        # Check if more than 2 distinct (pid, fd) endpoints claim this exact 4-tuple concurrently
        if len(distinct_proc_pairs) > 2:
            correlations.append(
                CorrelationRecord(
                    packet_sequence=pkt.sequence,
                    flow_id=flow_id,
                    connection_tuple=conn_tuple_str,
                    confidence="unresolved",
                    method="four_tuple_ambiguous",
                    reason=(
                        f"Ambiguous mapping: {len(distinct_proc_pairs)} distinct (pid, fd) sockets "
                        "matched this four-tuple; refusing to fabricate a process correlation."
                    ),
                )
            )
            continue

        # Step 2: Filter by monotonic window & operation compatibility
        in_window = [(ev, d_str, d_ns) for (ev, d_str, d_ns) in tuple_matches if d_ns <= window_ns]
        compatible_in_window = [
            (ev, d_str, d_ns) for (ev, d_str, d_ns) in in_window if _is_operation_compatible(pkt, ev)
        ]

        if compatible_in_window:
            compatible_in_window.sort(key=lambda item: item[2])
            selected = compatible_in_window
            best_delta_ns = selected[0][2]
            confidence = "high"
            method = "four_tuple_monotonic_and_operation"
            reason = (
                f"Matched {len(selected)} compatible socket_api event(s) by exact 4-tuple "
                f"(forward/reverse) within {best_delta_ns / 1e6:.3f} ms monotonic callback window."
            )
        elif in_window:
            in_window.sort(key=lambda item: item[2])
            selected = in_window
            best_delta_ns = selected[0][2]
            confidence = "medium"
            method = "four_tuple_and_monotonic_window"
            reason = (
                f"Matched {len(selected)} socket_api event(s) by exact 4-tuple within "
                f"{best_delta_ns / 1e6:.3f} ms monotonic window (kernel-generated control packet)."
            )
        else:
            tuple_matches.sort(key=lambda item: item[2])
            selected = tuple_matches
            best_delta_ns = selected[0][2]
            confidence = "low"
            method = "four_tuple_only_outside_window"
            reason = (
                f"Exact 4-tuple matched {len(selected)} socket_api event(s), but nearest monotonic "
                f"callback delta ({best_delta_ns / 1e6:.3f} ms) exceeded {window_ns / 1e6:.0f} ms window."
            )

        related_seqs = sorted({ev.sequence for ev, _, _ in selected})
        proc_seen: Dict[int, str] = {}
        fds_seen: Set[int] = set()
        for ev, _, _ in selected:
            proc_seen[ev.process.pid] = ev.process.name
            if ev.socket_fd is not None:
                fds_seen.add(ev.socket_fd)

        if flow_id:
            flow_socket_map.setdefault(flow_id, set()).update(related_seqs)

        correlations.append(
            CorrelationRecord(
                packet_sequence=pkt.sequence,
                flow_id=flow_id,
                connection_tuple=conn_tuple_str,
                related_socket_event_sequences=related_seqs,
                related_processes=[{"pid": pid, "name": name} for pid, name in sorted(proc_seen.items())],
                related_socket_fds=sorted(fds_seen),
                confidence=confidence,
                method=method,
                reason=reason,
                monotonic_delta_ms=round(best_delta_ns / 1e6, 3),
            )
        )

    # Back-populate correlated socket sequences onto TcpFlowSummary objects
    if flows:
        for flow in flows:
            if flow.flow_id in flow_socket_map:
                flow.correlated_socket_sequences = sorted(flow_socket_map[flow.flow_id])

    return correlations
