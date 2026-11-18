from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class EvidenceReference(BaseModel):
    tag: str = Field(..., description="Original citation tag, e.g. '[PACKET: pkt_4]'")
    kind: Literal["packet", "socket", "flow", "analysis"]
    id: str = Field(..., description="Normalized ID, e.g. 'pkt_4', 'sock_7', flow_id")
    target_sequence: Optional[int] = None
    target_flow_id: Optional[str] = None
    verified: bool = True
    label: str = ""


class LLMStatusResponse(BaseModel):
    available: bool
    runtime_reachable: bool
    model_available: bool
    provider: str = "ollama"
    base_url: str
    configured_model: str
    installed_models: List[str] = Field(default_factory=list)
    temperature: float = 0.2
    max_tokens: int = 900
    timeout_seconds: float = 60.0
    error: Optional[str] = None
    setup_hint: Optional[str] = None


class LLMModelsResponse(BaseModel):
    provider: str = "ollama"
    runtime_reachable: bool
    configured_model: str
    models: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class AIConfigUpdateRequest(BaseModel):
    model: Optional[str] = Field(default=None, min_length=1, max_length=128)
    base_url: Optional[str] = Field(default=None, min_length=7, max_length=256)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=1.5)
    max_tokens: Optional[int] = Field(default=None, ge=64, le=4096)
    timeout_seconds: Optional[float] = Field(default=None, ge=5.0, le=300.0)


class ExplainExecutionRequest(BaseModel):
    learning_mode: bool = Field(default=False, description="Explain underlying CN concepts for students")
    focus: Literal["execution", "timeline"] = Field(
        default="execution",
        description="'execution' for full report or 'timeline' for chronological connection walkthrough",
    )
    flow_id: Optional[str] = Field(default=None, description="Optional flow_id to isolate explanation")


class AskRunRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    learning_mode: bool = Field(default=False)
    flow_id: Optional[str] = Field(default=None)
    packet_id: Optional[int] = Field(default=None, ge=1)
    include_history: bool = Field(default=True)


class ExplainPacketRequest(BaseModel):
    learning_mode: bool = Field(default=True)
    question: Optional[str] = Field(default=None, max_length=1000)


class GeneralAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    learning_mode: bool = Field(default=True)


class EvidenceSummary(BaseModel):
    run_id: Optional[str] = None
    socket_event_count: int = 0
    packet_count: int = 0
    flow_count: int = 0
    included_socket_sequences: List[int] = Field(default_factory=list)
    included_packet_sequences: List[int] = Field(default_factory=list)
    included_flow_ids: List[str] = Field(default_factory=list)
    packet_capture_status: Optional[str] = None
    truncated_for_budget: bool = False


class AIAssistantResponse(BaseModel):
    run_id: Optional[str] = None
    mode: str  # "explain_execution" | "explain_timeline" | "ask_run" | "explain_packet" | "general_ask"
    learning_mode: bool = False
    provider: str
    model: str
    answer: str
    verified_references: List[EvidenceReference] = Field(default_factory=list)
    unverified_references: List[str] = Field(default_factory=list)
    grounding_warnings: List[str] = Field(default_factory=list)
    evidence_summary: EvidenceSummary = Field(default_factory=EvidenceSummary)
    is_general_knowledge: bool = False
    latency_ms: float = 0.0
    created_at: str


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    mode: Optional[str] = None
    verified_references: List[EvidenceReference] = Field(default_factory=list)
    grounding_warnings: List[str] = Field(default_factory=list)
    created_at: str


class ConversationClearResponse(BaseModel):
    run_id: str
    cleared_turns: int
    status: str = "cleared"
