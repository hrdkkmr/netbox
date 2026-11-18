import hmac
import secrets
from typing import Optional

from fastapi import HTTPException, Request, status

from .config import get_core_config

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def get_client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def is_loopback_request(request: Request) -> bool:
    host = get_client_ip(request).strip().lower()
    if host.startswith("::ffff:"):
        host = host[7:]
    return host in LOOPBACK_HOSTS


def extract_request_token(request: Request) -> Optional[str]:
    header_token = request.headers.get("X-NetBox-Token")
    if header_token:
        return header_token.strip()
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return None


def verify_token_value(provided: Optional[str]) -> bool:
    cfg = get_core_config()
    if not cfg.require_auth:
        return True
    if not cfg.access_token or not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), cfg.access_token.encode("utf-8"))


def require_access_token(request: Request) -> None:
    """
    FastAPI dependency enforcing lightweight host-controlled LAN access control.
    - When require_auth is False: allows access.
    - Loopback requests (host itself) pass unless require_auth_localhost is True.
    - Remote LAN clients must supply matching X-NetBox-Token or Authorization: Bearer token.
    """
    cfg = get_core_config()
    if not cfg.require_auth:
        return

    if is_loopback_request(request) and not cfg.require_auth_localhost:
        return

    provided = extract_request_token(request)
    if not verify_token_value(provided):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "NetBox LAN access token required or invalid. "
                "Obtain the pairing token from the NetBox host System & LAN dashboard "
                "and supply it via 'X-NetBox-Token' or 'Authorization: Bearer <token>'."
            ),
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_execution_permission(request: Request) -> None:
    """
    Protects sensitive host execution and configuration endpoints (run creation,
    stopping runs, AI config updates, lab execution).
    """
    require_access_token(request)
    cfg = get_core_config()
    if not is_loopback_request(request) and not cfg.allow_remote_execution:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Remote experiment execution is disabled by the NetBox host policy. "
                "Remote LAN clients can still inspect runs and ask the local AI assistant."
            ),
        )


def require_host_local_only(request: Request) -> None:
    """Restricts host administrative actions (rotating pairing tokens, toggling policy) to the host."""
    if not is_loopback_request(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This administrative action is restricted to the NetBox host machine (localhost).",
        )


def rotate_access_token(custom_token: Optional[str] = None) -> str:
    cfg = get_core_config()
    if custom_token is not None:
        cleaned = custom_token.strip()
        if len(cleaned) < 6:
            raise ValueError("Access token must be at least 6 characters long.")
        cfg.access_token = cleaned
    else:
        cfg.access_token = f"nbx-{secrets.token_hex(4)}"
    cfg.require_auth = True
    return cfg.access_token
