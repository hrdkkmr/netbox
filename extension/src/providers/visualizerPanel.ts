import * as vscode from "vscode";
import { BackendService } from "../services/backendService";
import { WebviewToExtensionMessage } from "../services/types";

export class VisualizerPanel {
  public static currentPanel: VisualizerPanel | undefined;
  public static readonly viewType = "netboxVisualizer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private readonly _backendService: BackendService;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (VisualizerPanel.currentPanel) {
      VisualizerPanel.currentPanel._panel.reveal(column);
      VisualizerPanel.currentPanel.loadDemoEvents();
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

    VisualizerPanel.currentPanel = new VisualizerPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._backendService = BackendService.getInstance();

    this._panel.title = "NetBox Visualizer";
    this._panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "netbox-icon.svg");

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );
  }

  public async loadDemoEvents() {
    try {
      const demoData = await this._backendService.getTcpDemo();
      this._panel.webview.postMessage({
        type: "eventsLoaded",
        payload: {
          runId: demoData.demo_id,
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
      if (!targetRunId) {
        const runs = await this._backendService.listRuns();
        if (runs && runs.length > 0) {
          targetRunId = runs[0].run_id;
        } else {
          // If no runs exist, trigger a live execution first!
          const newRun = await this._backendService.createRun("tcp-echo");
          targetRunId = newRun.run_id;
        }
      }

      const eventsData = await this._backendService.getRunEvents(targetRunId);
      this._panel.webview.postMessage({
        type: "eventsLoaded",
        payload: {
          runId: eventsData.run_id,
          isSimulated: eventsData.is_simulated,
          label: eventsData.simulation_label,
          events: eventsData.events,
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
        `Run '${runRes.run_id}' finished with status '${runRes.status}' (${runRes.event_count} events). Loading visualizer...`
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
        await this.executeLiveRun(message.payload?.exampleId || "tcp-echo", message.payload?.clientArgs);
        break;

      case "listRuns":
        try {
          const runs = await this._backendService.listRuns();
          this._panel.webview.postMessage({
            type: "runsList",
            payload: runs,
          });
        } catch (err: any) {
          // ignore
        }
        break;

      case "checkBackend":
        const status = await this._backendService.checkHealth();
        this._panel.webview.postMessage({
          type: "backendStatus",
          payload: status,
        });
        break;
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

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    setTimeout(() => {
      this.loadDemoEvents();
    }, 200);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "visualizer.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "visualizer.css")
    );
    const nonce = getNonce();

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
    <!-- Header Banner -->
    <header class="vis-header">
      <div class="vis-title-group">
        <h2>NetBox Execution Visualizer</h2>
        <span class="badge simulated-badge" id="data-mode-badge">SIMULATED DATA (Schema v1.0)</span>
        <span class="run-id-pill" id="run-id-badge">Run: sim_tcp_demo_001</span>
      </div>
      <div class="vis-controls-bar">
        <button id="btn-run-live" class="ctrl-btn live-btn" title="Execute real C program under LD_PRELOAD">&#9658; Run Live TCP</button>
        <button id="btn-load-demo" class="ctrl-btn" title="Load simulated demo events">&#9881; Demo</button>
        <div class="divider-v"></div>
        <button id="btn-restart" class="ctrl-btn" title="Restart to start">&#9630; Reset</button>
        <button id="btn-prev" class="ctrl-btn" title="Previous event">&#9664; Prev</button>
        <button id="btn-play-pause" class="ctrl-btn primary" title="Play / Pause">&#9658; Play</button>
        <button id="btn-next" class="ctrl-btn" title="Next event">Next &#9654;</button>
        <div class="speed-selector">
          <label for="speed-select">Speed:</label>
          <select id="speed-select">
            <option value="2000">0.5x</option>
            <option value="1000" selected>1.0x</option>
            <option value="500">2.0x</option>
          </select>
        </div>
      </div>
    </header>

    <div class="vis-layout">
      <!-- Left Column: Topology & Timeline -->
      <div class="vis-main-column">
        <!-- Topology Section -->
        <section class="topology-panel">
          <div class="section-title">
            <h3>Network Topology</h3>
            <span id="lifecycle-state" class="state-pill state-closed">CLOSED</span>
          </div>

          <div class="topology-diagram">
            <!-- Client Node -->
            <div class="node-box" id="node-client">
              <div class="node-header">
                <span class="node-role">Client</span>
                <span class="node-pid" id="client-pid">PID: 2102</span>
              </div>
              <div class="node-body">
                <div class="node-metric">
                  <span class="metric-label">Local:</span>
                  <span class="metric-val" id="client-endpoint">127.0.0.1:54071</span>
                </div>
                <div class="node-metric">
                  <span class="metric-label">FD:</span>
                  <span class="metric-val" id="client-fd">3</span>
                </div>
                <div class="node-metric">
                  <span class="metric-label">State:</span>
                  <span class="metric-val" id="client-state">IDLE</span>
                </div>
              </div>
            </div>

            <!-- Connection Channel -->
            <div class="connection-channel" id="conn-channel">
              <div class="channel-line"></div>
              <div class="packet-flight" id="packet-anim">
                <span class="packet-arrow" id="packet-arrow">&#8594;</span>
                <span class="packet-label" id="packet-label">DATA</span>
              </div>
              <div class="channel-status" id="channel-status">No active connection</div>
            </div>

            <!-- Server Node -->
            <div class="node-box" id="node-server">
              <div class="node-header">
                <span class="node-role">Server</span>
                <span class="node-pid" id="server-pid">PID: 2101</span>
              </div>
              <div class="node-body">
                <div class="node-metric">
                  <span class="metric-label">Listen:</span>
                  <span class="metric-val" id="server-endpoint">127.0.0.1:8080</span>
                </div>
                <div class="node-metric">
                  <span class="metric-label">FD:</span>
                  <span class="metric-val" id="server-fd">3</span>
                </div>
                <div class="node-metric">
                  <span class="metric-label">State:</span>
                  <span class="metric-val" id="server-state">IDLE</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Chronological Timeline Section -->
        <section class="timeline-panel">
          <div class="section-title">
            <h3>Event Timeline (docs/event_schema.md)</h3>
            <span class="timeline-counter" id="timeline-counter">Event 0 of 0</span>
          </div>
          <div class="timeline-scroll-container">
            <table class="events-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Source</th>
                  <th>Process</th>
                  <th>Event Type</th>
                  <th>Endpoint / Target</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody id="events-tbody">
                <!-- Injected via JavaScript -->
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- Right Column: Structured Event Inspector -->
      <aside class="vis-inspector-column">
        <div class="section-title">
          <h3>Structured Event Inspector</h3>
          <span class="inspector-badge" id="inspector-seq">Seq: -</span>
        </div>
        <div class="inspector-content">
          <div class="inspector-summary-card">
            <div class="summary-row">
              <span class="s-label">Event:</span>
              <span class="s-val" id="insp-event-type">&mdash;</span>
            </div>
            <div class="summary-row">
              <span class="s-label">Process:</span>
              <span class="s-val" id="insp-process">&mdash;</span>
            </div>
            <div class="summary-row">
              <span class="s-label">Result:</span>
              <span class="s-val" id="insp-result">&mdash;</span>
            </div>
            <div class="summary-row">
              <span class="s-label">Error Code:</span>
              <span class="s-val" id="insp-error">null</span>
            </div>
          </div>

          <div class="json-section">
            <div class="json-header">
              <span>Event JSON (v1.0)</span>
            </div>
            <pre class="json-block"><code id="insp-json-raw">// Click any event on the timeline to inspect raw schema fields</code></pre>
          </div>

          <div class="schema-legend">
            <h4>Layer Separation Note</h4>
            <p>
              This trace represents <code>source: "socket_api"</code> events.
              Wire-level packets (TCP SYN, ACK, FIN) belong to <code>source: "packet_capture"</code> (Phase 4).
            </p>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
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
