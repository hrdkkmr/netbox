"""
Lightweight local JSON persistence for NetBox Phase 7 curriculum progress.
No database server required; survives backend restarts and stores zero raw packet payloads.
"""

import datetime
import json
import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

from .models import CurriculumProgressResponse, LabProgressRecord

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_PROGRESS_FILE = REPO_ROOT / "backend" / "data" / "curriculum_progress.json"


class ProgressStore:
    def __init__(self, file_path: Optional[Path] = None):
        env_path = os.environ.get("NETBOX_PROGRESS_FILE", "").strip()
        self.file_path = file_path or (Path(env_path) if env_path else DEFAULT_PROGRESS_FILE)
        self._lock = threading.Lock()
        self._current_module: int = 1
        self._labs: Dict[str, LabProgressRecord] = {}
        self._load()

    def _load(self) -> None:
        if not self.file_path.is_file():
            return
        try:
            raw = json.loads(self.file_path.read_text(encoding="utf-8"))
            self._current_module = int(raw.get("current_module", 1))
            labs_raw = raw.get("labs", {})
            for lab_id, item in labs_raw.items():
                self._labs[lab_id] = LabProgressRecord(**item)
        except Exception:
            # Corrupt or unreadable progress file should not break NetBox startup
            self._labs = {}
            self._current_module = 1

    def _save_locked(self) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": "1.0",
            "current_module": self._current_module,
            "labs": {lid: rec.model_dump() for lid, rec in self._labs.items()},
        }
        tmp_path = self.file_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp_path.replace(self.file_path)

    def record_experiment_run(
        self,
        lab_id: str,
        module_number: int,
        run_id: Optional[str],
        min_score_pct: int = 70,
    ) -> LabProgressRecord:
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._lock:
            rec = self._labs.get(lab_id) or LabProgressRecord(lab_id=lab_id)
            rec.attempted = True
            rec.experiment_runs += 1
            if run_id:
                rec.last_run_id = run_id
            if rec.best_score_pct is not None and rec.best_score_pct >= min_score_pct:
                rec.completed = True
            rec.updated_at = now
            self._labs[lab_id] = rec
            self._current_module = max(self._current_module, module_number)
            self._save_locked()
            return rec

    def record_assessment(
        self,
        lab_id: str,
        module_number: int,
        score_pct: int,
        passed: bool,
        require_experiment_run: bool = True,
    ) -> LabProgressRecord:
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._lock:
            rec = self._labs.get(lab_id) or LabProgressRecord(lab_id=lab_id)
            rec.attempted = True
            rec.quiz_attempts += 1
            rec.last_score_pct = score_pct
            rec.best_score_pct = max(rec.best_score_pct or 0, score_pct)
            if passed and (not require_experiment_run or rec.experiment_runs > 0):
                rec.completed = True
            rec.updated_at = now
            self._labs[lab_id] = rec
            self._current_module = max(self._current_module, module_number)
            self._save_locked()
            return rec

    def get_lab_record(self, lab_id: str) -> Optional[LabProgressRecord]:
        with self._lock:
            return self._labs.get(lab_id)

    def get_summary(self, all_lab_ids: List[str]) -> CurriculumProgressResponse:
        with self._lock:
            total = len(all_lab_ids)
            attempted = sum(1 for lid in all_lab_ids if lid in self._labs and self._labs[lid].attempted)
            completed = sum(1 for lid in all_lab_ids if lid in self._labs and self._labs[lid].completed)
            pct = int(round((completed / total) * 100)) if total > 0 else 0
            return CurriculumProgressResponse(
                current_module=self._current_module,
                total_labs=total,
                attempted_count=attempted,
                completed_count=completed,
                completion_pct=pct,
                labs={lid: self._labs[lid] for lid in all_lab_ids if lid in self._labs},
            )

    def reset(self) -> None:
        with self._lock:
            self._labs = {}
            self._current_module = 1
            self._save_locked()
