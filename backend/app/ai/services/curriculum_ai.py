"""
NetBox Phase 7 — Grounded Curriculum AI Tutor Extension.
Extends Phase 5 AIAssistantService with five explicit pedagogical modes:
  - explain
  - hint (progressive levels 1-3)
  - quiz_me
  - review_understanding (graded strictly against deterministic facts + rubric)
  - connect_theory (explicitly separates Textbook vs. Captured Observation vs. Deterministic Analysis vs. AI Interpretation)
"""

import datetime
from typing import Dict, List, Optional

from ...curriculum.models import CurriculumAIInteractRequest, LabDefinition
from ...curriculum.service import CurriculumService
from ..context.context_builder import EvidenceBundle, build_evidence_bundle
from ..models import AIAssistantResponse, EvidenceSummary
from ..prompts.prompt_builder import BASE_SYSTEM_PROMPT, LEARNING_MODE_ADDENDUM
from ..retrieval.evidence_retriever import retrieve_evidence
from ..validation.response_validator import validate_ai_response
from .ai_assistant_service import AIAssistantService


VALID_CURRICULUM_MODES = {
    "explain",
    "hint",
    "quiz_me",
    "review_understanding",
    "connect_theory",
}


def _lab_context_block(lab: LabDefinition) -> str:
    objectives = "; ".join(lab.learning_objectives)
    concepts = "; ".join(f"{c.title}: {c.summary}" for c in lab.concept_explanation)
    expected = "; ".join(lab.experiment.expected_observations)
    caveats = "; ".join(lab.experiment.observation_caveats)
    return (
        f"<CURRICULUM_LAB_CONTEXT>\n"
        f"LAB_ID: {lab.lab_id}\n"
        f"MODULE: {lab.module_title}\n"
        f"TITLE: {lab.title}\n"
        f"TOPIC: {lab.topic}\n"
        f"OBJECTIVES: {objectives}\n"
        f"CONCEPTS: {concepts}\n"
        f"EXPECTED_OBSERVATIONS: {expected}\n"
        f"OBSERVATION_CAVEATS: {caveats}\n"
        f"</CURRICULUM_LAB_CONTEXT>"
    )


def _build_curriculum_messages(
    lab: LabDefinition,
    req: CurriculumAIInteractRequest,
    bundle: Optional[EvidenceBundle],
) -> List[Dict[str, str]]:
    sys_prompt = (
        BASE_SYSTEM_PROMPT
        + "\nCURRICULUM TUTOR RULES:\n"
        "- Always distinguish: (1) Textbook Knowledge, (2) Directly Captured Observations (backed by [PACKET: ...]/[SOCKET: ...] tags when a run is attached), (3) Deterministic Analysis, and (4) AI Interpretation.\n"
        "- NEVER grade or treat fabricated/missing packet observations as real captured facts.\n"
        + (LEARNING_MODE_ADDENDUM if req.learning_mode else "")
    )

    evidence_text = (
        bundle.to_prompt_block()
        if bundle is not None
        else "NO_CAPTURED_RUN_ATTACHED: Give textbook/lab guidance only and do NOT invent [PACKET: ...] or [SOCKET: ...] IDs."
    )
    lab_block = _lab_context_block(lab)
    extra_q = (req.question or "").strip()

    if req.mode == "hint":
        level_guide = {
            1: "Give a gentle Level-1 conceptual nudge only — do NOT reveal the final answer.",
            2: "Give a Level-2 diagnostic hint pointing to which header field, socket call, or protocol layer to inspect — still do NOT spoil the complete answer.",
            3: "Give a Level-3 step-by-step guided walkthrough leading right up to the conclusion.",
        }[req.hint_level]
        task = (
            f"MODE: PROGRESSIVE HINT (Level {req.hint_level}/3)\n"
            f"{level_guide}\n"
            f"Student question/stuck point: {extra_q or 'Help me interpret what I should look for in this lab.'}"
        )
    elif req.mode == "quiz_me":
        task = (
            "MODE: QUIZ ME\n"
            "Generate ONE focused, technically meaningful Computer Networks check question grounded in this lab"
            + (" and the attached real capture (cite the relevant packet/socket tags)." if bundle else " (textbook concept level).")
            + " Provide 4 options (A–D) or a short-answer prompt, and wait for the student's answer instead of spoiling it immediately."
        )
    elif req.mode == "review_understanding":
        student_text = (req.student_explanation or extra_q or "").strip()
        if not student_text:
            student_text = "(No student explanation provided.)"
        rubric_points = "; ".join(q.rubric_summary for q in lab.questions)
        task = (
            "MODE: REVIEW MY UNDERSTANDING\n"
            f"RUBRIC_REFERENCE: {rubric_points}\n"
            f"STUDENT_EXPLANATION: {student_text}\n"
            "Evaluate the student's explanation strictly against deterministic networking facts and the attached capture evidence. "
            "Explicitly list: (1) What is technically accurate, (2) Any misconceptions or unsupported claims (never validate fabricated packet observations), and (3) Concrete next step."
        )
    elif req.mode == "connect_theory":
        pkt_note = f" focusing specifically on [PACKET: pkt_{req.packet_id}]" if req.packet_id else ""
        task = (
            f"MODE: CONNECT THEORY TO EVIDENCE{pkt_note}\n"
            "Structure your answer with four explicit labeled headings:\n"
            "1. Textbook Knowledge\n"
            "2. Directly Captured Observation (cite exact [PACKET: pkt_N] / [SOCKET: sock_N] tags, or state clearly if no capture is attached)\n"
            "3. Deterministic Analysis\n"
            "4. AI Interpretation & Takeaway\n"
            + (f"Student focus: {extra_q}" if extra_q else "")
        )
    else:  # explain
        task = (
            "MODE: EXPLAIN LAB OBSERVATION\n"
            f"Explain the observed behavior for lab '{lab.title}'. "
            + (f"Student question: {extra_q}" if extra_q else "Connect the captured execution to the lab's learning objectives.")
        )

    user_msg = f"{lab_block}\n\n{evidence_text}\n\n{task}"
    return [
        {"role": "system", "content": sys_prompt.strip()},
        {"role": "user", "content": user_msg},
    ]


def handle_curriculum_ai_interaction(req: CurriculumAIInteractRequest) -> AIAssistantResponse:
    if req.mode not in VALID_CURRICULUM_MODES:
        raise ValueError(f"Unsupported curriculum AI mode '{req.mode}'. Valid: {sorted(VALID_CURRICULUM_MODES)}")

    lab = CurriculumService.get_instance().get_lab(req.lab_id)
    ai_service = AIAssistantService.get_instance()

    bundle: Optional[EvidenceBundle] = None
    if req.run_id:
        record = ai_service.run_manager._runs.get(req.run_id)
        if not record:
            raise KeyError(f"Run '{req.run_id}' not found.")
        retrieval = retrieve_evidence(
            record,
            question=req.question or req.student_explanation or lab.topic,
            packet_id=req.packet_id,
        )
        bundle = build_evidence_bundle(record, retrieval)

    messages = _build_curriculum_messages(lab, req, bundle)
    gen = ai_service.provider.generate(messages)

    if bundle is not None:
        validation = validate_ai_response(gen.text, bundle)
        verified_refs = validation.verified_references
        unverified_refs = validation.unverified_references
        warnings = validation.grounding_warnings
        summary = bundle.summary
        is_general = False
    else:
        verified_refs = []
        unverified_refs = []
        warnings = [
            "No live execution run is attached to this tutor turn; response provides curriculum/textbook guidance only."
        ]
        summary = EvidenceSummary(
            run_id=None,
            socket_events_included=0,
            packets_included=0,
            flows_included=0,
            correlations_included=0,
        )
        is_general = True

    return AIAssistantResponse(
        run_id=req.run_id,
        mode=f"curriculum_{req.mode}",
        learning_mode=req.learning_mode,
        provider=gen.provider,
        model=gen.model,
        answer=gen.text,
        verified_references=verified_refs,
        unverified_references=unverified_refs,
        grounding_warnings=warnings,
        evidence_summary=summary,
        is_general_knowledge=is_general,
        latency_ms=gen.latency_ms,
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )
