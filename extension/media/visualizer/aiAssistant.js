/**
 * NetBox Phase 5 Visualizer — Grounded Local AI Assistant Module
 * Handles safe HTML formatting, verified-only clickable evidence links,
 * suggested question chips, and conversation rendering.
 *
 * INVARIANT: Only references verified by the backend against actual RunRecord
 * objects are rendered as clickable navigation links. Never fakes citations.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.AIAssistant = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(val) {
    if (val === null || val === undefined) {
      return "";
    }
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Formats markdown-like response text safely and turns ONLY backend-verified
   * evidence references ([PACKET: pkt_N], [SOCKET: sock_N], [FLOW: ...], [ANALYSIS: ...])
   * into real clickable navigation buttons.
   */
  function formatAnswerWithVerifiedLinks(answerText, verifiedRefs) {
    let html = escapeHtml(answerText || "");

    // Lightweight safe formatting: bold (**text**) and inline code (`text`)
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    const refs = Array.isArray(verifiedRefs) ? verifiedRefs : [];
    refs.forEach((ref) => {
      if (!ref || !ref.verified || !ref.tag) {
        return;
      }
      const escapedTag = escapeHtml(ref.tag);
      const seqAttr =
        ref.target_sequence !== null && ref.target_sequence !== undefined
          ? `data-ev-seq="${escapeHtml(ref.target_sequence)}"`
          : "";
      const flowAttr = ref.target_flow_id
        ? `data-ev-flow="${escapeHtml(ref.target_flow_id)}"`
        : "";
      const btn = `<button type="button" class="ai-ev-link ai-ev-${escapeHtml(ref.kind)}" data-ev-kind="${escapeHtml(ref.kind)}" ${seqAttr} ${flowAttr} title="Navigate to ${escapeHtml(ref.label || ref.id)}">${escapedTag}</button>`;
      html = html.split(escapedTag).join(btn);
    });

    // Preserve paragraphs & line breaks cleanly
    html = html.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>");
    return `<p>${html}</p>`;
  }

  function getSuggestedChips(options) {
    const opts = options || {};
    const hasLiveRun = Boolean(opts.hasLiveRun);
    const selectedPacketSeq = opts.selectedPacketSeq;

    if (!hasLiveRun) {
      return [
        {
          id: "gen-handshake",
          label: "Explain the TCP three-way handshake",
          action: "general",
          question: "Explain the TCP three-way handshake and what SYN, SYN-ACK, and ACK mean.",
        },
        {
          id: "gen-socket-vs-tcp",
          label: "Socket vs. TCP connection",
          action: "general",
          question: "What is the difference between a POSIX socket and a TCP connection?",
        },
        {
          id: "gen-seq-ack",
          label: "How do TCP sequence & ACK numbers work?",
          action: "general",
          question: "How do TCP sequence and acknowledgment numbers work in a byte stream?",
        },
      ];
    }

    const chips = [
      { id: "explain-exec", label: "Explain this execution", action: "explain_execution" },
      { id: "explain-timeline", label: "Explain connection timeline", action: "explain_timeline" },
      {
        id: "ask-handshake",
        label: "Explain the handshake",
        action: "ask_run",
        question: "Explain the TCP handshake observed in this execution, citing exact packets.",
      },
      {
        id: "ask-data",
        label: "What happened during data transfer?",
        action: "ask_run",
        question: "Which packets carried application data during this execution, and how do they relate to the socket send/recv calls?",
      },
      {
        id: "ask-termination",
        label: "Explain connection termination",
        action: "ask_run",
        question: "Explain how the TCP connection terminated in this execution based on the captured packets.",
      },
      {
        id: "ask-anomalies",
        label: "Identify unusual observations",
        action: "ask_run",
        question: "Were any errors, retransmissions, incomplete stages, or unresolved correlations observed in this execution?",
      },
    ];

    if (selectedPacketSeq !== null && selectedPacketSeq !== undefined) {
      chips.splice(2, 0, {
        id: "explain-pkt",
        label: `Explain Packet #${selectedPacketSeq}`,
        action: "explain_packet",
        packetId: selectedPacketSeq,
      });
    }

    return chips;
  }

  function renderStatusBar(elements, status) {
    if (!elements) return;
    if (!status) {
      if (elements.statusPill) {
        elements.statusPill.textContent = "Local LLM: Checking...";
        elements.statusPill.className = "ai-status-pill ai-status-neutral";
      }
      return;
    }

    if (elements.statusPill) {
      if (status.available) {
        elements.statusPill.textContent = `Local LLM Ready (${status.provider}: ${status.configured_model})`;
        elements.statusPill.className = "ai-status-pill ai-status-ready";
      } else if (status.runtime_reachable) {
        elements.statusPill.textContent = `Model Missing (${status.configured_model})`;
        elements.statusPill.className = "ai-status-pill ai-status-warn";
      } else {
        elements.statusPill.textContent = "Local LLM Offline (Ollama unavailable)";
        elements.statusPill.className = "ai-status-pill ai-status-offline";
      }
    }

    if (elements.offlineBanner) {
      if (status.available) {
        elements.offlineBanner.classList.add("hidden");
      } else {
        elements.offlineBanner.classList.remove("hidden");
        elements.offlineBanner.innerHTML = `
          <div><strong>Local AI Assistant Unavailable:</strong> ${escapeHtml(status.error || "Local runtime not reachable.")}</div>
          ${status.setup_hint ? `<div class="ai-setup-hint">Setup: <code>${escapeHtml(status.setup_hint)}</code></div>` : ""}
          <div class="ai-setup-note">All deterministic NetBox features (socket tracing, packet capture, topology, flows, and correlations) continue working offline without an LLM.</div>
        `;
      }
    }

    if (elements.modelSelect) {
      const models = Array.isArray(status.installed_models) ? status.installed_models : [];
      elements.modelSelect.innerHTML = "";
      const list = models.includes(status.configured_model)
        ? models
        : [status.configured_model, ...models];
      list.forEach((m) => {
        if (!m) return;
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = models.includes(m) ? m : `${m} (not installed)`;
        elements.modelSelect.appendChild(opt);
      });
      elements.modelSelect.value = status.configured_model || "";
    }
  }

  function renderConversation(container, messages, onNavigateRef) {
    if (!container) return;

    if (!Array.isArray(messages) || messages.length === 0) {
      container.innerHTML = `
        <div class="ai-empty-state">
          <h4>Grounded Local AI Assistant</h4>
          <p>Ask questions about the selected execution, explain a captured TCP packet, or toggle <strong>Learning Mode</strong> for undergraduate-friendly networking explanations.</p>
          <p class="ai-empty-sub">Every claim about an observed run is grounded in Phase 2 socket calls and Phase 4 captured packets, with verified clickable evidence links.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = messages
      .map((msg) => {
        if (msg.role === "user") {
          return `
            <div class="ai-msg ai-msg-user">
              <div class="ai-msg-meta">You ${msg.mode ? `· ${escapeHtml(msg.mode)}` : ""}</div>
              <div class="ai-msg-body">${escapeHtml(msg.content)}</div>
            </div>
          `;
        }

        const refs = Array.isArray(msg.verified_references) ? msg.verified_references : [];
        const warnings = Array.isArray(msg.grounding_warnings) ? msg.grounding_warnings : [];
        const scopeBadge = msg.is_general_knowledge
          ? `<span class="ai-scope-badge ai-scope-general">General CN Concept (No Live Run Attached)</span>`
          : `<span class="ai-scope-badge ai-scope-grounded">Grounded in Run ${escapeHtml(msg.run_id || "")}</span>`;
        const learnBadge = msg.learning_mode
          ? `<span class="ai-scope-badge ai-scope-learn">Learning Mode</span>`
          : "";
        const modelInfo = msg.model
          ? `${escapeHtml(msg.model)}${msg.latency_ms ? ` · ${(msg.latency_ms / 1000).toFixed(2)}s` : ""}`
          : "Local AI";

        const refsStrip =
          refs.length > 0
            ? `<div class="ai-refs-strip">
                 <span class="ai-refs-label">Verified Evidence:</span>
                 ${refs
                   .map((r) => {
                     const seqAttr =
                       r.target_sequence !== null && r.target_sequence !== undefined
                         ? `data-ev-seq="${escapeHtml(r.target_sequence)}"`
                         : "";
                     const flowAttr = r.target_flow_id
                       ? `data-ev-flow="${escapeHtml(r.target_flow_id)}"`
                       : "";
                     return `<button type="button" class="ai-ev-link ai-ev-${escapeHtml(r.kind)}" data-ev-kind="${escapeHtml(r.kind)}" ${seqAttr} ${flowAttr}>${escapeHtml(r.label || r.tag)}</button>`;
                   })
                   .join("")}
               </div>`
            : "";

        const warningsBox =
          warnings.length > 0
            ? `<div class="ai-warnings-box">
                 <strong>Grounding Guardrail Notice:</strong>
                 <ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
               </div>`
            : "";

        return `
          <div class="ai-msg ai-msg-assistant">
            <div class="ai-msg-meta">
              <span>NetBox AI (${modelInfo})</span>
              <span class="ai-msg-badges">${scopeBadge}${learnBadge}</span>
            </div>
            <div class="ai-msg-body">${formatAnswerWithVerifiedLinks(msg.content, refs)}</div>
            ${refsStrip}
            ${warningsBox}
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".ai-ev-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-ev-kind");
        const seqRaw = btn.getAttribute("data-ev-seq");
        const flowId = btn.getAttribute("data-ev-flow");
        const seq = seqRaw !== null && seqRaw !== "" ? Number(seqRaw) : null;
        if (typeof onNavigateRef === "function") {
          onNavigateRef({ kind, targetSequence: Number.isFinite(seq) ? seq : null, targetFlowId: flowId || null });
        }
      });
    });

    container.scrollTop = container.scrollHeight;
  }

  return {
    escapeHtml,
    formatAnswerWithVerifiedLinks,
    getSuggestedChips,
    renderStatusBar,
    renderConversation,
  };
});
