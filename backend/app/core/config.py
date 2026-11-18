import os
import secrets
from dataclasses import dataclass, field
from typing import List, Optional


DEFAULT_LOCAL_ORIGINS = [
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "http://localhost",
    "http://localhost:8000",
    "vscode-webview://*",
]

LOCAL_ORIGIN_REGEX = r"^http://(127\.0\.0\.1|localhost)(:\d+)?$"
LAN_ORIGIN_REGEX = (
    r"^http://("
    r"127\.0\.0\.1|localhost|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"192\.170\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|"
    r"[a-zA-Z0-9-]+\.local"
    r")(:\d+)?$"
)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class NetBoxCoreConfig:
    """
    Centralized runtime configuration for NetBox Host & LAN operation.
    Defaults strictly to safe localhost-only operation unless NETBOX_MODE=lan.
    """

    mode: str = "localhost"  # "localhost" | "lan"
    bind_host: str = "127.0.0.1"
    port: int = 8000
    advertised_host: Optional[str] = None
    require_auth: bool = False
    require_auth_localhost: bool = False
    access_token: Optional[str] = None
    allow_remote_execution: bool = True
    health_check_interval_ms: int = 10000
    connection_timeout_ms: int = 5000
    cors_origins: List[str] = field(default_factory=lambda: list(DEFAULT_LOCAL_ORIGINS))
    cors_origin_regex: str = LOCAL_ORIGIN_REGEX

    @classmethod
    def from_env(cls) -> "NetBoxCoreConfig":
        raw_mode = os.environ.get("NETBOX_MODE", "localhost").strip().lower()
        mode = "lan" if raw_mode == "lan" else "localhost"

        default_host = "0.0.0.0" if mode == "lan" else "127.0.0.1"
        bind_host = os.environ.get("NETBOX_HOST", default_host).strip() or default_host

        try:
            port = int(os.environ.get("NETBOX_PORT", "8000").strip())
            if port < 1 or port > 65535:
                port = 8000
        except ValueError:
            port = 8000

        advertised_host = os.environ.get("NETBOX_ADVERTISED_HOST", "").strip() or None

        token_env = os.environ.get("NETBOX_ACCESS_TOKEN", "").strip() or None
        require_auth = _env_bool("NETBOX_REQUIRE_AUTH", default=(mode == "lan" or token_env is not None))
        require_auth_localhost = _env_bool("NETBOX_REQUIRE_AUTH_LOCALHOST", default=False)

        access_token = token_env
        if require_auth and not access_token:
            # Generate a short human-typeable pairing code for LAN sessions when none was configured
            access_token = f"nbx-{secrets.token_hex(4)}"

        allow_remote_execution = _env_bool("NETBOX_ALLOW_REMOTE_EXECUTION", default=True)

        try:
            health_interval = max(2000, int(os.environ.get("NETBOX_HEALTH_INTERVAL_MS", "10000")))
        except ValueError:
            health_interval = 10000

        try:
            conn_timeout = max(1000, int(os.environ.get("NETBOX_CONNECTION_TIMEOUT_MS", "5000")))
        except ValueError:
            conn_timeout = 5000

        extra_origins = [
            o.strip()
            for o in os.environ.get("NETBOX_CORS_ORIGINS", "").split(",")
            if o.strip()
        ]
        cors_origins = list(dict.fromkeys(DEFAULT_LOCAL_ORIGINS + extra_origins))
        cors_regex = LAN_ORIGIN_REGEX if mode == "lan" else LOCAL_ORIGIN_REGEX

        return cls(
            mode=mode,
            bind_host=bind_host,
            port=port,
            advertised_host=advertised_host,
            require_auth=require_auth,
            require_auth_localhost=require_auth_localhost,
            access_token=access_token,
            allow_remote_execution=allow_remote_execution,
            health_check_interval_ms=health_interval,
            connection_timeout_ms=conn_timeout,
            cors_origins=cors_origins,
            cors_origin_regex=cors_regex,
        )


_CONFIG_SINGLETON: Optional[NetBoxCoreConfig] = None


def get_core_config() -> NetBoxCoreConfig:
    global _CONFIG_SINGLETON
    if _CONFIG_SINGLETON is None:
        _CONFIG_SINGLETON = NetBoxCoreConfig.from_env()
    return _CONFIG_SINGLETON


def set_core_config(config: NetBoxCoreConfig) -> NetBoxCoreConfig:
    global _CONFIG_SINGLETON
    _CONFIG_SINGLETON = config
    return _CONFIG_SINGLETON
