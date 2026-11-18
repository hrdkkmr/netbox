import datetime
import platform
import socket
import threading
import time
from typing import Dict, List, Optional

from ..ai.services.ai_assistant_service import AIAssistantService
from ..core.config import NetBoxCoreConfig, get_core_config
from ..models.system import (
    ComponentHealth,
    ConnectedClientRecord,
    ServiceItem,
    SystemConnectionResponse,
    SystemHealthResponse,
    SystemInfoResponse,
    SystemServicesResponse,
)
from .network_discovery import build_network_overview, detect_wsl2
from .packet_capture_service import PacketCaptureService
from .process_runner import EXAMPLES_DIR, TRACE_SO
from .qr_svg import generate_qr_svg
from .run_manager import RunManager

APP_VERSION = "0.8.0"
CURRENT_PHASE_LABEL = "Phase 8: Production Release & VS Code Marketplace Packaging"


class ClientSessionRegistry:
    """
    Lightweight in-memory tracker for real client heartbeats (never fabricates clients).
    Clients expire automatically if no heartbeat arrives within stale_seconds.
    """

    def __init__(self, stale_seconds: float = 45.0):
        self._lock = threading.Lock()
        self._stale_seconds = stale_seconds
        self._sessions: Dict[str, Dict] = {}

    def record_heartbeat(
        self,
        client_id: str,
        label: str,
        remote_ip: str,
        client_type: str,
        is_host_local: bool,
    ) -> ConnectedClientRecord:
        now_mono = time.monotonic()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._lock:
            existing = self._sessions.get(client_id)
            connected_at = existing["connected_at"] if existing else now_iso
            self._sessions[client_id] = {
                "client_id": client_id,
                "label": label,
                "remote_ip": remote_ip,
                "client_type": client_type,
                "connected_at": connected_at,
                "last_seen": now_iso,
                "last_seen_mono": now_mono,
                "is_host_local": is_host_local,
            }
            self._prune_locked(now_mono)
            rec = self._sessions[client_id]
            return ConnectedClientRecord(
                client_id=rec["client_id"],
                label=rec["label"],
                remote_ip=rec["remote_ip"],
                client_type=rec["client_type"],
                connected_at=rec["connected_at"],
                last_seen=rec["last_seen"],
                is_host_local=rec["is_host_local"],
            )

    def list_active(self) -> List[ConnectedClientRecord]:
        now_mono = time.monotonic()
        with self._lock:
            self._prune_locked(now_mono)
            active = sorted(self._sessions.values(), key=lambda r: r["last_seen"], reverse=True)
            return [
                ConnectedClientRecord(
                    client_id=r["client_id"],
                    label=r["label"],
                    remote_ip=r["remote_ip"],
                    client_type=r["client_type"],
                    connected_at=r["connected_at"],
                    last_seen=r["last_seen"],
                    is_host_local=r["is_host_local"],
                )
                for r in active
            ]

    def _prune_locked(self, now_mono: float) -> None:
        expired = [
            cid
            for cid, data in self._sessions.items()
            if (now_mono - data["last_seen_mono"]) > self._stale_seconds
        ]
        for cid in expired:
            del self._sessions[cid]


class SystemService:
    _instance: Optional["SystemService"] = None

    def __init__(self):
        self._started_monotonic = time.monotonic()
        self.clients = ClientSessionRegistry()

    @classmethod
    def get_instance(cls) -> "SystemService":
        if cls._instance is None:
            cls._instance = SystemService()
        return cls._instance

    def get_health(self, config: Optional[NetBoxCoreConfig] = None) -> SystemHealthResponse:
        cfg = config or get_core_config()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        components: Dict[str, ComponentHealth] = {}

        # 1. Backend
        components["backend"] = ComponentHealth(
            name="FastAPI Backend",
            status="running",
            detail=f"Listening in {cfg.mode} mode ({cfg.bind_host}:{cfg.port}).",
            metadata={"mode": cfg.mode, "bind_host": cfg.bind_host, "port": cfg.port},
        )

        # 2. Socket Instrumentation (LD_PRELOAD)
        trace_exists = TRACE_SO.is_file()
        tcp_server_exists = (EXAMPLES_DIR / "tcp" / "server").is_file()
        tcp_client_exists = (EXAMPLES_DIR / "tcp" / "client").is_file()
        if trace_exists and tcp_server_exists and tcp_client_exists:
            components["socket_instrumentation"] = ComponentHealth(
                name="Socket Instrumentation (LD_PRELOAD)",
                status="running",
                detail="libnetbox_trace.so and reference TCP binaries are built and ready.",
                metadata={"trace_library": trace_exists},
            )
        else:
            components["socket_instrumentation"] = ComponentHealth(
                name="Socket Instrumentation (LD_PRELOAD)",
                status="degraded" if trace_exists else "unavailable",
                detail="Run 'make all' to build libnetbox_trace.so and C binaries.",
                metadata={
                    "trace_library": trace_exists,
                    "tcp_server": tcp_server_exists,
                    "tcp_client": tcp_client_exists,
                },
            )

        # 3. Packet Capture (libpcap)
        pcap_avail = PacketCaptureService.check_availability()
        if pcap_avail.available:
            components["packet_capture"] = ComponentHealth(
                name="Packet Capture (libpcap)",
                status="running",
                detail="netbox_pcap helper is built and holds capture capabilities.",
                metadata={"capabilities": pcap_avail.capabilities},
            )
        else:
            components["packet_capture"] = ComponentHealth(
                name="Packet Capture (libpcap)",
                status="unavailable",
                detail=pcap_avail.reason or "Packet capture unavailable.",
                metadata={"binary_exists": pcap_avail.binary_exists},
            )

        # 4. Ollama Local AI Runtime & Configured Model
        ai_status = AIAssistantService.get_instance().get_status()
        if ai_status.runtime_reachable:
            components["ollama"] = ComponentHealth(
                name="Ollama Local Runtime",
                status="running",
                detail=f"Reachable on localhost ({ai_status.base_url}). Not exposed to LAN.",
                metadata={"base_url": ai_status.base_url, "models_count": len(ai_status.installed_models)},
            )
        else:
            components["ollama"] = ComponentHealth(
                name="Ollama Local Runtime",
                status="unavailable",
                detail=ai_status.error or "Ollama is not running on localhost.",
                metadata={"base_url": ai_status.base_url},
            )

        if ai_status.runtime_reachable and ai_status.model_available:
            components["ai_model"] = ComponentHealth(
                name="Configured Local AI Model",
                status="running",
                detail=f"Model '{ai_status.configured_model}' is installed and ready for host inference.",
                metadata={"model": ai_status.configured_model},
            )
        elif ai_status.runtime_reachable and not ai_status.model_available:
            components["ai_model"] = ComponentHealth(
                name="Configured Local AI Model",
                status="degraded",
                detail=(
                    f"Ollama is running, but configured model '{ai_status.configured_model}' is missing. "
                    f"Pull with: ollama pull {ai_status.configured_model}"
                ),
                metadata={"model": ai_status.configured_model, "available": ai_status.installed_models},
            )
        else:
            components["ai_model"] = ComponentHealth(
                name="Configured Local AI Model",
                status="unavailable",
                detail=f"Cannot verify model '{ai_status.configured_model}' while Ollama is offline.",
                metadata={"model": ai_status.configured_model},
            )

        # 5. LAN Accessibility
        net = build_network_overview(cfg)
        if cfg.mode == "lan":
            if net.is_wsl2 and net.wsl_network_mode == "wsl2_nat":
                lan_status = "degraded"
                lan_detail = (
                    f"LAN mode active ({cfg.bind_host}:{cfg.port}), WSL 2 NAT detected. "
                    f"Windows portproxy + firewall rule required for external devices to reach {net.recommended_lan_url or 'host'}."
                )
            elif net.recommended_lan_ip:
                lan_status = "running"
                lan_detail = f"LAN mode active; advertise {net.recommended_lan_url}."
            else:
                lan_status = "degraded"
                lan_detail = "LAN mode active, but no non-loopback LAN IPv4 address was detected."
        else:
            lan_status = "disabled"
            lan_detail = "Running in localhost-only mode (127.0.0.1). Start with --lan to share over Wi-Fi/hotspot."

        components["lan"] = ComponentHealth(
            name="LAN Accessibility",
            status=lan_status,
            detail=lan_detail,
            metadata={
                "mode": cfg.mode,
                "recommended_lan_url": net.recommended_lan_url,
                "wsl_network_mode": net.wsl_network_mode,
            },
        )

        # Rollup: healthy backend alone NEVER masks degraded/unavailable core components
        core_statuses = [
            components["socket_instrumentation"].status,
            components["packet_capture"].status,
            components["ollama"].status,
            components["ai_model"].status,
        ]
        if all(s == "running" for s in core_statuses):
            overall = "running"
        else:
            overall = "degraded"

        return SystemHealthResponse(
            overall_status=overall,
            timestamp=now_iso,
            backend_version=APP_VERSION,
            mode=cfg.mode,
            components=components,
        )

    def get_info(self, config: Optional[NetBoxCoreConfig] = None) -> SystemInfoResponse:
        cfg = config or get_core_config()
        is_wsl2, wsl_mode = detect_wsl2()
        run_mgr = RunManager.get_instance()
        runs = list(run_mgr._runs.values())
        active_runs = sum(1 for r in runs if r.status == "running")

        return SystemInfoResponse(
            version=APP_VERSION,
            current_phase=CURRENT_PHASE_LABEL,
            mode=cfg.mode,
            bind_host=cfg.bind_host,
            port=cfg.port,
            hostname=socket.gethostname(),
            os_platform=f"{platform.system()} {platform.release()}",
            is_wsl2=is_wsl2,
            wsl_network_mode=wsl_mode,
            uptime_seconds=round(time.monotonic() - self._started_monotonic, 1),
            total_runs=len(runs),
            active_runs=active_runs,
        )

    def get_services(self, config: Optional[NetBoxCoreConfig] = None) -> SystemServicesResponse:
        cfg = config or get_core_config()
        health = self.get_health(cfg)
        ai_status = AIAssistantService.get_instance().get_status()

        services = [
            ServiceItem(
                id="fastapi",
                name="NetBox Core FastAPI + Browser UI",
                status=health.components["backend"].status,
                endpoint=f"http://{cfg.bind_host}:{cfg.port}",
                lan_exposed=(cfg.mode == "lan"),
                detail=health.components["backend"].detail,
            ),
            ServiceItem(
                id="ollama",
                name="Ollama Local Inference Engine",
                status=health.components["ollama"].status,
                endpoint=ai_status.base_url,
                lan_exposed=False,
                detail=health.components["ollama"].detail,
            ),
            ServiceItem(
                id="socket_instrumentation",
                name="LD_PRELOAD Socket Tracer",
                status=health.components["socket_instrumentation"].status,
                endpoint=None,
                lan_exposed=False,
                detail=health.components["socket_instrumentation"].detail,
            ),
            ServiceItem(
                id="packet_capture",
                name="Native libpcap Packet Capture Helper",
                status=health.components["packet_capture"].status,
                endpoint=None,
                lan_exposed=False,
                detail=health.components["packet_capture"].detail,
            ),
        ]
        return SystemServicesResponse(mode=cfg.mode, services=services)

    def get_connection(
        self,
        is_host_local: bool,
        config: Optional[NetBoxCoreConfig] = None,
    ) -> SystemConnectionResponse:
        cfg = config or get_core_config()
        net = build_network_overview(cfg)
        target_url = net.recommended_lan_url if (cfg.mode == "lan" and net.recommended_lan_url) else net.local_url
        qr_svg = generate_qr_svg(target_url) if target_url else None

        token_preview: Optional[str] = None
        if cfg.access_token:
            token_preview = (
                f"{cfg.access_token[:4]}...{cfg.access_token[-2:]}"
                if len(cfg.access_token) > 6
                else "******"
            )

        active_clients = self.clients.list_active()

        security_notes = [
            "Ollama stays bound to 127.0.0.1:11434 on the host and is never exposed directly to the LAN.",
            "No host filesystem browser, environment variables, or arbitrary shell execution are exposed.",
            "Remote clients can only trigger allowlisted localhost experiments when permitted by host policy.",
            "HTTP over local Wi-Fi/hotspot is unencrypted (no TLS certificate); use only on trusted local/classroom networks.",
        ]

        return SystemConnectionResponse(
            mode=cfg.mode,
            local_url=net.local_url,
            lan_url=net.recommended_lan_url,
            lan_urls=net.lan_urls,
            auth_required=cfg.require_auth,
            allow_remote_execution=cfg.allow_remote_execution,
            pairing_token_preview=token_preview,
            pairing_token=cfg.access_token if is_host_local else None,
            health_check_interval_ms=cfg.health_check_interval_ms,
            connection_timeout_ms=cfg.connection_timeout_ms,
            qr_svg=qr_svg,
            connected_clients=active_clients,
            connected_client_count=len(active_clients),
            security_notes=security_notes,
        )
