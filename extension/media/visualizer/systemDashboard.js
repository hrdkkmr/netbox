/**
 * NetBox Phase 6 — System & LAN Dashboard Module (UMD)
 * Renders honest component-level health (Running / Degraded / Unavailable / Disconnected),
 * LAN IPv4 discovery, offline SVG QR code, pairing token / host target configuration,
 * connected client sessions, and WSL 2 troubleshooting guidance.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.SystemDashboard = factory();
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

  function mapStatusBadge(rawStatus) {
    const s = String(rawStatus || "unknown").toLowerCase();
    if (s === "running" || s === "connected" || s === "ready" || s === "healthy") {
      return { label: "Running", cls: "sys-badge-running" };
    }
    if (s === "degraded") {
      return { label: "Degraded", cls: "sys-badge-degraded" };
    }
    if (s === "disconnected") {
      return { label: "Disconnected", cls: "sys-badge-disconnected" };
    }
    if (s === "disabled") {
      return { label: "Localhost Only", cls: "sys-badge-neutral" };
    }
    return { label: "Unavailable", cls: "sys-badge-unavailable" };
  }

  function sanitizeSvgMarkup(svg) {
    if (!svg || typeof svg !== "string") return "";
    const trimmed = svg.trim();
    if (!trimmed.startsWith("<svg ") || !trimmed.endsWith("</svg>")) return "";
    if (/<script|on\w+=/i.test(trimmed)) return "";
    return trimmed;
  }

  function renderSystemDashboard(state) {
    const connected = Boolean(state && state.connected);
    const health = (state && state.health) || null;
    const info = (state && state.info) || null;
    const network = (state && state.network) || null;
    const connection = (state && state.connection) || null;
    const clientSettings = (state && state.clientSettings) || {};
    const authError = (state && state.authError) || null;
    const isWebBrowser = Boolean(state && state.isWebBrowser);

    const overallBadge = !connected
      ? mapStatusBadge("disconnected")
      : mapStatusBadge(health ? health.overall_status : "unavailable");

    const components = (health && health.components) || {};
    const compKeys = [
      "backend",
      "socket_instrumentation",
      "packet_capture",
      "ollama",
      "ai_model",
      "lan",
    ];

    const componentCardsHtml = compKeys
      .map((key) => {
        const comp = components[key];
        if (!comp) {
          const badge = !connected ? mapStatusBadge("disconnected") : mapStatusBadge("unavailable");
          return `
            <div class="sys-card">
              <div class="sys-card-head">
                <span class="sys-card-title">${escapeHtml(key)}</span>
                <span class="sys-badge ${badge.cls}">${badge.label}</span>
              </div>
              <p class="sys-card-detail">${!connected ? "Host unreachable — waiting for reconnection." : "Status not reported."}</p>
            </div>`;
        }
        const badge = mapStatusBadge(comp.status);
        return `
          <div class="sys-card">
            <div class="sys-card-head">
              <span class="sys-card-title">${escapeHtml(comp.name)}</span>
              <span class="sys-badge ${badge.cls}">${badge.label}</span>
            </div>
            <p class="sys-card-detail">${escapeHtml(comp.detail)}</p>
          </div>`;
      })
      .join("");

    const interfaces = (network && network.interfaces) || [];
    const interfacesHtml = interfaces.length
      ? `<table class="events-table sys-table">
          <thead>
            <tr>
              <th>Adapter</th>
              <th>Layer</th>
              <th>IPv4 Address(es)</th>
              <th>LAN Candidate</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            ${interfaces
              .map(
                (i) => `<tr>
                  <td><strong>${escapeHtml(i.name)}</strong></td>
                  <td><code>${escapeHtml(i.source)}</code></td>
                  <td><code>${escapeHtml((i.ipv4_addresses || []).join(", ") || "—")}</code></td>
                  <td>${i.is_lan_candidate ? '<span class="sys-badge sys-badge-running">Yes</span>' : '<span class="sys-badge sys-badge-neutral">No</span>'}</td>
                  <td>${escapeHtml(i.adapter_hint || (i.is_loopback ? "Loopback" : "Interface"))}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : `<div class="sys-muted">No interface data loaded yet.</div>`;

    const clients = (connection && connection.connected_clients) || [];
    const clientsHtml = clients.length
      ? `<table class="events-table sys-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th>Remote IP</th>
              <th>Scope</th>
              <th>Last Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            ${clients
              .map(
                (c) => `<tr>
                  <td>${escapeHtml(c.label)}</td>
                  <td><code>${escapeHtml(c.client_type)}</code></td>
                  <td><code>${escapeHtml(c.remote_ip)}</code></td>
                  <td>${c.is_host_local ? "Host Local" : "LAN Client"}</td>
                  <td>${escapeHtml(c.last_seen)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : `<div class="sys-muted">No active client sessions recorded yet.</div>`;

    const qrMarkup = sanitizeSvgMarkup(connection && connection.qr_svg);
    const primaryUrl =
      (connection && (connection.lan_url || connection.local_url)) ||
      (network && (network.recommended_lan_url || network.local_url)) ||
      clientSettings.backendUrl ||
      "http://127.0.0.1:8000";

    const troubleshootingList = (network && network.troubleshooting) || [];
    const wslCmdBlock =
      network && network.wsl_portproxy_command
        ? `<div class="sys-wsl-commands">
            <div class="sys-subhead">WSL 2 NAT Host Forwarding Commands (Run manually in Admin PowerShell — never auto-applied)</div>
            <pre class="json-block"><code>${escapeHtml(network.wsl_portproxy_command)}\n${escapeHtml(network.wsl_firewall_command || "")}</code></pre>
          </div>`
        : "";

    const pairingSection = connection
      ? `<div class="sys-pairing-box">
          <div><strong>Access Control:</strong> ${connection.auth_required ? "Token Required for LAN Clients" : "Open (Localhost Mode)"}</div>
          <div><strong>Remote Execution:</strong> ${connection.allow_remote_execution ? "Allowed (Authenticated)" : "Host-Only (Clients Read + AI Only)"}</div>
          ${
            connection.pairing_token
              ? `<div class="sys-token-row"><strong>Host Pairing Token:</strong> <code id="sys-pairing-token-val">${escapeHtml(connection.pairing_token)}</code>
                   <button type="button" class="ctrl-btn" data-sys-action="copy-token">Copy Token</button>
                   <button type="button" class="ctrl-btn" data-sys-action="rotate-token">Rotate Token</button>
                 </div>`
              : connection.pairing_token_preview
              ? `<div><strong>Pairing Token:</strong> <code>${escapeHtml(connection.pairing_token_preview)}</code> (visible only on host localhost)</div>`
              : ""
          }
        </div>`
      : "";

    const disconnectedBanner = !connected
      ? `<div class="sys-alert-banner sys-alert-danger">
          <strong>Host Disconnected:</strong> Cannot reach NetBox Host at <code>${escapeHtml(clientSettings.backendUrl || "http://127.0.0.1:8000")}</code>.
          Verify the host is running (<code>./scripts/start_netbox.sh --lan</code>), both devices share the same Wi-Fi/hotspot, and Windows port forwarding is active.
        </div>`
      : authError
      ? `<div class="sys-alert-banner sys-alert-warn">
          <strong>LAN Authentication Required:</strong> ${escapeHtml(authError)} Enter the Host Pairing Token below and click <em>Save &amp; Reconnect</em>.
        </div>`
      : "";

    return `
      <div class="sys-dashboard">
        <div class="sys-topbar">
          <div class="sys-topbar-left">
            <h3>NetBox Host &amp; LAN System Overview</h3>
            <span class="sys-badge ${overallBadge.cls}">${overallBadge.label}</span>
            ${info ? `<span class="run-id-pill">v${escapeHtml(info.version)} &middot; Mode: ${escapeHtml(info.mode.toUpperCase())}</span>` : ""}
            ${info ? `<span class="run-id-pill">Runs: ${info.total_runs} (Active: ${info.active_runs})</span>` : ""}
            <span class="run-id-pill">Offline Ready &middot; Host-Local AI</span>
          </div>
          <div class="sys-topbar-right">
            <button type="button" class="ctrl-btn primary" data-sys-action="refresh">&#8635; Refresh Status</button>
          </div>
        </div>

        ${disconnectedBanner}

        <section class="sys-section">
          <div class="sys-section-title">Component Health (Independent Diagnostics)</div>
          <div class="sys-cards-grid">${componentCardsHtml}</div>
        </section>

        <div class="sys-two-col">
          <section class="sys-section">
            <div class="sys-section-title">LAN Sharing &amp; Client Pairing</div>
            <div class="sys-connect-layout">
              <div class="sys-connect-details">
                <div class="sys-kv"><span>Host Machine:</span> <code>${escapeHtml((info && info.hostname) || "—")} (${escapeHtml((info && info.wsl_network_mode) || "unknown")})</code></div>
                <div class="sys-kv"><span>Local URL:</span> <code>${escapeHtml((network && network.local_url) || "http://127.0.0.1:8000")}</code></div>
                <div class="sys-kv">
                  <span>LAN Client URL:</span>
                  <code id="sys-lan-url-val">${escapeHtml(primaryUrl)}</code>
                  <button type="button" class="ctrl-btn" data-sys-action="copy-url">Copy URL</button>
                </div>
                <div class="sys-kv"><span>AI Inference:</span> <strong>Host Local Ollama Only</strong> (Client needs no local LLM)</div>
                ${pairingSection}
              </div>
              ${
                qrMarkup
                  ? `<div class="sys-qr-box" title="Scan on a LAN device to open NetBox">${qrMarkup}<div class="sys-qr-caption">Offline LAN QR</div></div>`
                  : ""
              }
            </div>
          </section>

          <section class="sys-section">
            <div class="sys-section-title">${isWebBrowser ? "Client Connection Settings (This Browser)" : "Client Connection Settings"}</div>
            <form id="sys-client-config-form" class="sys-config-form">
              <label class="sys-field">
                <span>NetBox Host URL (update if host IP changes)</span>
                <input type="text" id="sys-input-host-url" value="${escapeHtml(clientSettings.backendUrl || primaryUrl)}" placeholder="http://192.168.137.1:8000" />
              </label>
              <label class="sys-field">
                <span>LAN Pairing / Access Token (optional on host localhost)</span>
                <input type="password" id="sys-input-token" value="${escapeHtml(clientSettings.accessToken || "")}" placeholder="nbx-xxxxxxxx" />
              </label>
              <div class="sys-form-actions">
                <button type="submit" class="ctrl-btn primary">Save &amp; Reconnect</button>
                <button type="button" class="ctrl-btn" data-sys-action="clear-token">Clear Token</button>
              </div>
              <div class="sys-muted">Connection health checks run automatically every ${Math.round(((connection && connection.health_check_interval_ms) || 10000) / 1000)}s and recover when the host comes back online.</div>
            </form>
          </section>
        </div>

        <section class="sys-section">
          <div class="sys-section-title">Discovered Host &amp; WSL 2 Network Interfaces</div>
          ${interfacesHtml}
          ${wslCmdBlock}
          ${
            troubleshootingList.length
              ? `<ul class="sys-notes-list">${troubleshootingList.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
              : ""
          }
        </section>

        <section class="sys-section">
          <div class="sys-section-title">Active Connected Clients (${clients.length})</div>
          ${clientsHtml}
        </section>
      </div>
    `;
  }

  return {
    escapeHtml,
    mapStatusBadge,
    sanitizeSvgMarkup,
    renderSystemDashboard,
  };
});
