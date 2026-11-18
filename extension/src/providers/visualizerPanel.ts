import * as vscode from "vscode";
import { BackendService } from "../services/backendService";
import { WebviewToExtensionMessage } from "../services/types";

export class VisualizerPanel {
  public static currentPanel: VisualizerPanel | undefined;
  public static readonly viewType = "netboxVisualizer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _globalState?: vscode.Memento;
  private _disposables: vscode.Disposable[] = [];
  private readonly _backendService: BackendService;

  public static createOrShow(
    extensionUri: vscode.Uri,
    initialRunId?: string,
    options?: { startTour?: boolean; presentationMode?: boolean; globalState?: vscode.Memento }
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (VisualizerPanel.currentPanel) {
      VisualizerPanel.currentPanel._panel.reveal(column);
      if (initialRunId) {
        VisualizerPanel.currentPanel.loadLiveEvents(initialRunId);
      } else {
        VisualizerPanel.currentPanel.refreshRunsList();
      }
      if (options?.startTour) {
        VisualizerPanel.currentPanel.startGuidedTour(true);
      }
      if (options?.presentationMode) {
        VisualizerPanel.currentPanel.startPresentationMode();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisualizerPanel.viewType,
      "NetBox Visualizer",
      column || vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    VisualizerPanel.currentPanel = new VisualizerPanel(panel, extensionUri, initialRunId, options);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialRunId?: string,
    options?: { startTour?: boolean; presentationMode?: boolean; globalState?: vscode.Memento }
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._globalState = options?.globalState;
    this._backendService = BackendService.getInstance();

    this._panel.title = "NetBox Visualizer";
    this._panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "netbox-icon.svg");

    this._update(initialRunId, options);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );
  }

  public async refreshRunsList() {
    try {
      const runs = await this._backendService.listRuns();
      this._panel.webview.postMessage({
        type: "runsList",
        payload: runs,
      });
    } catch {
      // Backend may be offline; error banner is handled on explicit fetch
    }
  }

  public async loadDemoEvents() {
    try {
      const demoData = await this._backendService.getTcpDemo();
      this._panel.webview.postMessage({
        type: "eventsLoaded",
        payload: {
          runId: demoData.demo_id,
          runStatus: "simulated",
          isSimulated: demoData.is_simulated,
          label: demoData.simulation_label,
          events: demoData.events,
        },
      });
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: "errorMessage",
        payload: {
          message: `Backend unavailable (${err?.message}). Start the backend via ./scripts/run_backend.sh to load events.`,
        },
      });
    }
  }

  public async loadLiveEvents(runId?: string) {
    try {
      let targetRunId = runId;
      const runs = await this._backendService.listRuns();
      this._panel.webview.postMessage({
        type: "runsList",
        payload: runs,
      });

      if (!targetRunId) {
        if (runs && runs.length > 0) {
          targetRunId = runs[0].run_id;
        } else {
          const newRun = await this._backendService.createRun("tcp-echo");
          targetRunId = newRun.run_id;
          await this.refreshRunsList();
        }
      }

      const [runMeta, eventsData, packetData, flowsData, correlationsData] = await Promise.all([
        this._backendService.getRun(targetRunId),
        this._backendService.getRunEvents(targetRunId),
        this._backendService.getRunPackets(targetRunId).catch(() => null),
        this._backendService.getRunFlows(targetRunId).catch(() => null),
        this._backendService.getRunCorrelations(targetRunId).catch(() => null),
      ]);

      this._panel.webview.postMessage({
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
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load live events: ${err?.message}`);
      this._panel.webview.postMessage({
        type: "errorMessage",
        payload: { message: `Failed to load live run: ${err?.message}` },
      });
    }
  }

  public async executeLiveRun(exampleId: string = "tcp-echo", clientArgs?: string[]) {
    try {
      vscode.window.showInformationMessage(`Starting monitored execution of '${exampleId}'...`);
      const runRes = await this._backendService.createRun(exampleId, clientArgs);
      vscode.window.showInformationMessage(
        `Run '${runRes.run_id}' finished with status '${runRes.status}' (${runRes.event_count} events).`
      );
      await this.loadLiveEvents(runRes.run_id);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Live run execution failed: ${err?.message}`);
      this._panel.webview.postMessage({
        type: "errorMessage",
        payload: { message: `Execution failed: ${err?.message}` },
      });
    }
  }

  private async _handleMessage(message: WebviewToExtensionMessage) {
    switch (message.type) {
      case "getDemoEvents":
        await this.loadDemoEvents();
        break;

      case "getLiveEvents":
        await this.loadLiveEvents(message.payload?.runId);
        break;

      case "executeLiveRun":
        await this.executeLiveRun(
          message.payload?.exampleId || "tcp-echo",
          message.payload?.clientArgs
        );
        break;

      case "listRuns":
        await this.refreshRunsList();
        break;

      case "checkBackend": {
        const status = await this._backendService.checkHealth();
        this._panel.webview.postMessage({
          type: "backendStatus",
          payload: status,
        });
        break;
      }

      case "aiGetStatus":
        try {
          const aiStatus = await this._backendService.getAIStatus();
          this._panel.webview.postMessage({ type: "aiStatus", payload: aiStatus });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: `Unable to check AI runtime status: ${err?.message}` },
          });
        }
        break;

      case "aiUpdateConfig":
        try {
          const updated = await this._backendService.updateAIConfig(message.payload || {});
          this._panel.webview.postMessage({ type: "aiStatus", payload: updated });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: `Failed to update AI config: ${err?.message}` },
          });
        }
        break;

      case "aiExplainExecution":
        try {
          const res = await this._backendService.explainExecution(
            message.payload.runId,
            Boolean(message.payload.learningMode),
            message.payload.focus || "execution",
            message.payload.flowId
          );
          this._panel.webview.postMessage({ type: "aiResponse", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: err?.message || "Local AI execution explanation failed." },
          });
        }
        break;

      case "aiAskRun":
        try {
          const res = await this._backendService.askAboutRun(
            message.payload.runId,
            message.payload.question,
            Boolean(message.payload.learningMode),
            message.payload.flowId,
            message.payload.packetId
          );
          this._panel.webview.postMessage({ type: "aiResponse", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: err?.message || "Local AI question failed." },
          });
        }
        break;

      case "aiExplainPacket":
        try {
          const res = await this._backendService.explainPacket(
            message.payload.runId,
            message.payload.packetId,
            message.payload.learningMode !== false,
            message.payload.question
          );
          this._panel.webview.postMessage({ type: "aiResponse", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: err?.message || "Local AI packet explanation failed." },
          });
        }
        break;

      case "aiAskGeneral":
        try {
          const res = await this._backendService.askGeneral(
            message.payload.question,
            message.payload.learningMode !== false
          );
          this._panel.webview.postMessage({ type: "aiResponse", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "aiError",
            payload: { message: err?.message || "Local AI general question failed." },
          });
        }
        break;

      case "aiClearConversation":
        try {
          await this._backendService.clearAIConversation(message.payload.runId);
          this._panel.webview.postMessage({
            type: "aiConversationCleared",
            payload: { runId: message.payload.runId },
          });
        } catch {
          this._panel.webview.postMessage({
            type: "aiConversationCleared",
            payload: { runId: message.payload.runId },
          });
        }
        break;

      case "systemGetOverview":
        await this._sendSystemOverview();
        break;

      case "systemRotateToken":
        try {
          await this._backendService.rotatePairingToken();
          await this._sendSystemOverview();
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "errorMessage",
            payload: { message: `Failed to rotate pairing token: ${err?.message}` },
          });
        }
        break;

      case "systemUpdateClientConfig":
        try {
          await this._backendService.updateConnectionSettings(
            message.payload?.backendUrl,
            message.payload?.accessToken
          );
          await this._sendSystemOverview();
          await this.refreshRunsList();
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "errorMessage",
            payload: { message: `Failed to save client connection settings: ${err?.message}` },
          });
        }
        break;

      case "curriculumListLabs":
        try {
          const data = await this._backendService.listCurriculumLabs();
          this._panel.webview.postMessage({ type: "curriculumLabsLoaded", payload: data });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumError",
            payload: { message: err?.message || "Failed to load curriculum labs." },
          });
        }
        break;

      case "curriculumGetLab":
        try {
          const lab = await this._backendService.getCurriculumLab(message.payload.labId);
          this._panel.webview.postMessage({ type: "curriculumLabDetail", payload: lab });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumError",
            payload: { message: err?.message || "Failed to load lab detail." },
          });
        }
        break;

      case "curriculumRunLab":
        try {
          const result = await this._backendService.runCurriculumLab(
            message.payload.labId,
            message.payload.scenarioId,
            message.payload.params
          );
          this._panel.webview.postMessage({ type: "curriculumRunResult", payload: result });
          if (result && result.run_id) {
            await this.loadLiveEvents(result.run_id);
          }
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumError",
            payload: { message: err?.message || "Lab experiment execution failed." },
          });
        }
        break;

      case "curriculumSubmitAssessment":
        try {
          const res = await this._backendService.submitCurriculumAssessment(
            message.payload.labId,
            message.payload.answers
          );
          this._panel.webview.postMessage({ type: "curriculumAssessmentResult", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumError",
            payload: { message: err?.message || "Assessment submission failed." },
          });
        }
        break;

      case "curriculumSubnetCalc":
        try {
          const res = await this._backendService.calculateSubnet(
            message.payload.cidr,
            message.payload.compareIp
          );
          this._panel.webview.postMessage({ type: "curriculumSubnetResult", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumSubnetResult",
            payload: { error: err?.message || "Invalid CIDR input." },
          });
        }
        break;

      case "curriculumAIInteract":
        try {
          const res = await this._backendService.curriculumAIInteract(message.payload || {});
          this._panel.webview.postMessage({ type: "curriculumAIResponse", payload: res });
        } catch (err: any) {
          this._panel.webview.postMessage({
            type: "curriculumError",
            payload: { message: err?.message || "Curriculum AI tutor request failed." },
          });
        }
        break;

      case "onboardingGetState":
        this._sendOnboardingState();
        break;

      case "onboardingSetState":
        if (this._globalState && message.payload) {
          if (typeof message.payload.completed === "boolean") {
            await this._globalState.update("netbox.onboardingCompleted", message.payload.completed);
          }
          if (typeof message.payload.skipped === "boolean") {
            await this._globalState.update("netbox.onboardingSkipped", message.payload.skipped);
          }
          if (typeof message.payload.currentStep === "number") {
            await this._globalState.update("netbox.tourStep", message.payload.currentStep);
          }
        }
        break;

      case "configureBackend":
        vscode.commands.executeCommand("netbox.configureBackend");
        break;
    }
  }

  public startGuidedTour(restart: boolean = false) {
    const savedStep = restart ? 0 : (this._globalState?.get<number>("netbox.tourStep", 0) || 0);
    this._panel.webview.postMessage({
      type: "startGuidedTour",
      payload: { stepIndex: savedStep, restart },
    });
  }

  public startPresentationMode() {
    this._panel.webview.postMessage({
      type: "startPresentationMode",
      payload: { stageIndex: 0 },
    });
  }

  private _sendOnboardingState() {
    this._panel.webview.postMessage({
      type: "onboardingState",
      payload: {
        completed: Boolean(this._globalState?.get<boolean>("netbox.onboardingCompleted", false)),
        skipped: Boolean(this._globalState?.get<boolean>("netbox.onboardingSkipped", false)),
        currentStep: this._globalState?.get<number>("netbox.tourStep", 0) || 0,
      },
    });
  }

  private async _sendSystemOverview() {
    const hasStoredToken = await this._backendService.hasStoredAccessToken();
    const clientSettings = {
      backendUrl: this._backendService.getBackendUrl(),
      accessToken: "",
      hasStoredToken,
    };
    try {
      const [health, info] = await Promise.all([
        this._backendService.getSystemHealth(),
        this._backendService.getSystemInfo(),
      ]);
      let network: any = null;
      let connection: any = null;
      let authError: string | null = null;
      try {
        await this._backendService.sendClientHeartbeat("vscode-host-client", "VS Code Extension").catch(() => null);
        [network, connection] = await Promise.all([
          this._backendService.getSystemNetwork(),
          this._backendService.getSystemConnection(),
        ]);
      } catch (err: any) {
        authError = err?.message || "Authentication required for host LAN details.";
      }
      this._panel.webview.postMessage({
        type: "systemOverview",
        payload: {
          connected: true,
          health,
          info,
          network,
          connection,
          authError,
          clientSettings,
          isWebBrowser: false,
        },
      });
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: "systemOverview",
        payload: {
          connected: false,
          health: null,
          info: null,
          network: null,
          connection: null,
          authError: err?.message || "Host disconnected.",
          clientSettings,
          isWebBrowser: false,
        },
      });
    }
  }

  public dispose() {
    VisualizerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update(
    initialRunId?: string,
    options?: { startTour?: boolean; presentationMode?: boolean }
  ) {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    setTimeout(() => {
      this._sendOnboardingState();
      this.refreshRunsList();
      if (initialRunId) {
        this.loadLiveEvents(initialRunId);
      } else {
        this.loadDemoEvents();
      }
      if (options?.startTour) {
        this.startGuidedTour(false);
      } else if (options?.presentationMode) {
        this.startPresentationMode();
      }
    }, 250);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const mediaUri = (...parts: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", ...parts));

    const stylesUri = mediaUri("visualizer.css");
    const moduleScripts = [
      mediaUri("visualizer", "eventStore.js"),
      mediaUri("visualizer", "timingEngine.js"),
      mediaUri("visualizer", "socketStateEngine.js"),
      mediaUri("visualizer", "eventFilter.js"),
      mediaUri("visualizer", "sequenceMapper.js"),
      mediaUri("visualizer", "eventInspector.js"),
      mediaUri("visualizer", "playbackEngine.js"),
      mediaUri("visualizer", "renderers.js"),
      mediaUri("visualizer", "packetView.js"),
      mediaUri("visualizer", "aiAssistant.js"),
      mediaUri("visualizer", "systemDashboard.js"),
      mediaUri("visualizer", "labsView.js"),
      mediaUri("visualizer", "guidedTour.js"),
      mediaUri("visualizer.js"),
    ];

    const nonce = getNonce();
    const scriptsHtml = moduleScripts
      .map((uri) => `<script nonce="${nonce}" src="${uri}"></script>`)
      .join("\n  ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesUri}">
  <title>NetBox Visualizer</title>
</head>
<body>
  <div class="visualizer-container">
    <!-- A. Top Toolbar -->
    <header class="vis-header">
      <div class="vis-title-group">
        <h2>NetBox Networking Visualizer</h2>
        <span class="badge neutral-badge" id="data-mode-badge">LOADING...</span>
        <span class="run-id-pill" id="run-id-badge">Run: —</span>
        <span class="status-pill status-neutral" id="run-status-badge">IDLE</span>
        <span class="status-pill status-neutral" id="conn-status-pill" title="Connection state to NetBox Host">Checking Host...</span>
      </div>
      <div class="vis-controls-bar">
        <select id="run-select" class="run-selector" title="Switch between live runs and simulated demo">
          <option value="__demo__">Simulated Demo</option>
        </select>
        <button id="btn-run-live" class="ctrl-btn live-btn" title="Execute real C TCP program under LD_PRELOAD">&#9658; Run Live TCP</button>
        <button id="btn-refresh" class="ctrl-btn" title="Refresh events and runs">&#8635; Refresh</button>
        <button id="btn-load-demo" class="ctrl-btn" title="Load simulated demo trace">&#9881; Demo</button>
        <button id="btn-start-tour" class="ctrl-btn" title="Start or resume the 10-step interactive NetBox guided tour">&#128214; Tour</button>
        <button id="btn-demo-mode" class="ctrl-btn" title="Toggle clean Presentation / Demo Mode">&#127916; Present</button>
        <div class="divider-v"></div>
        <button id="btn-restart" class="ctrl-btn" title="Reset visualization">&#8634; Reset</button>
        <button id="btn-prev" class="ctrl-btn" title="Previous event">&#9664; Prev</button>
        <button id="btn-play-pause" class="ctrl-btn primary" title="Play / Pause">&#9658; Play</button>
        <button id="btn-next" class="ctrl-btn" title="Next event">Next &#9654;</button>
        <div class="speed-selector">
          <label for="speed-select">Speed:</label>
          <select id="speed-select">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        </div>
      </div>
    </header>

    <!-- Presentation / Demo Mode Bar (Phase 8.6E) -->
    <div id="demo-bar-root" class="hidden"></div>

    <!-- Error Notification Banner -->
    <div id="vis-error-banner" class="vis-error-banner hidden" role="alert">
      <span id="vis-error-text"></span>
      <button id="vis-error-close" class="vis-error-close" title="Dismiss">&times;</button>
    </div>

    <!-- Compact Timing & Performance Summary -->
    <div id="metrics-summary-bar" class="metrics-summary-bar"></div>

    <!-- Phase 4 Navigation Tabs + Layer Playback Mode -->
    <nav class="vis-nav-tabs" role="tablist">
      <div class="nav-tab-group">
        <button type="button" class="nav-tab-btn active" data-tab="socket" role="tab">Overview &amp; Socket API</button>
        <button type="button" class="nav-tab-btn" data-tab="packets" role="tab">Packets <span class="tab-count" id="tab-count-packets">0</span></button>
        <button type="button" class="nav-tab-btn" data-tab="flows" role="tab">TCP Flows <span class="tab-count" id="tab-count-flows">0</span></button>
        <button type="button" class="nav-tab-btn" data-tab="correlations" role="tab">Correlations &amp; Dual-Layer</button>
        <button type="button" class="nav-tab-btn nav-tab-ai" data-tab="ai" role="tab">&#10024; AI Assistant</button>
        <button type="button" class="nav-tab-btn nav-tab-labs" data-tab="labs" role="tab">&#127891; Curriculum Labs</button>
        <button type="button" class="nav-tab-btn nav-tab-system" data-tab="system" role="tab">&#128421; System &amp; LAN</button>
      </div>
      <div class="pcap-status-chip" id="header-pcap-chip" title="Packet capture status for current run">
        Packet Capture: NOT REQUESTED
      </div>
    </nav>

    <!-- Tab 1: Overview & Socket API (Phase 3 layout preserved) -->
    <div id="tab-pane-socket" class="vis-layout tab-pane">
      <!-- Left/Main Column: Topology + (Timeline & Sequence Diagram) -->
      <div class="vis-main-column">
        <!-- B. Interactive Network Topology View -->
        <section class="topology-panel">
          <div class="section-title">
            <h3>Network Topology &amp; Socket Lifecycle</h3>
            <span id="lifecycle-state" class="state-pill state-closed">READY</span>
          </div>
          <div id="topology-container"></div>
        </section>

        <!-- Lower Split View: Event Timeline + API-Level Sequence Diagram -->
        <div id="lower-split-container" class="lower-split-container" data-view-mode="split">
          <!-- Interactive Event Timeline -->
          <section class="timeline-panel">
            <div class="section-title">
              <h3>Chronological Event Timeline</h3>
              <div class="timeline-meta-row">
                <span class="filter-summary" id="filter-summary">Showing 0</span>
                <span class="timeline-counter" id="timeline-counter">Event 0 of 0</span>
                <div class="view-mode-switcher" title="Switch lower panel layout">
                  <button type="button" class="view-mode-btn active" data-mode="split">Split</button>
                  <button type="button" class="view-mode-btn" data-mode="timeline">Timeline</button>
                  <button type="button" class="view-mode-btn" data-mode="sequence">Sequence</button>
                </div>
              </div>
            </div>

            <div class="filter-bar">
              <select id="filter-process" class="filter-select" title="Filter by process">
                <option value="all">All Processes</option>
              </select>
              <select id="filter-type" class="filter-select" title="Filter by event type">
                <option value="all">All Event Types</option>
              </select>
              <select id="filter-fd" class="filter-select" title="Filter by socket FD">
                <option value="all">All FDs</option>
              </select>
              <label class="filter-checkbox-label">
                <input type="checkbox" id="filter-errors"> Errors only
              </label>
              <input type="search" id="filter-search" class="filter-search" placeholder="Search events, IP, port, errno...">
              <button type="button" id="btn-clear-filters" class="btn-link-clear">Clear</button>
            </div>

            <div class="timeline-scroll-container">
              <table class="events-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Rel. Time</th>
                    <th>Process</th>
                    <th>Event Type</th>
                    <th>FD</th>
                    <th>Result</th>
                    <th>Status</th>
                    <th title="Compare interval">Δ</th>
                  </tr>
                </thead>
                <tbody id="events-tbody"></tbody>
              </table>
            </div>
          </section>

          <!-- Interactive API-Level Sequence Diagram -->
          <section class="sequence-panel">
            <div class="section-title">
              <h3>TCP API Sequence Diagram</h3>
              <span class="timeline-counter">API-Level Only</span>
            </div>
            <div id="sequence-container" class="sequence-container"></div>
          </section>
        </div>
      </div>

      <!-- Right Column: Detailed Event Inspector -->
      <aside class="vis-inspector-column">
        <div class="section-title">
          <h3>Event Inspector</h3>
          <span class="inspector-badge" id="inspector-seq">Seq: -</span>
        </div>
        <div class="inspector-content">
          <div id="insp-explanation" class="inspector-explanation">
            Select an event from the timeline or sequence diagram to inspect its recorded fields.
          </div>

          <div class="insp-section">
            <div class="insp-section-header">
              <span>Directly Observed Fields</span>
              <span>Schema v1.0</span>
            </div>
            <div id="insp-observed-grid" class="insp-grid"></div>
          </div>

          <div class="insp-section">
            <div class="insp-section-header">
              <span>Visualizer-Derived Fields</span>
              <span>Computed</span>
            </div>
            <div id="insp-derived-grid" class="insp-grid"></div>
          </div>

          <details class="json-details">
            <summary>Raw Event JSON</summary>
            <pre class="json-block"><code id="insp-json-raw">// Select an event to view JSON</code></pre>
          </details>

          <div class="schema-legend">
            <h4>Observation Boundary</h4>
            <p>
              <code>socket_api</code> events observe user-space POSIX calls via <code>LD_PRELOAD</code>.
              Real wire packets belong to the separate <code>packet_capture</code> layer (Packets tab).
            </p>
          </div>
          <div id="insp-correlated-packets" class="insp-section hidden">
            <div class="insp-section-header"><span>Correlated Packets</span><span>4-Tuple</span></div>
            <div id="insp-correlated-packets-body" class="insp-grid"></div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Tab 2: Captured Packets + Observed Handshake + Packet Inspector -->
    <div id="tab-pane-packets" class="vis-layout tab-pane hidden">
      <div class="vis-main-column">
        <div id="pcap-status-banner"></div>

        <section class="topology-panel">
          <div class="section-title">
            <h3>Observed TCP Handshake (Captured Packets Only)</h3>
            <span class="timeline-counter">No Fabricated Packets</span>
          </div>
          <div id="handshake-container"></div>
        </section>

        <section class="timeline-panel">
          <div class="section-title">
            <h3>Captured Packet Timeline (source: packet_capture)</h3>
            <span class="timeline-counter" id="packet-timeline-counter">0 packets</span>
          </div>
          <div class="timeline-scroll-container">
            <table class="events-table">
              <thead>
                <tr>
                  <th>Pkt</th>
                  <th>Rel. Mono Time</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>TCP Flags</th>
                  <th>Payload</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody id="packets-tbody"></tbody>
            </table>
          </div>
        </section>
      </div>

      <aside class="vis-inspector-column">
        <div class="section-title">
          <h3>Packet Inspector</h3>
          <span class="inspector-badge" id="pkt-inspector-seq">Pkt: -</span>
        </div>
        <div id="packet-inspector-content" class="inspector-content"></div>
      </aside>
    </div>

    <!-- Tab 3: Bidirectional TCP Flows -->
    <div id="tab-pane-flows" class="tab-pane single-pane hidden">
      <div class="section-title">
        <h3>TCP Flows (Bidirectional 4-Tuple Analysis)</h3>
        <span class="timeline-counter" id="flows-counter">0 flows</span>
      </div>
      <div id="flows-container" class="flows-scroll"></div>
    </div>

    <!-- Tab 4: Socket <-> Packet Correlations & Dual-Layer Playback -->
    <div id="tab-pane-correlations" class="tab-pane dual-pane hidden">
      <section class="timeline-panel">
        <div class="section-title">
          <h3>Socket API &harr; Packet Correlations</h3>
          <span class="timeline-counter" id="correlations-counter">0 resolved / 0 unresolved</span>
        </div>
        <div class="timeline-scroll-container">
          <table class="events-table">
            <thead>
              <tr>
                <th>Packet</th>
                <th>Connection Tuple</th>
                <th>Confidence</th>
                <th>Socket Events</th>
                <th>Processes</th>
                <th>Correlation Evidence / Reason</th>
              </tr>
            </thead>
            <tbody id="correlations-tbody"></tbody>
          </table>
        </div>
      </section>

      <section class="timeline-panel">
        <div class="section-title">
          <h3>Multi-Layer Monotonic Replay</h3>
          <div class="replay-layer-bar">
            <label for="replay-layer-select">Layer:</label>
            <select id="replay-layer-select" class="filter-select">
              <option value="both" selected>Both Layers Together</option>
              <option value="socket">Socket API Only</option>
              <option value="packets">Packets Only</option>
            </select>
            <button type="button" id="btn-dual-prev" class="ctrl-btn">&#9664;</button>
            <button type="button" id="btn-dual-play" class="ctrl-btn primary">&#9658; Replay</button>
            <button type="button" id="btn-dual-next" class="ctrl-btn">&#9654;</button>
            <button type="button" id="btn-dual-reset" class="ctrl-btn">&#8634;</button>
          </div>
        </div>
        <div class="dual-caution-note">
          Ordered by monotonic observation timestamps (<code>socket_api</code> syscall time vs. <code>packet_capture</code> callback time). Close timestamps do not prove strict causal order.
        </div>
        <div class="timeline-scroll-container">
          <table class="events-table">
            <thead>
              <tr>
                <th>Rel. Mono Time</th>
                <th>Source</th>
                <th>Seq</th>
                <th>Observed Operation / Segment</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="unified-replay-tbody"></tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- Tab 5: Grounded Local AI Assistant (Phase 5) -->
    <div id="tab-pane-ai" class="tab-pane ai-pane hidden">
      <div class="ai-toolbar">
        <div class="ai-toolbar-left">
          <span id="ai-status-pill" class="ai-status-pill ai-status-neutral">Local LLM: Checking...</span>
          <span id="ai-context-badge" class="run-id-pill">Context: None (General CN)</span>
        </div>
        <div class="ai-toolbar-right">
          <label class="ai-ctrl-label" for="ai-model-select">Model:</label>
          <select id="ai-model-select" class="filter-select" title="Select local Ollama model"></select>
          <label class="ai-ctrl-label" for="ai-flow-select">Flow:</label>
          <select id="ai-flow-select" class="filter-select" title="Optionally isolate AI context to a single TCP flow">
            <option value="">All Flows</option>
          </select>
          <label class="filter-checkbox-label" title="Explain underlying Computer Networks concepts for students">
            <input type="checkbox" id="ai-learning-mode" checked> Learning Mode
          </label>
          <button type="button" id="btn-ai-refresh-status" class="ctrl-btn" title="Re-check local LLM runtime">&#8635; Status</button>
          <button type="button" id="btn-ai-clear" class="ctrl-btn" title="Clear conversation for current run">Clear</button>
        </div>
      </div>

      <div id="ai-offline-banner" class="ai-offline-banner hidden"></div>

      <div id="ai-chips-bar" class="ai-chips-bar"></div>

      <div id="ai-messages-container" class="ai-messages-container"></div>

      <div id="ai-loading-indicator" class="ai-loading-indicator hidden">
        <span class="ai-spinner"></span>
        <span id="ai-loading-text">Local LLM is analyzing observed execution evidence...</span>
      </div>

      <form id="ai-input-form" class="ai-input-form">
        <input
          type="text"
          id="ai-question-input"
          class="ai-question-input"
          placeholder="Ask NetBox about this execution, a TCP packet, handshake, or Computer Networks concept..."
          autocomplete="off"
        />
        <button type="submit" id="btn-ai-send" class="ctrl-btn primary">Send</button>
      </form>
    </div>

    <!-- Tab 6: Curriculum Labs (Phase 7) -->
    <div id="tab-pane-labs" class="tab-pane labs-pane hidden">
      <div id="labs-root" class="labs-root">
        <div class="empty-state-box">Loading Computer Networks curriculum labs...</div>
      </div>
    </div>

    <!-- Tab 7: System & LAN Dashboard (Phase 6) -->
    <div id="tab-pane-system" class="tab-pane system-pane hidden">
      <div id="system-dashboard-root" class="system-dashboard-root">
        <div class="empty-state-box">Loading NetBox system and LAN health status...</div>
      </div>
    </div>

    <!-- Interactive Guided Tour Overlay (Phase 8.6B) -->
    <div id="tour-overlay-root" class="tour-overlay-root hidden"></div>
  </div>

  ${scriptsHtml}
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
