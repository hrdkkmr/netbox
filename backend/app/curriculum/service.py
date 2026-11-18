from pathlib import Path
from typing import Any, Dict, List, Optional

from ..services.lab_runner import execute_lab_scenario
from .loader import CurriculumLoader
from .models import (
    AssessmentSubmitResponse,
    CurriculumListResponse,
    CurriculumProgressResponse,
    LabDefinition,
    LabRunResponse,
    LabSummaryItem,
    QuestionGradeResult,
)
from .progress_store import ProgressStore


class CurriculumService:
    _instance: Optional["CurriculumService"] = None

    def __init__(
        self,
        loader: Optional[CurriculumLoader] = None,
        progress_store: Optional[ProgressStore] = None,
    ):
        self.loader = loader or CurriculumLoader()
        self.progress = progress_store or ProgressStore()

    @classmethod
    def get_instance(cls) -> "CurriculumService":
        if cls._instance is None:
            cls._instance = CurriculumService()
        return cls._instance

    def _all_lab_ids(self) -> List[str]:
        return [lab.lab_id for lab in self.loader.list_labs()]

    def list_labs(self) -> CurriculumListResponse:
        labs = self.loader.list_labs()
        progress_summary = self.progress.get_summary([l.lab_id for l in labs])
        items: List[LabSummaryItem] = []
        for lab in labs:
            rec = progress_summary.labs.get(lab.lab_id)
            items.append(
                LabSummaryItem(
                    lab_id=lab.lab_id,
                    module_number=lab.module_number,
                    module_title=lab.module_title,
                    title=lab.title,
                    topic=lab.topic,
                    difficulty=lab.difficulty,
                    estimated_minutes=lab.estimated_minutes,
                    scenario_count=len(lab.experiment.supported_scenarios),
                    question_count=len(lab.questions),
                    attempted=rec.attempted if rec else False,
                    completed=rec.completed if rec else False,
                    best_score_pct=rec.best_score_pct if rec else None,
                    last_run_id=rec.last_run_id if rec else None,
                )
            )
        return CurriculumListResponse(total_labs=len(items), labs=items, progress=progress_summary)

    def get_lab(self, lab_id: str) -> LabDefinition:
        lab = self.loader.get_lab(lab_id)
        if not lab:
            raise KeyError(f"Curriculum lab '{lab_id}' not found.")
        return lab

    def get_progress(self) -> CurriculumProgressResponse:
        return self.progress.get_summary(self._all_lab_ids())

    def reset_progress(self) -> CurriculumProgressResponse:
        self.progress.reset()
        return self.progress.get_summary(self._all_lab_ids())

    def run_lab_experiment(
        self,
        lab_id: str,
        scenario_id: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> LabRunResponse:
        lab = self.get_lab(lab_id)
        allowed_scenarios = {s.scenario_id: s for s in lab.experiment.supported_scenarios}
        target_scenario = scenario_id or lab.experiment.experiment_id
        if target_scenario not in allowed_scenarios:
            raise ValueError(
                f"Scenario '{target_scenario}' is not allowed for lab '{lab_id}'. "
                f"Supported: {sorted(allowed_scenarios.keys())}"
            )

        merged_params = dict(allowed_scenarios[target_scenario].default_params)
        if params:
            merged_params.update(params)

        result = execute_lab_scenario(target_scenario, merged_params)
        self.progress.record_experiment_run(
            lab_id=lab.lab_id,
            module_number=lab.module_number,
            run_id=result.get("run_id"),
            min_score_pct=lab.completion_criteria.min_assessment_score_pct,
        )
        progress_summary = self.get_progress()

        return LabRunResponse(
            lab_id=lab.lab_id,
            scenario_id=target_scenario,
            status=result.get("status", "completed"),
            run_id=result.get("run_id"),
            protocol=result.get("protocol", "TCP"),
            summary=result.get("summary", ""),
            socket_event_count=int(result.get("socket_event_count", 0)),
            packet_count=int(result.get("packet_count", 0)),
            packet_capture_status=result.get("packet_capture_status", "NOT_REQUESTED"),
            actual_observations=result.get("actual_observations", []),
            warnings=result.get("warnings", []),
            measured_metrics=result.get("measured_metrics", {}),
            raw_observations=result.get("raw_observations", {}),
            progress=progress_summary,
        )

    def grade_assessment(self, lab_id: str, answers: Dict[str, Any]) -> AssessmentSubmitResponse:
        lab = self.get_lab(lab_id)
        results: List[QuestionGradeResult] = []
        total_score = 0.0
        correct_count = 0

        for q in lab.questions:
            raw_ans = answers.get(q.question_id)
            if q.type in ("multiple_choice", "packet_interpretation", "scenario") and q.options:
                try:
                    chosen = int(raw_ans) if raw_ans is not None and str(raw_ans).strip() != "" else -1
                except (ValueError, TypeError):
                    chosen = -1
                is_correct = (q.correct_option_index is not None) and (chosen == q.correct_option_index)
                frac = 1.0 if is_correct else 0.0
                if is_correct:
                    correct_count += 1
                    feedback = "Correct!"
                else:
                    correct_text = (
                        q.options[q.correct_option_index]
                        if q.correct_option_index is not None and 0 <= q.correct_option_index < len(q.options)
                        else "See explanation"
                    )
                    feedback = f"Incorrect. Expected: {correct_text}"
                total_score += frac
                results.append(
                    QuestionGradeResult(
                        question_id=q.question_id,
                        type=q.type,
                        correct=is_correct,
                        score_fraction=frac,
                        feedback=feedback,
                        explanation=q.explanation,
                    )
                )
            else:
                # Deterministic rubric-keyword evaluation for short-answer questions
                text = str(raw_ans or "").strip().lower()
                keywords = [kw.lower() for kw in q.expected_keywords]
                matched = [kw for kw in keywords if kw in text]
                if not text or len(text) < 8:
                    is_correct = False
                    frac = 0.0
                    feedback = "Answer is too brief. Include key technical reasoning from the lab."
                elif not keywords:
                    is_correct = True
                    frac = 1.0
                    correct_count += 1
                    feedback = "Recorded response."
                else:
                    # Passing threshold: at least 2 matching technical rubric concepts (or >=40% of rubric keywords)
                    needed = min(2, len(keywords))
                    if len(matched) >= needed:
                        is_correct = True
                        frac = 1.0
                        correct_count += 1
                        feedback = f"Good technical explanation (matched concepts: {', '.join(matched)})."
                    elif len(matched) == 1:
                        is_correct = False
                        frac = 0.5
                        feedback = f"Partially correct (mentioned '{matched[0]}'). Rubric expects: {q.rubric_summary}"
                    else:
                        is_correct = False
                        frac = 0.0
                        feedback = f"Missing key concepts. Rubric expects: {q.rubric_summary}"
                total_score += frac
                results.append(
                    QuestionGradeResult(
                        question_id=q.question_id,
                        type=q.type,
                        correct=is_correct,
                        score_fraction=frac,
                        feedback=feedback,
                        explanation=q.explanation,
                    )
                )

        total_q = len(lab.questions)
        score_pct = int(round((total_score / total_q) * 100)) if total_q > 0 else 100
        passed = score_pct >= lab.completion_criteria.min_assessment_score_pct

        self.progress.record_assessment(
            lab_id=lab.lab_id,
            module_number=lab.module_number,
            score_pct=score_pct,
            passed=passed,
            require_experiment_run=lab.completion_criteria.require_experiment_run,
        )

        return AssessmentSubmitResponse(
            lab_id=lab.lab_id,
            score_pct=score_pct,
            passed=passed,
            correct_count=correct_count,
            total_questions=total_q,
            results=results,
            progress=self.get_progress(),
        )
