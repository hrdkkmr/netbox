"""
Serves the unified NetBox Web Interface directly from FastAPI so LAN clients
(Device B browsers) need zero local software, zero Node.js, and zero Internet access.
"""

from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, HTMLResponse

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MEDIA_DIR = (REPO_ROOT / "extension" / "media").resolve()

router = APIRouter(tags=["web-ui"])

VISUALIZER_SCRIPTS = [
    "visualizer/eventStore.js",
    "visualizer/timingEngine.js",
    "visualizer/socketStateEngine.js",
    "visualizer/eventFilter.js",
    "visualizer/sequenceMapper.js",
    "visualizer/eventInspector.js",
    "visualizer/playbackEngine.js",
    "visualizer/renderers.js",
    "visualizer/packetView.js",
    "visualizer/aiAssistant.js",
    "visualizer/systemDashboard.js",
    "visualizer/labsView.js",
    "visualizer/guidedTour.js",
    "visualizer.js",
]

ALLOWED_EXTENSIONS = {".js", ".css", ".svg", ".png", ".json"}


def build_web_visualizer_html() -> str:
    scripts_tags = "\n  ".join(
        f'<script src="/media/{script}"></script>'
        for script in VISUALIZER_SCRIPTS
        if (MEDIA_DIR / script).is_file()
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/visualizer.css">
  <title>NetBox — Computer Networks Platform</title>
</head>
<body class="netbox-web-mode">
  <div class="visualizer-container">
    <!-- A. Top Toolbar -->
    <header class="vis-header">
      <div class="vis-title-group">
        <h2>NetBox Networking Platform</h2>
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

    <!-- Error / Offline Notification Banner -->
    <div id="vis-error-banner" class="vis-error-banner hidden" role="alert">
      <span id="vis-error-text"></span>
      <button id="vis-error-close" class="vis-error-close" title="Dismiss">&times;</button>
    </div>

    <!-- Compact Timing & Performance Summary -->
    <div id="metrics-summary-bar" class="metrics-summary-bar"></div>

    <!-- Navigation Tabs -->
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

    <!-- Tab 1: Overview & Socket API -->
    <div id="tab-pane-socket" class="vis-layout tab-pane">
      <div class="vis-main-column">
        <section class="topology-panel">
          <div class="section-title">
            <h3>Network Topology &amp; Socket Lifecycle</h3>
            <span id="lifecycle-state" class="state-pill state-closed">READY</span>
          </div>
          <div id="topology-container"></div>
        </section>

        <div id="lower-split-container" class="lower-split-container" data-view-mode="split">
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
                    <th title="Compare interval">&Delta;</th>
                  </tr>
                </thead>
                <tbody id="events-tbody"></tbody>
              </table>
            </div>
          </section>

          <section class="sequence-panel">
            <div class="section-title">
              <h3>TCP API Sequence Diagram</h3>
              <span class="timeline-counter">API-Level Only</span>
            </div>
            <div id="sequence-container" class="sequence-container"></div>
          </section>
        </div>
      </div>

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

    <!-- Tab 2: Captured Packets -->
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

    <!-- Tab 3: TCP Flows -->
    <div id="tab-pane-flows" class="tab-pane single-pane hidden">
      <div class="section-title">
        <h3>TCP Flows (Bidirectional 4-Tuple Analysis)</h3>
        <span class="timeline-counter" id="flows-counter">0 flows</span>
      </div>
      <div id="flows-container" class="flows-scroll"></div>
    </div>

    <!-- Tab 4: Correlations & Dual-Layer -->
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

    <!-- Tab 5: Grounded Local AI Assistant -->
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

  <script>
    window.NETBOX_BACKEND_URL = window.location.origin;
  </script>
  {scripts_tags}
</body>
</html>
"""


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def serve_web_visualizer() -> HTMLResponse:
    """Serves the standalone offline NetBox Visualizer web app for LAN & local browsers."""
    return HTMLResponse(content=build_web_visualizer_html())


@router.get("/media/{file_path:path}", include_in_schema=False)
def serve_media_asset(file_path: str):
    """Serves static JS/CSS/SVG visualizer assets strictly inside extension/media/."""
    candidate = (MEDIA_DIR / file_path).resolve()
    try:
        candidate.relative_to(MEDIA_DIR)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid media asset path.")

    if not candidate.is_file() or candidate.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found.")

    return FileResponse(path=str(candidate))
