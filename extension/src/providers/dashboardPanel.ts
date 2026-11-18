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
      "NetBox Welcome & Setup",
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

    this._panel.title = "NetBox Welcome & Setup";
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
    const readiness = await this._backendService.getComponentReadiness();
    this._panel.webview.postMessage({
      type: "readinessReport",
      payload: readiness,
    });
  }

  private async _handleMessage(message: WebviewToExtensionMessage) {
    switch (message.type) {
      case "checkBackend":
        await this._fetchAndPushStatus();
        break;

      case "openVisualizer":
        vscode.commands.executeCommand("netbox.openVisualizer", message.payload?.runId);
        break;

      case "startGuidedTour":
        vscode.commands.executeCommand("netbox.startGuidedTour");
        break;

      case "startPresentationMode":
        vscode.commands.executeCommand("netbox.startPresentationMode");
        break;

      case "configureBackend":
        await vscode.commands.executeCommand("netbox.configureBackend");
        await this._fetchAndPushStatus();
        break;

      case "openDocs": {
        const target =
          message.payload?.url || "https://github.com/hrdkkmr/netbox#readme";
        vscode.env.openExternal(vscode.Uri.parse(target));
        break;
      }

      case "executeLiveRun":
        try {
          const runRes = await this._backendService.createRun("tcp-echo");
          vscode.window.showInformationMessage(
            `Executed live TCP run ${runRes.run_id} (${runRes.event_count} socket events, ${runRes.packet_count ?? 0} packets).`
          );
          vscode.commands.executeCommand("netbox.openVisualizer", runRes.run_id);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Execution failed: ${err?.message}`);
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
  <title>NetBox Welcome &amp; Setup</title>
</head>
<body>
  <div class="dashboard-container">
    <header class="dashboard-header">
      <div class="brand">
        <div class="logo-box">NB</div>
        <div class="title-group">
          <h1>NetBox</h1>
          <span class="subtitle">Hands-On Computer Networks Laboratory &amp; Evidence-Grounded Local AI Tutor</span>
        </div>
      </div>
      <div class="header-status">
        <div id="backend-status-badge" class="status-badge connecting">
          <span class="status-dot"></span>
          <span class="status-label">Checking Components...</span>
        </div>
        <div class="phase-badge">v0.8.0</div>
      </div>
    </header>

    <main class="dashboard-grid">
      <!-- Welcome & Philosophy -->
      <section class="card overview-card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <h2>Welcome to NetBox</h2>
          <span class="card-tag">Real Experiments &middot; Real Telemetry &middot; Local AI</span>
        </div>
        <div class="card-body">
          <p class="description-text">
            NetBox helps students learn Computer Networks by running <strong>real networking experiments</strong>
            (TCP, UDP, DNS, HTTP, ARP, IP/Subnetting, Routing, Monitoring), observing actual OS socket API calls
            (<code>LD_PRELOAD</code>) and wire-level packets (<code>libpcap</code>), visualizing flows interactively,
            and asking a <strong>host-local AI tutor (Ollama)</strong> whose answers cite verified captured evidence.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;">
            <button id="btn-open-visualizer" class="btn btn-primary">&#9658; Get Started (Open Workspace)</button>
            <button id="btn-start-tour" class="btn btn-secondary">&#128214; Start 10-Step Guided Tour</button>
            <button id="btn-configure-backend" class="btn btn-secondary">&#9881; Connect to NetBox Backend</button>
            <button id="btn-presentation-mode" class="btn btn-secondary">&#127916; Presentation / Demo Mode</button>
            <button id="btn-view-docs" class="btn btn-secondary">&#128196; View Documentation</button>
          </div>
        </div>
      </section>

      <!-- Honest 7-Component Readiness Matrix -->
      <section class="card backend-card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <h2>Component Readiness (Honest Live Diagnostics)</h2>
          <button id="btn-recheck-backend" class="btn-sm" title="Re-verify backend and components">&#8635; Refresh Status</button>
        </div>
        <div class="card-body">
          <div id="readiness-summary-banner" class="backend-helper hidden"></div>
          <div class="backend-details" id="readiness-matrix">
            <div class="detail-row"><span class="label">1. VS Code Extension</span><span id="comp-ext" class="val-text">Installed (v0.8.0)</span></div>
            <div class="detail-row"><span class="label">2. Backend URL Configured</span><code id="comp-url">http://127.0.0.1:8000</code></div>
            <div class="detail-row"><span class="label">3. Backend Reachable</span><span id="comp-reach" class="val-text">Checking...</span></div>
            <div class="detail-row"><span class="label">4. Authentication (SecretStorage)</span><span id="comp-auth" class="val-text">Checking...</span></div>
            <div class="detail-row"><span class="label">5. Socket Instrumentation (LD_PRELOAD)</span><span id="comp-sock" class="val-text">Checking...</span></div>
            <div class="detail-row"><span class="label">6. Packet Capture (libpcap)</span><span id="comp-pcap" class="val-text">Checking...</span></div>
            <div class="detail-row"><span class="label">7. Host Local AI (Ollama + Model)</span><span id="comp-ai" class="val-text">Checking...</span></div>
          </div>
        </div>
      </section>

      <!-- Local & LAN Backend Setup Guide -->
      <section class="card">
        <div class="card-header">
          <h2>Option A: Run Local Backend</h2>
          <span class="card-tag">Linux / WSL 2</span>
        </div>
        <div class="card-body">
          <p class="description-text">
            The VS Code extension connects to the NetBox FastAPI backend, which executes networking labs,
            captures packets, and calls local Ollama.
          </p>
          <div class="example-commands" style="margin-top:8px;">
            <code>git clone https://github.com/hrdkkmr/netbox.git &amp;&amp; cd netbox</code><br/>
            <code>make all &amp;&amp; ./scripts/setup_backend.sh</code><br/>
            <code>./scripts/start_netbox.sh</code>
          </div>
          <p class="info-note" style="margin-top:8px;">
            For local AI tutoring, install Ollama on the host and pull a small local model (e.g., <code>ollama pull qwen2.5-coder:1.5b</code>).
            Ollama stays strictly on <code>127.0.0.1:11434</code>.
          </p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Option B: Connect to a LAN Host</h2>
          <span class="card-tag">Classroom / Hotspot</span>
        </div>
        <div class="card-body">
          <p class="description-text">
            Connecting to an instructor or teammate running NetBox on the same Wi-Fi/hotspot?
            You do <strong>not</strong> need Ollama or the backend installed locally.
          </p>
          <ol style="margin:8px 0 8px 18px;font-size:12.5px;line-height:1.6;">
            <li>Click <strong>Connect to NetBox Backend</strong> above.</li>
            <li>Enter the host URL (e.g. <code>http://192.168.137.1:8000</code>).</li>
            <li>Enter the host's pairing token (stored securely in VS Code SecretStorage).</li>
          </ol>
          <p class="info-note">
            All AI inference stays on the host computer—no cloud API or Internet connection is required.
          </p>
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
