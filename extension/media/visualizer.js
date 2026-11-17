// NetBox Visualizer Client Logic

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  let events = [];
  let currentIndex = -1;
  let isPlaying = false;
  let playTimer = null;
  let playbackSpeedMs = 1000;

  // DOM Elements
  const btnRestart = document.getElementById("btn-restart");
  const btnPrev = document.getElementById("btn-prev");
  const btnPlayPause = document.getElementById("btn-play-pause");
  const btnNext = document.getElementById("btn-next");
  const speedSelect = document.getElementById("speed-select");
  const btnRunLive = document.getElementById("btn-run-live");
  const btnLoadDemo = document.getElementById("btn-load-demo");
  const runIdBadge = document.getElementById("run-id-badge");

  const lifecycleState = document.getElementById("lifecycle-state");
  const timelineCounter = document.getElementById("timeline-counter");
  const eventsTbody = document.getElementById("events-tbody");

  const nodeClient = document.getElementById("node-client");
  const nodeServer = document.getElementById("node-server");
  const clientPid = document.getElementById("client-pid");
  const serverPid = document.getElementById("server-pid");
  const clientEndpoint = document.getElementById("client-endpoint");
  const serverEndpoint = document.getElementById("server-endpoint");
  const clientFd = document.getElementById("client-fd");
  const serverFd = document.getElementById("server-fd");
  const clientState = document.getElementById("client-state");
  const serverState = document.getElementById("server-state");
  const connChannel = document.getElementById("conn-channel");
  const channelStatus = document.getElementById("channel-status");
  const packetAnim = document.getElementById("packet-anim");
  const packetArrow = document.getElementById("packet-arrow");
  const packetLabel = document.getElementById("packet-label");

  const inspectorSeq = document.getElementById("inspector-seq");
  const inspEventType = document.getElementById("insp-event-type");
  const inspProcess = document.getElementById("insp-process");
  const inspResult = document.getElementById("insp-result");
  const inspError = document.getElementById("insp-error");
  const inspJsonRaw = document.getElementById("insp-json-raw");
  const dataModeBadge = document.getElementById("data-mode-badge");

  // Event Listeners
  btnPlayPause?.addEventListener("click", togglePlay);
  btnNext?.addEventListener("click", () => { pause(); stepForward(); });
  btnPrev?.addEventListener("click", () => { pause(); stepBackward(); });
  btnRestart?.addEventListener("click", () => { pause(); resetPlayback(); });
  btnRunLive?.addEventListener("click", () => {
    if (dataModeBadge) {
      dataModeBadge.textContent = "RUNNING LIVE TCP TEST...";
      dataModeBadge.className = "badge simulated-badge";
    }
    vscode.postMessage({ type: "executeLiveRun" });
  });
  btnLoadDemo?.addEventListener("click", () => {
    vscode.postMessage({ type: "getDemoEvents" });
  });

  speedSelect?.addEventListener("change", (e) => {
    // @ts-ignore
    playbackSpeedMs = parseInt(e.target.value, 10) || 1000;
    if (isPlaying) {
      pause();
      play();
    }
  });

  // Handle Extension Host Messages
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "eventsLoaded":
        onEventsLoaded(msg.payload);
        break;

      case "errorMessage":
        console.warn("[NetBox Visualizer]", msg.payload?.message);
        if (dataModeBadge) {
          dataModeBadge.textContent = "BACKEND OFFLINE — RECONNECT TO RELOAD";
          dataModeBadge.style.backgroundColor = "rgba(241, 76, 76, 0.2)";
          dataModeBadge.style.color = "var(--error-color)";
        }
        break;
    }
  });

  function onEventsLoaded(payload) {
    if (!payload || !Array.isArray(payload.events)) return;

    events = payload.events;
    if (runIdBadge && payload.runId) {
      runIdBadge.textContent = `Run: ${payload.runId}`;
    }

    if (dataModeBadge) {
      if (payload.isSimulated) {
        dataModeBadge.textContent = `SIMULATED DATA (${payload.label || "SIMULATED"})`;
        dataModeBadge.className = "badge simulated-badge";
      } else {
        dataModeBadge.textContent = "ACTUAL SOCKET API EVENTS";
        dataModeBadge.className = "badge actual-badge";
      }
    }

    renderTimelineTable();
    resetPlayback();
  }

  function renderTimelineTable() {
    if (!eventsTbody) return;
    eventsTbody.innerHTML = "";

    events.forEach((ev, idx) => {
      const tr = document.createElement("tr");
      tr.id = `event-row-${idx}`;
      tr.dataset.index = String(idx);

      const endpointStr = ev.connection
        ? `${ev.connection.local_ip || "*"}:${ev.connection.local_port || "*"} -> ${ev.connection.remote_ip || "*"}:${ev.connection.remote_port || "*"}`
        : (ev.socket_fd ? `fd=${ev.socket_fd}` : "—");

      tr.innerHTML = `
        <td>${ev.sequence}</td>
        <td><code>${ev.source}</code></td>
        <td><strong>${ev.process?.name || "unknown"}</strong> (${ev.process?.pid || "-"})</td>
        <td><span class="event-type-badge badge-${ev.event_type}">${ev.event_type}</span></td>
        <td>${endpointStr}</td>
        <td>${ev.result >= 0 ? ev.result : `ERR (${ev.error_code})`}</td>
      `;

      tr.addEventListener("click", () => {
        pause();
        jumpToIndex(idx);
      });

      eventsTbody.appendChild(tr);
    });

    updateCounter();
  }

  function togglePlay() {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (events.length === 0) return;
    isPlaying = true;
    if (btnPlayPause) {
      btnPlayPause.innerHTML = "&#10074;&#10074; Pause";
    }

    if (currentIndex >= events.length - 1) {
      currentIndex = -1;
    }

    playTimer = setInterval(() => {
      if (currentIndex < events.length - 1) {
        stepForward();
      } else {
        pause();
      }
    }, playbackSpeedMs);
  }

  function pause() {
    isPlaying = false;
    if (btnPlayPause) {
      btnPlayPause.innerHTML = "&#9658; Play";
    }
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function resetPlayback() {
    pause();
    currentIndex = -1;
    updateCounter();
    resetTopology();
    clearInspector();
    clearRowHighlights();
  }

  function stepForward() {
    if (currentIndex < events.length - 1) {
      jumpToIndex(currentIndex + 1);
    }
  }

  function stepBackward() {
    if (currentIndex > 0) {
      jumpToIndex(currentIndex - 1);
    } else if (currentIndex === 0) {
      resetPlayback();
    }
  }

  function jumpToIndex(targetIdx) {
    if (targetIdx < 0 || targetIdx >= events.length) return;
    currentIndex = targetIdx;
    updateCounter();
    highlightRows();

    const ev = events[currentIndex];
    updateTopologyForEvent(ev);
    updateInspector(ev);
  }

  function updateCounter() {
    if (timelineCounter) {
      timelineCounter.textContent = `Event ${currentIndex + 1} of ${events.length}`;
    }
  }

  function clearRowHighlights() {
    if (!eventsTbody) return;
    const rows = eventsTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      r.className = "";
    });
  }

  function highlightRows() {
    if (!eventsTbody) return;
    const rows = eventsTbody.querySelectorAll("tr");
    rows.forEach((r, idx) => {
      if (idx === currentIndex) {
        r.className = "active-event-row";
        r.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if (idx < currentIndex) {
        r.className = "past-event-row";
      } else {
        r.className = "";
      }
    });
  }

  function resetTopology() {
    if (clientState) clientState.textContent = "IDLE";
    if (serverState) serverState.textContent = "IDLE";
    if (clientFd) clientFd.textContent = "—";
    if (serverFd) serverFd.textContent = "—";
    if (connChannel) connChannel.className = "connection-channel";
    if (channelStatus) channelStatus.textContent = "No active connection";
    if (packetAnim) packetAnim.className = "packet-flight";
    if (lifecycleState) {
      lifecycleState.className = "state-pill state-closed";
      lifecycleState.textContent = "CLOSED";
    }
    nodeClient?.classList.remove("active-node");
    nodeServer?.classList.remove("active-node");
  }

  function updateTopologyForEvent(ev) {
    if (!ev) return;

    const isClient = ev.process?.name === "client";
    const isServer = ev.process?.name === "server";

    if (isClient) {
      nodeClient?.classList.add("active-node");
      nodeServer?.classList.remove("active-node");
      if (clientPid) clientPid.textContent = `PID: ${ev.process.pid}`;
      if (ev.socket_fd && clientFd) clientFd.textContent = String(ev.socket_fd);
    } else if (isServer) {
      nodeServer?.classList.add("active-node");
      nodeClient?.classList.remove("active-node");
      if (serverPid) serverPid.textContent = `PID: ${ev.process.pid}`;
      if (ev.socket_fd && serverFd) serverFd.textContent = String(ev.socket_fd);
    }

    if (packetAnim) packetAnim.className = "packet-flight";

    switch (ev.event_type) {
      case "socket":
        if (isClient && clientState) clientState.textContent = "SOCKET_CREATED";
        if (isServer && serverState) serverState.textContent = "SOCKET_CREATED";
        break;

      case "bind":
        if (isServer && serverState) serverState.textContent = "BOUND (8080)";
        break;

      case "listen":
        if (isServer && serverState) serverState.textContent = "LISTENING";
        if (lifecycleState) {
          lifecycleState.className = "state-pill state-listen";
          lifecycleState.textContent = "LISTEN";
        }
        if (channelStatus) channelStatus.textContent = "Server listening on 127.0.0.1:8080";
        break;

      case "connect":
        if (isClient && clientState) clientState.textContent = "CONNECTING...";
        if (channelStatus) channelStatus.textContent = "TCP handshake initiated...";
        break;

      case "accept":
        if (isServer && serverState) serverState.textContent = "CLIENT_ACCEPTED";
        if (isClient && clientState) clientState.textContent = "ESTABLISHED";
        if (lifecycleState) {
          lifecycleState.className = "state-pill state-established";
          lifecycleState.textContent = "ESTABLISHED";
        }
        if (connChannel) connChannel.className = "connection-channel connected";
        if (channelStatus) channelStatus.textContent = "TCP Connection Established (fd=4)";
        break;

      case "send":
        if (lifecycleState) {
          lifecycleState.className = "state-pill state-datatransfer";
          lifecycleState.textContent = "DATA TRANSFER";
        }
        if (packetAnim && packetArrow && packetLabel) {
          packetAnim.className = "packet-flight active";
          if (isClient) {
            packetArrow.innerHTML = "&#8594;";
            packetLabel.textContent = `DATA (${ev.payload?.bytes || 0}B)`;
            if (channelStatus) channelStatus.textContent = `Client -> Server (${ev.payload?.bytes} bytes)`;
          } else {
            packetArrow.innerHTML = "&#8592;";
            packetLabel.textContent = `ECHO (${ev.payload?.bytes || 0}B)`;
            if (channelStatus) channelStatus.textContent = `Server -> Client Echo (${ev.payload?.bytes} bytes)`;
          }
        }
        break;

      case "recv":
        if (channelStatus) {
          channelStatus.textContent = `${ev.process.name} read ${ev.result} byte(s) successfully`;
        }
        break;

      case "close":
        if (isClient && clientState) clientState.textContent = "CLOSED";
        if (isServer && serverState) serverState.textContent = "CLIENT_CLOSED";
        if (channelStatus) channelStatus.textContent = `${ev.process.name} closed socket`;
        if (lifecycleState && currentIndex >= events.length - 2) {
          lifecycleState.className = "state-pill state-closed";
          lifecycleState.textContent = "CLOSED";
        }
        break;
    }
  }

  function clearInspector() {
    if (inspectorSeq) inspectorSeq.textContent = "Seq: -";
    if (inspEventType) inspEventType.textContent = "—";
    if (inspProcess) inspProcess.textContent = "—";
    if (inspResult) inspResult.textContent = "—";
    if (inspError) inspError.textContent = "null";
    if (inspJsonRaw) inspJsonRaw.textContent = "// Click any event on the timeline to inspect raw schema fields";
  }

  function updateInspector(ev) {
    if (!ev) return;
    if (inspectorSeq) inspectorSeq.textContent = `Seq: #${ev.sequence}`;
    if (inspEventType) inspEventType.textContent = ev.event_type;
    if (inspProcess) inspProcess.textContent = `${ev.process?.name} (PID ${ev.process?.pid})`;
    if (inspResult) inspResult.textContent = String(ev.result);
    if (inspError) inspError.textContent = ev.error_code !== null ? `${ev.error_code} (${ev.error_name || "ERR"})` : "null";

    if (inspJsonRaw) {
      inspJsonRaw.textContent = JSON.stringify(ev, null, 2);
    }
  }

  // Trigger initial event request
  vscode.postMessage({ type: "getDemoEvents" });
})();
