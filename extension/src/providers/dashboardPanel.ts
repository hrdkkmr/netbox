import * as vscode from "vscode";
import { BackendService } from "../services/backendService";
import { WebviewToExtensionMessage } from "../services/types";

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  public static readonly viewType = "netboxDashboard";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private readonly _backendService: BackendService;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      DashboardPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "NetBox Dashboard",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._backendService = BackendService.getInstance();

    this._panel.title = "NetBox Dashboard";
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

  public async refresh() {
    await this._fetchAndPushStatus();
  }

  private async _fetchAndPushStatus() {
    const status = await this._backendService.checkHealth();
    this._panel.webview.postMessage({
      type: "backendStatus",
      payload: status,
    });

    if (status.connected) {
      try {
        const project = await this._backendService.getProjectInfo();
        this._panel.webview.postMessage({
          type: "projectInfo",
          payload: project,
        });

        const examples = await this._backendService.getExamples();
        this._panel.webview.postMessage({
          type: "examplesList",
          payload: examples,
        });
      } catch (err: any) {
        this._panel.webview.postMessage({
          type: "errorMessage",
          payload: { message: `Failed to load metadata: ${err?.message}` },
        });
      }
    }
  }

  private async _handleMessage(message: WebviewToExtensionMessage) {
    switch (message.type) {
      case "checkBackend":
        await this._fetchAndPushStatus();
        break;

      case "getProject":
        try {
          const project = await this._backendService.getProjectInfo();
          this._panel.webview.postMessage({
            type: "projectInfo",
            payload: project,
          });
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `Could not reach NetBox backend at ${this._backendService.getBackendUrl()}. Is the backend running?`
          );
        }
        break;

      case "getExamples":
        try {
          const examples = await this._backendService.getExamples();
          this._panel.webview.postMessage({
            type: "examplesList",
            payload: examples,
          });
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `Could not fetch examples from backend: ${err?.message}`
          );
        }
        break;

      case "openVisualizer":
        vscode.commands.executeCommand("netbox.openVisualizer");
        break;

      case "executeLiveRun":
        try {
          const runRes = await this._backendService.createRun("tcp-echo");
          vscode.window.showInformationMessage(`Executed run ${runRes.run_id} (${runRes.event_count} events).`);
          vscode.commands.executeCommand("netbox.openVisualizer");
        } catch (err: any) {
          vscode.window.showErrorMessage(`Execution failed: ${err?.message}`);
        }
        break;

      case "openFile":
        if (message.payload?.filePath) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            const rootUri = workspaceFolders[0].uri;
            const targetUri = vscode.Uri.joinPath(rootUri, message.payload.filePath);
            try {
              const doc = await vscode.workspace.openTextDocument(targetUri);
              await vscode.window.showTextDocument(doc);
            } catch (err) {
              vscode.window.showErrorMessage(`Unable to open file: ${message.payload.filePath}`);
            }
          }
        }
        break;
    }
  }

  public dispose() {
    DashboardPanel.currentPanel = undefined;
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
    // Push initial status shortly after Webview DOM initializes
    setTimeout(() => {
      this._fetchAndPushStatus();
    }, 200);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "dashboard.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "dashboard.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesUri}">
  <title>NetBox Dashboard</title>
</head>
<body>
  <div class="dashboard-container">
    <header class="dashboard-header">
      <div class="brand">
        <div class="logo-box">NB</div>
        <div class="title-group">
          <h1>NetBox</h1>
          <span class="subtitle">Computer Networks Assistant</span>
        </div>
      </div>
      <div class="header-status">
        <div id="backend-status-badge" class="status-badge connecting">
          <span class="status-dot"></span>
          <span class="status-label">Checking Backend...</span>
        </div>
        <div class="phase-badge">Phase 1: Extension Foundation</div>
      </div>
    </header>

    <main class="dashboard-grid">
      <!-- Section A: Project Overview -->
      <section class="card overview-card">
        <div class="card-header">
          <h2>Project Overview</h2>
          <span class="card-tag">Phase 1</span>
        </div>
        <div class="card-body">
          <p class="description-text" id="project-description">
            NetBox pairs a local offline networking environment with a VS Code assistant that executes networking code,
            records actual socket and packet events, visualizes what occurred, and provides grounded course-aware explanations.
          </p>
          <div class="stats-row">
            <div class="stat-item">
              <span class="stat-label">Current Phase</span>
              <span class="stat-value" id="current-phase-val">Phase 1</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Supported Languages</span>
              <span class="stat-value">C (POSIX), Python</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Verified Baseline</span>
              <span class="stat-value">TCP Sockets (Phase 0)</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section B: Networking Examples -->
      <section class="card examples-card">
        <div class="card-header">
          <h2>Networking Examples</h2>
          <span class="card-count" id="examples-count">1 available</span>
        </div>
        <div class="card-body">
          <div class="example-item selected">
            <div class="example-header">
              <span class="example-badge tcp">TCP</span>
              <h3>POSIX TCP Echo Client &amp; Server</h3>
            </div>
            <p class="example-desc">
              Standard POSIX sockets on loopback (127.0.0.1:8080). Handles sequential client connections,
              stream echo verification, and clean socket closure.
            </p>
            <div class="example-files">
              <span class="file-chip" id="open-server-file" title="Click to view file">examples/tcp/server.c</span>
              <span class="file-chip" id="open-client-file" title="Click to view file">examples/tcp/client.c</span>
              <span class="file-chip" id="open-readme-file" title="Click to view file">examples/tcp/README.md</span>
            </div>
            <div class="example-commands">
              <code>make all &amp;&amp; ./examples/tcp/server</code>
            </div>
          </div>
        </div>
      </section>

      <!-- Section C: Execution -->
      <section class="card execution-card">
        <div class="card-header">
          <h2>Execution &amp; Demonstration</h2>
          <span class="card-tag simulated">Simulated in Phase 1</span>
        </div>
        <div class="card-body">
          <p class="info-note">
            In Phase 1, execution demonstrates the planned telemetry flow using verified simulated events.
            Live compilation and LD_PRELOAD socket instrumentation will be active in Phase 2.
          </p>
          <div class="execution-actions">
            <button id="btn-run-demo" class="btn btn-primary">
              <span class="btn-icon">&#9658;</span> Run Phase 1 Demo Flow
            </button>
            <div id="demo-status" class="execution-status-box idle">
              <span class="status-indicator"></span>
              <span id="demo-status-text">Ready to run demonstration</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section D: Visualizer Access -->
      <section class="card visualizer-card">
        <div class="card-header">
          <h2>Visualizer</h2>
          <span class="card-tag">Webview</span>
        </div>
        <div class="card-body">
          <p class="description-text">
            Inspect network topology, socket lifecycles, and chronological event timelines.
            Currently visualizes the 12-event simulated TCP connection sequence from docs/event_schema.md.
          </p>
          <div class="visualizer-status-badge simulated">
            <span>Data Mode: SIMULATED (docs/event_schema.md v1.0)</span>
          </div>
          <button id="btn-open-visualizer" class="btn btn-secondary">
            Open Visualizer Panel &rarr;
          </button>
        </div>
      </section>

      <!-- Section E: Backend Status -->
      <section class="card backend-card">
        <div class="card-header">
          <h2>Backend Service</h2>
          <button id="btn-recheck-backend" class="btn-sm" title="Recheck backend">Refresh</button>
        </div>
        <div class="card-body">
          <div class="backend-details">
            <div class="detail-row">
              <span class="label">Backend URL:</span>
              <code id="backend-url-val">http://127.0.0.1:8000</code>
            </div>
            <div class="detail-row">
              <span class="label">Connection:</span>
              <span id="backend-conn-status" class="val-text">Checking...</span>
            </div>
            <div class="detail-row">
              <span class="label">Service Name:</span>
              <span id="backend-service-val" class="val-text">&mdash;</span>
            </div>
            <div class="detail-row">
              <span class="label">API Version:</span>
              <span id="backend-version-val" class="val-text">&mdash;</span>
            </div>
          </div>
          <div id="backend-instructions" class="backend-helper hidden">
            <p><strong>Backend not detected?</strong> Start it via:</p>
            <code>./scripts/run_backend.sh</code>
          </div>
        </div>
      </section>
    </main>
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
