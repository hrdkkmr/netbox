import datetime
import logging
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from ..models.events import NetworkEvent
from ..models.packets import (
    CorrelationRecord,
    PacketRecord,
    RunCorrelationsResponse,
    RunFlowsResponse,
    RunPacketsResponse,
    TcpFlowSummary,
)
from ..models.runs import (
    ProcessExecutionSummary,
    RunEventsResponse,
    RunListItem,
    RunResponse,
)
from .event_correlator import correlate_packets_with_socket_events
from .event_reader import EventReader
from .packet_capture_service import PacketCaptureService, PacketCaptureSession
from .packet_parser import read_packets_jsonl
from .process_runner import ALLOWED_EXAMPLES, ProcessRunner, ProcessRunnerError
from .tcp_analyzer import analyze_packets_and_flows

logger = logging.getLogger("netbox.run_manager")
RUNS_BASE_DIR = Path("/tmp/netbox_runs")


class RunRecord:
    def __init__(
        self,
        run_id: str,
        example_id: str,
        created_at: str,
        status: str = "pending",
        payload_capture_enabled: bool = False,
    ):
        self.run_id = run_id
        self.example_id = example_id
        self.created_at = created_at
        self.status = status
        self.start_time: Optional[str] = None
        self.end_time: Optional[str] = None
        self.duration_ms: Optional[float] = None
        self.exit_code: Optional[int] = None
        self.processes: List[ProcessExecutionSummary] = []
        self.events: List[NetworkEvent] = []
        self.error: Optional[str] = None

        # Phase 4 capture & analysis fields
        self.socket_capture_status: str = "PENDING"
        self.packet_capture_status: str = "NOT_REQUESTED"
        self.packet_capture_interface: Optional[str] = None
        self.packet_capture_error: Optional[str] = None
        self.payload_capture_enabled: bool = payload_capture_enabled
        self.packets: List[PacketRecord] = []
        self.flows: List[TcpFlowSummary] = []
        self.correlations: List[CorrelationRecord] = []
        self.active_capture_session: Optional[PacketCaptureSession] = None

    def to_response(self) -> RunResponse:
        return RunResponse(
            run_id=self.run_id,
            example_id=self.example_id,
            status=self.status,
            created_at=self.created_at,
            start_time=self.start_time,
            end_time=self.end_time,
            duration_ms=self.duration_ms,
            exit_code=self.exit_code,
            processes=self.processes,
            event_count=len(self.events),
            error=self.error,
            socket_capture_status=self.socket_capture_status,
            packet_capture_status=self.packet_capture_status,
            packet_capture_interface=self.packet_capture_interface,
            packet_capture_error=self.packet_capture_error,
            packet_count=len(self.packets),
            payload_capture_enabled=self.payload_capture_enabled,
        )

    def to_list_item(self) -> RunListItem:
        return RunListItem(
            run_id=self.run_id,
            example_id=self.example_id,
            status=self.status,
            created_at=self.created_at,
            event_count=len(self.events),
            exit_code=self.exit_code,
            socket_capture_status=self.socket_capture_status,
            packet_capture_status=self.packet_capture_status,
            packet_count=len(self.packets),
        )


class RunManager:
    _instance = None

    def __init__(self):
        self._runs: Dict[str, RunRecord] = {}
        RUNS_BASE_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def get_instance(cls) -> "RunManager":
        if cls._instance is None:
            cls._instance = RunManager()
        return cls._instance

    def create_run(
        self,
        example_id: str = "tcp-echo",
        client_args: Optional[List[str]] = None,
        capture_packets: bool = True,
        capture_interface: Optional[str] = None,
        enable_payload_preview: bool = False,
    ) -> RunResponse:
        if example_id not in ALLOWED_EXAMPLES:
            raise ValueError(f"Unsupported example: '{example_id}'. Allowed: {sorted(ALLOWED_EXAMPLES)}")

        # 1. Generate unique run ID & create isolated run directory
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        run_id = f"run_{now_dt.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        created_at_iso = now_dt.isoformat()

        record = RunRecord(
            run_id=run_id,
            example_id=example_id,
            created_at=created_at_iso,
            payload_capture_enabled=bool(enable_payload_preview),
        )
        self._runs[run_id] = record

        run_dir = RUNS_BASE_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        packets_jsonl = run_dir / "packets.jsonl"

        record.status = "running"
        record.socket_capture_status = "RUNNING"
        t0 = datetime.datetime.now(datetime.timezone.utc)
        record.start_time = t0.isoformat()

        capture_session: Optional[PacketCaptureSession] = None
        capture_started = False

        # 2. Initialize and start packet capture BEFORE launching target server/client
        if not capture_packets:
            record.packet_capture_status = "NOT_REQUESTED"
        else:
            iface, iface_err = PacketCaptureService.select_loopback_interface(capture_interface)
            if iface_err or not iface:
                record.packet_capture_status = "FAILED"
                record.packet_capture_error = iface_err or "Failed to select capture interface."
            else:
                record.packet_capture_interface = iface
                avail = PacketCaptureService.check_availability()
                if not avail.available:
                    record.packet_capture_status = "UNAVAILABLE"
                    record.packet_capture_error = avail.reason
                else:
                    record.packet_capture_status = "STARTING"
                    capture_session = PacketCaptureSession(
                        run_id=run_id,
                        interface=iface,
                        output_file=packets_jsonl,
                        bpf_filter="tcp and port 8080",
                        capture_payload=bool(enable_payload_preview),
                    )
                    record.active_capture_session = capture_session
                    ok, start_err = capture_session.start(ready_timeout=3.0)
                    if ok:
                        capture_started = True
                        record.packet_capture_status = "CAPTURING"
                    else:
                        record.packet_capture_status = capture_session.status
                        record.packet_capture_error = start_err
                        capture_session = None
                        record.active_capture_session = None

        # 3. Execute server & client under Phase 2 LD_PRELOAD (always runs even if pcap unavailable)
        try:
            summaries, event_files = ProcessRunner.run_tcp_echo(
                run_id=run_id,
                run_dir=run_dir,
                client_args=client_args,
            )
            record.processes = summaries

            max_ec = 0
            for s in summaries:
                if s.exit_code is not None and s.exit_code != 0:
                    max_ec = s.exit_code
            record.exit_code = max_ec

            record.events = EventReader.merge_and_sort_events(event_files)
            record.socket_capture_status = "COMPLETED" if len(record.events) > 0 else "FAILED"
            record.status = "completed" if max_ec == 0 else "failed"

        except ProcessRunnerError as err:
            logger.error("Process execution error for run %s: %s", run_id, err)
            record.status = "failed"
            record.socket_capture_status = "FAILED"
            record.error = str(err)
            record.exit_code = 1
        except Exception as err:
            logger.exception("Unexpected error in run %s: %s", run_id, err)
            record.status = "failed"
            record.socket_capture_status = "FAILED"
            record.error = f"Execution failed: {err}"
            record.exit_code = 1
        finally:
            # 4. Stop packet capture cleanly AFTER server has terminated (never leave orphans)
            if capture_session is not None and capture_started:
                # Brief flush window so final loopback FIN/ACK packets deliver to libpcap
                time.sleep(0.15)
                stop_ok, stop_err = capture_session.stop(graceful_timeout=2.0)
                record.active_capture_session = None
                if not stop_ok:
                    record.packet_capture_status = "FAILED"
                    record.packet_capture_error = stop_err
                else:
                    # 5. Parse captured packets, analyze TCP flows, and correlate with socket_api events
                    packets, invalid_lines = read_packets_jsonl(packets_jsonl)
                    if invalid_lines > 0:
                        logger.warning("Run %s had %d invalid packet JSONL lines skipped", run_id, invalid_lines)

                    record.packets = packets
                    if len(packets) == 0:
                        # Strict invariant: NEVER mark packet capture COMPLETED if 0 packets were captured
                        record.packet_capture_status = "FAILED"
                        record.packet_capture_error = (
                            "Packet capture started and stopped cleanly, but 0 packets were captured "
                            f"on interface '{record.packet_capture_interface}'."
                        )
                    else:
                        record.flows = analyze_packets_and_flows(record.packets, record.events)
                        record.correlations = correlate_packets_with_socket_events(
                            record.packets, record.events, record.flows
                        )
                        record.packet_capture_status = "COMPLETED"

            t1 = datetime.datetime.now(datetime.timezone.utc)
            record.end_time = t1.isoformat()
            record.duration_ms = round((t1 - t0).total_seconds() * 1000.0, 2)

        return record.to_response()

    def get_run(self, run_id: str) -> Optional[RunResponse]:
        record = self._runs.get(run_id)
        if not record:
            return None
        return record.to_response()

    def get_run_events(self, run_id: str) -> Optional[RunEventsResponse]:
        record = self._runs.get(run_id)
        if not record:
            return None
        return RunEventsResponse(
            run_id=record.run_id,
            schema_version="1.0",
            is_simulated=False,
            simulation_label="ACTUAL SOCKET API EVENTS",
            event_count=len(record.events),
            events=record.events,
        )

    def get_run_packets(self, run_id: str) -> Optional[RunPacketsResponse]:
        record = self._runs.get(run_id)
        if not record:
            return None
        return RunPacketsResponse(
            run_id=record.run_id,
            schema_version="1.0",
            is_simulated=False,
            packet_capture_status=record.packet_capture_status,
            interface=record.packet_capture_interface,
            capture_error=record.packet_capture_error,
            payload_capture_enabled=record.payload_capture_enabled,
            packet_count=len(record.packets),
            packets=record.packets,
        )

    def get_run_packet_by_id(self, run_id: str, packet_id: int) -> Optional[PacketRecord]:
        record = self._runs.get(run_id)
        if not record:
            return None
        for pkt in record.packets:
            if pkt.sequence == packet_id:
                return pkt
        return None

    def get_run_flows(self, run_id: str) -> Optional[RunFlowsResponse]:
        record = self._runs.get(run_id)
        if not record:
            return None
        return RunFlowsResponse(
            run_id=record.run_id,
            packet_capture_status=record.packet_capture_status,
            interface=record.packet_capture_interface,
            flow_count=len(record.flows),
            flows=record.flows,
        )

    def get_run_correlations(self, run_id: str) -> Optional[RunCorrelationsResponse]:
        record = self._runs.get(run_id)
        if not record:
            return None
        resolved = sum(1 for c in record.correlations if c.confidence != "unresolved")
        unresolved = len(record.correlations) - resolved
        return RunCorrelationsResponse(
            run_id=record.run_id,
            packet_capture_status=record.packet_capture_status,
            correlation_count=len(record.correlations),
            resolved_count=resolved,
            unresolved_count=unresolved,
            correlations=record.correlations,
        )

    def list_runs(self) -> List[RunListItem]:
        sorted_runs = sorted(self._runs.values(), key=lambda r: r.created_at, reverse=True)
        return [r.to_list_item() for r in sorted_runs]

    def stop_run(self, run_id: str) -> bool:
        record = self._runs.get(run_id)
        if not record:
            return False
        if record.active_capture_session is not None:
            record.active_capture_session.stop(graceful_timeout=1.5)
            record.active_capture_session = None
        if record.status == "running":
            record.status = "stopped"
            return True
        return False
