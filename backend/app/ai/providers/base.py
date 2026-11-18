import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional
from urllib.parse import urlparse

from ..models import LLMStatusResponse

ALLOWED_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class LLMProviderError(Exception):
    """Base error for local LLM provider failures."""


class LLMUnavailableError(LLMProviderError):
    """Raised when the local LLM runtime is not running or unreachable."""


class LLMModelNotFoundError(LLMProviderError):
    """Raised when the configured local model is not installed in the runtime."""


class LLMTimeoutError(LLMProviderError):
    """Raised when local inference exceeds configured timeout."""


def validate_local_url(url: str) -> str:
    """
    Strictly enforces localhost/loopback URLs so NetBox never transmits
    captured network telemetry to any external or cloud AI service.
    """
    cleaned = (url or "").strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported LLM URL scheme '{parsed.scheme}'. Use http://127.0.0.1:11434.")
    hostname = (parsed.hostname or "").lower()
    if hostname not in ALLOWED_LOCAL_HOSTS:
        raise ValueError(
            f"External LLM host '{hostname}' is forbidden. NetBox Phase 5 strictly requires "
            f"a local loopback runtime ({', '.join(sorted(ALLOWED_LOCAL_HOSTS))})."
        )
    return cleaned


@dataclass
class LLMConfig:
    base_url: str = "http://127.0.0.1:11434"
    model: str = "qwen2.5-coder:1.5b"
    temperature: float = 0.2
    max_tokens: int = 512
    timeout_seconds: float = 90.0

    @classmethod
    def from_env(cls) -> "LLMConfig":
        raw_url = os.environ.get("NETBOX_LLM_BASE_URL", "http://127.0.0.1:11434")
        base_url = validate_local_url(raw_url)
        model = os.environ.get("NETBOX_LLM_MODEL", "qwen2.5-coder:1.5b").strip() or "qwen2.5-coder:1.5b"
        try:
            temp = float(os.environ.get("NETBOX_LLM_TEMPERATURE", "0.2"))
        except ValueError:
            temp = 0.2
        try:
            max_tok = int(os.environ.get("NETBOX_LLM_MAX_TOKENS", "512"))
        except ValueError:
            max_tok = 512
        try:
            timeout = float(os.environ.get("NETBOX_LLM_TIMEOUT", "90.0"))
        except ValueError:
            timeout = 90.0
        return cls(
            base_url=base_url,
            model=model,
            temperature=max(0.0, min(1.5, temp)),
            max_tokens=max(64, min(4096, max_tok)),
            timeout_seconds=max(5.0, min(300.0, timeout)),
        )


@dataclass
class LLMGenerationResult:
    text: str
    provider: str
    model: str
    latency_ms: float
    prompt_eval_count: Optional[int] = None
    eval_count: Optional[int] = None


class BaseLLMProvider(ABC):
    provider_name: str = "base"

    def __init__(self, config: Optional[LLMConfig] = None):
        self.config = config or LLMConfig.from_env()
        self.config.base_url = validate_local_url(self.config.base_url)

    def update_config(
        self,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        timeout_seconds: Optional[float] = None,
    ) -> LLMConfig:
        if base_url is not None:
            self.config.base_url = validate_local_url(base_url)
        if model is not None:
            self.config.model = model.strip()
        if temperature is not None:
            self.config.temperature = float(temperature)
        if max_tokens is not None:
            self.config.max_tokens = int(max_tokens)
        if timeout_seconds is not None:
            self.config.timeout_seconds = float(timeout_seconds)
        return self.config

    @abstractmethod
    def list_models(self, timeout_seconds: float = 2.5) -> List[str]:
        """Returns names of locally available models."""

    @abstractmethod
    def get_status(self) -> LLMStatusResponse:
        """Detects runtime reachability and configured model availability."""

    @abstractmethod
    def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> LLMGenerationResult:
        """Runs local chat completion over structured messages."""
