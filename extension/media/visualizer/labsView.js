/**
 * NetBox Phase 7 — Interactive Curriculum Labs Module (UMD)
 * Connects 9 structured Computer Networks modules with live safe experiments,
 * deterministic IPv4 Subnet Calculator, live observations, grounded local AI tutoring,
 * deterministic assessments, and locally persisted progress.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.LabsView = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function difficultyBadge(diff) {
    const d = String(diff || "beginner").toLowerCase();
    if (d === "advanced") return '<span class="sys-badge sys-badge-degraded">Advanced</span>';
    if (d === "intermediate") return '<span class="sys-badge sys-badge-neutral">Intermediate</span>';
    return '<span class="sys-badge sys-badge-running">Beginner</span>';
  }

  function renderSubnetResult(res) {
    if (!res) return "";
    if (res.error) {
      return `<div class="sys-alert-banner sys-alert-danger">${escapeHtml(res.error)}</div>`;
    }
    return `
      <div class="lab-subnet-result">
        <div class="lab-metrics-grid">
          <div class="lab-metric"><span>Network ID</span><code>${escapeHtml(res.network_address)}/${res.prefix_length}</code></div>
          <div class="lab-metric"><span>Subnet Mask</span><code>${escapeHtml(res.subnet_mask)}</code></div>
          <div class="lab-metric"><span>Wildcard</span><code>${escapeHtml(res.wildcard_mask)}</code></div>
          <div class="lab-metric"><span>Broadcast</span><code>${escapeHtml(res.broadcast_address)}</code></div>
          <div class="lab-metric"><span>Usable Range</span><code>${escapeHtml(res.first_usable_host)} &ndash; ${escapeHtml(res.last_usable_host)}</code></div>
          <div class="lab-metric"><span>Usable Hosts</span><code>${res.usable_host_count} (total ${res.total_addresses})</code></div>
          <div class="lab-metric"><span>Scope</span><code>${escapeHtml(res.address_scope)}</code></div>
        </div>
        <div class="lab-binary-box">
          <div><span>Network Binary:</span> <code>${escapeHtml(res.network_binary)}</code></div>
          <div><span>Mask Binary:</span> <code>${escapeHtml(res.mask_binary)}</code></div>
        </div>
        ${
          res.compare_ip
            ? `<div class="sys-alert-banner ${res.same_subnet ? "lab-alert-ok" : "sys-alert-warn"}">
                <strong>${res.same_subnet ? "Same Subnet (Direct L2 Delivery)" : "Different Subnet (Requires Default Gateway)"}:</strong>
                ${escapeHtml(res.compare_explanation || "")}
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderLabWorkspace(state) {
    const labsList = (state && state.labs) || [];
    const progress = (state && state.progress) || {
      total_labs: labsList.length,
      attempted_count: 0,
      completed_count: 0,
      completion_pct: 0,
    };
    const activeLab = (state && state.activeLab) || null;
    const activeSection = (state && state.activeSection) || "learn";
    const selectedScenarioId =
      (state && state.selectedScenarioId) ||
      (activeLab && activeLab.experiment && activeLab.experiment.experiment_id) ||
      "";
    const runResult = (state && state.runResult) || null;
    const isRunning = Boolean(state && state.isRunning);
    const subnetResult = (state && state.subnetResult) || null;
    const assessmentResult = (state && state.assessmentResult) || null;
    const aiResponse = (state && state.aiResponse) || null;
    const aiBusy = Boolean(state && state.aiBusy);
    const errorMsg = (state && state.errorMsg) || null;
    const aiModule = (state && state.aiHelper) || null;

    const sidebarHtml = labsList
      .map((item) => {
        const isSelected = activeLab && activeLab.lab_id === item.lab_id;
        const statusIcon = item.completed ? "&#10003;" : item.attempted ? "&#9679;" : "&#9675;";
        const statusCls = item.completed ? "lab-status-done" : item.attempted ? "lab-status-prog" : "lab-status-new";
        return `
          <button type="button" class="lab-nav-item ${isSelected ? "active" : ""}" data-lab-select="${escapeHtml(item.lab_id)}">
            <span class="lab-nav-icon ${statusCls}" title="${item.completed ? "Completed" : item.attempted ? "Attempted" : "Not started"}">${statusIcon}</span>
            <span class="lab-nav-text">
              <strong>M${item.module_number}: ${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.difficulty)} &middot; ${item.best_score_pct != null ? `Best ${item.best_score_pct}%` : `${item.scenario_count} exp`}</small>
            </span>
          </button>`;
      })
      .join("");

    if (!activeLab) {
      return `
        <div class="labs-shell">
          <aside class="labs-sidebar">
            <div class="labs-progress-card">
              <div class="labs-progress-head">
                <strong>Curriculum Progress</strong>
                <span>${progress.completed_count}/${progress.total_labs} (${progress.completion_pct}%)</span>
              </div>
              <div class="labs-progress-bar"><div class="labs-progress-fill" style="width:${progress.completion_pct}%"></div></div>
            </div>
            <div class="labs-nav-list">${sidebarHtml || '<div class="sys-muted">No labs loaded.</div>'}</div>
          </aside>
          <main class="labs-main">
            <div class="empty-state-box">Select any Computer Networks lab module on the left to begin.</div>
          </main>
        </div>`;
    }

    const exp = activeLab.experiment;
    const scenarios = exp.supported_scenarios || [];

    // Section A: Learn
    const learnHtml = `
      <div class="lab-section-body">
        <div class="sys-section">
          <div class="sys-section-title">Learning Objectives</div>
          <ul class="lab-list">${activeLab.learning_objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>
        </div>
        <div class="lab-concepts-grid">
          ${activeLab.concept_explanation
            .map(
              (c) => `
              <div class="sys-section">
                <div class="sys-section-title">${escapeHtml(c.title)}</div>
                <p class="lab-para">${escapeHtml(c.summary)}</p>
                <ul class="lab-list">${(c.key_points || []).map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>
                <div class="lab-layer-chips">${(c.protocol_layers || []).map((l) => `<span class="run-id-pill">${escapeHtml(l)}</span>`).join("")}</div>
              </div>`
            )
            .join("")}
        </div>
      </div>`;

    // Section B: Experiment
    const experimentHtml = `
      <div class="lab-section-body">
        <div class="sys-section">
          <div class="sys-section-title">${escapeHtml(exp.title)}</div>
          <p class="lab-para">${escapeHtml(exp.instructions)}</p>
          <div class="lab-run-controls">
            <label for="lab-scenario-select">Scenario:</label>
            <select id="lab-scenario-select" class="filter-select">
              ${scenarios
                .map(
                  (s) =>
                    `<option value="${escapeHtml(s.scenario_id)}" ${s.scenario_id === selectedScenarioId ? "selected" : ""}>${escapeHtml(s.label)} [${escapeHtml(s.protocol)}]</option>`
                )
                .join("")}
            </select>
            <button type="button" class="ctrl-btn live-btn" id="btn-lab-run" ${isRunning ? "disabled" : ""}>
              ${isRunning ? "Running Experiment..." : "&#9658; Run Safe Experiment"}
            </button>
          </div>
          <div class="lab-two-col">
            <div>
              <div class="sys-subhead">Execution Steps</div>
              <ol class="lab-list">${exp.execution_steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
            </div>
            <div>
              <div class="sys-subhead">Expected Observations</div>
              <ul class="lab-list">${exp.expected_observations.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>
            </div>
          </div>
          ${
            exp.observation_caveats && exp.observation_caveats.length
              ? `<div class="sys-alert-banner sys-alert-warn"><strong>Honest Observation Boundaries:</strong><ul class="lab-list">${exp.observation_caveats
                  .map((c) => `<li>${escapeHtml(c)}</li>`)
                  .join("")}</ul></div>`
              : ""
          }
        </div>

        ${
          exp.has_subnet_calculator
            ? `<div class="sys-section">
                <div class="sys-section-title">Deterministic IPv4 Subnet Calculator (Exact Bitwise Math)</div>
                <form id="lab-subnet-form" class="lab-subnet-form">
                  <input type="text" id="lab-subnet-cidr" placeholder="IPv4/CIDR e.g. 192.168.10.70/26" value="192.168.10.70/26" />
                  <input type="text" id="lab-subnet-compare" placeholder="Optional compare IP e.g. 192.168.10.100" value="192.168.10.100" />
                  <button type="submit" class="ctrl-btn primary">Calculate Subnet</button>
                </form>
                ${renderSubnetResult(subnetResult)}
              </div>`
            : ""
        }
      </div>`;

    // Section C: Observe
    const observeHtml = !runResult
      ? `<div class="empty-state-box">No experiment executed yet for this lab. Go to <strong>B. Experiment</strong> and click <em>Run Safe Experiment</em> to capture real observations.</div>`
      : `<div class="lab-section-body">
          <div class="sys-section">
            <div class="sys-section-title">Actual Observed Output (${escapeHtml(runResult.scenario_id)} &middot; ${escapeHtml(runResult.protocol)})</div>
            <p class="lab-para"><strong>${escapeHtml(runResult.summary)}</strong></p>
            <div class="lab-metrics-grid">
              <div class="lab-metric"><span>Status</span><code>${escapeHtml(runResult.status)}</code></div>
              <div class="lab-metric"><span>Socket Events</span><code>${runResult.socket_event_count}</code></div>
              <div class="lab-metric"><span>Captured Packets</span><code>${runResult.packet_count}</code></div>
              <div class="lab-metric"><span>Capture State</span><code>${escapeHtml(runResult.packet_capture_status)}</code></div>
              ${Object.entries(runResult.measured_metrics || {})
                .slice(0, 8)
                .map(
                  ([k, v]) =>
                    `<div class="lab-metric"><span>${escapeHtml(k)}</span><code>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}</code></div>`
                )
                .join("")}
            </div>
            ${
              runResult.run_id
                ? `<div class="lab-jump-bar">
                    <span class="run-id-pill">Run: ${escapeHtml(runResult.run_id)}</span>
                    <button type="button" class="ctrl-btn" data-lab-jump="socket">Inspect Socket API</button>
                    <button type="button" class="ctrl-btn" data-lab-jump="packets">Inspect Packets</button>
                    <button type="button" class="ctrl-btn" data-lab-jump="flows">Inspect TCP Flows</button>
                  </div>`
                : ""
            }
            <ul class="lab-list">${(runResult.actual_observations || []).map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>
            ${
              runResult.warnings && runResult.warnings.length
                ? `<div class="sys-alert-banner sys-alert-warn">${runResult.warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("")}</div>`
                : ""
            }
            ${
              runResult.raw_observations && Object.keys(runResult.raw_observations).length
                ? `<details class="json-details"><summary>Raw Observed Telemetry JSON</summary><pre class="json-block"><code>${escapeHtml(JSON.stringify(runResult.raw_observations, null, 2))}</code></pre></details>`
                : ""
            }
          </div>
        </div>`;

    // Section D: Understand (Grounded Local AI Tutor)
    const renderedAiBody = aiResponse
      ? aiModule && typeof aiModule.formatAnswerWithVerifiedLinks === "function"
        ? aiModule.formatAnswerWithVerifiedLinks(aiResponse.answer || "", aiResponse.verified_references || [])
        : escapeHtml(aiResponse.answer || "")
      : "";

    const understandHtml = `
      <div class="lab-section-body">
        <div class="sys-section">
          <div class="sys-section-title">Grounded Local AI Curriculum Tutor (Host Ollama Only)</div>
          <p class="lab-para">Ask the local AI tutor about <strong>${escapeHtml(activeLab.title)}</strong>${
            runResult && runResult.run_id ? ` grounded in captured run <code>${escapeHtml(runResult.run_id)}</code>` : " (run an experiment first to ground explanations in live packets)"
          }.</p>
          <div class="lab-ai-actions">
            <button type="button" class="ctrl-btn primary" data-lab-ai-mode="explain" ${aiBusy ? "disabled" : ""}>Explain Observation</button>
            <button type="button" class="ctrl-btn" data-lab-ai-mode="hint" data-hint-level="1" ${aiBusy ? "disabled" : ""}>Hint (L1)</button>
            <button type="button" class="ctrl-btn" data-lab-ai-mode="hint" data-hint-level="2" ${aiBusy ? "disabled" : ""}>Hint (L2)</button>
            <button type="button" class="ctrl-btn" data-lab-ai-mode="quiz_me" ${aiBusy ? "disabled" : ""}>Quiz Me</button>
            <button type="button" class="ctrl-btn" data-lab-ai-mode="connect_theory" ${aiBusy ? "disabled" : ""}>Connect Theory &harr; Evidence</button>
          </div>
          <form id="lab-ai-review-form" class="lab-review-form">
            <textarea id="lab-ai-student-input" rows="2" placeholder="Write your own explanation of what happened in this lab (or ask a specific question) and click Review My Understanding..."></textarea>
            <div class="sys-form-actions">
              <button type="submit" class="ctrl-btn primary" ${aiBusy ? "disabled" : ""}>Review My Understanding</button>
              <button type="button" class="ctrl-btn" data-lab-ai-mode="explain-custom" ${aiBusy ? "disabled" : ""}>Ask Tutor</button>
            </div>
          </form>
          ${aiBusy ? `<div class="ai-loading-indicator"><span class="ai-spinner"></span><span>Host local LLM is generating grounded tutoring response...</span></div>` : ""}
          ${
            aiResponse
              ? `<div class="lab-ai-response-card">
                  <div class="ai-msg-meta">
                    <strong>Local AI Tutor (${escapeHtml(aiResponse.mode)})</strong>
                    <span>${escapeHtml(aiResponse.model)} &middot; ${Math.round(aiResponse.latency_ms || 0)} ms</span>
                  </div>
                  <div class="ai-msg-body">${renderedAiBody}</div>
                  ${
                    aiResponse.grounding_warnings && aiResponse.grounding_warnings.length
                      ? `<div class="ai-warning-box">${aiResponse.grounding_warnings.map((w) => `<div>&#9888; ${escapeHtml(w)}</div>`).join("")}</div>`
                      : ""
                  }
                </div>`
              : ""
          }
        </div>
      </div>`;

    // Section E: Assess
    const gradeMap = new Map();
    if (assessmentResult && Array.isArray(assessmentResult.results)) {
      assessmentResult.results.forEach((r) => gradeMap.set(r.question_id, r));
    }
    const assessHtml = `
      <div class="lab-section-body">
        <form id="lab-assessment-form" class="sys-section">
          <div class="sys-section-title">Lab Assessment (Pass Threshold: ${activeLab.completion_criteria.min_assessment_score_pct}%)</div>
          ${
            assessmentResult
              ? `<div class="sys-alert-banner ${assessmentResult.passed ? "lab-alert-ok" : "sys-alert-warn"}">
                  <strong>Score: ${assessmentResult.score_pct}% (${assessmentResult.correct_count}/${assessmentResult.total_questions}) &mdash; ${
                    assessmentResult.passed ? "PASSED" : "TRY AGAIN"
                  }</strong>
                </div>`
              : ""
          }
          ${activeLab.questions
            .map((q, idx) => {
              const g = gradeMap.get(q.question_id);
              const inputBlock =
                q.options && q.options.length
                  ? `<div class="lab-mcq-options">
                      ${q.options
                        .map(
                          (opt, oIdx) => `
                          <label class="lab-mcq-option">
                            <input type="radio" name="q_${escapeHtml(q.question_id)}" value="${oIdx}" />
                            <span>${escapeHtml(opt)}</span>
                          </label>`
                        )
                        .join("")}
                    </div>`
                  : `<textarea class="lab-short-answer" name="q_${escapeHtml(q.question_id)}" rows="3" placeholder="Write a concise technical explanation..."></textarea>`;

              return `
                <div class="lab-question-card">
                  <div class="lab-question-head">
                    <strong>Q${idx + 1}. ${escapeHtml(q.prompt)}</strong>
                    <span class="run-id-pill">${escapeHtml(q.type.replace("_", " "))}</span>
                  </div>
                  ${inputBlock}
                  ${
                    g
                      ? `<div class="lab-grade-note ${g.correct ? "lab-grade-ok" : "lab-grade-err"}">
                          <div><strong>${escapeHtml(g.feedback)}</strong></div>
                          <div>${escapeHtml(g.explanation)}</div>
                        </div>`
                      : ""
                  }
                </div>`;
            })
            .join("")}
          <div class="sys-form-actions">
            <button type="submit" class="ctrl-btn primary">Submit Assessment</button>
          </div>
        </form>
      </div>`;

    const sections = [
      { id: "learn", label: "A. Learn" },
      { id: "experiment", label: "B. Experiment" },
      { id: "observe", label: "C. Observe" },
      { id: "understand", label: "D. Understand (AI)" },
      { id: "assess", label: "E. Assess" },
    ];

    const bodyBySection = {
      learn: learnHtml,
      experiment: experimentHtml,
      observe: observeHtml,
      understand: understandHtml,
      assess: assessHtml,
    };

    return `
      <div class="labs-shell">
        <aside class="labs-sidebar">
          <div class="labs-progress-card">
            <div class="labs-progress-head">
              <strong>Curriculum Progress</strong>
              <span>${progress.completed_count}/${progress.total_labs} (${progress.completion_pct}%)</span>
            </div>
            <div class="labs-progress-bar"><div class="labs-progress-fill" style="width:${progress.completion_pct}%"></div></div>
          </div>
          <div class="labs-nav-list">${sidebarHtml}</div>
        </aside>
        <main class="labs-main">
          <div class="lab-header">
            <div>
              <div class="lab-module-kicker">${escapeHtml(activeLab.module_title)}</div>
              <h3>${escapeHtml(activeLab.title)}</h3>
            </div>
            <div class="lab-header-badges">
              ${difficultyBadge(activeLab.difficulty)}
              <span class="run-id-pill">~${activeLab.estimated_minutes} min</span>
            </div>
          </div>
          ${errorMsg ? `<div class="sys-alert-banner sys-alert-danger">${escapeHtml(errorMsg)}</div>` : ""}
          <div class="lab-subtabs" role="tablist">
            ${sections
              .map(
                (s) =>
                  `<button type="button" class="lab-subtab-btn ${activeSection === s.id ? "active" : ""}" data-lab-section="${s.id}">${s.label}</button>`
              )
              .join("")}
          </div>
          ${bodyBySection[activeSection] || learnHtml}
        </main>
      </div>
    `;
  }

  return {
    escapeHtml,
    renderSubnetResult,
    renderLabWorkspace,
  };
});
