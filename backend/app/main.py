from typing import Any, Dict, List, Optional
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .ai.models import (
    AIAssistantResponse,
    AIConfigUpdateRequest,
    AskRunRequest,
    ConversationClearResponse,
    ConversationTurn,
    ExplainExecutionRequest,
    ExplainPacketRequest,
    GeneralAskRequest,
    LLMModelsResponse,
    LLMStatusResponse,
)
from .ai.providers.base import (
    LLMModelNotFoundError,
    LLMProviderError,
    LLMTimeoutError,
    LLMUnavailableError,
)
from .ai.services.ai_assistant_service import AIAssistantService
from .core.config import get_core_config
from .core.security import require_access_token, require_execution_permission
from .models.events import (
    ConnectionInfo,
    DemoSequenceResponse,
    NetworkEvent,
    PayloadInfo,
    ProcessInfo,
)
from .models.packets import (
    PacketRecord,
    RunCorrelationsResponse,
    RunFlowsResponse,
    RunPacketsResponse,
)
from .models.runs import (
    RunCreateRequest,
    RunEventsResponse,
    RunListItem,
    RunResponse,
)
from .routers.curriculum import router as curriculum_router
from .routers.system import router as system_router
from .routers.web_ui import router as web_ui_router
from .services.run_manager import RunManager

core_cfg = get_core_config()

app = FastAPI(
    title="NetBox Backend",
    description="Local & LAN-capable backend service for NetBox Computer Networks Platform (Phases 0-8)",
    version="0.8.0",
)

# Restrict CORS to configured localhost or private LAN origins (never wildcard '*' with credentials)
app.add_middleware(
    CORSMiddleware,
    allow_origins=core_cfg.cors_origins,
    allow_origin_regex=core_cfg.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(system_router)
app.include_router(curriculum_router)
app.include_router(web_ui_router)


class HealthResponse(BaseModel):
    status: str = Field(default="healthy", description="Service health status")
    service: str = Field(default="netbox-backend", description="Service name")
    version: str = Field(default="0.8.0", description="API version")


class ExampleItem(BaseModel):
    id: str
    title: str
    protocol: str
    directory: str
    files: List[str]
    description: str
    build_command: str
    run_instructions: Dict[str, str]


class ProjectResponse(BaseModel):
    name: str = "NetBox"
    tagline: str = "Computer Networks Learning, Observation & Grounded Local AI Platform"
    current_phase: str = "Phase 7: Curriculum Labs & Final Hardening"
    phase_status: str = "Completed"
    description: str = (
        "NetBox pairs an offline host-client networking laboratory with a VS Code & Browser visualizer "
        "that executes real networking experiments via LD_PRELOAD and libpcap, visualizes socket & wire activity, "
        "guides students through 9 structured CN curriculum modules, and provides evidence-grounded local AI tutoring."
    )
    supported_languages: List[str] = ["C (POSIX TCP/UDP)", "Python (Course Labs)"]
    examples_count: int = 2
    examples: List[str] = ["examples/tcp", "examples/udp"]


AVAILABLE_EXAMPLES: List[ExampleItem] = [
    ExampleItem(
        id="tcp-echo",
        title="POSIX TCP Echo Client & Server",
        protocol="TCP",
        directory="examples/tcp",
        files=["examples/tcp/server.c", "examples/tcp/client.c", "examples/tcp/README.md"],
        description=(
            "Minimal POSIX C11 TCP echo server and client communicating over loopback "
            "(127.0.0.1:8080). Server handles sequential clients cleanly; client sends a message "
            "and verifies echoed byte-stream integrity."
        ),
        build_command="make all",
        run_instructions={
            "server": "./examples/tcp/server",
            "client": "./examples/tcp/client \"Hello from NetBox TCP client!\"",
        },
    ),
    ExampleItem(
        id="udp-echo",
        title="POSIX UDP Echo Client & Server",
        protocol="UDP",
        directory="examples/udp",
        files=["examples/udp/udp_server.c", "examples/udp/udp_client.c"],
        description=(
            "Minimal POSIX C11 UDP datagram echo server and client communicating over loopback "
            "(127.0.0.1). Demonstrates connectionless sendto()/recvfrom() and preserved datagram boundaries."
        ),
        build_command="make udp",
        run_instructions={
            "server": "./examples/udp/udp_server 9090 4",
            "client": "./examples/udp/udp_client 9090 \"Datagram 1\" \"Datagram 2\"",
        },
    ),
]

# Simulated 12-event TCP echo lifecycle based strictly on docs/event_schema.md v1.0
SIMULATED_TCP_EVENTS: List[NetworkEvent] = [
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=1,
        timestamp_ns=1000000000,
        source="socket_api",
        event_type="socket",
        process=ProcessInfo(pid=2101, name="server"),
        socket_fd=3,
        socket_domain="AF_INET",
        socket_type="SOCK_STREAM",
        result=3,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=2,
        timestamp_ns=1000050000,
        source="socket_api",
        event_type="bind",
        process=ProcessInfo(pid=2101, name="server"),
        connection=ConnectionInfo(local_ip="127.0.0.1", local_port=8080, remote_ip=None, remote_port=None),
        socket_fd=3,
        result=0,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=3,
        timestamp_ns=1000090000,
        source="socket_api",
        event_type="listen",
        process=ProcessInfo(pid=2101, name="server"),
        connection=ConnectionInfo(local_ip="127.0.0.1", local_port=8080, remote_ip=None, remote_port=None),
        socket_fd=3,
        result=0,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=4,
        timestamp_ns=1001000000,
        source="socket_api",
        event_type="socket",
        process=ProcessInfo(pid=2102, name="client"),
        socket_fd=3,
        socket_domain="AF_INET",
        socket_type="SOCK_STREAM",
        result=3,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=5,
        timestamp_ns=1001200000,
        source="socket_api",
        event_type="connect",
        process=ProcessInfo(pid=2102, name="client"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=54071,
            remote_ip="127.0.0.1",
            remote_port=8080,
        ),
        socket_fd=3,
        result=0,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=6,
        timestamp_ns=1001350000,
        source="socket_api",
        event_type="accept",
        process=ProcessInfo(pid=2101, name="server"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=8080,
            remote_ip="127.0.0.1",
            remote_port=54071,
        ),
        socket_fd=4,
        result=4,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=7,
        timestamp_ns=1001500000,
        source="socket_api",
        event_type="send",
        process=ProcessInfo(pid=2102, name="client"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=54071,
            remote_ip="127.0.0.1",
            remote_port=8080,
        ),
        socket_fd=3,
        payload=PayloadInfo(bytes=29, preview_utf8="Hello from NetBox TCP client!", truncated=False),
        result=29,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=8,
        timestamp_ns=1001580000,
        source="socket_api",
        event_type="recv",
        process=ProcessInfo(pid=2101, name="server"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=8080,
            remote_ip="127.0.0.1",
            remote_port=54071,
        ),
        socket_fd=4,
        payload=PayloadInfo(bytes=29, preview_utf8="Hello from NetBox TCP client!", truncated=False),
        result=29,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=9,
        timestamp_ns=1001650000,
        source="socket_api",
        event_type="send",
        process=ProcessInfo(pid=2101, name="server"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=8080,
            remote_ip="127.0.0.1",
            remote_port=54071,
        ),
        socket_fd=4,
        payload=PayloadInfo(bytes=29, preview_utf8="Hello from NetBox TCP client!", truncated=False),
        result=29,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=10,
        timestamp_ns=1001720000,
        source="socket_api",
        event_type="recv",
        process=ProcessInfo(pid=2102, name="client"),
        connection=ConnectionInfo(
            local_ip="127.0.0.1",
            local_port=54071,
            remote_ip="127.0.0.1",
            remote_port=8080,
        ),
        socket_fd=3,
        payload=PayloadInfo(bytes=29, preview_utf8="Hello from NetBox TCP client!", truncated=False),
        result=29,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=11,
        timestamp_ns=1001850000,
        source="socket_api",
        event_type="close",
        process=ProcessInfo(pid=2102, name="client"),
        socket_fd=3,
        result=0,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
    NetworkEvent(
        schema_version="1.0",
        run_id="sim_tcp_demo_001",
        sequence=12,
        timestamp_ns=1001920000,
        source="socket_api",
        event_type="close",
        process=ProcessInfo(pid=2101, name="server"),
        socket_fd=4,
        result=0,
        error_code=None,
        is_simulated=True,
        simulation_label="SIMULATED",
    ),
]


# ===================== Phase 1 Endpoints =====================

@app.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Returns backend service health status, service name, and API version."""
    return HealthResponse(status="healthy", service="netbox-backend", version="0.8.0")


@app.get("/api/project", response_model=ProjectResponse)
def get_project() -> ProjectResponse:
    """Returns NetBox project overview, current phase, and available example pointers."""
    return ProjectResponse()


@app.get("/api/examples", response_model=List[ExampleItem])
def get_examples() -> List[ExampleItem]:
    """Returns available networking examples and their build/run metadata."""
    return AVAILABLE_EXAMPLES


@app.get("/api/demo/tcp", response_model=DemoSequenceResponse)
def get_tcp_demo() -> DemoSequenceResponse:
    """
    Returns simulated TCP event sequence conforming to docs/event_schema.md.
    Events are explicitly marked as SIMULATED.
    """
    return DemoSequenceResponse(
        event_count=len(SIMULATED_TCP_EVENTS),
        events=SIMULATED_TCP_EVENTS,
    )


# ===================== Phase 2 Execution Endpoints =====================

@app.post(
    "/api/runs",
    response_model=RunResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_execution_permission)],
)
def create_run(request: RunCreateRequest) -> RunResponse:
    """
    Creates and executes a new monitored networking run under LD_PRELOAD
    and (when enabled & available) libpcap packet capture.
    Supported example_id: 'tcp-echo'.
    """
    manager = RunManager.get_instance()
    try:
        run_res = manager.create_run(
            example_id=request.example_id,
            client_args=request.client_args,
            capture_packets=request.capture_packets,
            capture_interface=request.capture_interface,
            enable_payload_preview=request.enable_payload_preview,
        )
        return run_res
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Run execution failed: {err}",
        )


@app.get("/api/runs/{run_id}", response_model=RunResponse, dependencies=[Depends(require_access_token)])
def get_run(run_id: str) -> RunResponse:
    """Retrieves execution status, metadata, process summary, and exit codes for a run."""
    manager = RunManager.get_instance()
    run_res = manager.get_run(run_id)
    if not run_res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    return run_res


@app.get("/api/runs/{run_id}/events", response_model=RunEventsResponse, dependencies=[Depends(require_access_token)])
def get_run_events(run_id: str) -> RunEventsResponse:
    """
    Retrieves actual recorded socket API events for an execution run.
    Events are marked with is_simulated: false.
    """
    manager = RunManager.get_instance()
    events_res = manager.get_run_events(run_id)
    if not events_res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    return events_res


@app.post("/api/runs/{run_id}/stop", dependencies=[Depends(require_execution_permission)])
def stop_run(run_id: str) -> Dict[str, Any]:
    """Stops an active run safely."""
    manager = RunManager.get_instance()
    stopped = manager.stop_run(run_id)
    if not stopped:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found or not in running state.",
        )
    return {"run_id": run_id, "status": "stopped"}


@app.get("/api/runs", response_model=List[RunListItem], dependencies=[Depends(require_access_token)])
def list_runs() -> List[RunListItem]:
    """Returns a list of recent execution runs sorted newest first."""
    manager = RunManager.get_instance()
    return manager.list_runs()


# ===================== Phase 4 Packet Capture Endpoints =====================

@app.get("/api/runs/{run_id}/packets", response_model=RunPacketsResponse, dependencies=[Depends(require_access_token)])
def get_run_packets(run_id: str) -> RunPacketsResponse:
    """
    Retrieves actual captured network packets (source='packet_capture') for a run.
    Includes capture status, selected interface, and any capture error diagnostics.
    """
    manager = RunManager.get_instance()
    res = manager.get_run_packets(run_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    return res


@app.get("/api/runs/{run_id}/packets/{packet_id}", response_model=PacketRecord, dependencies=[Depends(require_access_token)])
def get_run_packet_detail(run_id: str, packet_id: int) -> PacketRecord:
    """Retrieves a single captured packet record by its 1-based sequence number."""
    manager = RunManager.get_instance()
    if not manager.get_run(run_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    pkt = manager.get_run_packet_by_id(run_id, packet_id)
    if not pkt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Packet #{packet_id} not found in run '{run_id}'.",
        )
    return pkt


@app.get("/api/runs/{run_id}/flows", response_model=RunFlowsResponse, dependencies=[Depends(require_access_token)])
def get_run_flows(run_id: str) -> RunFlowsResponse:
    """Retrieves TCP bidirectional 4-tuple flow summaries, handshake & termination analysis."""
    manager = RunManager.get_instance()
    res = manager.get_run_flows(run_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    return res


@app.get("/api/runs/{run_id}/correlations", response_model=RunCorrelationsResponse, dependencies=[Depends(require_access_token)])
def get_run_correlations(run_id: str) -> RunCorrelationsResponse:
    """Retrieves socket_api <-> packet_capture correlation mappings for a run."""
    manager = RunManager.get_instance()
    res = manager.get_run_correlations(run_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )
    return res


# ===================== Phase 5 Grounded Local AI Endpoints =====================

def _handle_ai_error(err: Exception) -> HTTPException:
    if isinstance(err, KeyError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err.args[0] if err.args else err))
    if isinstance(err, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    if isinstance(err, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    if isinstance(err, LLMTimeoutError):
        return HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(err))
    if isinstance(err, (LLMUnavailableError, LLMModelNotFoundError)):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    if isinstance(err, LLMProviderError):
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"AI request failed: {err}")


@app.get("/api/ai/status", response_model=LLMStatusResponse, dependencies=[Depends(require_access_token)])
def get_ai_status() -> LLMStatusResponse:
    """Detects local LLM runtime availability and configured model status."""
    return AIAssistantService.get_instance().get_status()


@app.get("/api/ai/models", response_model=LLMModelsResponse, dependencies=[Depends(require_access_token)])
def get_ai_models() -> LLMModelsResponse:
    """Lists locally available models from the local inference runtime."""
    return AIAssistantService.get_instance().list_models()


@app.post("/api/ai/config", response_model=LLMStatusResponse, dependencies=[Depends(require_execution_permission)])
def update_ai_config(request: AIConfigUpdateRequest) -> LLMStatusResponse:
    """Updates local LLM model/generation settings (strictly localhost-only)."""
    try:
        return AIAssistantService.get_instance().update_config(request)
    except Exception as err:
        raise _handle_ai_error(err)


@app.post("/api/ai/runs/{run_id}/explain", response_model=AIAssistantResponse, dependencies=[Depends(require_access_token)])
def ai_explain_execution(run_id: str, request: ExplainExecutionRequest) -> AIAssistantResponse:
    """Explains an observed execution or chronological TCP timeline grounded in real evidence."""
    try:
        return AIAssistantService.get_instance().explain_execution(
            run_id=run_id,
            learning_mode=request.learning_mode,
            focus=request.focus,
            flow_id=request.flow_id,
        )
    except Exception as err:
        raise _handle_ai_error(err)


@app.post("/api/ai/runs/{run_id}/ask", response_model=AIAssistantResponse, dependencies=[Depends(require_access_token)])
def ai_ask_run(run_id: str, request: AskRunRequest) -> AIAssistantResponse:
    """Answers a conversational question grounded in the selected execution's evidence."""
    try:
        return AIAssistantService.get_instance().ask_about_run(
            run_id=run_id,
            question=request.question,
            learning_mode=request.learning_mode,
            flow_id=request.flow_id,
            packet_id=request.packet_id,
            include_history=request.include_history,
        )
    except Exception as err:
        raise _handle_ai_error(err)


@app.post(
    "/api/ai/runs/{run_id}/packets/{packet_id}/explain",
    response_model=AIAssistantResponse,
    dependencies=[Depends(require_access_token)],
)
def ai_explain_packet(
    run_id: str,
    packet_id: int,
    request: ExplainPacketRequest,
) -> AIAssistantResponse:
    """Explains a specific captured packet with neighboring packet context."""
    try:
        return AIAssistantService.get_instance().explain_packet(
            run_id=run_id,
            packet_id=packet_id,
            learning_mode=request.learning_mode,
            question=request.question,
        )
    except Exception as err:
        raise _handle_ai_error(err)


@app.get(
    "/api/ai/runs/{run_id}/conversation",
    response_model=List[ConversationTurn],
    dependencies=[Depends(require_access_token)],
)
def ai_get_conversation(run_id: str) -> List[ConversationTurn]:
    """Retrieves conversation history scoped strictly to run_id."""
    try:
        return AIAssistantService.get_instance().get_conversation(run_id)
    except Exception as err:
        raise _handle_ai_error(err)


@app.post(
    "/api/ai/runs/{run_id}/conversation/clear",
    response_model=ConversationClearResponse,
    dependencies=[Depends(require_access_token)],
)
def ai_clear_conversation(run_id: str) -> ConversationClearResponse:
    """Clears conversation history for the specified execution run."""
    try:
        return AIAssistantService.get_instance().clear_conversation(run_id)
    except Exception as err:
        raise _handle_ai_error(err)


@app.post("/api/ai/ask", response_model=AIAssistantResponse, dependencies=[Depends(require_access_token)])
def ai_ask_general(request: GeneralAskRequest) -> AIAssistantResponse:
    """Answers a general Computer Networks question when no execution is selected."""
    try:
        return AIAssistantService.get_instance().ask_general(
            question=request.question,
            learning_mode=request.learning_mode,
        )
    except Exception as err:
        raise _handle_ai_error(err)
