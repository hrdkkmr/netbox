/**
 * NetBox Phase 8.6 — Interactive Guided Tour & Presentation / Demo Mode (UMD)
 * Provides a 10-step contextual walkthrough highlighting real NetBox UI panels,
 * a genuine Phase 2+4 TCP first-experiment step, persistent completion/resume state,
 * and an uncluttered Presentation / Demo Mode for classroom & evaluation demos.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.GuidedTour = factory();
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

  const TOUR_STEPS = [
    {
      id: "welcome",
      title: "1. Welcome to NetBox",
      tab: "socket",
      selector: ".vis-header",
      summary:
        "NetBox is a hands-on Computer Networks learning platform. You run real networking experiments, observe genuine socket calls and captured packets, and use an evidence-grounded local AI tutor to understand what actually happened.",
      tip: "Core principle: NetBox never fabricates packet captures—live runs show actual OS and wire telemetry.",
    },
    {
      id: "backend-connection",
      title: "2. Backend Connection (Local & LAN)",
      tab: "system",
      selector: "#conn-status-pill",
      summary:
        "This indicator and the System & LAN tab show honest component health: FastAPI Backend, LD_PRELOAD Socket Instrumentation, libpcap Packet Capture, Ollama Local Runtime, and Configured AI Model. You can run locally or connect to a NetBox host over LAN/hotspot with a pairing token.",
      tip: "If the backend is offline, start it on the host with './scripts/start_netbox.sh' or configure your host URL in VS Code.",
    },
    {
      id: "workspace",
      title: "3. NetBox Workspace & Navigation",
      tab: "socket",
      selector: ".vis-nav-tabs",
      summary:
        "Switch seamlessly across 7 integrated views: Socket API, Captured Packets, TCP Flows, Dual-Layer Correlations, Grounded AI Assistant, 9 Curriculum Labs, and System & LAN Health.",
      tip: "Use the top playback controls (Prev / Play / Next / 0.5x–4x) to step chronologically through any captured run.",
    },
    {
      id: "curriculum-labs",
      title: "4. Nine Structured Networking Labs",
      tab: "labs",
      selector: "#tab-pane-labs",
      summary:
        "NetBox includes 9 hands-on Computer Networks modules covering Foundations, Ethernet/ARP, IP & Subnetting (with a deterministic bitwise Subnet Calculator), TCP, UDP, DNS, HTTP, Routing, and Network Monitoring.",
      tip: "Every lab connects theory, real safe localhost experiments, observed telemetry, AI tutoring, and graded assessments.",
    },
    {
      id: "execution-visualization",
      title: "5. Execution & Socket Visualization",
      tab: "socket",
      selector: "#topology-container",
      summary:
        "When a C or Python program runs under LD_PRELOAD, NetBox tracks every POSIX syscall (socket, bind, listen, accept, connect, send, recv, close), maps separate listening vs. accepted socket FDs, and plots an API-level sequence diagram.",
      tip: "Click any timeline row to inspect raw schema fields and exact nanosecond timing deltas.",
    },
    {
      id: "packet-inspector",
      title: "6. Wire-Level Packet Inspector",
      tab: "packets",
      selector: "#handshake-container",
      summary:
        "When libpcap capture is available, the Packets tab displays real captured IPv4/TCP/UDP packets, the observed TCP 3-way handshake (SYN, SYN+ACK, ACK), flags, sequence/ack byte offsets, window sizes, and privacy-safe header inspection.",
      tip: "Click any packet row to inspect headers or jump straight to 'Explain Packet with Local AI'.",
    },
    {
      id: "ai-tutor",
      title: "7. Evidence-Grounded Local AI Tutor",
      tab: "ai",
      selector: "#tab-pane-ai",
      summary:
        "The AI Assistant runs 100% locally via host Ollama (zero cloud APIs). Every answer cites real observed evidence such as [PACKET: pkt_1] or [SOCKET: sock_5]. Only backend-verified citations become clickable navigation links.",
      tip: "Toggle Learning Mode for undergraduate-friendly explanations, progressive hints, and rubric-grounded self-review.",
    },
    {
      id: "learning-progress",
      title: "8. Assessments & Learning Progress",
      tab: "labs",
      selector: "#tab-pane-labs",
      summary:
        "Each module ends with technically meaningful multiple-choice, packet-interpretation, scenario, and short-answer questions. Your scores and completed modules persist locally across restarts without storing sensitive payloads.",
      tip: "Complete both the experiment and assessment (>=67%) to earn a module completion checkmark.",
    },
    {
      id: "first-experiment",
      title: "9. Run Your First Real TCP Experiment",
      tab: "socket",
      selector: "#btn-run-live",
      summary:
        "Let's run a real POSIX C TCP Echo client-server experiment right now! NetBox will capture actual LD_PRELOAD socket calls and real loopback packets—then you can inspect the handshake or ask the local AI to explain what occurred.",
      tip: "If packet capture or Ollama is unavailable on this machine, NetBox honestly reports the missing component while keeping socket observation working.",
      isExperimentStep: true,
    },
    {
      id: "completion",
      title: "10. Tour Complete — Ready to Explore!",
      tab: "labs",
      selector: null,
      summary:
        "You have completed the NetBox Guided Tour! You can now inspect your live TCP run, start Module 1 (Networking Foundations), or launch Presentation / Demo Mode for live demonstrations.",
      tip: "Restart this tour anytime via the 'Guide' button or Command Palette: 'NetBox: Start Guided Tour'.",
      isCompletionStep: true,
    },
  ];

  const DEMO_STAGES = [
    {
      id: "demo-host",
      title: "1. Offline Host & LAN Status",
      tab: "system",
      caption: "Show independent component health (FastAPI, LD_PRELOAD, libpcap, host-local Ollama) and LAN pairing QR.",
    },
    {
      id: "demo-run",
      title: "2. Live TCP Client–Server Execution",
      tab: "socket",
      caption: "Trigger a real C POSIX TCP echo run and step through socket → bind → listen → connect → accept → send → recv → close.",
      action: "run-tcp",
      actionLabel: "▶ Execute Real TCP Run",
    },
    {
      id: "demo-packets",
      title: "3. Real Captured Wire Packets & Handshake",
      tab: "packets",
      caption: "Inspect actual libpcap loopback packets: SYN → SYN+ACK → ACK handshake, PSH+ACK data, and FIN teardown.",
    },
    {
      id: "demo-flows",
      title: "4. TCP Flow & Socket↔Packet Correlation",
      tab: "correlations",
      caption: "Show how user-space socket calls map conservatively onto wire-level TCP segments without fabricating causality.",
    },
    {
      id: "demo-ai",
      title: "5. Grounded Local AI Explanation",
      tab: "ai",
      caption: "Ask host-local Ollama to explain the captured run and click a verified [PACKET: pkt_N] badge to jump straight to that packet.",
      action: "explain-ai",
      actionLabel: "✨ Ask Local AI to Explain Run",
    },
    {
      id: "demo-labs",
      title: "6. Interactive Curriculum Lab & Assessment",
      tab: "labs",
      caption: "Open the 9 structured CN modules, run the deterministic Subnet Calculator or UDP/DNS/HTTP lab, and submit an assessment.",
    },
  ];

  function renderTourCard(stepIndex, extraState) {
    const idx = Math.max(0, Math.min(TOUR_STEPS.length - 1, Number(stepIndex) || 0));
    const step = TOUR_STEPS[idx];
    const total = TOUR_STEPS.length;
    const pct = Math.round(((idx + 1) / total) * 100);
    const experimentStatus = (extraState && extraState.experimentStatus) || null;
    const isBusy = Boolean(extraState && extraState.isBusy);

    const experimentBlock = step.isExperimentStep
      ? `<div class="tour-exp-box">
          <div class="tour-exp-actions">
            <button type="button" class="ctrl-btn live-btn" data-tour-action="run-first-exp" ${isBusy ? "disabled" : ""}>
              ${isBusy ? "Running Real TCP Experiment..." : "&#9658; Run Real TCP Experiment"}
            </button>
            <button type="button" class="ctrl-btn" data-tour-action="inspect-packets">View Captured Packets</button>
            <button type="button" class="ctrl-btn" data-tour-action="ask-ai-exp">Ask Local AI to Explain</button>
          </div>
          ${experimentStatus ? `<div class="tour-exp-status">${escapeHtml(experimentStatus)}</div>` : ""}
        </div>`
      : "";

    const completionBlock = step.isCompletionStep
      ? `<div class="tour-exp-actions">
          <button type="button" class="ctrl-btn primary" data-tour-action="open-mod1">Start Module 1 Lab</button>
          <button type="button" class="ctrl-btn" data-tour-action="enter-demo">Open Presentation Mode</button>
        </div>`
      : "";

    return `
      <div class="tour-card" role="dialog" aria-label="NetBox Interactive Guided Tour">
        <div class="tour-card-header">
          <span class="tour-step-badge">Guided Tour &middot; Step ${idx + 1} of ${total}</span>
          <button type="button" class="tour-close-btn" data-tour-action="skip" title="Skip / close tour">&times;</button>
        </div>
        <div class="tour-progress-track"><div class="tour-progress-fill" style="width:${pct}%"></div></div>
        <h4 class="tour-title">${escapeHtml(step.title)}</h4>
        <p class="tour-summary">${escapeHtml(step.summary)}</p>
        <div class="tour-tip">${escapeHtml(step.tip)}</div>
        ${experimentBlock}
        ${completionBlock}
        <div class="tour-footer">
          <button type="button" class="ctrl-btn" data-tour-action="skip">Skip Tour</button>
          <div class="tour-nav-btns">
            <button type="button" class="ctrl-btn" data-tour-action="prev" ${idx === 0 ? "disabled" : ""}>&#9664; Back</button>
            ${
              idx < total - 1
                ? `<button type="button" class="ctrl-btn primary" data-tour-action="next">Next &#9654;</button>`
                : `<button type="button" class="ctrl-btn primary" data-tour-action="finish">Finish Tour &#10003;</button>`
            }
          </div>
        </div>
      </div>
    `;
  }

  function renderPresentationBar(stageIndex) {
    const idx = Math.max(0, Math.min(DEMO_STAGES.length - 1, Number(stageIndex) || 0));
    const stage = DEMO_STAGES[idx];
    return `
      <div class="demo-presenter-bar" role="region" aria-label="NetBox Presentation Mode">
        <div class="demo-presenter-left">
          <span class="demo-pill">PRESENTATION MODE</span>
          <strong>${escapeHtml(stage.title)}</strong>
          <span class="demo-caption">${escapeHtml(stage.caption)}</span>
        </div>
        <div class="demo-presenter-right">
          ${
            stage.action
              ? `<button type="button" class="ctrl-btn live-btn" data-demo-action="${escapeHtml(stage.action)}">${escapeHtml(stage.actionLabel)}</button>`
              : ""
          }
          <button type="button" class="ctrl-btn" data-demo-action="prev" ${idx === 0 ? "disabled" : ""}>&#9664; Prev</button>
          <span class="demo-counter">${idx + 1} / ${DEMO_STAGES.length}</span>
          <button type="button" class="ctrl-btn primary" data-demo-action="next" ${idx === DEMO_STAGES.length - 1 ? "disabled" : ""}>Next &#9654;</button>
          <button type="button" class="ctrl-btn" data-demo-action="exit">Exit Demo Mode</button>
        </div>
      </div>
    `;
  }

  return {
    TOUR_STEPS,
    DEMO_STAGES,
    escapeHtml,
    renderTourCard,
    renderPresentationBar,
  };
});
