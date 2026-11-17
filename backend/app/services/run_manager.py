import datetime
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from ..models.runs import (
    ProcessExecutionSummary,
    RunEventsResponse,
    RunListItem,
    RunResponse,
)
from ..models.events import NetworkEvent
from .event_reader import EventReader
from .process_runner import ProcessRunner, ProcessRunnerError, ALLOWED_EXAMPLES

logger = logging.getLogger("netbox.run_manager")
RUNS_BASE_DIR = Path("/tmp/netbox_runs")


class RunRecord:
    def __init__(
        self,
        run_id: str,
        example_id: str,
        created_at: str,
        status: str = "pending",
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
        )

    def to_list_item(self) -> RunListItem:
        return RunListItem(
            run_id=self.run_id,
            example_id=self.example_id,
            status=self.status,
            created_at=self.created_at,
            event_count=len(self.events),
            exit_code=self.exit_code,
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
    ) -> RunResponse:
        if example_id not in ALLOWED_EXAMPLES:
            raise ValueError(f"Unsupported example: '{example_id}'. Allowed: {sorted(ALLOWED_EXAMPLES)}")

        now_dt = datetime.datetime.now(datetime.timezone.utc)
        run_id = f"run_{now_dt.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        created_at_iso = now_dt.isoformat()

        record = RunRecord(run_id=run_id, example_id=example_id, created_at=created_at_iso)
        self._runs[run_id] = record

        run_dir = RUNS_BASE_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        record.status = "running"
        t0 = datetime.datetime.now(datetime.timezone.utc)
        record.start_time = t0.isoformat()

        try:
            summaries, event_files = ProcessRunner.run_tcp_echo(
                run_id=run_id,
                run_dir=run_dir,
                client_args=client_args,
            )
            record.processes = summaries

            # Determine composite exit code: non-zero if any process failed
            max_ec = 0
            for s in summaries:
                if s.exit_code is not None and s.exit_code != 0:
                    max_ec = s.exit_code
            record.exit_code = max_ec

            # Merge and sort real events
            record.events = EventReader.merge_and_sort_events(event_files)
            record.status = "completed" if max_ec == 0 else "failed"

        except ProcessRunnerError as err:
            logger.error("Process execution error for run %s: %s", run_id, err)
            record.status = "failed"
            record.error = str(err)
            record.exit_code = 1
        except Exception as err:
            logger.exception("Unexpected error in run %s: %s", run_id, err)
            record.status = "failed"
            record.error = f"Execution failed: {err}"
            record.exit_code = 1
        finally:
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

    def list_runs(self) -> List[RunListItem]:
        # Return recent runs sorted newest first
        sorted_runs = sorted(self._runs.values(), key=lambda r: r.created_at, reverse=True)
        return [r.to_list_item() for r in sorted_runs]

    def stop_run(self, run_id: str) -> bool:
        record = self._runs.get(run_id)
        if not record:
            return False
        if record.status == "running":
            record.status = "stopped"
            return True
        return False
