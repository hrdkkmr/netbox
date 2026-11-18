/**
 * NetBox Phase 4 Visualizer — Packet Capture, TCP Handshake, Flows,
 * Correlations, and Unified Dual-Layer Replay Module.
 *
 * Strictly separates source="socket_api" from source="packet_capture".
 * Never invents missing packets or fabricates correlations.
 * Displays unavailable fields as "Not available".
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.PacketView = factory();
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

  function valOrNA(v) {
    if (v === null || v === undefined || v === "") {
      return NA;
    }
    return String(v);
  }

  function formatRelMonoMs(monoNs, baseMonoNs) {
    if (typeof monoNs !== "number" || typeof baseMonoNs !== "number") {
      return NA;
    }
    const ms = (monoNs - baseMonoNs) / 1e6;
    const sign = ms < 0 ? "-" : "+";
    return `${sign}${Math.abs(ms).toFixed(3)} ms`;
  }

  function packetFlagClass(pkt) {
    const cls = (pkt && pkt.analysis && pkt.analysis.classification) || "OTHER";
    switch (cls) {
      case "SYN":
        return "pkt-badge-syn";
      case "SYN+ACK":
        return "pkt-badge-synack";
      case "DATA":
        return "pkt-badge-data";
      case "FIN":
      case "FIN+ACK":
        return "pkt-badge-fin";
      case "RST":
        return "pkt-badge-rst";
      case "ACK":
        return "pkt-badge-ack";
      default:
        return "pkt-badge-other";
    }
  }

  /**
   * Builds a unified chronological timeline combining socket_api and packet_capture
   * records ordered strictly by monotonic observation timestamps, while preserving
   * each item's original source label and never mutating either input stream.
   */
  function buildUnifiedTimeline(socketEvents, packets, mode) {
    const replayMode = mode || "both"; // "socket" | "packets" | "both"
    const sList = Array.isArray(socketEvents) ? socketEvents : [];
    const pList = Array.isArray(packets) ? packets : [];

    const items = [];
    if (replayMode === "socket" || replayMode === "both") {
      sList.forEach((ev, idx) => {
        if (!ev) return;
        items.push({
          source: "socket_api",
          monotonicNs: typeof ev.timestamp_ns === "number" ? ev.timestamp_ns : 0,
          sequence: ev.sequence,
          originalIndex: idx,
          summary: `${(ev.process && ev.process.name) || "proc"} ${ev.event_type}() → ${ev.result}`,
          detail: ev.socket_fd !== null && ev.socket_fd !== undefined ? `fd=${ev.socket_fd}` : "",
          isError: ev.result < 0 || ev.error_code != null,
          raw: ev,
        });
      });
    }

    if (replayMode === "packets" || replayMode === "both") {
      pList.forEach((pkt, idx) => {
        if (!pkt) return;
        const mono =
          pkt.timestamp && typeof pkt.timestamp.capture_monotonic_ns === "number"
            ? pkt.timestamp.capture_monotonic_ns
            : 0;
        const flagsLabel = (pkt.analysis && pkt.analysis.flags_label) || pkt.protocol;
        const src =
          pkt.network && pkt.transport && pkt.transport.tcp
            ? `${pkt.network.source_ip}:${pkt.transport.tcp.source_port}`
            : "?";
        const dst =
          pkt.network && pkt.transport && pkt.transport.tcp
            ? `${pkt.network.destination_ip}:${pkt.transport.tcp.destination_port}`
            : "?";
        const plen = pkt.payload ? pkt.payload.payload_length : 0;
        items.push({
          source: "packet_capture",
          monotonicNs: mono,
          sequence: pkt.sequence,
          originalIndex: idx,
          summary: `TCP [${flagsLabel}] ${src} → ${dst}`,
          detail: plen > 0 ? `${plen} B payload` : `${pkt.capture ? pkt.capture.original_length : 0} B frame`,
          isError: Boolean(pkt.transport && pkt.transport.tcp && pkt.transport.tcp.flags && pkt.transport.tcp.flags.rst),
          raw: pkt,
        });
      });
    }

    items.sort((a, b) => {
      if (a.monotonicNs !== b.monotonicNs) {
        return a.monotonicNs - b.monotonicNs;
      }
      if (a.source !== b.source) {
        return a.source === "socket_api" ? -1 : 1;
      }
      return a.sequence - b.sequence;
    });

    const baseMonoNs = items.length > 0 ? items[0].monotonicNs : null;
    return items.map((item, idx) => ({
      ...item,
      unifiedIndex: idx,
      timestamp_ns: item.monotonicNs, // Compatible with PlaybackEngine
      relativeFormatted: formatRelMonoMs(item.monotonicNs, baseMonoNs),
    }));
  }

  function renderPacketStatusBanner(container, packetData) {
    if (!container) return;
    if (!packetData) {
      container.innerHTML = `<div class="pcap-banner pcap-neutral">No packet capture metadata loaded (switch to a live run via <strong>Run Live TCP</strong>).</div>`;
      return;
    }

    const st = packetData.packet_capture_status || "NOT_REQUESTED";
    const iface = packetData.interface || NA;
    const count = packetData.packet_count || 0;
    const privacy = packetData.payload_capture_enabled
      ? "Payload Preview: OPT-IN ENABLED (bounded)"
      : "Payload Privacy: HEADER-ONLY (raw payloads disabled)";

    if (st === "COMPLETED" && count > 0) {
      container.innerHTML = `
        <div class="pcap-banner pcap-ok">
          <span><strong>PACKET CAPTURE: COMPLETED</strong> · Interface: <code>${escapeHtml(iface)}</code> · Captured: <strong>${count}</strong> real packets · ${escapeHtml(privacy)}</span>
        </div>
      `;
    } else if (st === "UNAVAILABLE" || st === "FAILED") {
      container.innerHTML = `
        <div class="pcap-banner pcap-warn">
          <div><strong>PACKET CAPTURE: ${escapeHtml(st)}</strong> (Interface: <code>${escapeHtml(iface)}</code>)</div>
          <div class="pcap-err-detail">${escapeHtml(packetData.capture_error || "Packet capture was unavailable for this run. Phase 2 socket API events remain fully available.")}</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="pcap-banner pcap-neutral">
          <strong>PACKET CAPTURE: ${escapeHtml(st)}</strong> · Interface: <code>${escapeHtml(iface)}</code> · Packets: ${count}
        </div>
      `;
    }
  }

  function renderPacketTimeline(tbody, packets, selectedSeq, baseMonoNs, onSelect) {
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!Array.isArray(packets) || packets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-table-cell">No captured packets for this run.</td></tr>`;
      return;
    }

    packets.forEach((pkt) => {
      const tr = document.createElement("tr");
      const isSelected = pkt.sequence === selectedSeq;
      const isRst = Boolean(pkt.transport && pkt.transport.tcp && pkt.transport.tcp.flags && pkt.transport.tcp.flags.rst);
      const isRetrans = Boolean(pkt.analysis && pkt.analysis.retransmission_status);
      tr.className = [
        isSelected ? "active-event-row" : "",
        isRst ? "error-event-row" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const src =
        pkt.network && pkt.transport && pkt.transport.tcp
          ? `${pkt.network.source_ip}:${pkt.transport.tcp.source_port}`
          : pkt.network
            ? pkt.network.source_ip
            : NA;
      const dst =
        pkt.network && pkt.transport && pkt.transport.tcp
          ? `${pkt.network.destination_ip}:${pkt.transport.tcp.destination_port}`
          : pkt.network
            ? pkt.network.destination_ip
            : NA;

      const flagsLabel = (pkt.analysis && pkt.analysis.flags_label) || pkt.protocol;
      const flagClass = packetFlagClass(pkt);
      const relTime = formatRelMonoMs(
        pkt.timestamp ? pkt.timestamp.capture_monotonic_ns : null,
        baseMonoNs
      );
      const plen = pkt.payload ? pkt.payload.payload_length : 0;
      const flen = pkt.capture ? pkt.capture.original_length : 0;

      tr.innerHTML = `
        <td>#${escapeHtml(pkt.sequence)}</td>
        <td>${escapeHtml(relTime)}</td>
        <td>${escapeHtml(src)}</td>
        <td>${escapeHtml(dst)}</td>
        <td>
          <span class="pkt-flag-badge ${flagClass}">${escapeHtml(flagsLabel)}</span>
          ${isRetrans ? `<span class="pkt-retrans-chip" title="${escapeHtml(pkt.analysis.retransmission_reason || "")}">RETRANS?</span>` : ""}
        </td>
        <td>${escapeHtml(plen)} B</td>
        <td>${escapeHtml(flen)} B</td>
      `;

      tr.addEventListener("click", () => {
        if (typeof onSelect === "function") {
          onSelect(pkt.sequence);
        }
      });

      tbody.appendChild(tr);
      if (isSelected && typeof tr.scrollIntoView === "function") {
        tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  /**
   * Renders Observed TCP Handshake Diagram strictly from captured packets.
   * Never fabricates missing arrows; shows Incomplete / Missing explicitly.
   */
  function renderHandshakeDiagram(container, flows, selectedPktSeq, onSelectPacket) {
    if (!container) return;
    if (!Array.isArray(flows) || flows.length === 0) {
      container.innerHTML = `<div class="seq-empty">No captured TCP flows to display handshake.</div>`;
      return;
    }

    const html = flows
      .map((flow) => {
        const hs = flow.handshake || { status: "NOT_OBSERVED", note: "", steps: [] };
        const statusCls =
          hs.status === "COMPLETE"
            ? "hs-complete"
            : hs.status === "INCOMPLETE"
              ? "hs-incomplete"
              : "hs-none";

        const stepsHtml = (hs.steps || [])
          .map((st) => {
            if (!st.observed) {
              return `
                <div class="hs-row hs-missing">
                  <span class="hs-step-tag">${escapeHtml(st.step)}</span>
                  <div class="hs-missing-line">Not captured (missing packet — not fabricated)</div>
                </div>
              `;
            }
            const isSel = st.packet_sequence === selectedPktSeq;
            const isRight = st.direction === "client->server";
            return `
              <div class="hs-row hs-observed ${isSel ? "hs-selected" : ""}" data-pkt-seq="${st.packet_sequence}">
                <span class="hs-step-tag">#${escapeHtml(st.packet_sequence)}</span>
                <div class="seq-arrow ${isRight ? "seq-arrow-right" : "seq-arrow-left"}">
                  <span class="seq-arrow-label">${escapeHtml(st.step)} (seq=${escapeHtml(st.seq_num)}, ack=${escapeHtml(st.ack_num)})</span>
                  <div class="seq-arrow-line">
                    <span class="${isRight ? "seq-arrowhead-right" : "seq-arrowhead-left"}">${isRight ? "&#9654;" : "&#9664;"}</span>
                  </div>
                </div>
              </div>
            `;
          })
          .join("");

        return `
          <div class="hs-card">
            <div class="hs-header">
              <span class="hs-flow-id">${escapeHtml(flow.client_endpoint || flow.endpoint_a)} ↔ ${escapeHtml(flow.server_endpoint || flow.endpoint_b)}</span>
              <span class="hs-status-pill ${statusCls}">${escapeHtml(hs.status)}</span>
            </div>
            <div class="hs-note">${escapeHtml(hs.note)}</div>
            <div class="hs-lanes-header">
              <span class="lifeline-title-client">Client (${escapeHtml(flow.client_endpoint || "undetermined")})</span>
              <span class="lifeline-title-server">Server (${escapeHtml(flow.server_endpoint || "undetermined")})</span>
            </div>
            <div class="hs-steps">${stepsHtml}</div>
          </div>
        `;
      })
      .join("");

    container.innerHTML = html;
    container.querySelectorAll(".hs-observed").forEach((el) => {
      el.addEventListener("click", () => {
        const seq = Number(el.getAttribute("data-pkt-seq"));
        if (Number.isFinite(seq) && typeof onSelectPacket === "function") {
          onSelectPacket(seq);
        }
      });
    });
  }

  function renderPacketInspector(container, pkt, baseMonoNs, correlation, onJumpSocketEvent, onAskAIPacket) {
    if (!container) return;
    if (!pkt) {
      container.innerHTML = `<div class="insp-empty">Select a captured packet from the Packet Timeline or Handshake view to inspect its IPv4 &amp; TCP headers.</div>`;
      return;
    }

    const net = pkt.network;
    const tcp = pkt.transport && pkt.transport.tcp;
    const exp = pkt.analysis && pkt.analysis.explanation;
    const relTime = formatRelMonoMs(
      pkt.timestamp ? pkt.timestamp.capture_monotonic_ns : null,
      baseMonoNs
    );

    const row = (label, val, derived) => {
      const formatted = valOrNA(val);
      const isNA = formatted === NA;
      return `
        <div class="insp-row">
          <span class="insp-key">${escapeHtml(label)}</span>
          <span class="insp-val ${isNA ? "insp-na" : ""} ${derived ? "insp-derived-val" : ""}">${escapeHtml(formatted)}</span>
        </div>
      `;
    };

    const optionsStr =
      tcp && Array.isArray(tcp.options) && tcp.options.length > 0
        ? tcp.options.map((o) => `${o.name}=${o.value}`).join(", ")
        : NA;

    const corrHtml = correlation
      ? `
        <div class="insp-section">
          <div class="insp-section-header">
            <span>Socket API Correlation</span>
            <span>${escapeHtml(correlation.confidence.toUpperCase())}</span>
          </div>
          <div class="insp-grid">
            ${row("Confidence", correlation.confidence, true)}
            ${row("Method", correlation.method, true)}
            ${row("Monotonic Delta", correlation.monotonic_delta_ms !== null && correlation.monotonic_delta_ms !== undefined ? `${correlation.monotonic_delta_ms} ms` : null, true)}
            <div class="corr-reason-note">${escapeHtml(correlation.reason)}</div>
            ${
              Array.isArray(correlation.related_socket_event_sequences) &&
              correlation.related_socket_event_sequences.length > 0
                ? `<div class="corr-chips">
                    ${correlation.related_socket_event_sequences
                      .map(
                        (seq) =>
                          `<button type="button" class="corr-jump-btn" data-sock-seq="${seq}">Socket Event #${seq}</button>`
                      )
                      .join("")}
                   </div>`
                : ""
            }
          </div>
        </div>
      `
      : "";

    const explanationHtml = exp
      ? `
        <div class="pkt-explanation-box">
          <div class="pkt-exp-title">${escapeHtml(exp.summary)}</div>
          <div class="pkt-exp-item"><strong>Directly Observed:</strong> ${escapeHtml(exp.observed)}</div>
          <div class="pkt-exp-item"><strong>TCP Flags:</strong> ${escapeHtml(exp.flags_meaning)}</div>
          <div class="pkt-exp-item"><strong>Reasonable Inference:</strong> ${escapeHtml(exp.reasonable_inference)}</div>
          <div class="pkt-exp-item pkt-exp-caution"><strong>Cannot Conclude Alone:</strong> ${escapeHtml(exp.cannot_conclude)}</div>
        </div>
      `
      : "";

    container.innerHTML = `
      <div class="pkt-ai-action-bar">
        <button type="button" class="ctrl-btn live-btn pkt-ask-ai-btn" data-pkt-seq="${escapeHtml(pkt.sequence)}">&#10024; Explain Packet #${escapeHtml(pkt.sequence)} with Local AI</button>
      </div>
      ${explanationHtml}
      <div class="insp-section">
        <div class="insp-section-header"><span>General (Captured)</span><span>Packet #${escapeHtml(pkt.sequence)}</span></div>
        <div class="insp-grid">
          ${row("Packet Sequence", pkt.sequence)}
          ${row("Run ID", pkt.run_id)}
          ${row("Capture Interface", pkt.interface)}
          ${row("Link-Layer Type", pkt.link_layer ? pkt.link_layer.type : null)}
          ${row("pcap Timestamp (ns)", pkt.timestamp ? pkt.timestamp.pcap_timestamp_ns : null)}
          ${row("Capture Monotonic (ns)", pkt.timestamp ? pkt.timestamp.capture_monotonic_ns : null)}
          ${row("Relative Monotonic Time", relTime, true)}
          ${row("Captured / Original Length", pkt.capture ? `${pkt.capture.captured_length} B / ${pkt.capture.original_length} B` : null)}
          ${row("Protocol", pkt.protocol)}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-header"><span>IP Header (Observed)</span><span>IPv4</span></div>
        <div class="insp-grid">
          ${row("Source IP", net ? net.source_ip : null)}
          ${row("Destination IP", net ? net.destination_ip : null)}
          ${row("IP Version", net ? net.ip_version : null)}
          ${row("TTL", net ? net.ttl : null)}
          ${row("Total Length", net ? `${net.total_length} B` : null)}
          ${row("Header Length", net ? `${net.header_length} B` : null)}
          ${row("Identification", net ? net.identification : null)}
          ${row("Protocol Number", net ? net.protocol_number : null)}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-header"><span>TCP Header (Observed)</span><span>${escapeHtml(pkt.analysis ? pkt.analysis.flags_label : NA)}</span></div>
        <div class="insp-grid">
          ${row("Source Port", tcp ? tcp.source_port : null)}
          ${row("Destination Port", tcp ? tcp.destination_port : null)}
          ${row("Sequence Number", tcp ? tcp.sequence_number : null)}
          ${row("Acknowledgement Number", tcp ? tcp.acknowledgement_number : null)}
          ${row("Header Length", tcp ? `${tcp.header_length} B` : null)}
          ${row("Window Size", tcp ? tcp.window_size : null)}
          ${row("Decoded Flags", pkt.analysis ? `${pkt.analysis.flags_label} (0x${tcp ? tcp.flags_raw.toString(16).padStart(2, "0") : "00"})` : null)}
          ${row("TCP Options", optionsStr)}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-header"><span>Payload (Privacy Protected)</span><span>${pkt.payload && pkt.payload.captured_bytes > 0 ? "OPT-IN" : "HEADERS ONLY"}</span></div>
        <div class="insp-grid">
          ${row("Payload Length", pkt.payload ? `${pkt.payload.payload_length} B` : null)}
          ${row("Captured Payload Bytes", pkt.payload ? `${pkt.payload.captured_bytes} B` : null)}
          ${row("Truncated", pkt.payload ? String(pkt.payload.truncated) : null)}
          ${row("Preview (UTF-8)", pkt.payload ? pkt.payload.preview_utf8 : null)}
        </div>
      </div>

      ${corrHtml}

      <details class="json-details">
        <summary>Raw Packet JSON (Schema v1.0)</summary>
        <pre class="json-block"><code>${escapeHtml(JSON.stringify(pkt, null, 2))}</code></pre>
      </details>
    `;

    container.querySelectorAll(".corr-jump-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sockSeq = Number(btn.getAttribute("data-sock-seq"));
        if (Number.isFinite(sockSeq) && typeof onJumpSocketEvent === "function") {
          onJumpSocketEvent(sockSeq);
        }
      });
    });

    const aiBtn = container.querySelector(".pkt-ask-ai-btn");
    if (aiBtn) {
      aiBtn.addEventListener("click", () => {
        const seq = Number(aiBtn.getAttribute("data-pkt-seq"));
        if (Number.isFinite(seq) && typeof onAskAIPacket === "function") {
          onAskAIPacket(seq);
        }
      });
    }
  }

  function renderFlowsView(container, flows, onSelectPacket, onJumpSocketEvent) {
    if (!container) return;
    if (!Array.isArray(flows) || flows.length === 0) {
      container.innerHTML = `<div class="seq-empty">No TCP flows observed for this run. Run a live TCP execution with libpcap enabled to inspect bidirectional flows.</div>`;
      return;
    }

    container.innerHTML = flows
      .map((f) => {
        const pktBtns = (f.packet_sequences || [])
          .map((s) => `<button type="button" class="corr-jump-btn pkt-jump" data-pkt-seq="${s}">Pkt #${s}</button>`)
          .join("");
        const sockBtns = (f.correlated_socket_sequences || [])
          .map((s) => `<button type="button" class="corr-jump-btn sock-jump" data-sock-seq="${s}">API #${s}</button>`)
          .join("");
        const retransHtml =
          f.retransmissions && f.retransmissions.length > 0
            ? f.retransmissions
                .map((r) => `<div class="flow-warn-item">${escapeHtml(r.status)}: Pkt #${r.packet_sequence} — ${escapeHtml(r.reason)}</div>`)
                .join("")
            : `<span class="muted">None observed</span>`;

        return `
          <div class="flow-card">
            <div class="flow-card-header">
              <strong>Flow: <code>${escapeHtml(f.flow_id)}</code></strong>
              <span class="hs-status-pill ${f.handshake && f.handshake.status === "COMPLETE" ? "hs-complete" : "hs-incomplete"}">Handshake: ${escapeHtml(f.handshake ? f.handshake.status : "N/A")}</span>
            </div>
            <div class="flow-grid">
              <div><span class="insp-key">Client Endpoint:</span> <code>${escapeHtml(valOrNA(f.client_endpoint))}</code></div>
              <div><span class="insp-key">Server Endpoint:</span> <code>${escapeHtml(valOrNA(f.server_endpoint))}</code></div>
              <div><span class="insp-key">Role Determination:</span> <code>${escapeHtml(f.role_determination)}</code></div>
              <div><span class="insp-key">Total Packets:</span> <code>${escapeHtml(f.packet_count)}</code> (${f.packets_a_to_b} A→B, ${f.packets_b_to_a} B→A)</div>
              <div><span class="insp-key">Payload Bytes:</span> <code>${f.payload_bytes_a_to_b} B (A→B) / ${f.payload_bytes_b_to_a} B (B→A)</code></div>
              <div><span class="insp-key">Observed Flags:</span> <code>${escapeHtml((f.observed_flags || []).join(", ") || NA)}</code></div>
              <div><span class="insp-key">Termination:</span> <code>${escapeHtml(f.termination ? f.termination.status : NA)}</code> — ${escapeHtml(f.termination ? f.termination.note : "")}</div>
              <div><span class="insp-key">Retransmissions:</span> ${retransHtml}</div>
            </div>
            <div class="flow-links-row">
              <div><span class="insp-key">Packets:</span> ${pktBtns || NA}</div>
              <div><span class="insp-key">Correlated Socket Ops:</span> ${sockBtns || NA}</div>
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".pkt-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seq = Number(btn.getAttribute("data-pkt-seq"));
        if (Number.isFinite(seq) && typeof onSelectPacket === "function") onSelectPacket(seq);
      });
    });
    container.querySelectorAll(".sock-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seq = Number(btn.getAttribute("data-sock-seq"));
        if (Number.isFinite(seq) && typeof onJumpSocketEvent === "function") onJumpSocketEvent(seq);
      });
    });
  }

  function renderCorrelationsView(tbody, correlations, onSelectPacket, onJumpSocketEvent) {
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!Array.isArray(correlations) || correlations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No packet-to-socket correlations available for this run.</td></tr>`;
      return;
    }

    correlations.forEach((c) => {
      const tr = document.createElement("tr");
      const confClass =
        c.confidence === "high"
          ? "conf-high"
          : c.confidence === "medium"
            ? "conf-med"
            : c.confidence === "low"
              ? "conf-low"
              : "conf-unresolved";
      const sockButtons = (c.related_socket_event_sequences || [])
        .map((s) => `<button type="button" class="corr-jump-btn sock-jump" data-sock-seq="${s}">#${s}</button>`)
        .join(" ");
      const procSummary = (c.related_processes || [])
        .map((p) => `${p.name}(${p.pid})`)
        .join(", ");

      tr.innerHTML = `
        <td><button type="button" class="corr-jump-btn pkt-jump" data-pkt-seq="${c.packet_sequence}">Packet #${c.packet_sequence}</button></td>
        <td><code>${escapeHtml(valOrNA(c.connection_tuple))}</code></td>
        <td><span class="conf-pill ${confClass}">${escapeHtml(c.confidence.toUpperCase())}</span></td>
        <td>${sockButtons || `<span class="insp-na">${NA}</span>`}</td>
        <td>${escapeHtml(procSummary || NA)}</td>
        <td class="corr-reason-cell">${escapeHtml(c.reason)}</td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".pkt-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seq = Number(btn.getAttribute("data-pkt-seq"));
        if (Number.isFinite(seq) && typeof onSelectPacket === "function") onSelectPacket(seq);
      });
    });
    tbody.querySelectorAll(".sock-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seq = Number(btn.getAttribute("data-sock-seq"));
        if (Number.isFinite(seq) && typeof onJumpSocketEvent === "function") onJumpSocketEvent(seq);
      });
    });
  }

  function renderUnifiedReplayTable(tbody, unifiedItems, activeIndex, onSelect) {
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!Array.isArray(unifiedItems) || unifiedItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-table-cell">No events available for selected playback layer.</td></tr>`;
      return;
    }

    unifiedItems.forEach((item, idx) => {
      const tr = document.createElement("tr");
      tr.className = [
        idx === activeIndex ? "active-event-row" : "",
        item.isError ? "error-event-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const srcBadge =
        item.source === "packet_capture"
          ? `<span class="src-badge src-packet">packet_capture</span>`
          : `<span class="src-badge src-socket">socket_api</span>`;

      tr.innerHTML = `
        <td>${escapeHtml(item.relativeFormatted)}</td>
        <td>${srcBadge}</td>
        <td>#${escapeHtml(item.sequence)}</td>
        <td>${escapeHtml(item.summary)}</td>
        <td>${escapeHtml(item.detail || NA)}</td>
      `;
      tr.addEventListener("click", () => {
        if (typeof onSelect === "function") onSelect(idx, item);
      });
      tbody.appendChild(tr);
    });
  }

  return {
    NA,
    formatRelMonoMs,
    packetFlagClass,
    buildUnifiedTimeline,
    renderPacketStatusBanner,
    renderPacketTimeline,
    renderHandshakeDiagram,
    renderPacketInspector,
    renderFlowsView,
    renderCorrelationsView,
    renderUnifiedReplayTable,
  };
});
