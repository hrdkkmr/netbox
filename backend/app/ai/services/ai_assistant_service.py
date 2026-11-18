import datetime
from typing import List, Optional

from ...services.run_manager import RunManager, RunRecord
from ..context.context_builder import build_evidence_bundle
from ..models import (
    AIAssistantResponse,
    AIConfigUpdateRequest,
    ConversationClearResponse,
    ConversationTurn,
    EvidenceSummary,
    LLMModelsResponse,
    LLMStatusResponse,
)
from ..prompts.prompt_builder import (
    build_ask_run_messages,
    build_explain_execution_messages,
    build_explain_packet_messages,
    build_explain_timeline_messages,
    build_general_ask_messages,
)
from ..providers.base import BaseLLMProvider, LLMProviderError
from ..providers.ollama_provider import OllamaProvider
from ..retrieval.evidence_retriever import retrieve_evidence
from ..validation.response_validator import validate_ai_response
from .conversation_store import ConversationStore


class AIAssistantService:
    """
    Layer C orchestrator connecting RunManager (Layer A), EvidenceRetriever +
    ContextBuilder (Layer B), BaseLLMProvider (local Ollama), ResponseValidator,
    and per-run ConversationStore.
    """

    _instance: Optional["AIAssistantService"] = None

    def __init__(
        self,
        provider: Optional[BaseLLMProvider] = None,
        run_manager: Optional[RunManager] = None,
        conversation_store: Optional[ConversationStore] = None,
    ):
        self.provider: BaseLLMProvider = provider or OllamaProvider()
        self.run_manager: RunManager = run_manager or RunManager.get_instance()
        self.conversations: ConversationStore = conversation_store or ConversationStore()

    @classmethod
    def get_instance(cls) -> "AIAssistantService":
        if cls._instance is None:
            cls._instance = AIAssistantService()
        return cls._instance

    def _get_run_record(self, run_id: str) -> RunRecord:
        record = self.run_manager._runs.get(run_id)
        if not record:
            raise KeyError(f"Run '{run_id}' not found.")
        return record

    def get_status(self) -> LLMStatusResponse:
        return self.provider.get_status()

    def list_models(self) -> LLMModelsResponse:
        try:
            models = self.provider.list_models()
            return LLMModelsResponse(
                provider=self.provider.provider_name,
                runtime_reachable=True,
                configured_model=self.provider.config.model,
                models=models,
                error=None,
            )
        except LLMProviderError as err:
            return LLMModelsResponse(
                provider=self.provider.provider_name,
                runtime_reachable=False,
                configured_model=self.provider.config.model,
                models=[],
                error=str(err),
            )

    def update_config(self, req: AIConfigUpdateRequest) -> LLMStatusResponse:
        self.provider.update_config(
            model=req.model,
            base_url=req.base_url,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            timeout_seconds=req.timeout_seconds,
        )
        return self.provider.get_status()

    def explain_execution(
        self,
        run_id: str,
        learning_mode: bool = False,
        focus: str = "execution",
        flow_id: Optional[str] = None,
    ) -> AIAssistantResponse:
        record = self._get_run_record(run_id)
        retrieval = retrieve_evidence(record, flow_id=flow_id)
        bundle = build_evidence_bundle(record, retrieval)

        if focus == "timeline":
            messages = build_explain_timeline_messages(bundle, learning_mode=learning_mode)
            mode = "explain_timeline"
            user_prompt_label = "Explain the chronological connection timeline for this execution."
        else:
            messages = build_explain_execution_messages(bundle, learning_mode=learning_mode)
            mode = "explain_execution"
            user_prompt_label = "Explain this network execution."

        gen = self.provider.generate(messages)
        validation = validate_ai_response(gen.text, bundle)

        self.conversations.append_turn(run_id, "user", user_prompt_label, mode=mode)
        self.conversations.append_turn(
            run_id,
            "assistant",
            gen.text,
            mode=mode,
            verified_references=validation.verified_references,
            grounding_warnings=validation.grounding_warnings,
        )

        return AIAssistantResponse(
            run_id=run_id,
            mode=mode,
            learning_mode=learning_mode,
            provider=gen.provider,
            model=gen.model,
            answer=gen.text,
            verified_references=validation.verified_references,
            unverified_references=validation.unverified_references,
            grounding_warnings=validation.grounding_warnings,
            evidence_summary=bundle.summary,
            is_general_knowledge=False,
            latency_ms=gen.latency_ms,
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

    def ask_about_run(
        self,
        run_id: str,
        question: str,
        learning_mode: bool = False,
        flow_id: Optional[str] = None,
        packet_id: Optional[int] = None,
        include_history: bool = True,
    ) -> AIAssistantResponse:
        record = self._get_run_record(run_id)
        retrieval = retrieve_evidence(
            record,
            question=question,
            flow_id=flow_id,
            packet_id=packet_id,
        )
        bundle = build_evidence_bundle(record, retrieval)
        history = self.conversations.get_history(run_id) if include_history else []
        messages = build_ask_run_messages(
            bundle,
            question=question,
            history=history,
            learning_mode=learning_mode,
        )

        gen = self.provider.generate(messages)
        validation = validate_ai_response(gen.text, bundle)

        self.conversations.append_turn(run_id, "user", question, mode="ask_run")
        self.conversations.append_turn(
            run_id,
            "assistant",
            gen.text,
            mode="ask_run",
            verified_references=validation.verified_references,
            grounding_warnings=validation.grounding_warnings,
        )

        return AIAssistantResponse(
            run_id=run_id,
            mode="ask_run",
            learning_mode=learning_mode,
            provider=gen.provider,
            model=gen.model,
            answer=gen.text,
            verified_references=validation.verified_references,
            unverified_references=validation.unverified_references,
            grounding_warnings=validation.grounding_warnings,
            evidence_summary=bundle.summary,
            is_general_knowledge=False,
            latency_ms=gen.latency_ms,
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

    def explain_packet(
        self,
        run_id: str,
        packet_id: int,
        learning_mode: bool = True,
        question: Optional[str] = None,
    ) -> AIAssistantResponse:
        record = self._get_run_record(run_id)
        target_pkt = next((p for p in record.packets if p.sequence == packet_id), None)
        if not target_pkt:
            raise LookupError(f"Packet #{packet_id} not found in run '{run_id}'.")

        retrieval = retrieve_evidence(record, question=question, packet_id=packet_id)
        bundle = build_evidence_bundle(record, retrieval)
        messages = build_explain_packet_messages(
            bundle,
            target_packet_id=packet_id,
            question=question,
            learning_mode=learning_mode,
        )

        gen = self.provider.generate(messages)
        validation = validate_ai_response(gen.text, bundle)

        user_label = question.strip() if question and question.strip() else f"Explain Packet #{packet_id}."
        self.conversations.append_turn(run_id, "user", user_label, mode="explain_packet")
        self.conversations.append_turn(
            run_id,
            "assistant",
            gen.text,
            mode="explain_packet",
            verified_references=validation.verified_references,
            grounding_warnings=validation.grounding_warnings,
        )

        return AIAssistantResponse(
            run_id=run_id,
            mode="explain_packet",
            learning_mode=learning_mode,
            provider=gen.provider,
            model=gen.model,
            answer=gen.text,
            verified_references=validation.verified_references,
            unverified_references=validation.unverified_references,
            grounding_warnings=validation.grounding_warnings,
            evidence_summary=bundle.summary,
            is_general_knowledge=False,
            latency_ms=gen.latency_ms,
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

    def ask_general(
        self,
        question: str,
        learning_mode: bool = True,
    ) -> AIAssistantResponse:
        messages = build_general_ask_messages(question, learning_mode=learning_mode)
        gen = self.provider.generate(messages)
        validation = validate_ai_response(gen.text, None)

        return AIAssistantResponse(
            run_id=None,
            mode="general_ask",
            learning_mode=learning_mode,
            provider=gen.provider,
            model=gen.model,
            answer=gen.text,
            verified_references=[],
            unverified_references=validation.unverified_references,
            grounding_warnings=validation.grounding_warnings,
            evidence_summary=EvidenceSummary(),
            is_general_knowledge=True,
            latency_ms=gen.latency_ms,
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

    def get_conversation(self, run_id: str) -> List[ConversationTurn]:
        self._get_run_record(run_id)
        return self.conversations.get_history(run_id)

    def clear_conversation(self, run_id: str) -> ConversationClearResponse:
        self._get_run_record(run_id)
        cleared = self.conversations.clear(run_id)
        return ConversationClearResponse(run_id=run_id, cleared_turns=cleared)
