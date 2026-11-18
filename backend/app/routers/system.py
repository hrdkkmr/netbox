from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..core.config import get_core_config
from ..core.security import (
    extract_request_token,
    get_client_ip,
    is_loopback_request,
    require_access_token,
    require_host_local_only,
    rotate_access_token,
    verify_token_value,
)
from ..models.system import (
    AccessControlUpdateRequest,
    AuthVerifyRequest,
    AuthVerifyResponse,
    ClientHeartbeatRequest,
    ConnectedClientRecord,
    SystemConnectionResponse,
    SystemHealthResponse,
    SystemInfoResponse,
    SystemNetworkResponse,
    SystemServicesResponse,
)
from ..services.network_discovery import build_network_overview
from ..services.system_service import SystemService

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health", response_model=SystemHealthResponse)
def get_system_health() -> SystemHealthResponse:
    """
    Component-level health status for Backend, Socket Instrumentation,
    Packet Capture, Ollama Runtime, Configured AI Model, and LAN Accessibility.
    """
    return SystemService.get_instance().get_health()


@router.get("/info", response_model=SystemInfoResponse)
def get_system_info() -> SystemInfoResponse:
    """Returns NetBox host runtime metadata, version, WSL mode, and run counts."""
    return SystemService.get_instance().get_info()


@router.get("/network", response_model=SystemNetworkResponse, dependencies=[Depends(require_access_token)])
def get_system_network() -> SystemNetworkResponse:
    """Returns discovered host/WSL network interfaces, LAN URLs, and WSL 2 guidance."""
    return build_network_overview()


@router.get("/services", response_model=SystemServicesResponse, dependencies=[Depends(require_access_token)])
def get_system_services() -> SystemServicesResponse:
    """Returns status and exposure boundary of all NetBox backend services."""
    return SystemService.get_instance().get_services()


@router.get("/connection", response_model=SystemConnectionResponse, dependencies=[Depends(require_access_token)])
def get_system_connection(request: Request) -> SystemConnectionResponse:
    """
    Returns client connection details, offline SVG QR code, active client sessions,
    and host-local pairing token (never exposed to remote clients).
    """
    return SystemService.get_instance().get_connection(is_host_local=is_loopback_request(request))


@router.post("/clients/heartbeat", response_model=ConnectedClientRecord, dependencies=[Depends(require_access_token)])
def post_client_heartbeat(payload: ClientHeartbeatRequest, request: Request) -> ConnectedClientRecord:
    """Records a live client session heartbeat so the host dashboard tracks real connected devices."""
    return SystemService.get_instance().clients.record_heartbeat(
        client_id=payload.client_id,
        label=payload.label,
        remote_ip=get_client_ip(request),
        client_type=payload.client_type,
        is_host_local=is_loopback_request(request),
    )


@router.post("/auth/verify", response_model=AuthVerifyResponse)
def verify_auth(payload: AuthVerifyRequest, request: Request) -> AuthVerifyResponse:
    """Verifies whether the caller is authenticated with the host's LAN access token."""
    cfg = get_core_config()
    host_local = is_loopback_request(request)
    token = payload.token or extract_request_token(request)

    if not cfg.require_auth:
        return AuthVerifyResponse(
            authenticated=True,
            auth_required=False,
            is_host_local=host_local,
            allow_remote_execution=cfg.allow_remote_execution,
            detail="Access token authentication is not currently required by the host.",
        )

    if host_local and not cfg.require_auth_localhost:
        return AuthVerifyResponse(
            authenticated=True,
            auth_required=True,
            is_host_local=True,
            allow_remote_execution=True,
            detail="Authenticated as local host (loopback).",
        )

    ok = verify_token_value(token)
    return AuthVerifyResponse(
        authenticated=ok,
        auth_required=True,
        is_host_local=host_local,
        allow_remote_execution=cfg.allow_remote_execution if ok else False,
        detail="Pairing token verified." if ok else "Invalid or missing pairing token.",
    )


@router.post(
    "/access-control",
    response_model=SystemConnectionResponse,
    dependencies=[Depends(require_host_local_only)],
)
def update_access_control(payload: AccessControlUpdateRequest, request: Request) -> SystemConnectionResponse:
    """Host-only endpoint to toggle LAN auth policy, remote execution permission, or rotate token."""
    cfg = get_core_config()
    if payload.require_auth is not None:
        cfg.require_auth = payload.require_auth
        if cfg.require_auth and not cfg.access_token:
            rotate_access_token()
    if payload.allow_remote_execution is not None:
        cfg.allow_remote_execution = payload.allow_remote_execution
    if payload.rotate_token or payload.custom_token is not None:
        try:
            rotate_access_token(payload.custom_token)
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    return SystemService.get_instance().get_connection(is_host_local=is_loopback_request(request))
