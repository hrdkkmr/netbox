import datetime
from typing import Dict, List, Optional

from ..models import ConversationTurn, EvidenceReference

MAX_TURNS_PER_RUN = 20


class ConversationStore:
    """
    Maintains strictly run-isolated conversation history per run_id so switching
    executions never mixes observations from different runs.
    """

    def __init__(self, max_turns: int = MAX_TURNS_PER_RUN):
        self._history: Dict[str, List[ConversationTurn]] = {}
        self._max_turns = max_turns

    def get_history(self, run_id: str) -> List[ConversationTurn]:
        return list(self._history.get(run_id, []))

    def append_turn(
        self,
        run_id: str,
        role: str,
        content: str,
        mode: Optional[str] = None,
        verified_references: Optional[List[EvidenceReference]] = None,
        grounding_warnings: Optional[List[str]] = None,
    ) -> ConversationTurn:
        turn = ConversationTurn(
            role=role,  # type: ignore[arg-type]
            content=content,
            mode=mode,
            verified_references=verified_references or [],
            grounding_warnings=grounding_warnings or [],
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
        turns = self._history.setdefault(run_id, [])
        turns.append(turn)
        if len(turns) > self._max_turns:
            self._history[run_id] = turns[-self._max_turns :]
        return turn

    def clear(self, run_id: str) -> int:
        existing = self._history.pop(run_id, [])
        return len(existing)
