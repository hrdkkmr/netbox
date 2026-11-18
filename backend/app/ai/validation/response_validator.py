import re
from dataclasses import dataclass, field
from typing import List, Optional, Set, Tuple

from ..context.context_builder import EvidenceBundle
from ..models import EvidenceReference

# Matches [PACKET: pkt_1], [SOCKET: sock_3], [FLOW: 127.0.0.1:8080<->127.0.0.1:50000], [ANALYSIS: handshake:...]
CITATION_PATTERN = re.compile(
    r"\[(PACKET|SOCKET|FLOW|ANALYSIS)\s*:\s*([^\]]+)\]",
    re.IGNORECASE,
)


@dataclass
class ValidationReport:
    verified_references: List[EvidenceReference] = field(default_factory=list)
    unverified_references: List[str] = field(default_factory=list)
    grounding_warnings: List[str] = field(default_factory=list)


def _parse_seq_num(raw_id: str, expected_prefix: str) -> Optional[int]:
    cleaned = raw_id.strip()
    m = re.match(rf"^(?:{expected_prefix}_|#)?(\d+)$", cleaned, re.IGNORECASE)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def validate_ai_response(
    answer_text: str,
    bundle: Optional[EvidenceBundle],
) -> ValidationReport:
    """
    Validates LLM-generated output against the deterministic Layer A evidence bundle:
    1. Resolves every [PACKET/SOCKET/FLOW/ANALYSIS] tag against actual recorded IDs.
    2. Never allows fabricated/non-existent IDs into verified_references.
    3. Flags confidence/uncertainty contradictions (e.g., claiming a complete handshake
       when deterministic analysis reported INCOMPLETE, or claiming confirmed
       retransmission when only possible/none was observed).
    """
    report = ValidationReport()
    text = answer_text or ""
    seen_verified: Set[Tuple[str, str]] = set()
    seen_unverified: Set[str] = set()

    for match in CITATION_PATTERN.finditer(text):
        full_tag = match.group(0)
        kind_raw = match.group(1).upper()
        raw_id = match.group(2).strip()

        if bundle is None:
            if full_tag not in seen_unverified:
                seen_unverified.add(full_tag)
                report.unverified_references.append(full_tag)
            continue

        if kind_raw == "PACKET":
            seq = _parse_seq_num(raw_id, "pkt")
            if seq is not None and seq in bundle.valid_packet_seqs:
                norm_id = f"pkt_{seq}"
                if ("packet", norm_id) not in seen_verified:
                    seen_verified.add(("packet", norm_id))
                    report.verified_references.append(
                        EvidenceReference(
                            tag=full_tag,
                            kind="packet",
                            id=norm_id,
                            target_sequence=seq,
                            verified=True,
                            label=f"Packet #{seq}",
                        )
                    )
            else:
                if full_tag not in seen_unverified:
                    seen_unverified.add(full_tag)
                    report.unverified_references.append(full_tag)

        elif kind_raw == "SOCKET":
            seq = _parse_seq_num(raw_id, "sock")
            if seq is not None and seq in bundle.valid_socket_seqs:
                norm_id = f"sock_{seq}"
                if ("socket", norm_id) not in seen_verified:
                    seen_verified.add(("socket", norm_id))
                    report.verified_references.append(
                        EvidenceReference(
                            tag=full_tag,
                            kind="socket",
                            id=norm_id,
                            target_sequence=seq,
                            verified=True,
                            label=f"Socket Event #{seq}",
                        )
                    )
            else:
                if full_tag not in seen_unverified:
                    seen_unverified.add(full_tag)
                    report.unverified_references.append(full_tag)

        elif kind_raw == "FLOW":
            if raw_id in bundle.valid_flow_ids:
                if ("flow", raw_id) not in seen_verified:
                    seen_verified.add(("flow", raw_id))
                    report.verified_references.append(
                        EvidenceReference(
                            tag=full_tag,
                            kind="flow",
                            id=raw_id,
                            target_flow_id=raw_id,
                            verified=True,
                            label=f"Flow {raw_id}",
                        )
                    )
            else:
                if full_tag not in seen_unverified:
                    seen_unverified.add(full_tag)
                    report.unverified_references.append(full_tag)

        elif kind_raw == "ANALYSIS":
            if raw_id in bundle.valid_analysis_ids:
                if ("analysis", raw_id) not in seen_verified:
                    seen_verified.add(("analysis", raw_id))
                    target_seq = None
                    target_flow = None
                    if raw_id.startswith("corr:pkt_") or raw_id.startswith("retrans:pkt_"):
                        target_seq = _parse_seq_num(raw_id.split("pkt_", 1)[1], "pkt")
                    elif raw_id.startswith("handshake:") or raw_id.startswith("termination:"):
                        target_flow = raw_id.split(":", 1)[1]
                    report.verified_references.append(
                        EvidenceReference(
                            tag=full_tag,
                            kind="analysis",
                            id=raw_id,
                            target_sequence=target_seq,
                            target_flow_id=target_flow,
                            verified=True,
                            label=f"Analysis ({raw_id})",
                        )
                    )
            else:
                if full_tag not in seen_unverified:
                    seen_unverified.add(full_tag)
                    report.unverified_references.append(full_tag)

    if report.unverified_references:
        report.grounding_warnings.append(
            f"Unverified evidence reference(s) ignored and not linked: {', '.join(report.unverified_references)}."
        )

    # Confidence & deterministic consistency guardrails
    if bundle is not None:
        facts = bundle.deterministic_facts
        lower = text.lower()

        if facts.get("packet_count", 0) == 0:
            if re.search(r"\bcaptured\s+\d+\s+packets?\b", lower) and not re.search(r"\bcaptured\s+0\s+packets?\b", lower):
                report.grounding_warnings.append(
                    "Deterministic check: 0 packets were captured in this run; treat any claimed packet counts with caution."
                )

        if not facts.get("any_complete_handshake", False):
            # Flag positive claim of a complete observed handshake when deterministic status != COMPLETE
            if re.search(r"\b(complete|full)\s+(three-way\s+|3-way\s+)?handshake\s+was\s+(observed|captured|completed)\b", lower):
                report.grounding_warnings.append(
                    "Deterministic check: No COMPLETE TCP handshake was observed in captured packets for this run."
                )

        if not facts.get("any_confirmed_retrans", False):
            if re.search(r"\bconfirmed\s+retransmission\b", lower) and not re.search(
                r"\bno\s+confirmed\s+retransmission\b|\bnot\s+a?\s*confirmed\s+retransmission\b", lower
            ):
                if facts.get("any_possible_retrans", False):
                    report.grounding_warnings.append(
                        "Deterministic check: Only a 'possible_retransmission' candidate was flagged; not a confirmed retransmission."
                    )
                else:
                    report.grounding_warnings.append(
                        "Deterministic check: No confirmed retransmission was detected by the TCP analyzer."
                    )

        if facts.get("unresolved_corr_count", 0) > 0:
            if re.search(r"\ball\s+packets\s+(were|are)\s+(successfully\s+)?correlated\b", lower):
                report.grounding_warnings.append(
                    f"Deterministic check: {facts['unresolved_corr_count']} packet correlation(s) remain UNRESOLVED."
                )

    return report
