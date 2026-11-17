from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .models.events import (
    ConnectionInfo,
    DemoSequenceResponse,
    NetworkEvent,
    PayloadInfo,
    ProcessInfo,
)
from .models.runs import (
    RunCreateRequest,
    RunEventsResponse,
    RunListItem,
    RunResponse,
)
from .services.run_manager import RunManager

app = FastAPI(
    title="NetBox Backend",
    description="Local backend service for NetBox Computer Networks Assistant (Phase 2)",
    version="0.2.0",
)

# Restrict CORS to local development origins only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
        "http://localhost",
        "http://localhost:8000",
        "vscode-webview://*",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str = Field(default="healthy", description="Service health status")
    service: str = Field(default="netbox-backend", description="Service name")
    version: str = Field(default="0.2.0", description="API version")


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
    tagline: str = "Computer Networks Learning & Debugging Environment"
    current_phase: str = "Phase 2: C Program Execution and Real Socket Event Collection"
    phase_status: str = "In Progress"
    description: str = (
        "NetBox pairs a local offline networking environment with a VS Code assistant "
        "that executes networking code, captures real socket execution events via LD_PRELOAD, "
        "visualizes what occurred, and provides grounded course-aware explanations."
    )
    supported_languages: List[str] = ["C (Phase 0-2 POSIX)", "Python (Course Labs)"]
    examples_count: int = 1
    examples: List[str] = ["examples/tcp"]


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
    )
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
    return HealthResponse(status="healthy", service="netbox-backend", version="0.2.0")


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

@app.post("/api/runs", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
def create_run(request: RunCreateRequest) -> RunResponse:
    """
    Creates and executes a new monitored networking run under LD_PRELOAD.
    Supported example_id: 'tcp-echo'.
    """
    manager = RunManager.get_instance()
    try:
        run_res = manager.create_run(
            example_id=request.example_id,
            client_args=request.client_args,
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


@app.get("/api/runs/{run_id}", response_model=RunResponse)
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


@app.get("/api/runs/{run_id}/events", response_model=RunEventsResponse)
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


@app.post("/api/runs/{run_id}/stop")
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


@app.get("/api/runs", response_model=List[RunListItem])
def list_runs() -> List[RunListItem]:
    """Returns a list of recent execution runs sorted newest first."""
    manager = RunManager.get_instance()
    return manager.list_runs()
