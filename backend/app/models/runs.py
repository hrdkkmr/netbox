from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from .events import NetworkEvent


class RunCreateRequest(BaseModel):
    example_id: str = Field(default="tcp-echo", description="Approved example identifier (e.g. tcp-echo)")
    client_args: Optional[List[str]] = Field(default=None, description="Optional arguments passed to client")
    capture_packets: bool = Field(default=True, description="Whether to attempt real libpcap packet capture")
    capture_interface: Optional[str] = Field(
        default=None,
        description="Optional capture interface override (defaults to verified loopback 'lo' for local TCP)",
    )
    enable_payload_preview: bool = Field(
        default=False,
        description="Privacy opt-in: disabled by default; when true captures small bounded payload preview for this run only",
    )


class ProcessExecutionSummary(BaseModel):
    pid: Optional[int] = None
    name: str
    exit_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""


class RunResponse(BaseModel):
    run_id: str
    example_id: str
    status: str  # "pending", "running", "completed", "failed", "stopped"
    created_at: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    duration_ms: Optional[float] = None
    exit_code: Optional[int] = None
    processes: List[ProcessExecutionSummary] = []
    event_count: int = 0
    error: Optional[str] = None
    # Phase 4 capture status metadata
    socket_capture_status: str = "COMPLETED"
    packet_capture_status: str = "NOT_REQUESTED"  # NOT_REQUESTED | STARTING | CAPTURING | COMPLETED | FAILED | UNAVAILABLE
    packet_capture_interface: Optional[str] = None
    packet_capture_error: Optional[str] = None
    packet_count: int = 0
    payload_capture_enabled: bool = False


class RunEventsResponse(BaseModel):
    run_id: str
    schema_version: str = "1.0"
    is_simulated: bool = False
    simulation_label: str = "ACTUAL SOCKET API EVENTS"
    event_count: int
    events: List[NetworkEvent]


class RunListItem(BaseModel):
    run_id: str
    example_id: str
    status: str
    created_at: str
    event_count: int
    exit_code: Optional[int] = None
    socket_capture_status: str = "COMPLETED"
    packet_capture_status: str = "NOT_REQUESTED"
    packet_count: int = 0
