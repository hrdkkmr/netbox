import json
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from ..models import LLMStatusResponse
from .base import (
    BaseLLMProvider,
    LLMConfig,
    LLMGenerationResult,
    LLMModelNotFoundError,
    LLMProviderError,
    LLMTimeoutError,
    LLMUnavailableError,
)


def _model_matches(configured: str, installed_list: List[str]) -> bool:
    if configured in installed_list:
        return True
    # Ollama treats "model" as "model:latest" when tag is omitted
    if ":" not in configured and f"{configured}:latest" in installed_list:
        return True
    if configured.endswith(":latest"):
        base = configured[: -len(":latest")]
        if base in installed_list:
            return True
    return False


class OllamaProvider(BaseLLMProvider):
    """
    Local HTTP client for Ollama (http://127.0.0.1:11434) built strictly
    on Python stdlib urllib.request (zero cloud fallback, zero extra deps).
    """

    provider_name = "ollama"

    def __init__(self, config: Optional[LLMConfig] = None):
        super().__init__(config=config)

    def _http_json(
        self,
        path: str,
        method: str = "GET",
        payload: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        url = f"{self.config.base_url}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        eff_timeout = timeout if timeout is not None else self.config.timeout_seconds

        try:
            with urllib.request.urlopen(req, timeout=eff_timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as err:
            body = ""
            try:
                body = err.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if err.code == 404 and "model" in body.lower():
                raise LLMModelNotFoundError(
                    f"Configured local model '{self.config.model}' is not installed in Ollama. "
                    f"Pull it locally via: ollama pull {self.config.model}"
                ) from err
            raise LLMProviderError(f"Ollama returned HTTP {err.code}: {body or err.reason}") from err
        except (TimeoutError, socket.timeout) as err:
            raise LLMTimeoutError(
                f"Local LLM inference timed out after {eff_timeout:.1f}s on {url}."
            ) from err
        except urllib.error.URLError as err:
            if isinstance(err.reason, (TimeoutError, socket.timeout)):
                raise LLMTimeoutError(
                    f"Local LLM request timed out after {eff_timeout:.1f}s on {url}."
                ) from err
            raise LLMUnavailableError(
                f"Local Ollama runtime is unreachable at {self.config.base_url} ({err.reason}). "
                "Start Ollama locally via 'ollama serve'."
            ) from err
        except json.JSONDecodeError as err:
            raise LLMProviderError(f"Invalid JSON received from Ollama: {err}") from err

    def list_models(self, timeout_seconds: float = 2.5) -> List[str]:
        data = self._http_json("/api/tags", method="GET", timeout=timeout_seconds)
        models_raw = data.get("models", [])
        names: List[str] = []
        if isinstance(models_raw, list):
            for item in models_raw:
                if isinstance(item, dict) and item.get("name"):
                    names.append(str(item["name"]))
        return sorted(set(names))

    def get_status(self) -> LLMStatusResponse:
        try:
            installed = self.list_models(timeout_seconds=2.5)
        except LLMProviderError as err:
            return LLMStatusResponse(
                available=False,
                runtime_reachable=False,
                model_available=False,
                provider=self.provider_name,
                base_url=self.config.base_url,
                configured_model=self.config.model,
                installed_models=[],
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
                timeout_seconds=self.config.timeout_seconds,
                error=str(err),
                setup_hint=(
                    "Install Ollama in Ubuntu WSL2 (curl -fsSL https://ollama.com/install.sh | sh), "
                    f"start 'ollama serve', and run 'ollama pull {self.config.model}'."
                ),
            )

        model_ok = _model_matches(self.config.model, installed)
        if not model_ok:
            return LLMStatusResponse(
                available=False,
                runtime_reachable=True,
                model_available=False,
                provider=self.provider_name,
                base_url=self.config.base_url,
                configured_model=self.config.model,
                installed_models=installed,
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
                timeout_seconds=self.config.timeout_seconds,
                error=(
                    f"Ollama is running, but configured model '{self.config.model}' is not installed. "
                    f"Available local models: {installed if installed else 'none'}."
                ),
                setup_hint=f"Run: ollama pull {self.config.model}",
            )

        return LLMStatusResponse(
            available=True,
            runtime_reachable=True,
            model_available=True,
            provider=self.provider_name,
            base_url=self.config.base_url,
            configured_model=self.config.model,
            installed_models=installed,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            timeout_seconds=self.config.timeout_seconds,
            error=None,
            setup_hint=None,
        )

    def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> LLMGenerationResult:
        t0 = time.monotonic()
        payload = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature if temperature is not None else self.config.temperature,
                "num_predict": max_tokens if max_tokens is not None else self.config.max_tokens,
                "num_ctx": 4096,
            },
        }
        resp = self._http_json("/api/chat", method="POST", payload=payload)
        elapsed_ms = round((time.monotonic() - t0) * 1000.0, 2)

        msg = resp.get("message") or {}
        content = msg.get("content")
        if content is None:
            # Fallback if Ollama returns top-level 'response'
            content = resp.get("response", "")
        if not isinstance(content, str):
            content = str(content)

        return LLMGenerationResult(
            text=content.strip(),
            provider=self.provider_name,
            model=str(resp.get("model") or self.config.model),
            latency_ms=elapsed_ms,
            prompt_eval_count=resp.get("prompt_eval_count"),
            eval_count=resp.get("eval_count"),
        )
