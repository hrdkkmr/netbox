from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ComponentHealth(BaseModel):
    name: str
    status: str = Field(..., description="running | degraded | unavailable | disabled")
    detail: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SystemHealthResponse(BaseModel):
    overall_status: str = Field(..., description="running | degraded | unavailable")
    timestamp: str
    backend_version: str
    mode: str
    components: Dict[str, ComponentHealth]


class SystemInfoResponse(BaseModel):
    name: str = "NetBox"
    version: str
    current_phase: str
    mode: str
    bind_host: str
    port: int
    hostname: str
    os_platform: str
    is_wsl2: bool
    wsl_network_mode: str
    uptime_seconds: float
    total_runs: int
    active_runs: int
    internet_required: bool = False
    ai_inference_location: str = "host_local_only"


class NetworkInterfaceRecord(BaseModel):
    name: str
    source: str = Field(..., description="linux_wsl | windows_host")
    ipv4_addresses: List[str] = Field(default_factory=list)
    subnet_masks: List[str] = Field(default_factory=list)
    mac_address: Optional[str] = None
    is_up: bool = True
    is_loopback: bool = False
    is_lan_candidate: bool = False
    adapter_hint: Optional[str] = None


class SystemNetworkResponse(BaseModel):
    mode: str
    bind_host: str
    port: int
    is_wsl2: bool
    wsl_network_mode: str
    wsl_eth0_ip: Optional[str] = None
    default_gateway: Optional[str] = None
    advertised_host: Optional[str] = None
    recommended_lan_ip: Optional[str] = None
    recommended_lan_url: Optional[str] = None
    local_url: str
    lan_urls: List[str] = Field(default_factory=list)
    interfaces: List[NetworkInterfaceRecord] = Field(default_factory=list)
    wsl_portproxy_command: Optional[str] = None
    wsl_firewall_command: Optional[str] = None
    troubleshooting: List[str] = Field(default_factory=list)


class ServiceItem(BaseModel):
    id: str
    name: str
    status: str  # running | degraded | unavailable
    endpoint: Optional[str] = None
    lan_exposed: bool = False
    detail: str


class SystemServicesResponse(BaseModel):
    mode: str
    services: List[ServiceItem]


class ConnectedClientRecord(BaseModel):
    client_id: str
    label: str
    remote_ip: str
    client_type: str  # "browser" | "vscode" | "api"
    connected_at: str
    last_seen: str
    is_host_local: bool


class SystemConnectionResponse(BaseModel):
    mode: str
    local_url: str
    lan_url: Optional[str] = None
    lan_urls: List[str] = Field(default_factory=list)
    auth_required: bool
    allow_remote_execution: bool
    pairing_token_preview: Optional[str] = None
    pairing_token: Optional[str] = Field(
        default=None,
        description="Only visible to host loopback callers; always null for remote LAN clients.",
    )
    health_check_interval_ms: int
    connection_timeout_ms: int
    qr_svg: Optional[str] = None
    connected_clients: List[ConnectedClientRecord] = Field(default_factory=list)
    connected_client_count: int = 0
    security_notes: List[str] = Field(default_factory=list)


class ClientHeartbeatRequest(BaseModel):
    client_id: str = Field(..., min_length=2, max_length=64)
    label: str = Field(default="NetBox Client", max_length=80)
    client_type: str = Field(default="browser", max_length=32)


class AuthVerifyRequest(BaseModel):
    token: Optional[str] = None


class AuthVerifyResponse(BaseModel):
    authenticated: bool
    auth_required: bool
    is_host_local: bool
    allow_remote_execution: bool
    detail: str


class AccessControlUpdateRequest(BaseModel):
    require_auth: Optional[bool] = None
    allow_remote_execution: Optional[bool] = None
    rotate_token: bool = False
    custom_token: Optional[str] = None
