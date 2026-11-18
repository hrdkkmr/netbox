from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class PacketTimestamp(BaseModel):
    pcap_timestamp_ns: int = Field(..., description="Original libpcap capture timestamp (wall-clock based, ns)")
    capture_monotonic_ns: int = Field(..., description="CLOCK_MONOTONIC timestamp recorded in capture callback (ns)")


class LinkLayerInfo(BaseModel):
    type: str = Field(..., description="Decoded libpcap datalink type (e.g. DLT_EN10MB, DLT_LINUX_SLL, DLT_NULL)")
    dlt: int = Field(..., description="Numeric libpcap DLT constant")
    source_mac: Optional[str] = None
    destination_mac: Optional[str] = None


class NetworkHeaderInfo(BaseModel):
    ip_version: int = 4
    source_ip: str
    destination_ip: str
    ttl: int
    header_length: int
    total_length: int
    identification: int
    protocol_number: int


class TcpFlags(BaseModel):
    syn: bool = False
    ack: bool = False
    fin: bool = False
    rst: bool = False
    psh: bool = False
    urg: bool = False
    ece: bool = False
    cwr: bool = False


class TcpOption(BaseModel):
    name: str
    value: str


class TcpHeaderInfo(BaseModel):
    source_port: int
    destination_port: int
    sequence_number: int
    acknowledgement_number: int
    header_length: int
    window_size: int
    flags_raw: int
    flags: TcpFlags
    options: List[TcpOption] = Field(default_factory=list)


class TransportInfo(BaseModel):
    source_port: Optional[int] = None
    destination_port: Optional[int] = None
    tcp: Optional[TcpHeaderInfo] = None


class PacketPayloadInfo(BaseModel):
    captured_bytes: int = 0
    payload_length: int = 0
    preview_hex: Optional[str] = None
    preview_utf8: Optional[str] = None
    truncated: bool = False


class CaptureLengthInfo(BaseModel):
    captured_length: int
    original_length: int
    truncated: bool = False
    header_truncated: bool = False


class PacketExplanation(BaseModel):
    summary: str
    observed: str
    flags_meaning: str
    reasonable_inference: str
    cannot_conclude: str


class PacketAnalysisMeta(BaseModel):
    flags_list: List[str] = Field(default_factory=list)
    flags_label: str = "NONE"
    classification: str = "OTHER"  # SYN, SYN+ACK, ACK, DATA, FIN, FIN+ACK, RST, OTHER
    flow_id: Optional[str] = None
    retransmission_status: Optional[str] = None  # None | "possible_retransmission" | "confirmed_retransmission"
    retransmission_reason: Optional[str] = None
    explanation: Optional[PacketExplanation] = None


class PacketRecord(BaseModel):
    schema_version: str = "1.0"
    run_id: str
    sequence: int
    source: str = "packet_capture"
    timestamp: PacketTimestamp
    interface: str
    link_layer: LinkLayerInfo
    protocol: str
    network: Optional[NetworkHeaderInfo] = None
    transport: Optional[TransportInfo] = None
    payload: PacketPayloadInfo
    capture: CaptureLengthInfo
    is_simulated: bool = False
    analysis: Optional[PacketAnalysisMeta] = None


class HandshakeStep(BaseModel):
    step: str  # "SYN", "SYN+ACK", "ACK"
    observed: bool
    packet_sequence: Optional[int] = None
    direction: Optional[str] = None  # "client->server" | "server->client"
    seq_num: Optional[int] = None
    ack_num: Optional[int] = None
    capture_monotonic_ns: Optional[int] = None


class TcpHandshakeSummary(BaseModel):
    status: str  # "COMPLETE" | "INCOMPLETE" | "NOT_OBSERVED"
    note: str
    steps: List[HandshakeStep] = Field(default_factory=list)


class TcpTerminationSummary(BaseModel):
    status: str  # "COMPLETE_FIN_EXCHANGE" | "PARTIAL_FIN_OBSERVED" | "RESET_OBSERVED" | "NOT_OBSERVED"
    note: str
    fin_packets: List[int] = Field(default_factory=list)
    rst_packets: List[int] = Field(default_factory=list)
    ack_after_fin_packets: List[int] = Field(default_factory=list)


class RetransmissionObservation(BaseModel):
    packet_sequence: int
    original_packet_sequence: int
    status: str  # "confirmed_retransmission" | "possible_retransmission"
    tcp_sequence_number: int
    payload_length: int
    reason: str


class TcpFlowSummary(BaseModel):
    flow_id: str
    endpoint_a: str
    endpoint_b: str
    client_endpoint: Optional[str] = None
    server_endpoint: Optional[str] = None
    role_determination: str  # "observed_syn" | "socket_correlation" | "undetermined"
    packet_count: int
    packets_a_to_b: int
    packets_b_to_a: int
    payload_bytes_a_to_b: int
    payload_bytes_b_to_a: int
    observed_flags: List[str] = Field(default_factory=list)
    handshake: TcpHandshakeSummary
    termination: TcpTerminationSummary
    retransmissions: List[RetransmissionObservation] = Field(default_factory=list)
    packet_sequences: List[int] = Field(default_factory=list)
    correlated_socket_sequences: List[int] = Field(default_factory=list)


class CorrelationRecord(BaseModel):
    packet_sequence: int
    flow_id: Optional[str] = None
    connection_tuple: Optional[str] = None
    related_socket_event_sequences: List[int] = Field(default_factory=list)
    related_processes: List[Dict[str, Any]] = Field(default_factory=list)
    related_socket_fds: List[int] = Field(default_factory=list)
    confidence: str  # "high" | "medium" | "low" | "unresolved"
    method: str
    reason: str
    monotonic_delta_ms: Optional[float] = None


class RunPacketsResponse(BaseModel):
    run_id: str
    schema_version: str = "1.0"
    is_simulated: bool = False
    packet_capture_status: str
    interface: Optional[str] = None
    capture_error: Optional[str] = None
    payload_capture_enabled: bool = False
    packet_count: int
    packets: List[PacketRecord] = Field(default_factory=list)


class RunFlowsResponse(BaseModel):
    run_id: str
    packet_capture_status: str
    interface: Optional[str] = None
    flow_count: int
    flows: List[TcpFlowSummary] = Field(default_factory=list)


class RunCorrelationsResponse(BaseModel):
    run_id: str
    packet_capture_status: str
    correlation_count: int
    resolved_count: int
    unresolved_count: int
    correlations: List[CorrelationRecord] = Field(default_factory=list)
