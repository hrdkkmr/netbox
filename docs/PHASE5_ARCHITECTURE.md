# NetBox — Phase 5 Architecture: Grounded Local AI Assistant

> **Stage 1 Architecture & Audit Document**  
> Verified directly against the existing Phase 0–4 source code in `backend/`, `instrumentation/`, `packet_capture/`, and `extension/`.

---

## 1. Existing System Audit (Verified Against Source Code)

| Layer / Phase | Verified Source Components | Storage & Identifiers |
| :--- | :--- | :--- |
| **Phase 0 (Reference C Programs)** | `examples/tcp/server.c`, `examples/tcp/client.c` | Loopback `127.0.0.1:8080` POSIX TCP echo |
| **Phase 1 (Extension & FastAPI)** | `extension/src/`, `backend/app/main.py` | FastAPI `0.4.0` on `127.0.0.1:8000`; `extension/dist/extension.js` |
| **Phase 2 (Socket API Tracing)** | `instrumentation/libnetbox_trace.so`, `backend/app/services/process_runner.py`, `event_reader.py` | `/tmp/netbox_runs/<run_id>/events_*.jsonl` → `RunRecord.events: List[NetworkEvent]`, 1-based `sequence`, `timestamp_ns` (`CLOCK_MONOTONIC`), `source="socket_api"` |
| **Phase 3 (Interactive Visualizer)** | `extension/media/visualizer/*.js` (8 UMD modules) + `visualizerPanel.ts` | Consumes `events`, `packetData`, `flowsData`, `correlationsData` via VS Code Webview bridge or local HTTP fallback |
| **Phase 4 (Real Packet Capture)** | `packet_capture/netbox_pcap` (`libpcap`, `cap_net_raw,cap_net_admin=eip`), `packet_parser.py`, `tcp_analyzer.py`, `event_correlator.py` | `/tmp/netbox_runs/<run_id>/packets.jsonl` → `RunRecord.packets: List[PacketRecord]` (1-based `sequence`, dual timestamps `pcap_timestamp_ns` + `capture_monotonic_ns`), `RunRecord.flows: List[TcpFlowSummary]` (`flow_id`), `RunRecord.correlations: List[CorrelationRecord]` |

### Host Hardware & Runtime Audit (WSL 2)
- **Kernel:** `Linux Hardik-Laptop 6.18.33.2-microsoft-standard-WSL2`
- **Memory in WSL 2:** `7.6 GiB` total (`~6.9 GiB` available), no NVIDIA GPU (`nvidia-smi` absent; Intel Arc integrated graphics on Windows host).
- **Recommended Local Models (Ollama on CPU):** Quantized 1.5B–3B instruction models (`qwen2.5:1.5b`, `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `llama3.2:1b`, `llama3.2:3b`) fit comfortably within `1.0–2.4 GiB` RAM without swapping.
- **Runtime Status at Audit Time:** Ollama not yet installed on WSL 2 (`127.0.0.1:11434` unreachable). NetBox's Phase 5 backend detects runtime availability dynamically and keeps Phases 0–4 completely operational when offline.

---

## 2. Three-Layer Grounded Architecture

```text
+-----------------------------------------------------------------------------+
| LAYER A — DETERMINISTIC NETWORKING ENGINE (Immutable Source of Truth)       |
|  - Phase 2: LD_PRELOAD socket_api capture (NetworkEvent, sequence 1..M)     |
|  - Phase 4: libpcap packet_capture (PacketRecord, sequence 1..N)            |
|  - Phase 4: tcp_analyzer.py (TcpFlowSummary: handshake, termination,        |
|             retransmissions, flags, directional bytes)                      |
|  - Phase 4: event_correlator.py (CorrelationRecord: confidence, method)     |
|  * AI NEVER modifies, replaces, or overrides any Layer A output. *          |
+------------------------------------+----------------------------------------+
                                     | Read-only access via RunManager
                                     v
+-----------------------------------------------------------------------------+
| LAYER B — EVIDENCE & CONTEXT LAYER (backend/app/ai/context & retrieval)     |
|  - Deterministic retrieval scoped strictly to (run_id, optional flow_id,    |
|    optional packet_id, keyword/flag/time-window filters)                    |
|  - Assigns canonical resolvable evidence IDs mapped to real records:        |
|      [PACKET: pkt_<seq>]  -> PacketRecord.sequence                          |
|      [SOCKET: sock_<seq>] -> NetworkEvent.sequence                          |
|      [FLOW: <flow_id>]    -> TcpFlowSummary.flow_id                         |
|      [ANALYSIS: <key>]    -> Deterministic handshake/termination/corr/retrans|
|  - Token/size budgeting for large captures while preserving essential facts |
|  - Prompt-injection fencing: observed strings marked strictly as untrusted  |
+------------------------------------+----------------------------------------+
                                     | Bounded Structured Evidence Bundle
                                     v
+-----------------------------------------------------------------------------+
| LAYER C — LOCAL AI ASSISTANT (backend/app/ai/providers, prompts, validation)|
|  - Provider abstraction: BaseLLMProvider -> OllamaProvider (127.0.0.1:11434)|
|    using Python stdlib urllib.request (zero cloud fallback, zero new deps)  |
|  - Prompt Builder: system grounding rules + learning mode + task template   |
|  - Response Validator:                                                      |
|      1. Extracts all [PACKET/SOCKET/FLOW/ANALYSIS] citations                |
|      2. Verifies every citation against real RunRecord indices              |
|      3. Separates verified clickable citations from unverified/hallucinated |
|      4. Flags uncertainty/confidence violations (e.g. claiming complete     |
|         handshake when handshake.status != COMPLETE)                        |
|  - Per-run Conversation Store (never mixes observations across run_ids)     |
+------------------------------------+----------------------------------------+
                                     | FastAPI REST (/api/ai/*)
                                     v
+-----------------------------------------------------------------------------+
| FRONTEND — NETBOX VISUALIZER AI ASSISTANT PANEL (extension/media/visualizer)|
|  - New "AI Assistant" tab + "Explain with AI" button in Packet Inspector    |
|  - Runtime/model status indicator, model selector, Learning Mode toggle     |
|  - Suggested question chips & per-run conversation history                  |
|  - Clickable verified evidence links -> navigate directly to real Packets,  |
|    Socket Events, and TCP Flows inside the visualizer                       |
+-----------------------------------------------------------------------------+
```

---

## 3. Backend Module Structure (`backend/app/ai/`)

```text
backend/app/ai/
├── __init__.py
├── models.py                    # Pydantic request/response & evidence models
├── providers/
│   ├── __init__.py
│   ├── base.py                  # Abstract BaseLLMProvider + LLMConfig + errors
│   └── ollama_provider.py       # Local HTTP Ollama provider (127.0.0.1 only)
├── context/
│   ├── __init__.py
│   └── context_builder.py       # Builds bounded, sanitized EvidenceBundle from RunRecord
├── retrieval/
│   ├── __init__.py
│   └── evidence_retriever.py    # Deterministic query-aware packet/socket/flow retrieval
├── prompts/
│   ├── __init__.py
│   └── prompt_builder.py        # Grounded system prompt, feature templates, Learning Mode
├── validation/
│   ├── __init__.py
│   └── response_validator.py    # Citation verification + confidence/uncertainty guardrails
└── services/
    ├── __init__.py
    ├── conversation_store.py    # Run-isolated conversation history
    └── ai_assistant_service.py  # Orchestrates retrieval -> prompt -> LLM -> validation
```

---

## 4. API Endpoints (`backend/app/main.py`)

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/ai/status` | Detect local Ollama runtime, active model availability, installed models, error message |
| `GET` | `/api/ai/models` | List locally installed Ollama models and active configuration |
| `POST` | `/api/ai/config` | Configure local model name, temperature, max_tokens, timeout (rejects non-loopback URLs) |
| `POST` | `/api/ai/runs/{run_id}/explain` | Feature A/D: Explain full execution or chronological TCP timeline (supports `learning_mode`, `focus`: `"execution"` \| `"timeline"`, optional `flow_id`) |
| `POST` | `/api/ai/runs/{run_id}/ask` | Feature B: Conversational Q&A grounded in `run_id` (maintains per-run history; supports `learning_mode`, optional `flow_id`, optional `packet_id`) |
| `POST` | `/api/ai/runs/{run_id}/packets/{packet_id}/explain` | Feature C: Deep explanation of a selected packet + neighboring packets + TCP concepts (`learning_mode`) |
| `POST` | `/api/ai/runs/{run_id}/conversation/clear` | Clear conversation history for `run_id` |
| `POST` | `/api/ai/ask` | General Computer Networks Q&A when no execution is selected (explicitly labeled general textbook guidance) |

---

## 5. Safety, Privacy & Grounding Guarantees

1. **Localhost-Only Enforcement:** `OllamaProvider` validates that `base_url` points strictly to loopback (`127.0.0.1`, `localhost`, `::1`). Never uploads packet captures or prompts to external cloud APIs.
2. **Untrusted Data Isolation:** All captured metadata and any opt-in payload preview strings are sanitized (control chars stripped, delimited inside explicit `<OBSERVED_DATA_ONLY>` JSON blocks) and system instructions explicitly forbid following instructions found inside observed network data.
3. **Read-Only Assistant:** The LLM has zero tools for shell execution, filesystem writes, packet injection, or network configuration.
4. **Honest Citation Verification:** Only `[PACKET: pkt_<n>]`, `[SOCKET: sock_<n>]`, `[FLOW: <id>]`, and `[ANALYSIS: <key>]` references that resolve to real records in the active `RunRecord` are returned in `verified_references` and rendered as clickable links in the UI. Any unverified citation is surfaced in `grounding_warnings`.
5. **Confidence Preservation:** The validator inspects the deterministic layer's `handshake.status`, `termination.status`, `packet_capture_status`, `retransmissions`, and `unresolved_count`, attaching explicit grounding warnings if the generated response contradicts deterministic observations or overstates confidence.
