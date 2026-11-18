from fastapi import APIRouter, Depends, HTTPException, status

from ..ai.models import AIAssistantResponse
from ..ai.providers.base import (
    LLMModelNotFoundError,
    LLMProviderError,
    LLMTimeoutError,
    LLMUnavailableError,
)
from ..ai.services.curriculum_ai import handle_curriculum_ai_interaction
from ..core.security import require_access_token, require_execution_permission
from ..curriculum.models import (
    AssessmentSubmitRequest,
    AssessmentSubmitResponse,
    CurriculumAIInteractRequest,
    CurriculumListResponse,
    CurriculumProgressResponse,
    LabDefinition,
    LabRunRequest,
    LabRunResponse,
    SubnetCalcRequest,
    SubnetCalcResponse,
)
from ..curriculum.service import CurriculumService
from ..curriculum.subnet_calc import calculate_subnet

router = APIRouter(tags=["curriculum"])


@router.get(
    "/api/curriculum/labs",
    response_model=CurriculumListResponse,
    dependencies=[Depends(require_access_token)],
)
def list_curriculum_labs() -> CurriculumListResponse:
    """Returns all 9 structured Computer Networks curriculum modules and saved student progress."""
    return CurriculumService.get_instance().list_labs()


@router.get(
    "/api/curriculum/labs/{lab_id}",
    response_model=LabDefinition,
    dependencies=[Depends(require_access_token)],
)
def get_curriculum_lab(lab_id: str) -> LabDefinition:
    """Returns the complete structured definition (concepts, experiment, assessment) for one lab."""
    try:
        return CurriculumService.get_instance().get_lab(lab_id)
    except KeyError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err.args[0]))


@router.post(
    "/api/curriculum/labs/{lab_id}/run",
    response_model=LabRunResponse,
    dependencies=[Depends(require_execution_permission)],
)
def run_curriculum_lab(lab_id: str, request: LabRunRequest) -> LabRunResponse:
    """Executes an allowlisted, localhost-safe networking experiment for the specified curriculum lab."""
    try:
        return CurriculumService.get_instance().run_lab_experiment(
            lab_id=lab_id,
            scenario_id=request.scenario_id,
            params=request.params,
        )
    except KeyError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err.args[0]))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Lab execution failed: {err}")


@router.post(
    "/api/curriculum/labs/{lab_id}/assess",
    response_model=AssessmentSubmitResponse,
    dependencies=[Depends(require_access_token)],
)
def assess_curriculum_lab(lab_id: str, request: AssessmentSubmitRequest) -> AssessmentSubmitResponse:
    """Deterministically grades lab assessment responses and persists updated learning progress."""
    try:
        return CurriculumService.get_instance().grade_assessment(lab_id=lab_id, answers=request.answers)
    except KeyError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err.args[0]))


@router.get(
    "/api/curriculum/progress",
    response_model=CurriculumProgressResponse,
    dependencies=[Depends(require_access_token)],
)
def get_curriculum_progress() -> CurriculumProgressResponse:
    """Returns locally persisted student progress across all curriculum modules."""
    return CurriculumService.get_instance().get_progress()


@router.post(
    "/api/curriculum/progress/reset",
    response_model=CurriculumProgressResponse,
    dependencies=[Depends(require_access_token)],
)
def reset_curriculum_progress() -> CurriculumProgressResponse:
    """Resets locally saved curriculum progress."""
    return CurriculumService.get_instance().reset_progress()


@router.post(
    "/api/curriculum/tools/subnet",
    response_model=SubnetCalcResponse,
    dependencies=[Depends(require_access_token)],
)
def calculate_ipv4_subnet(request: SubnetCalcRequest) -> SubnetCalcResponse:
    """Deterministic mathematical IPv4 CIDR subnet calculator (never LLM-generated)."""
    try:
        return calculate_subnet(request.cidr, request.compare_ip)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.post(
    "/api/ai/curriculum/interact",
    response_model=AIAssistantResponse,
    dependencies=[Depends(require_access_token)],
)
def interact_curriculum_ai(request: CurriculumAIInteractRequest) -> AIAssistantResponse:
    """Grounded local AI curriculum tutor (explain, hint, quiz_me, review_understanding, connect_theory)."""
    try:
        return handle_curriculum_ai_interaction(request)
    except KeyError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err.args[0]))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except LLMTimeoutError as err:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(err))
    except (LLMUnavailableError, LLMModelNotFoundError) as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    except LLMProviderError as err:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))
