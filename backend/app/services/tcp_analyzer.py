from typing import Dict, List, Optional, Set, Tuple

from ..models.events import NetworkEvent
from ..models.packets import (
    HandshakeStep,
    PacketAnalysisMeta,
    PacketExplanation,
    PacketRecord,
    RetransmissionObservation,
    TcpFlags,
    TcpFlowSummary,
    TcpHandshakeSummary,
    TcpTerminationSummary,
)


def decode_flags_list(flags: TcpFlags) -> List[str]:
    names: List[str] = []
    if flags.syn:
        names.append("SYN")
    if flags.ack:
        names.append("ACK")
    if flags.fin:
        names.append("FIN")
    if flags.rst:
        names.append("RST")
    if flags.psh:
        names.append("PSH")
    if flags.urg:
        names.append("URG")
    if flags.ece:
        names.append("ECE")
    if flags.cwr:
        names.append("CWR")
    return names


def classify_tcp_packet(flags: TcpFlags, payload_length: int) -> str:
    if flags.rst:
        return "RST"
    if flags.syn and flags.ack:
        return "SYN+ACK"
    if flags.syn and not flags.ack:
        return "SYN"
    if flags.fin and flags.ack:
        return "FIN+ACK"
    if flags.fin:
        return "FIN"
    if payload_length > 0:
        return "DATA"
    if flags.ack:
        return "ACK"
    return "OTHER"


def explain_packet(pkt: PacketRecord) -> PacketExplanation:
    """
    Produces a deterministic, educational 4-part packet explanation grounded
    strictly in captured header fields (no LLM).
    """
    if pkt.protocol != "TCP" or not pkt.network or not pkt.transport or not pkt.transport.tcp:
        return PacketExplanation(
            summary=f"Captured {pkt.protocol} frame on {pkt.interface} ({pkt.capture.captured_length} B captured / {pkt.capture.original_length} B original).",
            observed=f"Link-layer {pkt.link_layer.type} frame classified as {pkt.protocol}.",
            flags_meaning="No TCP flags decoded for this packet.",
            reasonable_inference="Header metadata reflects a non-TCP or truncated frame.",
            cannot_conclude="TCP transport state or application semantics cannot be concluded from this frame.",
        )

    net = pkt.network
    tcp = pkt.transport.tcp
    flags = tcp.flags
    flag_names = decode_flags_list(flags)
    flags_str = "+".join(flag_names) if flag_names else "NONE"
    payload_len = pkt.payload.payload_length
    src = f"{net.source_ip}:{tcp.source_port}"
    dst = f"{net.destination_ip}:{tcp.destination_port}"

    observed = (
        f"IPv{net.ip_version} TCP segment from {src} to {dst} on '{pkt.interface}' "
        f"(flags={flags_str} [0x{tcp.flags_raw:02x}], seq={tcp.sequence_number}, "
        f"ack={tcp.acknowledgement_number}, win={tcp.window_size}, "
        f"tcp_hlen={tcp.header_length} B, payload={payload_len} B)."
    )

    meanings: List[str] = []
    if flags.syn and not flags.ack:
        meanings.append("SYN: The TCP endpoint is requesting to establish a connection and advertising its Initial Sequence Number (ISN).")
    elif flags.syn and flags.ack:
        meanings.append("SYN+ACK: The responding endpoint acknowledges the peer's SYN (ack = peer ISN + 1) and advertises its own ISN.")
    else:
        if flags.ack:
            meanings.append(
                f"ACK: The endpoint acknowledges receipt of peer byte-stream data up to sequence number {tcp.acknowledgement_number} (byte-stream offset, not an application message ID)."
            )
        if flags.fin:
            meanings.append("FIN: The sender is requesting an orderly shutdown of its sending direction (no further application bytes will be sent).")
        if flags.rst:
            meanings.append("RST: Indicates an abrupt TCP connection reset/termination.")
        if flags.psh:
            meanings.append("PSH: Indicates a push request asking the receiver's TCP stack to deliver buffered bytes promptly to the application.")
        if flags.urg:
            meanings.append("URG: Marks the urgent pointer field as significant.")
        if flags.ece:
            meanings.append("ECE: Explicit Congestion Notification (ECN) echo indicator.")
        if flags.cwr:
            meanings.append("CWR: Congestion Window Reduced indicator.")

    if not meanings:
        meanings.append("No TCP control flags are set.")

    flags_meaning = " ".join(meanings)

    if flags.syn and not flags.ack:
        summary = f"TCP SYN connection request ({src} -> {dst})"
        inference = "An endpoint initiated TCP connection setup toward the destination port."
        cannot = "Cannot conclude from this single packet alone whether the destination accepted the connection or completed the handshake."
    elif flags.syn and flags.ack:
        summary = f"TCP SYN+ACK handshake response ({src} -> {dst})"
        inference = "A listening TCP stack accepted the initial SYN and responded with its own sequence number."
        cannot = "Cannot conclude from this packet alone that the final ACK arrived or that accept() has returned in user space."
    elif flags.rst:
        summary = f"TCP RST connection reset ({src} -> {dst})"
        inference = "Either no socket was listening on the target port or the endpoint abruptly aborted the connection."
        cannot = "Cannot determine the internal application reason for the reset without inspecting socket API logs."
    elif flags.fin:
        summary = f"TCP {flags_str} graceful shutdown segment ({src} -> {dst})"
        inference = "The sender closed or shut down its write side of the TCP stream."
        cannot = "Cannot assume a full four-packet FIN exchange or infer kernel TIME_WAIT state without observing both directions."
    elif payload_len > 0:
        summary = f"TCP {flags_str} carrying {payload_len} B payload ({src} -> {dst})"
        inference = (
            f"The sender's TCP stack transmitted {payload_len} byte(s) starting at stream sequence number "
            f"{tcp.sequence_number} (byte offset in the TCP stream, not a message counter)."
        )
        cannot = "Cannot confirm from this packet alone that the remote application has called recv() to read these bytes."
    elif flags.ack:
        summary = f"TCP ACK control segment acknowledging up to {tcp.acknowledgement_number} ({src} -> {dst})"
        inference = "The receiver's kernel TCP stack is acknowledging prior control flags or received stream bytes and advertising its receive window."
        cannot = "Cannot conclude that the user-space application has finished processing the acknowledged data."
    else:
        summary = f"TCP {flags_str} segment ({src} -> {dst})"
        inference = "Observed TCP segment with non-standard flag combination."
        cannot = "Connection state transitions cannot be inferred from this packet alone."

    return PacketExplanation(
        summary=summary,
        observed=observed,
        flags_meaning=flags_meaning,
        reasonable_inference=inference,
        cannot_conclude=cannot,
    )


def canonical_flow_key(
    src_ip: str, src_port: int, dst_ip: str, dst_port: int
) -> Tuple[str, str, str]:
    """
    Returns (flow_id, endpoint_a, endpoint_b) ordered canonically so forward
    and reverse packets belong to the exact same bidirectional flow.
    """
    ep1 = f"{src_ip}:{src_port}"
    ep2 = f"{dst_ip}:{dst_port}"
    if (src_ip, src_port) <= (dst_ip, dst_port):
        return f"{ep1}<->{ep2}", ep1, ep2
    return f"{ep2}<->{ep1}", ep2, ep1


def _infer_roles_from_socket_events(
    ep_a: str, ep_b: str, socket_events: Optional[List[NetworkEvent]]
) -> Tuple[Optional[str], Optional[str]]:
    """
    Attempts to determine which endpoint is client vs server using observed
    Phase 2 socket API calls (connect -> client; bind/listen/accept -> server).
    Never guesses solely from port numbers.
    """
    if not socket_events:
        return None, None

    for ev in socket_events:
        if not ev.connection:
            continue
        loc = (
            f"{ev.connection.local_ip}:{ev.connection.local_port}"
            if ev.connection.local_ip and ev.connection.local_port is not None
            else None
        )
        rem = (
            f"{ev.connection.remote_ip}:{ev.connection.remote_port}"
            if ev.connection.remote_ip and ev.connection.remote_port is not None
            else None
        )
        if not loc or not rem:
            continue
        if {loc, rem} != {ep_a, ep_b}:
            continue
        if ev.event_type == "connect":
            return loc, rem
        if ev.event_type in ("accept", "accept4"):
            return rem, loc

    return None, None


def analyze_packets_and_flows(
    packets: List[PacketRecord],
    socket_events: Optional[List[NetworkEvent]] = None,
) -> List[TcpFlowSummary]:
    """
    Deterministic TCP analyzer:
    - Attaches PacketAnalysisMeta (flags, classification, flow_id, retransmission
      candidate metadata, educational explanation) onto each PacketRecord.
    - Groups TCP packets into bidirectional 4-tuple flows.
    - Detects complete vs. incomplete handshakes strictly from captured packets.
    - Detects observed FIN/RST termination sequences without assuming 4-way FIN.
    - Detects confirmed vs. possible retransmission candidates conservatively.
    """
    flows_packets: Dict[str, List[PacketRecord]] = {}
    flow_endpoints: Dict[str, Tuple[str, str]] = {}

    for pkt in packets:
        explanation = explain_packet(pkt)
        if pkt.protocol == "TCP" and pkt.network and pkt.transport and pkt.transport.tcp:
            tcp = pkt.transport.tcp
            flag_names = decode_flags_list(tcp.flags)
            flags_label = "+".join(flag_names) if flag_names else "NONE"
            classification = classify_tcp_packet(tcp.flags, pkt.payload.payload_length)
            fid, ep_a, ep_b = canonical_flow_key(
                pkt.network.source_ip,
                tcp.source_port,
                pkt.network.destination_ip,
                tcp.destination_port,
            )
            pkt.analysis = PacketAnalysisMeta(
                flags_list=flag_names,
                flags_label=flags_label,
                classification=classification,
                flow_id=fid,
                explanation=explanation,
            )
            flows_packets.setdefault(fid, []).append(pkt)
            flow_endpoints[fid] = (ep_a, ep_b)
        else:
            pkt.analysis = PacketAnalysisMeta(
                flags_list=[],
                flags_label="N/A",
                classification="OTHER",
                flow_id=None,
                explanation=explanation,
            )

    flow_summaries: List[TcpFlowSummary] = []

    for fid, fpkt_list in flows_packets.items():
        ep_a, ep_b = flow_endpoints[fid]

        # Determine client/server endpoints strictly from observed SYN or socket events
        client_ep: Optional[str] = None
        server_ep: Optional[str] = None
        role_det = "undetermined"

        first_syn = next(
            (
                p
                for p in fpkt_list
                if p.transport and p.transport.tcp and p.transport.tcp.flags.syn and not p.transport.tcp.flags.ack
            ),
            None,
        )
        if first_syn and first_syn.network and first_syn.transport and first_syn.transport.tcp:
            client_ep = f"{first_syn.network.source_ip}:{first_syn.transport.tcp.source_port}"
            server_ep = f"{first_syn.network.destination_ip}:{first_syn.transport.tcp.destination_port}"
            role_det = "observed_syn"
        else:
            c_ep, s_ep = _infer_roles_from_socket_events(ep_a, ep_b, socket_events)
            if c_ep and s_ep:
                client_ep, server_ep = c_ep, s_ep
                role_det = "socket_correlation"

        packets_a_to_b = 0
        packets_b_to_a = 0
        bytes_a_to_b = 0
        bytes_b_to_a = 0
        observed_flags_set: Set[str] = set()

        # Handshake tracking (strictly observed packets only)
        syn_pkt: Optional[PacketRecord] = None
        syn_ack_pkt: Optional[PacketRecord] = None
        hs_ack_pkt: Optional[PacketRecord] = None

        # Termination tracking
        fin_pkts: List[int] = []
        rst_pkts: List[int] = []
        ack_after_fin_pkts: List[int] = []
        fin_senders: Set[str] = set()

        # Retransmission tracking per direction
        # Maps (src_ep, seq_num, payload_len, syn, fin) -> first PacketRecord
        seen_segments: Dict[Tuple[str, int, int, bool, bool], PacketRecord] = {}
        highest_seq_end_by_dir: Dict[str, int] = {}
        retransmissions: List[RetransmissionObservation] = []

        for pkt in fpkt_list:
            assert pkt.network is not None and pkt.transport is not None and pkt.transport.tcp is not None
            tcp = pkt.transport.tcp
            flags = tcp.flags
            src_ep = f"{pkt.network.source_ip}:{tcp.source_port}"
            plen = pkt.payload.payload_length

            if src_ep == ep_a:
                packets_a_to_b += 1
                bytes_a_to_b += plen
            else:
                packets_b_to_a += 1
                bytes_b_to_a += plen

            for fl in decode_flags_list(flags):
                observed_flags_set.add(fl)

            # Handshake detection
            if flags.syn and not flags.ack and syn_pkt is None:
                syn_pkt = pkt
            elif flags.syn and flags.ack and syn_ack_pkt is None:
                if syn_pkt is None or src_ep == server_ep:
                    syn_ack_pkt = pkt
            elif (
                flags.ack
                and not flags.syn
                and not flags.fin
                and not flags.rst
                and hs_ack_pkt is None
                and syn_ack_pkt is not None
                and syn_ack_pkt.transport is not None
                and syn_ack_pkt.transport.tcp is not None
            ):
                # Must be sent by client acknowledging server's SYN+ACK ISN + 1
                expected_ack = (syn_ack_pkt.transport.tcp.sequence_number + 1) & 0xFFFFFFFF
                if (client_ep is None or src_ep == client_ep) and tcp.acknowledgement_number == expected_ack:
                    hs_ack_pkt = pkt

            # Termination tracking
            if flags.rst:
                rst_pkts.append(pkt.sequence)
            if flags.fin:
                fin_pkts.append(pkt.sequence)
                fin_senders.add(src_ep)
            elif flags.ack and len(fin_pkts) > 0 and not flags.syn:
                ack_after_fin_pkts.append(pkt.sequence)

            # Conservative retransmission candidate detection
            # Pure zero-length ACKs (not SYN/FIN) are NOT retransmissions (they are normal dup-ACKs / window updates)
            consumes_seq_space = plen > 0 or flags.syn or flags.fin
            if consumes_seq_space:
                sig = (src_ep, tcp.sequence_number, plen, flags.syn, flags.fin)
                seg_len = plen + (1 if flags.syn else 0) + (1 if flags.fin else 0)
                seg_end = (tcp.sequence_number + seg_len) & 0xFFFFFFFF

                if sig in seen_segments:
                    orig = seen_segments[sig]
                    # Same sender, identical sequence number + payload length/control flag
                    status = "confirmed_retransmission" if (flags.syn or flags.fin or plen > 0) else "possible_retransmission"
                    reason = (
                        f"Repeated segment from {src_ep} with identical seq={tcp.sequence_number}, "
                        f"payload_len={plen}, flags={pkt.analysis.flags_label if pkt.analysis else ''} "
                        f"(first seen in packet #{orig.sequence})."
                    )
                    retransmissions.append(
                        RetransmissionObservation(
                            packet_sequence=pkt.sequence,
                            original_packet_sequence=orig.sequence,
                            status=status,
                            tcp_sequence_number=tcp.sequence_number,
                            payload_length=plen,
                            reason=reason,
                        )
                    )
                    if pkt.analysis:
                        pkt.analysis.retransmission_status = status
                        pkt.analysis.retransmission_reason = reason
                else:
                    prev_high = highest_seq_end_by_dir.get(src_ep)
                    # Check out-of-order / overlapping partial sequence repeat (possible retransmission)
                    if prev_high is not None and tcp.sequence_number < prev_high and (prev_high - tcp.sequence_number) < 0x80000000:
                        status = "possible_retransmission"
                        reason = (
                            f"Segment seq={tcp.sequence_number} from {src_ep} is lower than previously observed "
                            f"highest sequence end {prev_high}; may indicate retransmission or out-of-order delivery."
                        )
                        first_ref = fpkt_list[0].sequence
                        retransmissions.append(
                            RetransmissionObservation(
                                packet_sequence=pkt.sequence,
                                original_packet_sequence=first_ref,
                                status=status,
                                tcp_sequence_number=tcp.sequence_number,
                                payload_length=plen,
                                reason=reason,
                            )
                        )
                        if pkt.analysis:
                            pkt.analysis.retransmission_status = status
                            pkt.analysis.retransmission_reason = reason
                    seen_segments[sig] = pkt
                    if prev_high is None or seg_end > prev_high:
                        highest_seq_end_by_dir[src_ep] = seg_end

        # Build Handshake Summary (strictly reflecting captured packets only)
        hs_steps = [
            HandshakeStep(
                step="SYN",
                observed=syn_pkt is not None,
                packet_sequence=syn_pkt.sequence if syn_pkt else None,
                direction="client->server" if syn_pkt else None,
                seq_num=syn_pkt.transport.tcp.sequence_number if (syn_pkt and syn_pkt.transport and syn_pkt.transport.tcp) else None,
                ack_num=syn_pkt.transport.tcp.acknowledgement_number if (syn_pkt and syn_pkt.transport and syn_pkt.transport.tcp) else None,
                capture_monotonic_ns=syn_pkt.timestamp.capture_monotonic_ns if syn_pkt else None,
            ),
            HandshakeStep(
                step="SYN+ACK",
                observed=syn_ack_pkt is not None,
                packet_sequence=syn_ack_pkt.sequence if syn_ack_pkt else None,
                direction="server->client" if syn_ack_pkt else None,
                seq_num=syn_ack_pkt.transport.tcp.sequence_number if (syn_ack_pkt and syn_ack_pkt.transport and syn_ack_pkt.transport.tcp) else None,
                ack_num=syn_ack_pkt.transport.tcp.acknowledgement_number if (syn_ack_pkt and syn_ack_pkt.transport and syn_ack_pkt.transport.tcp) else None,
                capture_monotonic_ns=syn_ack_pkt.timestamp.capture_monotonic_ns if syn_ack_pkt else None,
            ),
            HandshakeStep(
                step="ACK",
                observed=hs_ack_pkt is not None,
                packet_sequence=hs_ack_pkt.sequence if hs_ack_pkt else None,
                direction="client->server" if hs_ack_pkt else None,
                seq_num=hs_ack_pkt.transport.tcp.sequence_number if (hs_ack_pkt and hs_ack_pkt.transport and hs_ack_pkt.transport.tcp) else None,
                ack_num=hs_ack_pkt.transport.tcp.acknowledgement_number if (hs_ack_pkt and hs_ack_pkt.transport and hs_ack_pkt.transport.tcp) else None,
                capture_monotonic_ns=hs_ack_pkt.timestamp.capture_monotonic_ns if hs_ack_pkt else None,
            ),
        ]

        observed_hs_count = sum(1 for s in hs_steps if s.observed)
        if observed_hs_count == 3:
            hs_status = "COMPLETE"
            hs_note = "Observed full three-packet TCP handshake (SYN, SYN+ACK, ACK) in captured packets."
        elif observed_hs_count > 0:
            missing = [s.step for s in hs_steps if not s.observed]
            hs_status = "INCOMPLETE"
            hs_note = f"Incomplete TCP handshake observed; missing captured packet(s): {', '.join(missing)}."
        else:
            hs_status = "NOT_OBSERVED"
            hs_note = "No TCP handshake packets (SYN / SYN+ACK) were captured for this flow."

        # Build Termination Summary
        if len(rst_pkts) > 0:
            term_status = "RESET_OBSERVED"
            term_note = f"Observed abrupt TCP reset (RST) in packet(s): {rst_pkts}."
        elif len(fin_senders) >= 2 and len(ack_after_fin_pkts) >= 1:
            term_status = "COMPLETE_FIN_EXCHANGE"
            term_note = f"Observed bidirectional FIN termination (FIN packets: {fin_pkts}) with ACK response(s)."
        elif len(fin_pkts) > 0:
            term_status = "PARTIAL_FIN_OBSERVED"
            term_note = (
                f"Observed FIN packet(s) {fin_pkts} from {len(fin_senders)} direction(s); "
                "do not assume a complete four-packet FIN exchange."
            )
        else:
            term_status = "NOT_OBSERVED"
            term_note = "No FIN or RST termination packets were captured for this flow."

        flow_summaries.append(
            TcpFlowSummary(
                flow_id=fid,
                endpoint_a=ep_a,
                endpoint_b=ep_b,
                client_endpoint=client_ep,
                server_endpoint=server_ep,
                role_determination=role_det,
                packet_count=len(fpkt_list),
                packets_a_to_b=packets_a_to_b,
                packets_b_to_a=packets_b_to_a,
                payload_bytes_a_to_b=bytes_a_to_b,
                payload_bytes_b_to_a=bytes_b_to_a,
                observed_flags=sorted(observed_flags_set),
                handshake=TcpHandshakeSummary(status=hs_status, note=hs_note, steps=hs_steps),
                termination=TcpTerminationSummary(
                    status=term_status,
                    note=term_note,
                    fin_packets=fin_pkts,
                    rst_packets=rst_pkts,
                    ack_after_fin_packets=ack_after_fin_pkts,
                ),
                retransmissions=retransmissions,
                packet_sequences=[p.sequence for p in fpkt_list],
            )
        )

    return flow_summaries
