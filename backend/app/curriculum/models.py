from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConceptSection(BaseModel):
    title: str
    summary: str
    key_points: List[str] = Field(default_factory=list)
    protocol_layers: List[str] = Field(default_factory=list)


class LabScenarioOption(BaseModel):
    scenario_id: str
    label: str
    description: str
    protocol: str
    default_params: Dict[str, Any] = Field(default_factory=dict)


class LabExperimentSpec(BaseModel):
    experiment_id: str
    title: str
    instructions: str
    required_setup: List[str] = Field(default_factory=list)
    execution_steps: List[str] = Field(default_factory=list)
    supported_scenarios: List[LabScenarioOption] = Field(default_factory=list)
    expected_observations: List[str] = Field(default_factory=list)
    observation_caveats: List[str] = Field(default_factory=list)
    has_subnet_calculator: bool = False


class AssessmentQuestion(BaseModel):
    question_id: str
    type: str = Field(..., description="multiple_choice | short_answer | packet_interpretation | scenario")
    prompt: str
    options: List[str] = Field(default_factory=list)
    correct_option_index: Optional[int] = None
    expected_keywords: List[str] = Field(default_factory=list)
    rubric_summary: str
    explanation: str


class LabCompletionCriteria(BaseModel):
    require_experiment_run: bool = True
    min_assessment_score_pct: int = 70
    description: str


class LabDefinition(BaseModel):
    lab_id: str
    module_number: int
    module_title: str
    title: str
    topic: str
    difficulty: str = Field(..., description="beginner | intermediate | advanced")
    estimated_minutes: int = 15
    learning_objectives: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    concept_explanation: List[ConceptSection] = Field(default_factory=list)
    experiment: LabExperimentSpec
    questions: List[AssessmentQuestion] = Field(default_factory=list)
    completion_criteria: LabCompletionCriteria


class LabSummaryItem(BaseModel):
    lab_id: str
    module_number: int
    module_title: str
    title: str
    topic: str
    difficulty: str
    estimated_minutes: int
    scenario_count: int
    question_count: int
    attempted: bool = False
    completed: bool = False
    best_score_pct: Optional[int] = None
    last_run_id: Optional[str] = None


class LabProgressRecord(BaseModel):
    lab_id: str
    attempted: bool = False
    completed: bool = False
    experiment_runs: int = 0
    last_run_id: Optional[str] = None
    quiz_attempts: int = 0
    best_score_pct: Optional[int] = None
    last_score_pct: Optional[int] = None
    updated_at: Optional[str] = None


class CurriculumProgressResponse(BaseModel):
    current_module: int = 1
    total_labs: int
    attempted_count: int
    completed_count: int
    completion_pct: int
    labs: Dict[str, LabProgressRecord] = Field(default_factory=dict)


class CurriculumListResponse(BaseModel):
    total_labs: int
    labs: List[LabSummaryItem]
    progress: CurriculumProgressResponse


class LabRunRequest(BaseModel):
    scenario_id: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)


class LabRunResponse(BaseModel):
    lab_id: str
    scenario_id: str
    status: str
    run_id: Optional[str] = None
    protocol: str
    summary: str
    socket_event_count: int = 0
    packet_count: int = 0
    packet_capture_status: str = "NOT_REQUESTED"
    actual_observations: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    measured_metrics: Dict[str, Any] = Field(default_factory=dict)
    raw_observations: Dict[str, Any] = Field(default_factory=dict)
    progress: CurriculumProgressResponse


class AssessmentSubmitRequest(BaseModel):
    answers: Dict[str, Any] = Field(default_factory=dict)


class QuestionGradeResult(BaseModel):
    question_id: str
    type: str
    correct: bool
    score_fraction: float
    feedback: str
    explanation: str


class AssessmentSubmitResponse(BaseModel):
    lab_id: str
    score_pct: int
    passed: bool
    correct_count: int
    total_questions: int
    results: List[QuestionGradeResult]
    progress: CurriculumProgressResponse


class SubnetCalcRequest(BaseModel):
    cidr: str = Field(..., min_length=7, max_length=32, description="IPv4 address with prefix, e.g. 192.168.10.42/24")
    compare_ip: Optional[str] = Field(default=None, description="Optional second IPv4 to check same-subnet membership")


class SubnetCalcResponse(BaseModel):
    input_cidr: str
    ip_address: str
    prefix_length: int
    subnet_mask: str
    wildcard_mask: str
    network_address: str
    broadcast_address: str
    first_usable_host: Optional[str] = None
    last_usable_host: Optional[str] = None
    total_addresses: int
    usable_host_count: int
    address_scope: str
    network_binary: str
    mask_binary: str
    compare_ip: Optional[str] = None
    same_subnet: Optional[bool] = None
    compare_explanation: Optional[str] = None


class CurriculumAIInteractRequest(BaseModel):
    lab_id: str
    mode: str = Field(
        default="explain",
        description="explain | hint | quiz_me | review_understanding | connect_theory",
    )
    run_id: Optional[str] = None
    packet_id: Optional[int] = None
    question: Optional[str] = None
    student_explanation: Optional[str] = None
    hint_level: int = Field(default=1, ge=1, le=3)
    learning_mode: bool = True
