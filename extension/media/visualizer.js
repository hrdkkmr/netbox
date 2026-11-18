/**
 * NetBox Phase 3 Visualizer — Main Controller
 * Coordinates EventStore, TimingEngine, SocketStateEngine, EventFilter,
 * SequenceMapper, EventInspector, PlaybackEngine, and Renderers.
 */
(function () {
  "use strict";

  const NB = window.NetBoxVisualizer || {};
  const {
    EventStore,
    TimingEngine,
    SocketStateEngine,
    EventFilter,
    SequenceMapper,
    EventInspector,
    PlaybackEngine,
    Renderers,
    PacketView,
    AIAssistant,
    SystemDashboard,
    LabsView,
    GuidedTour,
  } = NB;

  if (
    !EventStore ||
    !TimingEngine ||
    !SocketStateEngine ||
    !EventFilter ||
    !SequenceMapper ||
    !EventInspector ||
    !PlaybackEngine ||
    !Renderers
  ) {
    console.error("[NetBox Visualizer] Required visualizer modules failed to load.");
    return;
  }

  // Transport abstraction: VS Code Webview API when inside VS Code,
  // or direct local FastAPI backend fallback when running in standalone browser preview.
  function createTransport() {
    if (typeof acquireVsCodeApi === "function") {
      // @ts-ignore
      const vscode = acquireVsCodeApi();
      return {
        post(message) {
          vscode.postMessage(message);
        },
        listen(handler) {
          window.addEventListener("message", (event) => handler(event.data));
        },
      };
    }

    let baseUrl = (
      (typeof localStorage !== "undefined" && localStorage.getItem("netbox_backend_url")) ||
      window.NETBOX_BACKEND_URL ||
      (window.location && window.location.origin && window.location.origin.startsWith("http")
        ? window.location.origin
        : "http://127.0.0.1:8000")
    ).replace(/\/+$/, "");
    let accessToken =
      (typeof localStorage !== "undefined" && localStorage.getItem("netbox_access_token")) || "";
    const browserClientId =
      (typeof localStorage !== "undefined" && localStorage.getItem("netbox_client_id")) ||
      `web-${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem("netbox_client_id", browserClientId);
    } catch (_) {}

    let listener = () => {};

    async function fetchJson(path, options) {
      const opts = Object.assign({}, options || {});
      const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
      if (accessToken) {
        headers["X-NetBox-Token"] = accessToken;
      }
      opts.headers = headers;
      const res = await fetch(`${baseUrl}${path}`, opts);
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const body = await res.json();
          if (body && body.detail) detail = body.detail;
        } catch (_) {}
        const err = new Error(`HTTP ${res.status}: ${detail}`);
        // @ts-ignore
        err.statusCode = res.status;
        throw err;
      }
      return res.json();
    }

    async function loadSystemOverview() {
      const clientSettings = { backendUrl: baseUrl, accessToken };
      try {
        const [health, info] = await Promise.all([
          fetchJson("/api/system/health"),
          fetchJson("/api/system/info"),
        ]);
        let network = null;
        let connection = null;
        let authError = null;
        try {
          await fetchJson("/api/system/clients/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: browserClientId,
              label: `Browser (${navigator.platform || "Web"})`,
              client_type: "browser",
            }),
          }).catch(() => null);
          [network, connection] = await Promise.all([
            fetchJson("/api/system/network"),
            fetchJson("/api/system/connection"),
          ]);
        } catch (err) {
          authError = err && err.message ? err.message : "Authentication required.";
        }
        listener({
          type: "systemOverview",
          payload: {
            connected: true,
            health,
            info,
            network,
            connection,
            authError,
            clientSettings,
            isWebBrowser: true,
          },
        });
      } catch (err) {
        listener({
          type: "systemOverview",
          payload: {
            connected: false,
            health: null,
            info: null,
            network: null,
            connection: null,
            authError: err && err.message ? err.message : "Host unreachable",
            clientSettings,
            isWebBrowser: true,
          },
        });
      }
    }

    return {
      listen(handler) {
        listener = handler;
      },
      async post(message) {
        try {
          switch (message.type) {
            case "getDemoEvents": {
              const demo = await fetchJson("/api/demo/tcp");
              listener({
                type: "eventsLoaded",
                payload: {
                  runId: demo.demo_id,
                  runStatus: "simulated",
                  isSimulated: demo.is_simulated,
                  label: demo.simulation_label,
                  events: demo.events,
                },
              });
              break;
            }
            case "listRuns": {
              const runs = await fetchJson("/api/runs");
              listener({ type: "runsList", payload: runs });
              break;
            }
            case "executeLiveRun": {
              const exampleId = (message.payload && message.payload.exampleId) || "tcp-echo";
              const clientArgs = message.payload && message.payload.clientArgs;
              const runMeta = await fetchJson("/api/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ example_id: exampleId, client_args: clientArgs }),
              });
              const [eventsData, packetData, flowsData, correlationsData, runs] = await Promise.all([
                fetchJson(`/api/runs/${encodeURIComponent(runMeta.run_id)}/events`),
                fetchJson(`/api/runs/${encodeURIComponent(runMeta.run_id)}/packets`).catch(() => null),
                fetchJson(`/api/runs/${encodeURIComponent(runMeta.run_id)}/flows`).catch(() => null),
                fetchJson(`/api/runs/${encodeURIComponent(runMeta.run_id)}/correlations`).catch(() => null),
                fetchJson("/api/runs"),
              ]);
              listener({ type: "runsList", payload: runs });
              listener({
                type: "eventsLoaded",
                payload: {
                  runId: eventsData.run_id,
                  runStatus: runMeta.status,
                  runMeta,
                  isSimulated: eventsData.is_simulated,
                  label: eventsData.simulation_label,
                  events: eventsData.events,
                  packetData,
                  flowsData,
                  correlationsData,
                },
              });
              break;
            }
            case "getLiveEvents": {
              let runId = message.payload && message.payload.runId;
              const runs = await fetchJson("/api/runs");
              listener({ type: "runsList", payload: runs });
              if (!runId) {
                if (runs.length > 0) {
                  runId = runs[0].run_id;
                } else {
                  await this.post({ type: "executeLiveRun" });
                  return;
                }
              }
              const [runMeta, eventsData, packetData, flowsData, correlationsData] = await Promise.all([
                fetchJson(`/api/runs/${encodeURIComponent(runId)}`),
                fetchJson(`/api/runs/${encodeURIComponent(runId)}/events`),
                fetchJson(`/api/runs/${encodeURIComponent(runId)}/packets`).catch(() => null),
                fetchJson(`/api/runs/${encodeURIComponent(runId)}/flows`).catch(() => null),
                fetchJson(`/api/runs/${encodeURIComponent(runId)}/correlations`).catch(() => null),
              ]);
              listener({
                type: "eventsLoaded",
                payload: {
                  runId: eventsData.run_id,
                  runStatus: runMeta.status,
                  runMeta,
                  isSimulated: eventsData.is_simulated,
                  label: eventsData.simulation_label,
                  events: eventsData.events,
                  packetData,
                  flowsData,
                  correlationsData,
                },
              });
              break;
            }
            case "aiGetStatus": {
              const st = await fetchJson("/api/ai/status");
              listener({ type: "aiStatus", payload: st });
              break;
            }
            case "aiUpdateConfig": {
              const st = await fetchJson("/api/ai/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(message.payload || {}),
              });
              listener({ type: "aiStatus", payload: st });
              break;
            }
            case "aiExplainExecution": {
              const p = message.payload || {};
              const res = await fetchJson(`/api/ai/runs/${encodeURIComponent(p.runId)}/explain`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  learning_mode: Boolean(p.learningMode),
                  focus: p.focus || "execution",
                  flow_id: p.flowId || null,
                }),
              });
              listener({ type: "aiResponse", payload: res });
              break;
            }
            case "aiAskRun": {
              const p = message.payload || {};
              const res = await fetchJson(`/api/ai/runs/${encodeURIComponent(p.runId)}/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  question: p.question,
                  learning_mode: Boolean(p.learningMode),
                  flow_id: p.flowId || null,
                  packet_id: p.packetId || null,
                  include_history: true,
                }),
              });
              listener({ type: "aiResponse", payload: res });
              break;
            }
            case "aiExplainPacket": {
              const p = message.payload || {};
              const res = await fetchJson(
                `/api/ai/runs/${encodeURIComponent(p.runId)}/packets/${encodeURIComponent(String(p.packetId))}/explain`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    learning_mode: p.learningMode !== false,
                    question: p.question || null,
                  }),
                }
              );
              listener({ type: "aiResponse", payload: res });
              break;
            }
            case "aiAskGeneral": {
              const p = message.payload || {};
              const res = await fetchJson("/api/ai/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  question: p.question,
                  learning_mode: p.learningMode !== false,
                }),
              });
              listener({ type: "aiResponse", payload: res });
              break;
            }
            case "aiClearConversation": {
              const p = message.payload || {};
              await fetchJson(`/api/ai/runs/${encodeURIComponent(p.runId)}/conversation/clear`, {
                method: "POST",
              }).catch(() => {});
              listener({ type: "aiConversationCleared", payload: { runId: p.runId } });
              break;
            }
            case "systemGetOverview": {
              await loadSystemOverview();
              break;
            }
            case "systemRotateToken": {
              await fetchJson("/api/system/access-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rotate_token: true }),
              });
              await loadSystemOverview();
              break;
            }
            case "systemUpdateClientConfig": {
              const p = message.payload || {};
              if (typeof p.backendUrl === "string" && p.backendUrl.trim()) {
                baseUrl = p.backendUrl.trim().replace(/\/+$/, "");
                try {
                  localStorage.setItem("netbox_backend_url", baseUrl);
                } catch (_) {}
              }
              if (typeof p.accessToken === "string") {
                accessToken = p.accessToken.trim();
                try {
                  if (accessToken) localStorage.setItem("netbox_access_token", accessToken);
                  else localStorage.removeItem("netbox_access_token");
                } catch (_) {}
              }
              await loadSystemOverview();
              try {
                const runs = await fetchJson("/api/runs");
                listener({ type: "runsList", payload: runs });
                const aiSt = await fetchJson("/api/ai/status");
                listener({ type: "aiStatus", payload: aiSt });
              } catch (_) {}
              break;
            }
            case "curriculumListLabs": {
              const data = await fetchJson("/api/curriculum/labs");
              listener({ type: "curriculumLabsLoaded", payload: data });
              break;
            }
            case "curriculumGetLab": {
              const p = message.payload || {};
              const lab = await fetchJson(`/api/curriculum/labs/${encodeURIComponent(p.labId)}`);
              listener({ type: "curriculumLabDetail", payload: lab });
              break;
            }
            case "curriculumRunLab": {
              const p = message.payload || {};
              const res = await fetchJson(`/api/curriculum/labs/${encodeURIComponent(p.labId)}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scenario_id: p.scenarioId || null, params: p.params || {} }),
              });
              listener({ type: "curriculumRunResult", payload: res });
              if (res && res.run_id) {
                await this.post({ type: "getLiveEvents", payload: { runId: res.run_id } });
              }
              break;
            }
            case "curriculumSubmitAssessment": {
              const p = message.payload || {};
              const res = await fetchJson(`/api/curriculum/labs/${encodeURIComponent(p.labId)}/assess`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ answers: p.answers || {} }),
              });
              listener({ type: "curriculumAssessmentResult", payload: res });
              break;
            }
            case "curriculumSubnetCalc": {
              const p = message.payload || {};
              const res = await fetchJson("/api/curriculum/tools/subnet", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cidr: p.cidr, compare_ip: p.compareIp || null }),
              });
              listener({ type: "curriculumSubnetResult", payload: res });
              break;
            }
            case "curriculumAIInteract": {
              const res = await fetchJson("/api/ai/curriculum/interact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(message.payload || {}),
              });
              listener({ type: "curriculumAIResponse", payload: res });
              break;
            }
          }
        } catch (err) {
          const errMsg = err && err.message ? err.message : String(err);
          if (message && String(message.type || "").startsWith("ai")) {
            listener({ type: "aiError", payload: { message: errMsg } });
          } else if (message && String(message.type || "").startsWith("curriculum")) {
            listener({ type: "curriculumError", payload: { message: errMsg } });
          } else {
            listener({ type: "errorMessage", payload: { message: errMsg } });
          }
        }
      },
    };
  }

  const transport = createTransport();
  const store = EventStore.createStore();

  // Application View State
  let timingAnalysis = TimingEngine.analyzeTimeline([]);
  let sequenceModel = SequenceMapper.buildSequenceDiagram([], timingAnalysis);
  let activeFilters = { ...EventFilter.DEFAULT_FILTERS };
  let compareIndex = -1;
  let availableRuns = [];
  let isBusy = false;

  // Phase 4 Packet & Correlation State
  let packetData = null;
  let flowsData = null;
  let correlationsData = null;
  let selectedPacketSeq = null;
  let unifiedItems = [];
  let replayLayerMode = "both";
  let activeTab = "socket";

  // Phase 5 AI Assistant State (strictly isolated per run_id)
  let aiStatus = null;
  let aiLoading = false;
  const aiConversationsByRun = new Map(); // runKey ("__general__" or run_id) -> Message[]

  // DOM References
  const el = {
    dataModeBadge: document.getElementById("data-mode-badge"),
    runIdBadge: document.getElementById("run-id-badge"),
    runStatusBadge: document.getElementById("run-status-badge"),
    runSelect: document.getElementById("run-select"),
    errorBanner: document.getElementById("vis-error-banner"),
    errorBannerText: document.getElementById("vis-error-text"),
    errorBannerClose: document.getElementById("vis-error-close"),

    btnRunLive: document.getElementById("btn-run-live"),
    btnLoadDemo: document.getElementById("btn-load-demo"),
    btnRefresh: document.getElementById("btn-refresh"),
    btnReset: document.getElementById("btn-restart"),
    btnPrev: document.getElementById("btn-prev"),
    btnPlayPause: document.getElementById("btn-play-pause"),
    btnNext: document.getElementById("btn-next"),
    speedSelect: document.getElementById("speed-select"),

    metricsBar: document.getElementById("metrics-summary-bar"),
    lifecycleState: document.getElementById("lifecycle-state"),
    topologyContainer: document.getElementById("topology-container"),

    filterProcess: document.getElementById("filter-process"),
    filterType: document.getElementById("filter-type"),
    filterFd: document.getElementById("filter-fd"),
    filterErrors: document.getElementById("filter-errors"),
    filterSearch: document.getElementById("filter-search"),
    btnClearFilters: document.getElementById("btn-clear-filters"),
    timelineCounter: document.getElementById("timeline-counter"),
    filterSummary: document.getElementById("filter-summary"),
    eventsTbody: document.getElementById("events-tbody"),

    sequenceContainer: document.getElementById("sequence-container"),
    splitContainer: document.getElementById("lower-split-container"),
    viewModeBtns: document.querySelectorAll(".view-mode-btn"),

    inspector: {
      seqBadge: document.getElementById("inspector-seq"),
      explanationBox: document.getElementById("insp-explanation"),
      observedGrid: document.getElementById("insp-observed-grid"),
      derivedGrid: document.getElementById("insp-derived-grid"),
      rawJson: document.getElementById("insp-json-raw"),
      corrPktsBox: document.getElementById("insp-correlated-packets"),
      corrPktsBody: document.getElementById("insp-correlated-packets-body"),
    },

    // Phase 4 DOM refs
    navTabBtns: document.querySelectorAll(".nav-tab-btn"),
    tabPanes: {
      socket: document.getElementById("tab-pane-socket"),
      packets: document.getElementById("tab-pane-packets"),
      flows: document.getElementById("tab-pane-flows"),
      correlations: document.getElementById("tab-pane-correlations"),
      ai: document.getElementById("tab-pane-ai"),
      labs: document.getElementById("tab-pane-labs"),
      system: document.getElementById("tab-pane-system"),
    },
    connStatusPill: document.getElementById("conn-status-pill"),
    systemRoot: document.getElementById("system-dashboard-root"),
    labsRoot: document.getElementById("labs-root"),
    tourOverlayRoot: document.getElementById("tour-overlay-root"),
    demoBarRoot: document.getElementById("demo-bar-root"),
    btnStartTour: document.getElementById("btn-start-tour"),
    btnDemoMode: document.getElementById("btn-demo-mode"),
    ai: {
      statusPill: document.getElementById("ai-status-pill"),
      contextBadge: document.getElementById("ai-context-badge"),
      modelSelect: document.getElementById("ai-model-select"),
      flowSelect: document.getElementById("ai-flow-select"),
      learningMode: document.getElementById("ai-learning-mode"),
      btnRefreshStatus: document.getElementById("btn-ai-refresh-status"),
      btnClear: document.getElementById("btn-ai-clear"),
      offlineBanner: document.getElementById("ai-offline-banner"),
      chipsBar: document.getElementById("ai-chips-bar"),
      messagesContainer: document.getElementById("ai-messages-container"),
      loadingIndicator: document.getElementById("ai-loading-indicator"),
      loadingText: document.getElementById("ai-loading-text"),
      inputForm: document.getElementById("ai-input-form"),
      questionInput: document.getElementById("ai-question-input"),
      btnSend: document.getElementById("btn-ai-send"),
    },
    tabCountPackets: document.getElementById("tab-count-packets"),
    tabCountFlows: document.getElementById("tab-count-flows"),
    headerPcapChip: document.getElementById("header-pcap-chip"),
    pcapStatusBanner: document.getElementById("pcap-status-banner"),
    handshakeContainer: document.getElementById("handshake-container"),
    packetTimelineCounter: document.getElementById("packet-timeline-counter"),
    packetsTbody: document.getElementById("packets-tbody"),
    pktInspectorSeq: document.getElementById("pkt-inspector-seq"),
    pktInspectorContent: document.getElementById("packet-inspector-content"),
    flowsCounter: document.getElementById("flows-counter"),
    flowsContainer: document.getElementById("flows-container"),
    correlationsCounter: document.getElementById("correlations-counter"),
    correlationsTbody: document.getElementById("correlations-tbody"),
    replayLayerSelect: document.getElementById("replay-layer-select"),
    unifiedReplayTbody: document.getElementById("unified-replay-tbody"),
    btnDualPrev: document.getElementById("btn-dual-prev"),
    btnDualPlay: document.getElementById("btn-dual-play"),
    btnDualNext: document.getElementById("btn-dual-next"),
    btnDualReset: document.getElementById("btn-dual-reset"),
  };

  // Playback Engine (Socket API layer)
  const playback = PlaybackEngine.createPlaybackEngine({
    onStep: (index) => {
      renderCurrentStep(index);
    },
    onStateChange: (pState) => {
      updatePlaybackControls(pState);
    },
  });

  // Playback Engine (Dual-Layer / Packet replay)
  const dualPlayback = PlaybackEngine.createPlaybackEngine({
    onStep: (index) => {
      renderUnifiedStep(index);
    },
    onStateChange: (pState) => {
      if (el.btnDualPlay) {
        el.btnDualPlay.innerHTML = pState.isPlaying ? "&#10074;&#10074; Pause" : "&#9658; Replay";
        el.btnDualPlay.classList.toggle("playing", pState.isPlaying);
      }
    },
  });

  // Clean up timers on unload to avoid memory leaks
  window.addEventListener("beforeunload", () => {
    playback.destroy();
    dualPlayback.destroy();
  });

  function showError(msg) {
    if (el.errorBanner && el.errorBannerText) {
      el.errorBannerText.textContent = msg;
      el.errorBanner.classList.remove("hidden");
    }
  }

  function hideError() {
    if (el.errorBanner) {
      el.errorBanner.classList.add("hidden");
    }
  }

  function setBusy(busy, message) {
    isBusy = busy;
    if (el.btnRunLive) el.btnRunLive.disabled = busy;
    if (el.btnRefresh) el.btnRefresh.disabled = busy;
    if (busy && el.runStatusBadge && message) {
      el.runStatusBadge.textContent = message;
      el.runStatusBadge.className = "status-pill status-running";
    }
  }

  function updatePlaybackControls(pState) {
    if (el.btnPlayPause) {
      el.btnPlayPause.innerHTML = pState.isPlaying ? "&#10074;&#10074; Pause" : "&#9658; Play";
      el.btnPlayPause.classList.toggle("playing", pState.isPlaying);
    }
    if (el.timelineCounter) {
      const displayIdx = pState.currentIndex >= 0 ? pState.currentIndex + 1 : 0;
      el.timelineCounter.textContent = `Event ${displayIdx} of ${pState.totalEvents}`;
    }
  }

  function updateHeaderBadges() {
    const state = store.getState();
    const cls = state.sourceClassification;

    if (el.dataModeBadge) {
      el.dataModeBadge.textContent = cls.label;
      el.dataModeBadge.className = `badge ${cls.badgeClass}`;
      el.dataModeBadge.title = cls.description || "";
    }

    if (el.runIdBadge) {
      el.runIdBadge.textContent = `Run: ${state.runId || "None"}`;
    }

    if (el.runStatusBadge) {
      const st = String(state.runStatus || "idle").toUpperCase();
      el.runStatusBadge.textContent = st;
      let statusCls = "status-pill ";
      if (st === "COMPLETED") statusCls += "status-completed";
      else if (st === "FAILED" || st === "ERROR") statusCls += "status-failed";
      else if (st === "RUNNING") statusCls += "status-running";
      else if (st === "SIMULATED") statusCls += "status-simulated";
      else statusCls += "status-neutral";
      el.runStatusBadge.className = statusCls;
    }
  }

  function populateFilterDropdowns(events) {
    const opts = EventFilter.extractFilterOptions(events);

    if (el.filterProcess) {
      const prev = activeFilters.process;
      el.filterProcess.innerHTML = `<option value="all">All Processes</option>`;
      opts.processes.forEach((p) => {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = p;
        el.filterProcess.appendChild(o);
      });
      el.filterProcess.value = opts.processes.includes(prev) ? prev : "all";
      activeFilters.process = el.filterProcess.value;
    }

    if (el.filterType) {
      const prev = activeFilters.eventType;
      el.filterType.innerHTML = `<option value="all">All Event Types</option>`;
      opts.eventTypes.forEach((t) => {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = t;
        el.filterType.appendChild(o);
      });
      el.filterType.value = opts.eventTypes.includes(prev) ? prev : "all";
      activeFilters.eventType = el.filterType.value;
    }

    if (el.filterFd) {
      const prev = activeFilters.socketFd;
      el.filterFd.innerHTML = `<option value="all">All FDs</option>`;
      opts.socketFds.forEach((fd) => {
        const o = document.createElement("option");
        o.value = fd;
        o.textContent = `fd=${fd}`;
        el.filterFd.appendChild(o);
      });
      el.filterFd.value = opts.socketFds.includes(prev) ? prev : "all";
      activeFilters.socketFd = el.filterFd.value;
    }
  }

  function populateRunSelector() {
    if (!el.runSelect) return;
    const state = store.getState();
    const currentRunId = state.runId;

    el.runSelect.innerHTML = "";
    const demoOpt = document.createElement("option");
    demoOpt.value = "__demo__";
    demoOpt.textContent = "Simulated Demo (tcp_echo_lifecycle)";
    el.runSelect.appendChild(demoOpt);

    availableRuns.forEach((run) => {
      const o = document.createElement("option");
      o.value = run.run_id;
      o.textContent = `${run.run_id} [${run.status}, ${run.event_count} ev]`;
      el.runSelect.appendChild(o);
    });

    if (state.sourceClassification.isSimulated) {
      el.runSelect.value = "__demo__";
    } else if (currentRunId && availableRuns.some((r) => r.run_id === currentRunId)) {
      el.runSelect.value = currentRunId;
    } else if (currentRunId) {
      const extraOpt = document.createElement("option");
      extraOpt.value = currentRunId;
      extraOpt.textContent = `${currentRunId} (current)`;
      el.runSelect.appendChild(extraOpt);
      el.runSelect.value = currentRunId;
    }
  }

  function renderCurrentStep(index) {
    const events = store.getEvents();
    const snapshot = SocketStateEngine.deriveStateAtIndex(events, index);

    // Overall lifecycle pill
    if (el.lifecycleState) {
      el.lifecycleState.textContent = snapshot.overallSummary.label;
      el.lifecycleState.className = `state-pill ${
        snapshot.overallSummary.hasActiveError
          ? "state-error"
          : snapshot.overallSummary.label.includes("CONNECTED")
            ? "state-established"
            : snapshot.overallSummary.label.includes("LISTENING")
              ? "state-listen"
              : "state-closed"
      }`;
    }

    // Topology
    Renderers.renderTopology(el.topologyContainer, snapshot);

    // Metrics summary + optional interval comparison
    const selectedInterval =
      compareIndex >= 0 && index >= 0 && compareIndex !== index
        ? TimingEngine.calculateSelectedInterval(events, compareIndex, index)
        : null;
    Renderers.renderMetricsSummary(el.metricsBar, timingAnalysis, selectedInterval);

    // Filtered Timeline (non-destructive)
    const filtered = EventFilter.filterEvents(events, activeFilters);
    if (el.filterSummary) {
      el.filterSummary.textContent =
        filtered.matchCount === filtered.totalCount
          ? `Showing all ${filtered.totalCount}`
          : `Showing ${filtered.matchCount} of ${filtered.totalCount}`;
    }
    Renderers.renderTimeline(
      el.eventsTbody,
      events,
      filtered.filteredIndices,
      timingAnalysis,
      index,
      compareIndex,
      (origIdx) => {
        playback.jumpTo(origIdx);
      },
      (origIdx) => {
        compareIndex = compareIndex === origIdx ? -1 : origIdx;
        renderCurrentStep(playback.getState().currentIndex);
      }
    );

    // Sequence Diagram
    Renderers.renderSequenceDiagram(el.sequenceContainer, sequenceModel, index, (origIdx) => {
      playback.jumpTo(origIdx);
    });

    // Event Inspector
    if (index >= 0 && index < events.length) {
      const ev = events[index];
      const tEntry = timingAnalysis.entries[index] || null;
      const activeKey =
        snapshot.topology.activeEvent && snapshot.topology.activeEvent.affectedSocketKey;
      const derivedSock = activeKey ? snapshot.socketsByKey[activeKey] : null;
      const inspModel = EventInspector.buildInspectorModel(ev, tEntry, derivedSock);
      Renderers.renderInspector(el.inspector, inspModel);
      renderCorrelatedPacketsForSocketEvent(ev.sequence);
    } else {
      Renderers.renderInspector(el.inspector, null);
      renderCorrelatedPacketsForSocketEvent(null);
    }
  }

  function switchTab(tabName) {
    activeTab = tabName;
    el.navTabBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });
    Object.keys(el.tabPanes).forEach((key) => {
      const pane = el.tabPanes[key];
      if (pane) pane.classList.toggle("hidden", key !== tabName);
    });
    if (tabName === "system") {
      transport.post({ type: "systemGetOverview" });
    } else if (tabName === "labs" && typeof window.__netboxOnLabsTabOpen === "function") {
      window.__netboxOnLabsTabOpen();
    }
  }

  function jumpToSocketEventBySequence(seq) {
    const events = store.getEvents();
    const idx = events.findIndex((e) => e && e.sequence === seq);
    if (idx >= 0) {
      switchTab("socket");
      playback.jumpTo(idx);
    }
  }

  function selectPacketBySequence(seq, openPacketsTab) {
    selectedPacketSeq = seq;
    if (openPacketsTab) {
      switchTab("packets");
    }
    renderPacketViews();
  }

  function renderCorrelatedPacketsForSocketEvent(socketSeq) {
    if (!el.inspector.corrPktsBox || !el.inspector.corrPktsBody) return;
    if (!socketSeq || !correlationsData || !Array.isArray(correlationsData.correlations)) {
      el.inspector.corrPktsBox.classList.add("hidden");
      return;
    }
    const matching = correlationsData.correlations.filter(
      (c) =>
        Array.isArray(c.related_socket_event_sequences) &&
        c.related_socket_event_sequences.includes(socketSeq)
    );
    if (matching.length === 0) {
      el.inspector.corrPktsBox.classList.add("hidden");
      return;
    }
    el.inspector.corrPktsBox.classList.remove("hidden");
    el.inspector.corrPktsBody.innerHTML = `<div class="corr-chips">${matching
      .map(
        (c) =>
          `<button type="button" class="corr-jump-btn" data-pkt-seq="${c.packet_sequence}">Packet #${c.packet_sequence} (${c.confidence})</button>`
      )
      .join("")}</div>`;
    el.inspector.corrPktsBody.querySelectorAll(".corr-jump-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pSeq = Number(btn.getAttribute("data-pkt-seq"));
        if (Number.isFinite(pSeq)) selectPacketBySequence(pSeq, true);
      });
    });
  }

  function renderPacketViews() {
    if (!PacketView) return;
    const packets = (packetData && Array.isArray(packetData.packets) && packetData.packets) || [];
    const flows = (flowsData && Array.isArray(flowsData.flows) && flowsData.flows) || [];
    const correlations =
      (correlationsData && Array.isArray(correlationsData.correlations) && correlationsData.correlations) || [];

    const pcapStatus = (packetData && packetData.packet_capture_status) || "NOT_REQUESTED";
    if (el.headerPcapChip) {
      const iface = packetData && packetData.interface ? ` (${packetData.interface})` : "";
      el.headerPcapChip.textContent = `Packet Capture: ${pcapStatus}${iface}`;
      el.headerPcapChip.className = `pcap-status-chip ${
        pcapStatus === "COMPLETED"
          ? "pcap-chip-ok"
          : pcapStatus === "UNAVAILABLE" || pcapStatus === "FAILED"
            ? "pcap-chip-warn"
            : "pcap-chip-neutral"
      }`;
    }

    if (el.tabCountPackets) el.tabCountPackets.textContent = String(packets.length);
    if (el.tabCountFlows) el.tabCountFlows.textContent = String(flows.length);
    if (el.packetTimelineCounter) el.packetTimelineCounter.textContent = `${packets.length} captured packet(s)`;
    if (el.flowsCounter) el.flowsCounter.textContent = `${flows.length} TCP flow(s)`;
    if (el.correlationsCounter) {
      const resolved = (correlationsData && correlationsData.resolved_count) || 0;
      const unresolved = (correlationsData && correlationsData.unresolved_count) || 0;
      el.correlationsCounter.textContent = `${resolved} resolved / ${unresolved} unresolved`;
    }

    PacketView.renderPacketStatusBanner(el.pcapStatusBanner, packetData);

    const baseMonoNs =
      packets.length > 0 && packets[0].timestamp
        ? packets[0].timestamp.capture_monotonic_ns
        : null;

    if (selectedPacketSeq === null && packets.length > 0) {
      selectedPacketSeq = packets[0].sequence;
    }

    PacketView.renderPacketTimeline(
      el.packetsTbody,
      packets,
      selectedPacketSeq,
      baseMonoNs,
      (seq) => selectPacketBySequence(seq, false)
    );

    PacketView.renderHandshakeDiagram(
      el.handshakeContainer,
      flows,
      selectedPacketSeq,
      (seq) => selectPacketBySequence(seq, false)
    );

    const selectedPkt = packets.find((p) => p.sequence === selectedPacketSeq) || null;
    const selectedCorr =
      correlations.find((c) => c.packet_sequence === selectedPacketSeq) || null;
    if (el.pktInspectorSeq) {
      el.pktInspectorSeq.textContent = selectedPkt ? `Pkt: #${selectedPkt.sequence}` : "Pkt: -";
    }
    PacketView.renderPacketInspector(
      el.pktInspectorContent,
      selectedPkt,
      baseMonoNs,
      selectedCorr,
      (sockSeq) => jumpToSocketEventBySequence(sockSeq),
      (pktSeq) => askAIForPacket(pktSeq)
    );

    PacketView.renderFlowsView(
      el.flowsContainer,
      flows,
      (pktSeq) => selectPacketBySequence(pktSeq, true),
      (sockSeq) => jumpToSocketEventBySequence(sockSeq)
    );

    PacketView.renderCorrelationsView(
      el.correlationsTbody,
      correlations,
      (pktSeq) => selectPacketBySequence(pktSeq, true),
      (sockSeq) => jumpToSocketEventBySequence(sockSeq)
    );
  }

  function rebuildUnifiedReplay() {
    if (!PacketView) return;
    const events = store.getEvents();
    const packets = (packetData && Array.isArray(packetData.packets) && packetData.packets) || [];
    unifiedItems = PacketView.buildUnifiedTimeline(events, packets, replayLayerMode);
    dualPlayback.setEvents(unifiedItems);
    renderUnifiedStep(unifiedItems.length > 0 ? 0 : -1);
  }

  function renderUnifiedStep(activeIdx) {
    if (!PacketView) return;
    PacketView.renderUnifiedReplayTable(
      el.unifiedReplayTbody,
      unifiedItems,
      activeIdx,
      (idx, item) => {
        dualPlayback.jumpTo(idx);
        if (item.source === "packet_capture") {
          selectedPacketSeq = item.sequence;
          renderPacketViews();
        }
      }
    );
  }

  function onEventsLoaded(payload) {
    setBusy(false);
    hideError();
    if (!payload || !Array.isArray(payload.events)) {
      showError("Invalid event payload received from backend.");
      return;
    }

    compareIndex = -1;
    selectedPacketSeq = null;
    packetData = payload.packetData || null;
    flowsData = payload.flowsData || null;
    correlationsData = payload.correlationsData || null;

    store.setRunData(payload);
    const events = store.getEvents();

    timingAnalysis = TimingEngine.analyzeTimeline(events);
    sequenceModel = SequenceMapper.buildSequenceDiagram(events, timingAnalysis);

    updateHeaderBadges();
    populateFilterDropdowns(events);
    populateRunSelector();
    renderPacketViews();
    rebuildUnifiedReplay();
    refreshAIContextUI();

    // Reset playback safely (clears old timers) and jump to first event if available
    playback.setEvents(events);
    if (events.length > 0) {
      playback.jumpTo(0);
    } else {
      renderCurrentStep(-1);
    }
  }

  // ==================== Phase 5 AI Assistant Controller ====================
  function getCurrentAIRunKey() {
    const st = store.getState();
    if (!st.sourceClassification.isSimulated && st.runId) {
      return st.runId;
    }
    return "__general__";
  }

  function hasLiveRunForAI() {
    return getCurrentAIRunKey() !== "__general__";
  }

  function getAIConversation(runKey) {
    if (!aiConversationsByRun.has(runKey)) {
      aiConversationsByRun.set(runKey, []);
    }
    return aiConversationsByRun.get(runKey);
  }

  function setAILoading(loading, label) {
    aiLoading = loading;
    if (el.ai.loadingIndicator) {
      el.ai.loadingIndicator.classList.toggle("hidden", !loading);
    }
    if (el.ai.loadingText && label) {
      el.ai.loadingText.textContent = label;
    }
    if (el.ai.btnSend) el.ai.btnSend.disabled = loading;
    if (el.ai.questionInput) el.ai.questionInput.disabled = loading;
  }

  function navigateToEvidenceReference(ref) {
    if (!ref || !ref.kind) return;
    if (ref.kind === "packet" && ref.targetSequence !== null) {
      selectPacketBySequence(ref.targetSequence, true);
    } else if (ref.kind === "socket" && ref.targetSequence !== null) {
      jumpToSocketEventBySequence(ref.targetSequence);
    } else if (ref.kind === "flow") {
      switchTab("flows");
    } else if (ref.kind === "analysis") {
      if (ref.targetSequence !== null) {
        selectPacketBySequence(ref.targetSequence, true);
      } else if (ref.targetFlowId) {
        switchTab("flows");
      }
    }
  }

  function refreshAIContextUI() {
    if (!AIAssistant) return;
    const runKey = getCurrentAIRunKey();
    const isLive = runKey !== "__general__";

    if (el.ai.contextBadge) {
      el.ai.contextBadge.textContent = isLive
        ? `Context: ${runKey}`
        : "Context: General CN (Run Live TCP to ground in real capture)";
    }

    // Populate Flow isolation dropdown strictly from current run's flows
    if (el.ai.flowSelect) {
      const flows = (flowsData && Array.isArray(flowsData.flows) && flowsData.flows) || [];
      el.ai.flowSelect.innerHTML = `<option value="">All Flows (${flows.length})</option>`;
      flows.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.flow_id;
        opt.textContent = f.flow_id;
        el.ai.flowSelect.appendChild(opt);
      });
    }

    // Render Suggested Question Chips
    if (el.ai.chipsBar) {
      const chips = AIAssistant.getSuggestedChips({
        hasLiveRun: isLive,
        selectedPacketSeq: isLive ? selectedPacketSeq : null,
      });
      el.ai.chipsBar.innerHTML = chips
        .map(
          (c) =>
            `<button type="button" class="ai-chip-btn" data-chip-id="${AIAssistant.escapeHtml(c.id)}">${AIAssistant.escapeHtml(c.label)}</button>`
        )
        .join("");

      el.ai.chipsBar.querySelectorAll(".ai-chip-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cid = btn.getAttribute("data-chip-id");
          const chip = chips.find((c) => c.id === cid);
          if (!chip || aiLoading) return;
          if (chip.action === "explain_execution") {
            triggerExplainExecution("execution");
          } else if (chip.action === "explain_timeline") {
            triggerExplainExecution("timeline");
          } else if (chip.action === "explain_packet" && chip.packetId) {
            askAIForPacket(chip.packetId);
          } else if (chip.action === "ask_run" && chip.question) {
            sendAIQuestion(chip.question);
          } else if (chip.action === "general" && chip.question) {
            sendAIQuestion(chip.question);
          }
        });
      });
    }

    AIAssistant.renderConversation(
      el.ai.messagesContainer,
      getAIConversation(runKey),
      (ref) => navigateToEvidenceReference(ref)
    );
  }

  function triggerExplainExecution(focus) {
    if (!hasLiveRunForAI() || aiLoading) return;
    const runId = getCurrentAIRunKey();
    const learningMode = Boolean(el.ai.learningMode && el.ai.learningMode.checked);
    const flowId = el.ai.flowSelect ? el.ai.flowSelect.value || null : null;
    const conv = getAIConversation(runId);
    const label =
      focus === "timeline"
        ? "Explain the chronological TCP connection timeline for this execution."
        : "Explain this observed network execution.";
    conv.push({ role: "user", content: label, mode: focus });
    refreshAIContextUI();
    setAILoading(true, "Local LLM is analyzing observed sockets, packets, and flows...");
    transport.post({
      type: "aiExplainExecution",
      payload: { runId, learningMode, focus, flowId },
    });
  }

  function askAIForPacket(packetId) {
    if (!hasLiveRunForAI() || aiLoading) return;
    const runId = getCurrentAIRunKey();
    const learningMode = Boolean(el.ai.learningMode && el.ai.learningMode.checked);
    switchTab("ai");
    const conv = getAIConversation(runId);
    conv.push({ role: "user", content: `Explain Packet #${packetId} in detail.`, mode: "explain_packet" });
    refreshAIContextUI();
    setAILoading(true, `Local LLM is explaining Packet #${packetId}...`);
    transport.post({
      type: "aiExplainPacket",
      payload: { runId, packetId, learningMode },
    });
  }

  function sendAIQuestion(question) {
    const trimmed = (question || "").trim();
    if (!trimmed || aiLoading) return;
    const runKey = getCurrentAIRunKey();
    const isLive = runKey !== "__general__";
    const learningMode = Boolean(el.ai.learningMode && el.ai.learningMode.checked);
    const flowId = el.ai.flowSelect ? el.ai.flowSelect.value || null : null;

    const conv = getAIConversation(runKey);
    conv.push({ role: "user", content: trimmed, mode: isLive ? "ask_run" : "general_ask" });
    refreshAIContextUI();
    setAILoading(true, "Local LLM is generating grounded response...");

    if (isLive) {
      transport.post({
        type: "aiAskRun",
        payload: { runId: runKey, question: trimmed, learningMode, flowId },
      });
    } else {
      transport.post({
        type: "aiAskGeneral",
        payload: { question: trimmed, learningMode },
      });
    }
  }

  // Wire Transport Listeners
  transport.listen((msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "eventsLoaded":
        onEventsLoaded(msg.payload);
        if (typeof updateTourAfterRunLoaded === "function") {
          updateTourAfterRunLoaded();
        }
        break;

      case "runsList":
        if (Array.isArray(msg.payload)) {
          availableRuns = msg.payload;
          populateRunSelector();
        }
        break;

      case "errorMessage":
        setBusy(false);
        showError((msg.payload && msg.payload.message) || "Backend communication error.");
        if (el.runStatusBadge) {
          el.runStatusBadge.textContent = "ERROR";
          el.runStatusBadge.className = "status-pill status-failed";
        }
        break;

      case "aiStatus":
        aiStatus = msg.payload;
        if (AIAssistant) AIAssistant.renderStatusBar(el.ai, aiStatus);
        break;

      case "aiResponse": {
        setAILoading(false);
        const res = msg.payload;
        if (res) {
          const targetKey = res.run_id || "__general__";
          const conv = getAIConversation(targetKey);
          conv.push({
            role: "assistant",
            content: res.answer,
            run_id: res.run_id,
            mode: res.mode,
            learning_mode: res.learning_mode,
            model: res.model,
            latency_ms: res.latency_ms,
            is_general_knowledge: res.is_general_knowledge,
            verified_references: res.verified_references || [],
            grounding_warnings: res.grounding_warnings || [],
          });
          refreshAIContextUI();
        }
        break;
      }

      case "aiError": {
        setAILoading(false);
        const errText = (msg.payload && msg.payload.message) || "Local AI request failed.";
        const conv = getAIConversation(getCurrentAIRunKey());
        conv.push({
          role: "assistant",
          content: `Local AI error: ${errText}`,
          grounding_warnings: ["Local LLM inference did not complete. Check Ollama runtime status above."],
          verified_references: [],
        });
        refreshAIContextUI();
        transport.post({ type: "aiGetStatus" });
        break;
      }

      case "aiConversationCleared": {
        const key = (msg.payload && msg.payload.runId) || getCurrentAIRunKey();
        aiConversationsByRun.set(key, []);
        refreshAIContextUI();
        break;
      }

      case "systemOverview": {
        renderSystemOverviewPanel(msg.payload || {});
        break;
      }

      case "curriculumLabsLoaded":
      case "curriculumLabDetail":
      case "curriculumRunResult":
      case "curriculumAssessmentResult":
      case "curriculumSubnetResult":
      case "curriculumAIResponse":
      case "curriculumError": {
        if (typeof window.__netboxHandleCurriculumMessage === "function") {
          window.__netboxHandleCurriculumMessage(msg);
        }
        break;
      }

      case "onboardingState": {
        if (typeof window.__netboxHandleOnboardingState === "function") {
          window.__netboxHandleOnboardingState(msg.payload || {});
        }
        break;
      }

      case "startGuidedTour": {
        if (typeof window.__netboxStartGuidedTour === "function") {
          const p = msg.payload || {};
          window.__netboxStartGuidedTour(p.restart ? 0 : p.stepIndex || 0);
        }
        break;
      }

      case "startPresentationMode": {
        if (typeof window.__netboxStartPresentationMode === "function") {
          window.__netboxStartPresentationMode(0);
        }
        break;
      }
    }
  });

  // Phase 6 System & LAN Dashboard Renderer + Periodic Health Monitor
  let lastSystemConnected = null;
  function updateConnStatusPill(payload) {
    if (!el.connStatusPill) return;
    if (!payload || !payload.connected) {
      el.connStatusPill.textContent = "Host: Disconnected";
      el.connStatusPill.className = "status-pill status-error";
      return;
    }
    const overall = (payload.health && payload.health.overall_status) || "running";
    const modeLabel = (payload.info && payload.info.mode === "lan") ? "LAN" : "Local";
    if (overall === "running") {
      el.connStatusPill.textContent = `Host: Connected (${modeLabel})`;
      el.connStatusPill.className = "status-pill status-ok";
    } else {
      el.connStatusPill.textContent = `Host: Degraded (${modeLabel})`;
      el.connStatusPill.className = "status-pill status-warn";
    }
  }

  function renderSystemOverviewPanel(payload) {
    updateConnStatusPill(payload);
    if (lastSystemConnected === false && payload && payload.connected) {
      hideError();
      transport.post({ type: "listRuns" });
      transport.post({ type: "aiGetStatus" });
    } else if (payload && !payload.connected && lastSystemConnected !== false) {
      showError("Lost connection to NetBox host. Retrying automatically — check System & LAN tab.");
    }
    lastSystemConnected = Boolean(payload && payload.connected);

    if (!el.systemRoot || !SystemDashboard) return;
    el.systemRoot.innerHTML = SystemDashboard.renderSystemDashboard(payload);

    el.systemRoot.querySelectorAll("[data-sys-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-sys-action");
        if (action === "refresh") {
          transport.post({ type: "systemGetOverview" });
        } else if (action === "rotate-token") {
          transport.post({ type: "systemRotateToken" });
        } else if (action === "clear-token") {
          const hostInput = el.systemRoot.querySelector("#sys-input-host-url");
          transport.post({
            type: "systemUpdateClientConfig",
            payload: {
              backendUrl: hostInput ? hostInput.value : undefined,
              accessToken: "",
            },
          });
        } else if (action === "copy-url") {
          const valEl = el.systemRoot.querySelector("#sys-lan-url-val");
          if (valEl && navigator.clipboard) {
            navigator.clipboard.writeText(valEl.textContent || "").catch(() => {});
          }
        } else if (action === "copy-token") {
          const valEl = el.systemRoot.querySelector("#sys-pairing-token-val");
          if (valEl && navigator.clipboard) {
            navigator.clipboard.writeText(valEl.textContent || "").catch(() => {});
          }
        }
      });
    });

    const cfgForm = el.systemRoot.querySelector("#sys-client-config-form");
    if (cfgForm) {
      cfgForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const hostInput = el.systemRoot.querySelector("#sys-input-host-url");
        const tokenInput = el.systemRoot.querySelector("#sys-input-token");
        transport.post({
          type: "systemUpdateClientConfig",
          payload: {
            backendUrl: hostInput ? hostInput.value : undefined,
            accessToken: tokenInput ? tokenInput.value : "",
          },
        });
      });
    }
  }

  // Expose controlled bridge for LabsView (Phase 7) without polluting global scope
  window.__netboxBridge = {
    post: (msg) => transport.post(msg),
    switchTab: (t) => switchTab(t),
    getCurrentRunId: () => {
      const s = store.getState();
      return s.mode === "live" ? s.runId : null;
    },
    getSelectedPacketSeq: () => selectedPacketSeq,
    navigateEvidence: (ref) => handleAIEvidenceNavigation(ref),
  };

  // Phase 7 Interactive Curriculum Labs Controller
  const labsState = {
    loaded: false,
    labs: [],
    progress: null,
    activeLab: null,
    activeSection: "learn",
    selectedScenarioId: "",
    runResultByLab: new Map(),
    assessmentByLab: new Map(),
    aiResponseByLab: new Map(),
    subnetResult: null,
    isRunning: false,
    aiBusy: false,
    errorMsg: null,
  };

  function renderLabsUI() {
    if (!el.labsRoot || !LabsView) return;
    const labId = labsState.activeLab ? labsState.activeLab.lab_id : null;
    el.labsRoot.innerHTML = LabsView.renderLabWorkspace({
      labs: labsState.labs,
      progress: labsState.progress,
      activeLab: labsState.activeLab,
      activeSection: labsState.activeSection,
      selectedScenarioId: labsState.selectedScenarioId,
      runResult: labId ? labsState.runResultByLab.get(labId) || null : null,
      assessmentResult: labId ? labsState.assessmentByLab.get(labId) || null : null,
      aiResponse: labId ? labsState.aiResponseByLab.get(labId) || null : null,
      subnetResult: labsState.subnetResult,
      isRunning: labsState.isRunning,
      aiBusy: labsState.aiBusy,
      errorMsg: labsState.errorMsg,
      aiHelper: AIAssistant,
    });

    el.labsRoot.querySelectorAll("[data-lab-select]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-lab-select");
        if (targetId) {
          labsState.errorMsg = null;
          labsState.activeSection = "learn";
          transport.post({ type: "curriculumGetLab", payload: { labId: targetId } });
        }
      });
    });

    el.labsRoot.querySelectorAll("[data-lab-section]").forEach((btn) => {
      btn.addEventListener("click", () => {
        labsState.activeSection = btn.getAttribute("data-lab-section") || "learn";
        renderLabsUI();
      });
    });

    const scenarioSelect = el.labsRoot.querySelector("#lab-scenario-select");
    if (scenarioSelect) {
      scenarioSelect.addEventListener("change", (e) => {
        // @ts-ignore
        labsState.selectedScenarioId = e.target.value;
      });
    }

    const btnRun = el.labsRoot.querySelector("#btn-lab-run");
    if (btnRun && labsState.activeLab) {
      btnRun.addEventListener("click", () => {
        if (labsState.isRunning) return;
        labsState.isRunning = true;
        labsState.errorMsg = null;
        renderLabsUI();
        transport.post({
          type: "curriculumRunLab",
          payload: {
            labId: labsState.activeLab.lab_id,
            scenarioId: labsState.selectedScenarioId || labsState.activeLab.experiment.experiment_id,
          },
        });
      });
    }

    el.labsRoot.querySelectorAll("[data-lab-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-lab-jump");
        if (tab) switchTab(tab);
      });
    });

    const subnetForm = el.labsRoot.querySelector("#lab-subnet-form");
    if (subnetForm) {
      subnetForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const cidrEl = el.labsRoot.querySelector("#lab-subnet-cidr");
        const cmpEl = el.labsRoot.querySelector("#lab-subnet-compare");
        transport.post({
          type: "curriculumSubnetCalc",
          payload: {
            cidr: cidrEl ? cidrEl.value : "",
            compareIp: cmpEl ? cmpEl.value : "",
          },
        });
      });
    }

    el.labsRoot.querySelectorAll("[data-lab-ai-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!labsState.activeLab || labsState.aiBusy) return;
        const rawMode = btn.getAttribute("data-lab-ai-mode") || "explain";
        const hintLevel = Number(btn.getAttribute("data-hint-level") || "1");
        const studentInput = el.labsRoot.querySelector("#lab-ai-student-input");
        const runRes = labsState.runResultByLab.get(labsState.activeLab.lab_id);
        const runId = (runRes && runRes.run_id) || window.__netboxBridge.getCurrentRunId();
        labsState.aiBusy = true;
        labsState.errorMsg = null;
        renderLabsUI();
        transport.post({
          type: "curriculumAIInteract",
          payload: {
            lab_id: labsState.activeLab.lab_id,
            mode: rawMode === "explain-custom" ? "explain" : rawMode,
            run_id: runId || null,
            packet_id: selectedPacketSeq || null,
            question: studentInput ? studentInput.value.trim() || null : null,
            hint_level: hintLevel,
            learning_mode: true,
          },
        });
      });
    });

    const reviewForm = el.labsRoot.querySelector("#lab-ai-review-form");
    if (reviewForm && labsState.activeLab) {
      reviewForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (labsState.aiBusy) return;
        const studentInput = el.labsRoot.querySelector("#lab-ai-student-input");
        const text = studentInput ? studentInput.value.trim() : "";
        if (!text) return;
        const runRes = labsState.runResultByLab.get(labsState.activeLab.lab_id);
        const runId = (runRes && runRes.run_id) || window.__netboxBridge.getCurrentRunId();
        labsState.aiBusy = true;
        labsState.errorMsg = null;
        renderLabsUI();
        transport.post({
          type: "curriculumAIInteract",
          payload: {
            lab_id: labsState.activeLab.lab_id,
            mode: "review_understanding",
            run_id: runId || null,
            student_explanation: text,
            learning_mode: true,
          },
        });
      });
    }

    // Verified clickable AI evidence links inside the Labs Tutor response
    el.labsRoot.querySelectorAll(".ai-ev-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleAIEvidenceNavigation({
          kind: btn.getAttribute("data-ev-kind"),
          target_sequence: btn.getAttribute("data-ev-seq") ? Number(btn.getAttribute("data-ev-seq")) : null,
          target_flow_id: btn.getAttribute("data-ev-flow") || null,
        });
      });
    });

    const assessForm = el.labsRoot.querySelector("#lab-assessment-form");
    if (assessForm && labsState.activeLab) {
      assessForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const answers = {};
        labsState.activeLab.questions.forEach((q) => {
          if (q.options && q.options.length) {
            const checked = assessForm.querySelector(`input[name="q_${q.question_id}"]:checked`);
            if (checked) answers[q.question_id] = Number(checked.value);
          } else {
            const ta = assessForm.querySelector(`textarea[name="q_${q.question_id}"]`);
            if (ta) answers[q.question_id] = ta.value;
          }
        });
        transport.post({
          type: "curriculumSubmitAssessment",
          payload: { labId: labsState.activeLab.lab_id, answers },
        });
      });
    }
  }

  window.__netboxOnLabsTabOpen = () => {
    if (!labsState.loaded) {
      transport.post({ type: "curriculumListLabs" });
    } else {
      renderLabsUI();
    }
  };

  window.__netboxHandleCurriculumMessage = (msg) => {
    switch (msg.type) {
      case "curriculumLabsLoaded": {
        const p = msg.payload || {};
        labsState.loaded = true;
        labsState.labs = p.labs || [];
        labsState.progress = p.progress || null;
        if (!labsState.activeLab && labsState.labs.length > 0) {
          transport.post({ type: "curriculumGetLab", payload: { labId: labsState.labs[0].lab_id } });
        } else {
          renderLabsUI();
        }
        break;
      }
      case "curriculumLabDetail": {
        labsState.activeLab = msg.payload;
        labsState.selectedScenarioId =
          (msg.payload && msg.payload.experiment && msg.payload.experiment.experiment_id) || "";
        renderLabsUI();
        break;
      }
      case "curriculumRunResult": {
        const res = msg.payload;
        labsState.isRunning = false;
        if (res && res.lab_id) {
          labsState.runResultByLab.set(res.lab_id, res);
          if (res.progress) labsState.progress = res.progress;
          labsState.activeSection = "observe";
          transport.post({ type: "curriculumListLabs" });
        }
        renderLabsUI();
        break;
      }
      case "curriculumAssessmentResult": {
        const res = msg.payload;
        if (res && res.lab_id) {
          labsState.assessmentByLab.set(res.lab_id, res);
          if (res.progress) labsState.progress = res.progress;
          transport.post({ type: "curriculumListLabs" });
        }
        renderLabsUI();
        break;
      }
      case "curriculumSubnetResult": {
        labsState.subnetResult = msg.payload;
        renderLabsUI();
        break;
      }
      case "curriculumAIResponse": {
        labsState.aiBusy = false;
        if (labsState.activeLab) {
          labsState.aiResponseByLab.set(labsState.activeLab.lab_id, msg.payload);
        }
        renderLabsUI();
        break;
      }
      case "curriculumError": {
        labsState.isRunning = false;
        labsState.aiBusy = false;
        labsState.errorMsg = (msg.payload && msg.payload.message) || "Curriculum request failed.";
        renderLabsUI();
        break;
      }
    }
  };

  // Wire Toolbar & Playback Controls
  el.btnRunLive?.addEventListener("click", () => {
    if (isBusy) return;
    hideError();
    playback.pause();
    setBusy(true, "RUNNING...");
    transport.post({ type: "executeLiveRun", payload: { exampleId: "tcp-echo" } });
  });

  el.btnLoadDemo?.addEventListener("click", () => {
    hideError();
    playback.pause();
    transport.post({ type: "getDemoEvents" });
  });

  el.btnRefresh?.addEventListener("click", () => {
    if (isBusy) return;
    hideError();
    playback.pause();
    const state = store.getState();
    transport.post({ type: "listRuns" });
    if (state.mode === "live" && state.runId) {
      transport.post({ type: "getLiveEvents", payload: { runId: state.runId } });
    } else {
      transport.post({ type: "getDemoEvents" });
    }
  });

  el.runSelect?.addEventListener("change", (e) => {
    // @ts-ignore
    const val = e.target.value;
    hideError();
    playback.pause();
    if (val === "__demo__") {
      transport.post({ type: "getDemoEvents" });
    } else if (val) {
      transport.post({ type: "getLiveEvents", payload: { runId: val } });
    }
  });

  el.btnPlayPause?.addEventListener("click", () => {
    if (playback.getState().isPlaying) {
      playback.pause();
    } else {
      playback.play();
    }
  });

  el.btnNext?.addEventListener("click", () => playback.next());
  el.btnPrev?.addEventListener("click", () => playback.prev());
  el.btnReset?.addEventListener("click", () => {
    compareIndex = -1;
    playback.reset();
  });

  el.speedSelect?.addEventListener("change", (e) => {
    // @ts-ignore
    const speed = Number(e.target.value) || 1;
    playback.setSpeed(speed);
    dualPlayback.setSpeed(speed);
  });

  // Phase 4 Navigation Tabs & Multi-Layer Replay Controls
  el.navTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab") || "socket";
      switchTab(tab);
    });
  });

  el.replayLayerSelect?.addEventListener("change", (e) => {
    // @ts-ignore
    replayLayerMode = e.target.value || "both";
    rebuildUnifiedReplay();
  });

  el.btnDualPlay?.addEventListener("click", () => {
    if (dualPlayback.getState().isPlaying) dualPlayback.pause();
    else dualPlayback.play();
  });
  el.btnDualNext?.addEventListener("click", () => dualPlayback.next());
  el.btnDualPrev?.addEventListener("click", () => dualPlayback.prev());
  el.btnDualReset?.addEventListener("click", () => dualPlayback.reset());

  el.errorBannerClose?.addEventListener("click", hideError);

  // Wire Filter Controls (non-destructive)
  function onFilterChanged() {
    activeFilters = {
      process: el.filterProcess ? el.filterProcess.value : "all",
      eventType: el.filterType ? el.filterType.value : "all",
      socketFd: el.filterFd ? el.filterFd.value : "all",
      errorsOnly: Boolean(el.filterErrors && el.filterErrors.checked),
      search: el.filterSearch ? el.filterSearch.value : "",
    };
    renderCurrentStep(playback.getState().currentIndex);
  }

  el.filterProcess?.addEventListener("change", onFilterChanged);
  el.filterType?.addEventListener("change", onFilterChanged);
  el.filterFd?.addEventListener("change", onFilterChanged);
  el.filterErrors?.addEventListener("change", onFilterChanged);
  el.filterSearch?.addEventListener("input", onFilterChanged);

  el.btnClearFilters?.addEventListener("click", () => {
    activeFilters = { ...EventFilter.DEFAULT_FILTERS };
    if (el.filterProcess) el.filterProcess.value = "all";
    if (el.filterType) el.filterType.value = "all";
    if (el.filterFd) el.filterFd.value = "all";
    if (el.filterErrors) el.filterErrors.checked = false;
    if (el.filterSearch) el.filterSearch.value = "";
    renderCurrentStep(playback.getState().currentIndex);
  });

  // View Mode Switcher (Split / Timeline / Sequence)
  el.viewModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode") || "split";
      el.viewModeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (el.splitContainer) {
        el.splitContainer.setAttribute("data-view-mode", mode);
      }
    });
  });

  // Phase 5 AI Assistant Event Listeners
  el.ai.btnRefreshStatus?.addEventListener("click", () => {
    transport.post({ type: "aiGetStatus" });
  });

  el.ai.modelSelect?.addEventListener("change", (e) => {
    // @ts-ignore
    const model = e.target.value;
    if (model) {
      transport.post({ type: "aiUpdateConfig", payload: { model } });
    }
  });

  el.ai.btnClear?.addEventListener("click", () => {
    const runKey = getCurrentAIRunKey();
    if (runKey !== "__general__") {
      transport.post({ type: "aiClearConversation", payload: { runId: runKey } });
    } else {
      aiConversationsByRun.set("__general__", []);
      refreshAIContextUI();
    }
  });

  el.ai.inputForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!el.ai.questionInput) return;
    const q = el.ai.questionInput.value;
    if (!q.trim()) return;
    el.ai.questionInput.value = "";
    sendAIQuestion(q);
  });

  // Phase 8.6 Interactive Guided Tour & Presentation / Demo Mode Controller
  const tourState = {
    active: false,
    stepIndex: 0,
    completed: false,
    skipped: false,
    experimentStatus: null,
    demoActive: false,
    demoStageIndex: 0,
  };

  function clearSpotlight() {
    document.querySelectorAll(".tour-spotlight-target").forEach((node) => {
      node.classList.remove("tour-spotlight-target");
    });
  }

  function persistTourState() {
    try {
      localStorage.setItem("netbox_tour_completed", tourState.completed ? "1" : "0");
      localStorage.setItem("netbox_tour_skipped", tourState.skipped ? "1" : "0");
      localStorage.setItem("netbox_tour_step", String(tourState.stepIndex));
    } catch (_) {}
    if (typeof acquireVsCodeApi === "function") {
      transport.post({
        type: "onboardingSetState",
        payload: {
          completed: tourState.completed,
          skipped: tourState.skipped,
          currentStep: tourState.stepIndex,
        },
      });
    }
  }

  function renderTourOverlay() {
    if (!el.tourOverlayRoot || !GuidedTour) return;
    clearSpotlight();
    if (!tourState.active) {
      el.tourOverlayRoot.classList.add("hidden");
      el.tourOverlayRoot.innerHTML = "";
      return;
    }

    const step = GuidedTour.TOUR_STEPS[tourState.stepIndex];
    if (step && step.tab && activeTab !== step.tab) {
      switchTab(step.tab);
    }

    if (step && step.selector) {
      const target = document.querySelector(step.selector);
      if (target) {
        target.classList.add("tour-spotlight-target");
        try {
          target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {}
      }
    }

    el.tourOverlayRoot.classList.remove("hidden");
    el.tourOverlayRoot.innerHTML = GuidedTour.renderTourCard(tourState.stepIndex, {
      experimentStatus: tourState.experimentStatus,
      isBusy,
    });

    el.tourOverlayRoot.querySelectorAll("[data-tour-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-tour-action");
        if (act === "next" && tourState.stepIndex < GuidedTour.TOUR_STEPS.length - 1) {
          tourState.stepIndex += 1;
          persistTourState();
          renderTourOverlay();
        } else if (act === "prev" && tourState.stepIndex > 0) {
          tourState.stepIndex -= 1;
          persistTourState();
          renderTourOverlay();
        } else if (act === "skip") {
          tourState.active = false;
          tourState.skipped = true;
          persistTourState();
          renderTourOverlay();
        } else if (act === "finish") {
          tourState.active = false;
          tourState.completed = true;
          tourState.stepIndex = 0;
          persistTourState();
          renderTourOverlay();
        } else if (act === "run-first-exp") {
          tourState.experimentStatus = "Executing real POSIX C TCP Echo under LD_PRELOAD + libpcap...";
          renderTourOverlay();
          setBusy(true, "RUNNING...");
          transport.post({ type: "executeLiveRun", payload: { exampleId: "tcp-echo" } });
        } else if (act === "inspect-packets") {
          switchTab("packets");
        } else if (act === "ask-ai-exp") {
          const runId = window.__netboxBridge.getCurrentRunId();
          switchTab("ai");
          if (runId) {
            triggerAIExplain("execution");
          }
        } else if (act === "open-mod1") {
          tourState.active = false;
          tourState.completed = true;
          persistTourState();
          renderTourOverlay();
          switchTab("labs");
          transport.post({ type: "curriculumGetLab", payload: { labId: "mod1-foundations" } });
        } else if (act === "enter-demo") {
          tourState.active = false;
          tourState.completed = true;
          persistTourState();
          renderTourOverlay();
          enterPresentationMode(0);
        }
      });
    });
  }

  function renderPresentationMode() {
    if (!el.demoBarRoot || !GuidedTour) return;
    document.body.classList.toggle("presentation-mode", tourState.demoActive);
    if (!tourState.demoActive) {
      el.demoBarRoot.classList.add("hidden");
      el.demoBarRoot.innerHTML = "";
      return;
    }
    const stage = GuidedTour.DEMO_STAGES[tourState.demoStageIndex];
    if (stage && stage.tab) {
      switchTab(stage.tab);
    }
    el.demoBarRoot.classList.remove("hidden");
    el.demoBarRoot.innerHTML = GuidedTour.renderPresentationBar(tourState.demoStageIndex);

    el.demoBarRoot.querySelectorAll("[data-demo-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-demo-action");
        if (act === "next" && tourState.demoStageIndex < GuidedTour.DEMO_STAGES.length - 1) {
          tourState.demoStageIndex += 1;
          renderPresentationMode();
        } else if (act === "prev" && tourState.demoStageIndex > 0) {
          tourState.demoStageIndex -= 1;
          renderPresentationMode();
        } else if (act === "exit") {
          tourState.demoActive = false;
          renderPresentationMode();
        } else if (act === "run-tcp") {
          setBusy(true, "RUNNING...");
          transport.post({ type: "executeLiveRun", payload: { exampleId: "tcp-echo" } });
        } else if (act === "explain-ai") {
          const runId = window.__netboxBridge.getCurrentRunId();
          switchTab("ai");
          if (runId) {
            triggerAIExplain("execution");
          }
        }
      });
    });
  }

  function enterPresentationMode(stageIdx) {
    tourState.demoActive = true;
    tourState.demoStageIndex = Number(stageIdx) || 0;
    renderPresentationMode();
  }

  window.__netboxStartGuidedTour = (startStep) => {
    tourState.active = true;
    tourState.stepIndex = Number(startStep) || 0;
    renderTourOverlay();
  };

  window.__netboxStartPresentationMode = (stageIdx) => {
    enterPresentationMode(stageIdx || 0);
  };

  window.__netboxHandleOnboardingState = (st) => {
    tourState.completed = Boolean(st.completed);
    tourState.skipped = Boolean(st.skipped);
    tourState.stepIndex = Number(st.currentStep) || 0;
  };

  el.btnStartTour?.addEventListener("click", () => {
    tourState.active = !tourState.active;
    if (tourState.active && tourState.completed) {
      tourState.stepIndex = 0;
    }
    renderTourOverlay();
  });

  el.btnDemoMode?.addEventListener("click", () => {
    tourState.demoActive = !tourState.demoActive;
    if (tourState.demoActive) tourState.demoStageIndex = 0;
    renderPresentationMode();
  });

  // Update Step 9 live experiment status whenever a real run finishes
  function updateTourAfterRunLoaded() {
    const s = store.getState();
    if (tourState.active && s && s.mode === "live" && s.runId) {
      const pkts = packetData && Array.isArray(packetData.packets) ? packetData.packets.length : 0;
      const evs = Array.isArray(s.events) ? s.events.length : 0;
      const capState = packetData ? packetData.packet_capture_status : "NOT_REQUESTED";
      tourState.experimentStatus = `Live run ${s.runId}: ${evs} real socket_api events, ${pkts} captured packets (capture: ${capState}).`;
      renderTourOverlay();
    }
  }

  // Initial Load: fetch run history + AI runtime status + System & LAN health + default view
  transport.post({ type: "listRuns" });
  transport.post({ type: "aiGetStatus" });
  transport.post({ type: "systemGetOverview" });
  transport.post({ type: "getDemoEvents" });

  // Restore browser localStorage onboarding state (VS Code uses globalState via onboardingState)
  if (typeof acquireVsCodeApi !== "function") {
    try {
      tourState.completed = localStorage.getItem("netbox_tour_completed") === "1";
      tourState.skipped = localStorage.getItem("netbox_tour_skipped") === "1";
      tourState.stepIndex = Number(localStorage.getItem("netbox_tour_step") || "0") || 0;
    } catch (_) {}
  }

  // Periodic health check & real client heartbeat (10s interval)
  setInterval(() => {
    transport.post({ type: "systemGetOverview" });
  }, 10000);
})();
