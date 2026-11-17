from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ProcessInfo(BaseModel):
    pid: int
    name: str
    ppid: Optional[int] = None
    tid: Optional[int] = None


class ConnectionInfo(BaseModel):
    local_ip: Optional[str] = None
    local_port: Optional[int] = None
    remote_ip: Optional[str] = None
    remote_port: Optional[int] = None


class PayloadInfo(BaseModel):
    bytes: int
    preview_utf8: Optional[str] = None
    truncated: bool = False


class NetworkEvent(BaseModel):
    schema_version: str = "1.0"
    run_id: str
    sequence: int
    timestamp_ns: int
    source: str = "socket_api"
    event_type: str
    process: ProcessInfo
    connection: Optional[ConnectionInfo] = None
    socket_fd: Optional[int] = None
    socket_domain: Optional[str] = None
    socket_type: Optional[str] = None
    payload: Optional[PayloadInfo] = None
    result: int
    error_code: Optional[int] = None
    error_name: Optional[str] = None
    error_message: Optional[str] = None
    is_simulated: bool = False
    simulation_label: str = "ACTUAL SOCKET API EVENTS"


class DemoSequenceResponse(BaseModel):
    demo_id: str = "tcp_echo_lifecycle"
    title: str = "TCP Client-Server Connection Lifecycle (Simulated)"
    description: str = (
        "Demonstration trace illustrating socket API operations during a full TCP echo exchange "
        "based on docs/event_schema.md. All events in this trace are simulated."
    )
    is_simulated: bool = True
    simulation_label: str = "SIMULATED"
    event_count: int
    events: List[NetworkEvent]
