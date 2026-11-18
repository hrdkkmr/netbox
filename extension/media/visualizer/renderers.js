/**
 * NetBox Phase 3 Visualizer — DOM Renderers
 * Renders Topology, Chronological Event Timeline, API-Level Sequence Diagram,
 * Timing/Metrics Summary, and Detailed Event Inspector strictly from derived
 * models and observed event data.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.Renderers = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NA = "Not available";

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

  function stateCssClass(state) {
    const s = String(state || "UNKNOWN").toUpperCase();
    switch (s) {
      case "CREATED":
        return "sock-state-created";
      case "BOUND":
        return "sock-state-bound";
      case "LISTENING":
        return "sock-state-listening";
      case "CONNECTING":
        return "sock-state-connecting";
      case "CONNECTED":
        return "sock-state-connected";
      case "CLOSING":
        return "sock-state-closing";
      case "CLOSED":
        return "sock-state-closed";
      case "CONNECTION_FAILED":
      case "ERROR":
        return "sock-state-error";
      default:
        return "sock-state-unknown";
    }
  }

  function eventCategoryMeta(ev) {
    const type = (ev && ev.event_type) || "unknown";
    const isErr = Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
    if (isErr) {
      return { icon: "&#9888;", cssClass: "badge-error", label: type };
    }
    switch (type) {
      case "socket":
        return { icon: "&#10010;", cssClass: "badge-socket", label: "socket" };
      case "bind":
        return { icon: "&#9875;", cssClass: "badge-bind", label: "bind" };
      case "listen":
        return { icon: "&#9673;", cssClass: "badge-listen", label: "listen" };
      case "connect":
        return { icon: "&#8644;", cssClass: "badge-connect", label: "connect" };
      case "accept":
      case "accept4":
        return { icon: "&#10003;", cssClass: "badge-accept", label: type };
      case "send":
      case "sendto":
        return { icon: "&#8599;", cssClass: "badge-send", label: type };
      case "recv":
      case "recvfrom":
        return { icon: "&#8601;", cssClass: "badge-recv", label: type };
      case "shutdown":
        return { icon: "&#9209;", cssClass: "badge-shutdown", label: "shutdown" };
      case "close":
        return { icon: "&#10005;", cssClass: "badge-close", label: "close" };
      default:
        return { icon: "?", cssClass: "badge-unknown", label: type };
    }
  }

  function renderSocketCard(sock, activeSocketKey, activeEvent) {
    const isActive = sock.key === activeSocketKey;
    const isError = sock.state === "ERROR" || sock.state === "CONNECTION_FAILED" || (isActive && activeEvent && activeEvent.isError);
    const animClass =
      isActive && activeEvent
        ? `anim-${activeEvent.eventType}${activeEvent.isError ? " anim-error" : ""}`
        : "";

    let roleLabel = "Socket";
    if (sock.role === "server_listener") {
      roleLabel = "Listening Socket";
    } else if (sock.role === "server_accepted") {
      roleLabel = "Accepted Connection Socket";
    } else if (sock.role === "client") {
      roleLabel = "Client Socket";
    }

    const localStr =
      sock.localIp || sock.localPort !== null
        ? `${sock.localIp || "*"}:${sock.localPort !== null ? sock.localPort : "*"}`
        : NA;
    const remoteStr =
      sock.remoteIp || sock.remotePort !== null
        ? `${sock.remoteIp || "*"}:${sock.remotePort !== null ? sock.remotePort : "*"}`
        : NA;

    const errorRow = sock.lastError
      ? `<div class="sock-error-banner">${escapeHtml(sock.lastError.name)}: ${escapeHtml(sock.lastError.message)}</div>`
      : "";

    return `
      <div class="socket-card ${isActive ? "socket-active" : ""} ${isError ? "socket-error" : ""} ${animClass}" data-socket-key="${escapeHtml(sock.key)}">
        <div class="socket-card-header">
          <span class="socket-role-title">${escapeHtml(roleLabel)} <code class="fd-chip">fd=${sock.fd !== null ? escapeHtml(sock.fd) : "?"}</code></span>
          <span class="sock-state-badge ${stateCssClass(sock.state)}" title="Visualizer API-derived state: ${escapeHtml(sock.stateReason)}">${escapeHtml(sock.state)}</span>
        </div>
        <div class="socket-card-meta">
          <div class="meta-pair"><span>Local:</span><code>${escapeHtml(localStr)}</code></div>
          ${sock.role !== "server_listener" ? `<div class="meta-pair"><span>Remote:</span><code>${escapeHtml(remoteStr)}</code></div>` : ""}
          ${sock.domain || sock.type ? `<div class="meta-pair"><span>Proto:</span><code>${escapeHtml(sock.domain || "?")} / ${escapeHtml(sock.type || "?")}</code></div>` : ""}
          ${sock.bytesSent > 0 || sock.bytesReceived > 0 ? `<div class="meta-pair"><span>API I/O:</span><code>TX ${sock.bytesSent}B / RX ${sock.bytesReceived}B</code></div>` : ""}
        </div>
        ${errorRow}
      </div>
    `;
  }

  /**
   * Renders the interactive Network Topology panel completely dynamically from
   * SocketStateEngine's snapshot.
   */
  function renderTopology(container, snapshot) {
    if (!container) {
      return;
    }

    if (!snapshot || snapshot.currentIndex < 0) {
      container.innerHTML = `
        <div class="topology-empty">
          <p>Press <strong>Play</strong>, <strong>Next</strong>, or click any event in the timeline to trace socket creation, connection establishment, and data transfer.</p>
          <p class="topology-empty-sub">All PIDs, file descriptors, endpoints, and socket states are derived dynamically from observed events.</p>
        </div>
      `;
      return;
    }

    const { clients, servers, otherProcesses, links, activeEvent } = snapshot.topology;
    const activeKey = activeEvent ? activeEvent.affectedSocketKey : null;

    // Client Column
    let clientHtml = "";
    if (clients.length === 0) {
      clientHtml = `
        <div class="proc-box proc-placeholder">
          <div class="proc-header">
            <span class="proc-name">Client Process</span>
            <span class="proc-pid">Not observed yet</span>
          </div>
          <div class="proc-body-empty">Waiting for client socket API events...</div>
        </div>
      `;
    } else {
      clientHtml = clients
        .map((proc) => {
          const isActiveProc = activeEvent && activeEvent.pid === proc.pid;
          const procError = isActiveProc && activeEvent.isError;
          return `
            <div class="proc-box ${isActiveProc ? "proc-active" : ""} ${procError ? "proc-error" : ""}">
              <div class="proc-header">
                <span class="proc-name">&#128187; ${escapeHtml(proc.name)}</span>
                <span class="proc-pid">PID: ${escapeHtml(proc.pid)}</span>
              </div>
              <div class="proc-sockets">
                ${proc.allSockets.map((s) => renderSocketCard(s, activeKey, activeEvent)).join("")}
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Center Link Column
    let channelClass = "topology-link-column";
    let statusText = "No connection link observed yet";
    let animBadgeHtml = "";

    const primaryLink = links.length > 0 ? links[links.length - 1] : null;
    if (primaryLink) {
      if (primaryLink.status === "active") {
        channelClass += " link-active";
        statusText = `Linked: ${primaryLink.clientEndpoint} ↔ ${primaryLink.serverEndpoint}`;
      } else if (primaryLink.status === "failed" || primaryLink.status === "error") {
        channelClass += " link-error";
        statusText = `Connection Error: ${primaryLink.error ? primaryLink.error.name : "FAILED"}`;
      } else if (primaryLink.status === "half-closed") {
        channelClass += " link-half-closed";
        statusText = `One side closed (${primaryLink.clientEndpoint})`;
      } else if (primaryLink.status === "closed") {
        channelClass += " link-closed";
        statusText = `Sockets closed (${primaryLink.clientEndpoint})`;
      } else {
        statusText = `Attempt: ${primaryLink.clientEndpoint} → ${primaryLink.serverEndpoint}`;
      }
    }

    if (activeEvent) {
      const et = activeEvent.eventType;
      if (activeEvent.isError) {
        channelClass += " link-error";
        animBadgeHtml = `<div class="link-pill pill-error">&#9888; ${escapeHtml(et)}() FAILED (${escapeHtml(activeEvent.errorName || "ERR")})</div>`;
      } else if (et === "connect") {
        animBadgeHtml = `<div class="link-pill pill-flow-right">connect() &#8594;</div>`;
      } else if (et === "accept" || et === "accept4") {
        animBadgeHtml = `<div class="link-pill pill-accept">&#10003; ${escapeHtml(et)}() → fd=${escapeHtml(activeEvent.result)}</div>`;
      } else if (et === "send" || et === "sendto") {
        const dirClass = activeEvent.direction === "server-to-client" ? "pill-flow-left" : "pill-flow-right";
        const arrow = activeEvent.direction === "server-to-client" ? "&#8592;" : "&#8594;";
        animBadgeHtml = `<div class="link-pill ${dirClass}">${arrow} ${escapeHtml(et)}(${activeEvent.bytes !== null ? activeEvent.bytes : 0} B)</div>`;
      } else if (et === "recv" || et === "recvfrom") {
        const arrow = activeEvent.direction === "client-to-server" ? "&#8594;" : "&#8592;";
        const bytesLabel = activeEvent.bytes === 0 ? "0 B / EOF" : `${activeEvent.bytes !== null ? activeEvent.bytes : 0} B`;
        animBadgeHtml = `<div class="link-pill pill-recv">${arrow} ${escapeHtml(et)}(${bytesLabel})</div>`;
      } else if (et === "shutdown") {
        animBadgeHtml = `<div class="link-pill pill-shutdown">&#9209; shutdown()</div>`;
      } else if (et === "close") {
        animBadgeHtml = `<div class="link-pill pill-close">&#10005; close(fd=${escapeHtml(activeEvent.socketFd)})</div>`;
      } else if (et === "listen") {
        animBadgeHtml = `<div class="link-pill pill-listen">&#9673; Listening (API)</div>`;
      } else if (et === "bind") {
        animBadgeHtml = `<div class="link-pill pill-bind">&#9875; bind()</div>`;
      } else if (et === "socket") {
        animBadgeHtml = `<div class="link-pill pill-socket">&#10010; socket()</div>`;
      }
    }

    const linkHtml = `
      <div class="${channelClass}">
        <div class="link-anim-slot">${animBadgeHtml}</div>
        <div class="link-wire"></div>
        <div class="link-status-text">${escapeHtml(statusText)}</div>
        <div class="link-disclaimer">API-derived state (not kernel TCP state)</div>
      </div>
    `;

    // Server Column (explicitly separating listening socket and accepted connection sockets)
    let serverHtml = "";
    if (servers.length === 0) {
      serverHtml = `
        <div class="proc-box proc-placeholder">
          <div class="proc-header">
            <span class="proc-name">Server Process</span>
            <span class="proc-pid">Not observed yet</span>
          </div>
          <div class="proc-body-empty">No server socket events recorded in this run.</div>
        </div>
      `;
    } else {
      serverHtml = servers
        .map((proc) => {
          const isActiveProc = activeEvent && activeEvent.pid === proc.pid;
          const procError = isActiveProc && activeEvent.isError;
          const listenerGroup = proc.listeningSockets.length
            ? `<div class="socket-group">
                 <div class="socket-group-label">Listening Socket</div>
                 ${proc.listeningSockets.map((s) => renderSocketCard(s, activeKey, activeEvent)).join("")}
               </div>`
            : "";
          const acceptedGroup = proc.acceptedSockets.length
            ? `<div class="socket-group">
                 <div class="socket-group-label">Accepted Server Connections (${proc.acceptedSockets.length})</div>
                 ${proc.acceptedSockets.map((s) => renderSocketCard(s, activeKey, activeEvent)).join("")}
               </div>`
            : "";
          return `
            <div class="proc-box ${isActiveProc ? "proc-active" : ""} ${procError ? "proc-error" : ""}">
              <div class="proc-header">
                <span class="proc-name">&#128421; ${escapeHtml(proc.name)}</span>
                <span class="proc-pid">PID: ${escapeHtml(proc.pid)}</span>
              </div>
              <div class="proc-sockets">
                ${listenerGroup}
                ${acceptedGroup}
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Other / Unclassified processes if any
    const otherHtml = otherProcesses.length
      ? `<div class="other-procs-strip">
           <span class="socket-group-label">Unclassified Process(es):</span>
           ${otherProcesses
             .map(
               (p) =>
                 `<div class="proc-box proc-other">
                    <div class="proc-header">
                      <span class="proc-name">${escapeHtml(p.name)}</span>
                      <span class="proc-pid">PID: ${escapeHtml(p.pid)}</span>
                    </div>
                    <div class="proc-sockets">
                      ${p.sockets.map((s) => renderSocketCard(s, activeKey, activeEvent)).join("")}
                    </div>
                  </div>`
             )
             .join("")}
         </div>`
      : "";

    container.innerHTML = `
      <div class="topology-grid">
        <div class="topology-col">${clientHtml}</div>
        ${linkHtml}
        <div class="topology-col">${serverHtml}</div>
      </div>
      ${otherHtml}
    `;
  }

  /**
   * Renders the Chronological Event Timeline table using non-destructive filtered indices.
   */
  function renderTimeline(tbody, events, filteredIndices, timingAnalysis, currentIndex, compareIndex, onSelect, onCompareToggle) {
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";

    if (!Array.isArray(filteredIndices) || filteredIndices.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="8" class="empty-table-cell">No events match the active filters.</td>`;
      tbody.appendChild(tr);
      return;
    }

    const timingEntries = (timingAnalysis && timingAnalysis.entries) || [];

    filteredIndices.forEach((origIdx) => {
      const ev = events[origIdx];
      if (!ev) {
        return;
      }
      const tEntry = timingEntries[origIdx] || {};
      const cat = eventCategoryMeta(ev);
      const isErr = Boolean(
        (typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined)
      );

      const tr = document.createElement("tr");
      tr.dataset.index = String(origIdx);

      const classes = [];
      if (origIdx === currentIndex) {
        classes.push("active-event-row");
      } else if (currentIndex >= 0 && origIdx < currentIndex) {
        classes.push("past-event-row");
      }
      if (isErr) {
        classes.push("error-event-row");
      }
      if (origIdx === compareIndex) {
        classes.push("compare-event-row");
      }
      tr.className = classes.join(" ");

      const procLabel = `${escapeHtml((ev.process && ev.process.name) || "unknown")} <span class="muted-pid">(${escapeHtml(ev.process && ev.process.pid !== undefined ? ev.process.pid : "?")})</span>`;
      const fdLabel = ev.socket_fd !== null && ev.socket_fd !== undefined ? `fd=${escapeHtml(ev.socket_fd)}` : NA;
      const resultLabel =
        typeof ev.result === "number"
          ? ev.event_type === "send" || ev.event_type === "sendto" || ev.event_type === "recv" || ev.event_type === "recvfrom"
            ? ev.result >= 0
              ? `${ev.result} B`
              : `${ev.result}`
            : String(ev.result)
          : NA;
      const errLabel = isErr
        ? `<span class="err-chip">${escapeHtml(ev.error_name || `errno ${ev.error_code}`)}</span>`
        : `<span class="ok-chip">OK</span>`;

      tr.innerHTML = `
        <td class="col-seq">${escapeHtml(ev.sequence)}</td>
        <td class="col-time" title="Delta from previous: ${escapeHtml(tEntry.deltaFormatted || NA)}">${escapeHtml(tEntry.relativeFormatted || NA)}</td>
        <td class="col-proc">${procLabel}</td>
        <td class="col-type"><span class="event-type-badge ${cat.cssClass}">${cat.icon} ${escapeHtml(cat.label)}</span></td>
        <td class="col-fd">${fdLabel}</td>
        <td class="col-result">${escapeHtml(resultLabel)}</td>
        <td class="col-err">${errLabel}</td>
        <td class="col-cmp"><button type="button" class="cmp-btn ${origIdx === compareIndex ? "cmp-active" : ""}" title="Pin as reference event for interval measurement">${origIdx === compareIndex ? "Ref" : "Δ"}</button></td>
      `;

      tr.addEventListener("click", (e) => {
        if (e.target && e.target.classList && e.target.classList.contains("cmp-btn")) {
          e.stopPropagation();
          if (typeof onCompareToggle === "function") {
            onCompareToggle(origIdx);
          }
          return;
        }
        if (typeof onSelect === "function") {
          onSelect(origIdx);
        }
      });

      tbody.appendChild(tr);

      if (origIdx === currentIndex && typeof tr.scrollIntoView === "function") {
        tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  /**
   * Renders the Interactive API-Level Communication Sequence Diagram.
   */
  function renderSequenceDiagram(container, sequenceModel, currentIndex, onSelect) {
    if (!container) {
      return;
    }

    if (!sequenceModel || !Array.isArray(sequenceModel.rows) || sequenceModel.rows.length === 0) {
      container.innerHTML = `<div class="seq-empty">No events loaded for sequence diagram.</div>`;
      return;
    }

    const rowsHtml = sequenceModel.rows
      .map((row) => {
        const isActive = row.index === currentIndex;
        const isPast = currentIndex >= 0 && row.index < currentIndex;
        const rowClass = [
          "seq-row",
          isActive ? "seq-row-active" : "",
          isPast ? "seq-row-past" : "",
          row.isError ? "seq-row-error" : "",
          row.kind === "unresolved" ? "seq-row-unresolved" : "",
        ]
          .filter(Boolean)
          .join(" ");

        let visualCell = "";
        if (row.kind === "unresolved") {
          visualCell = `
            <div class="seq-unresolved-badge" title="${escapeHtml(row.detail)}">
              <span>&#9888; ${escapeHtml(row.label)}</span>
            </div>
          `;
        } else if (row.direction === "client-to-server") {
          visualCell = `
            <div class="seq-arrow seq-arrow-right ${row.isError ? "seq-arrow-err" : ""}">
              <span class="seq-arrow-label">${escapeHtml(row.label)}</span>
              <div class="seq-arrow-line"><span class="seq-arrowhead-right">&#9654;</span></div>
              ${row.detail ? `<span class="seq-arrow-detail">${escapeHtml(row.detail)}</span>` : ""}
            </div>
          `;
        } else if (row.direction === "server-to-client") {
          visualCell = `
            <div class="seq-arrow seq-arrow-left ${row.isError ? "seq-arrow-err" : ""}">
              <span class="seq-arrow-label">${escapeHtml(row.label)}</span>
              <div class="seq-arrow-line"><span class="seq-arrowhead-left">&#9664;</span></div>
              ${row.detail ? `<span class="seq-arrow-detail">${escapeHtml(row.detail)}</span>` : ""}
            </div>
          `;
        } else if (row.direction === "at-server" || row.direction === "self-server") {
          visualCell = `
            <div class="seq-node-right ${row.isError ? "seq-node-err" : ""}">
              <span class="seq-node-pill">${escapeHtml(row.label)}</span>
              ${row.detail ? `<span class="seq-arrow-detail">${escapeHtml(row.detail)}</span>` : ""}
            </div>
          `;
        } else {
          visualCell = `
            <div class="seq-node-left ${row.isError ? "seq-node-err" : ""}">
              <span class="seq-node-pill">${escapeHtml(row.label)}</span>
              ${row.detail ? `<span class="seq-arrow-detail">${escapeHtml(row.detail)}</span>` : ""}
            </div>
          `;
        }

        return `
          <div class="${rowClass}" data-seq-index="${row.index}">
            <div class="seq-time-col">
              <span class="seq-num">#${escapeHtml(row.sequence)}</span>
              <span class="seq-ts">${escapeHtml(row.relativeTime)}</span>
            </div>
            <div class="seq-lane-area">
              <div class="lifeline-guide lifeline-client"></div>
              <div class="lifeline-guide lifeline-server"></div>
              ${visualCell}
            </div>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="seq-disclaimer-bar">${escapeHtml(sequenceModel.headerLabel)}</div>
      <div class="seq-lifeline-headers">
        <div class="seq-time-col">Seq / Time</div>
        <div class="seq-lane-headers-grid">
          <span class="lifeline-title lifeline-title-client">Client</span>
          <span class="lifeline-title lifeline-title-server">Server</span>
        </div>
      </div>
      <div class="seq-rows-scroll">${rowsHtml}</div>
    `;

    const rowEls = container.querySelectorAll(".seq-row");
    rowEls.forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-seq-index"));
        if (Number.isFinite(idx) && typeof onSelect === "function") {
          onSelect(idx);
        }
      });
    });

    const activeEl = container.querySelector(".seq-row-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /**
   * Renders the compact Timing & Performance Summary bar.
   */
  function renderMetricsSummary(container, timingAnalysis, selectedInterval) {
    if (!container) {
      return;
    }
    const s = (timingAnalysis && timingAnalysis.summary) || {
      totalDurationFormatted: "0.000 ms",
      operationCount: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errorCount: 0,
    };

    const intervalHtml = selectedInterval
      ? `<div class="metric-chip metric-chip-interval" title="Observed API-event interval (not wire network latency)">
           <span class="m-label">Interval (#${escapeHtml(selectedInterval.fromSeq)} ↔ #${escapeHtml(selectedInterval.toSeq)}):</span>
           <span class="m-val">${escapeHtml(selectedInterval.formatted)}</span>
         </div>`
      : `<div class="metric-chip metric-chip-hint" title="Click Δ on any row to compare API-event timing against the active event">
           <span class="m-label">API Interval:</span>
           <span class="m-val muted">Click Δ to compare</span>
         </div>`;

    container.innerHTML = `
      <div class="metric-chip" title="Total elapsed monotonic time from first to last observed socket API event">
        <span class="m-label">Observed Duration:</span>
        <span class="m-val">${escapeHtml(s.totalDurationFormatted)}</span>
      </div>
      <div class="metric-chip">
        <span class="m-label">Socket Ops:</span>
        <span class="m-val">${escapeHtml(s.operationCount)}</span>
      </div>
      <div class="metric-chip" title="Sum of positive return values from send/sendto calls">
        <span class="m-label">Bytes Sent:</span>
        <span class="m-val">${escapeHtml(s.bytesSent)} B</span>
      </div>
      <div class="metric-chip" title="Sum of positive return values from recv/recvfrom calls">
        <span class="m-label">Bytes Recv:</span>
        <span class="m-val">${escapeHtml(s.bytesReceived)} B</span>
      </div>
      <div class="metric-chip ${s.errorCount > 0 ? "metric-chip-err" : ""}">
        <span class="m-label">Errors:</span>
        <span class="m-val">${escapeHtml(s.errorCount)}</span>
      </div>
      ${intervalHtml}
    `;
  }

  /**
   * Renders the Detailed Event Inspector panel cleanly separating
   * Observed Fields, Derived Fields, Deterministic Explanation, and Raw JSON.
   */
  function renderInspector(elements, inspectorModel) {
    if (!elements) {
      return;
    }

    if (!inspectorModel) {
      if (elements.seqBadge) elements.seqBadge.textContent = "Seq: -";
      if (elements.explanationBox) {
        elements.explanationBox.className = "inspector-explanation";
        elements.explanationBox.textContent =
          "Select an event from the timeline or sequence diagram to inspect its recorded schema fields and deterministic explanation.";
      }
      if (elements.observedGrid) {
        elements.observedGrid.innerHTML = `<div class="insp-empty">No event selected.</div>`;
      }
      if (elements.derivedGrid) {
        elements.derivedGrid.innerHTML = `<div class="insp-empty">No derived timing or socket state selected.</div>`;
      }
      if (elements.rawJson) {
        elements.rawJson.textContent = "// Select any event to view raw JSON (docs/event_schema.md v1.0)";
      }
      return;
    }

    if (elements.seqBadge) {
      elements.seqBadge.textContent = `Seq: #${inspectorModel.sequence}`;
    }

    if (elements.explanationBox) {
      elements.explanationBox.className = `inspector-explanation ${
        inspectorModel.isError ? "explanation-error" : ""
      }`;
      elements.explanationBox.textContent = inspectorModel.explanation;
    }

    if (elements.observedGrid) {
      elements.observedGrid.innerHTML = inspectorModel.observedFields
        .map((field) => {
          const isNA = field.value === NA;
          const isErrField =
            inspectorModel.isError &&
            (field.key === "result" ||
              field.key === "error_code" ||
              field.key === "error_name" ||
              field.key === "error_message");
          return `
            <div class="insp-row">
              <span class="insp-key">${escapeHtml(field.label)}</span>
              <span class="insp-val ${isNA ? "insp-na" : ""} ${isErrField ? "insp-err" : ""}">${escapeHtml(field.value)}</span>
            </div>
          `;
        })
        .join("");
    }

    if (elements.derivedGrid) {
      elements.derivedGrid.innerHTML = inspectorModel.derivedFields
        .map(
          (field) => `
            <div class="insp-row">
              <span class="insp-key">${escapeHtml(field.label)}</span>
              <span class="insp-val insp-derived-val">${escapeHtml(field.value)}</span>
            </div>
          `
        )
        .join("");
    }

    if (elements.rawJson) {
      elements.rawJson.textContent = inspectorModel.rawJson;
    }
  }

  return {
    escapeHtml,
    stateCssClass,
    eventCategoryMeta,
    renderTopology,
    renderTimeline,
    renderSequenceDiagram,
    renderMetricsSummary,
    renderInspector,
  };
});
