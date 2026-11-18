# NetBox — Phase 5: Grounded Local AI Assistant

This document describes the architecture, local LLM runtime setup (Ollama), configuration, API endpoints, evidence grounding and validation system, safety guarantees, troubleshooting, and test execution for **Phase 5** of NetBox.

---

## 1. Architecture Overview (Three-Layer Separation)

NetBox Phase 5 maintains three strictly independent layers (see [`docs/PHASE5_ARCHITECTURE.md`](./PHASE5_ARCHITECTURE.md) for the full audit and design diagram):

1. **Layer A — Deterministic Networking Engine (Source of Truth):**
   - Phase 2 `LD_PRELOAD` socket API tracing (`NetworkEvent`, `source="socket_api"`).
   - Phase 4 `libpcap` packet capture (`PacketRecord`, `source="packet_capture"`).
   - Deterministic `tcp_analyzer.py` (flags, handshake, termination, bidirectional 4-tuple flows, retransmission candidates) and `event_correlator.py`.
   - *The AI never modifies or overrides Layer A outputs.*
2. **Layer B — Evidence & Context Layer (`backend/app/ai/retrieval/` & `backend/app/ai/context/`):**
   - `evidence_retriever.py`: Deterministic query-aware retrieval scoped to a single `run_id`, supporting strict `flow_id` isolation, focused `packet_id` neighbor windows (`[id-2..id+2]`), and context-window budgeting (`max_packets=40`, `max_sockets=40`) that always preserves essential handshake, termination, retransmission, and error anchors.
   - `context_builder.py`: Serializes compact structured evidence with canonical IDs (`pkt_<seq>`, `sock_<seq>`, `<flow_id>`, `handshake:<flow_id>`, `termination:<flow_id>`, `corr:pkt_<seq>`, `retrans:pkt_<seq>`), sanitizes untrusted observed strings, and wraps evidence inside `<OBSERVED_EVIDENCE_DATA_ONLY>...</OBSERVED_EVIDENCE_DATA_ONLY>`.
3. **Layer C — Grounded Local AI Assistant (`backend/app/ai/providers/`, `prompts/`, `validation/`, `services/`):**
   - Modular `BaseLLMProvider` abstraction with `OllamaProvider` communicating over local loopback HTTP (`127.0.0.1:11434`) using Python stdlib `urllib.request` (zero cloud fallback, zero extra dependencies).
   - `prompt_builder.py`: Grounded system prompt enforcing observation-vs-interpretation separation, uncertainty preservation, and optional **Learning Mode**.
   - `response_validator.py`: Verifies every `[PACKET: ...]`, `[SOCKET: ...]`, `[FLOW: ...]`, and `[ANALYSIS: ...]` citation against actual `RunRecord` indices and flags deterministic contradictions (e.g., claiming a complete handshake when `handshake.status != "COMPLETE"` or upgrading `possible_retransmission` to confirmed).
   - `conversation_store.py`: Strictly isolates conversation turns per `run_id` so switching runs never mixes observations.

---

## 2. Local Model Setup (Ollama on Ubuntu WSL 2)

NetBox uses **Ollama** as its default local model runtime. No OpenAI, Gemini, Claude, or cloud API keys are used or permitted.

### Recommended Models for 16 GB Host / 7.6 GiB WSL 2 CPU RAM
- **`qwen2.5-coder:1.5b`** *(default — ~1.0 GB RAM, fast on CPU, strong structured technical explanations)*
- **`qwen2.5:1.5b`** *(~1.0 GB RAM, general undergraduate-friendly explanations)*
- **`qwen2.5-coder:3b`** or **`llama3.2:3b`** *(~2.0–2.4 GB RAM, richer prose if memory headroom allows)*

### Installation & Startup (Ubuntu WSL 2)
```bash
# 1. Install Ollama locally inside Ubuntu WSL 2
curl -fsSL https://ollama.com/install.sh | sh

# 2. Start the local Ollama server (if systemd did not auto-start it)
ollama serve &

# 3. Pull the lightweight local model
ollama pull qwen2.5-coder:1.5b

# 4. Verify local runtime is reachable on loopback
curl http://127.0.0.1:11434/api/tags
```

### Configuration (Environment Variables or Runtime API)

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `NETBOX_LLM_BASE_URL` | `http://127.0.0.1:11434` | Local loopback Ollama URL (external hosts are rejected by `validate_local_url`) |
| `NETBOX_LLM_MODEL` | `qwen2.5-coder:1.5b` | Default local instruction-following model |
| `NETBOX_LLM_TEMPERATURE` | `0.2` | Sampling temperature (`0.0`–`1.5`) |
| `NETBOX_LLM_MAX_TOKENS` | `900` | Maximum response tokens (`64`–`4096`) |
| `NETBOX_LLM_TIMEOUT` | `60.0` | Local inference timeout in seconds (`5.0`–`300.0`) |

Models can also be switched live from the **AI Assistant** tab's model selector dropdown or via `POST /api/ai/config`.

---

## 3. API Documentation

| Method | Endpoint | Request Body / Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/ai/status` | Returns runtime reachability, configured model availability, installed local models, and troubleshooting hints. |
| `GET` | `/api/ai/models` | Lists locally installed models from Ollama. |
| `POST` | `/api/ai/config` | `{ "model"?, "base_url"?, "temperature"?, "max_tokens"?, "timeout_seconds"? }` — rejects non-localhost URLs with HTTP 400. |
| `POST` | `/api/ai/runs/{run_id}/explain` | `{ "learning_mode": bool, "focus": "execution" \| "timeline", "flow_id"?: str }` — Feature A (Execution Explanation) & Feature D (Chronological Timeline). |
| `POST` | `/api/ai/runs/{run_id}/ask` | `{ "question": str, "learning_mode": bool, "flow_id"?: str, "packet_id"?: int, "include_history": bool }` — Feature B (Ask NetBox conversational Q&A). |
| `POST` | `/api/ai/runs/{run_id}/packets/{packet_id}/explain` | `{ "learning_mode": bool, "question"?: str }` — Feature C (Explain Selected Packet with neighboring packet context). |
| `GET` | `/api/ai/runs/{run_id}/conversation` | Returns run-isolated conversation history. |
| `POST` | `/api/ai/runs/{run_id}/conversation/clear` | Clears conversation history for `run_id`. |
| `POST` | `/api/ai/ask` | `{ "question": str, "learning_mode": bool }` — General CN textbook Q&A when no live execution is selected (`is_general_knowledge: true`). |

**Error Handling:**
- `503 Service Unavailable`: Local Ollama runtime is offline or configured model is not installed (all Phase 0–4 endpoints continue functioning normally).
- `504 Gateway Timeout`: Local inference exceeded `timeout_seconds`.
- `404 Not Found`: Unknown `run_id` or `packet_id`.
- `400 Bad Request`: Invalid configuration or forbidden non-localhost URL.

---

## 4. Evidence Grounding & Clickable Navigation Mechanism

1. The context builder exposes canonical IDs from the actual `RunRecord`:
   - `[PACKET: pkt_<seq>]` → `PacketRecord.sequence`
   - `[SOCKET: sock_<seq>]` → `NetworkEvent.sequence`
   - `[FLOW: <flow_id>]` → `TcpFlowSummary.flow_id`
   - `[ANALYSIS: handshake:<flow_id>]`, `[ANALYSIS: termination:<flow_id>]`, `[ANALYSIS: corr:pkt_<seq>]`, `[ANALYSIS: retrans:pkt_<seq>]`
2. After the local LLM responds, `validate_ai_response()` resolves every bracketed citation against the run's real records:
   - **Verified citations** are returned in `verified_references` and rendered in the visualizer as clickable buttons (`extension/media/visualizer/aiAssistant.js`).
   - Clicking a verified `[PACKET: pkt_N]` switches to the **Packets** tab, highlights Packet `#N`, scrolls to it, and opens its header inspector.
   - Clicking a verified `[SOCKET: sock_N]` switches to **Overview & Socket API** and jumps playback to Socket Event `#N`.
   - Clicking a verified `[FLOW: ...]` opens the **TCP Flows** tab.
   - **Unverified / fabricated citations** are never linked and are surfaced in `unverified_references` + `grounding_warnings`.

---

## 5. Safety & Prompt-Injection Controls

- **Localhost-only:** External/cloud LLM hosts are rejected at configuration time (`ALLOWED_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}`).
- **Read-only Assistant:** The LLM has no shell, filesystem, packet-injection, or network-mutation tools.
- **Untrusted Data Fencing:** Observed network metadata is stripped of control characters and enclosed in `<OBSERVED_EVIDENCE_DATA_ONLY>...</OBSERVED_EVIDENCE_DATA_ONLY>`.
- **XSS Prevention:** All LLM text and evidence labels are HTML-escaped before DOM rendering.

---

## 6. Running Automated Tests

```bash
# Phase 5 Backend Unit, Grounding (8 scenarios), & Live-Run Integration Tests
backend/.venv/bin/python3 -m unittest backend/tests/test_phase5_ai.py -v

# Phase 4 Packet Capture + Live Loopback Regression Tests
backend/.venv/bin/python3 -m unittest backend/tests/test_phase4_packets.py -v

# Phase 2 LD_PRELOAD Socket Instrumentation Regression Tests
python3 instrumentation/tests/test_suite.py

# Phase 3–5 Extension Typecheck, Build, & Frontend Unit/Integration Tests
cd extension && npm run check-types && npm run build && npm test
```

---

## 7. Known Limitations & Troubleshooting

1. **CPU Inference Latency:** On laptops without a dedicated CUDA GPU, 1.5B–3B models run on CPU at ~5–20 tokens/sec (responses typically take 5–25 seconds). Increasing `NETBOX_LLM_TIMEOUT` (default `60s`) helps for longer execution summaries.
2. **Small Model Adherence:** Smaller 1.5B models occasionally omit bracket formatting or paraphrase citations; the deterministic `response_validator.py` acts as a safety net by verifying citations and displaying guardrail notices whenever a deterministic fact is contradicted.
3. **Ollama Not Running:** If `GET /api/ai/status` reports `runtime_reachable: false`, start Ollama with `ollama serve` in WSL 2 and click **Refresh Status** in the AI Assistant tab.
4. **Model Not Pulled:** If `model_available: false`, run `ollama pull qwen2.5-coder:1.5b` (or select an already installed model from the dropdown).
