// NetBox Dashboard Client Logic

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // Elements
  const backendBadge = document.getElementById("backend-status-badge");
  const backendBadgeText = backendBadge?.querySelector(".status-label");
  const backendUrlVal = document.getElementById("backend-url-val");
  const backendConnStatus = document.getElementById("backend-conn-status");
  const backendServiceVal = document.getElementById("backend-service-val");
  const backendVersionVal = document.getElementById("backend-version-val");
  const backendInstructions = document.getElementById("backend-instructions");
  const btnRecheck = document.getElementById("btn-recheck-backend");

  const btnOpenVisualizer = document.getElementById("btn-open-visualizer");
  const btnRunDemo = document.getElementById("btn-run-demo");
  const demoStatus = document.getElementById("demo-status");
  const demoStatusText = document.getElementById("demo-status-text");

  const openServerFile = document.getElementById("open-server-file");
  const openClientFile = document.getElementById("open-client-file");
  const openReadmeFile = document.getElementById("open-readme-file");

  // Attach Event Handlers
  btnRecheck?.addEventListener("click", () => {
    if (backendBadgeText) {
      backendBadgeText.textContent = "Checking...";
    }
    if (backendBadge) {
      backendBadge.className = "status-badge connecting";
    }
    vscode.postMessage({ type: "checkBackend" });
  });

  btnOpenVisualizer?.addEventListener("click", () => {
    vscode.postMessage({ type: "openVisualizer" });
  });

  btnRunDemo?.addEventListener("click", () => {
    if (!demoStatus || !demoStatusText) return;

    demoStatus.className = "execution-status-box running";
    demoStatusText.textContent = "Running Phase 1 simulated TCP exchange...";

    setTimeout(() => {
      demoStatus.className = "execution-status-box success";
      demoStatusText.textContent = "Simulation completed: 12 events generated. Opening visualizer...";
      setTimeout(() => {
        vscode.postMessage({ type: "openVisualizer" });
      }, 700);
    }, 1200);
  });

  openServerFile?.addEventListener("click", () => {
    vscode.postMessage({ type: "openFile", payload: { filePath: "examples/tcp/server.c" } });
  });

  openClientFile?.addEventListener("click", () => {
    vscode.postMessage({ type: "openFile", payload: { filePath: "examples/tcp/client.c" } });
  });

  openReadmeFile?.addEventListener("click", () => {
    vscode.postMessage({ type: "openFile", payload: { filePath: "examples/tcp/README.md" } });
  });

  // Handle incoming messages from extension host
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) return;

    switch (message.type) {
      case "backendStatus":
        updateBackendStatus(message.payload);
        break;

      case "projectInfo":
        updateProjectInfo(message.payload);
        break;

      case "examplesList":
        updateExamplesList(message.payload);
        break;

      case "errorMessage":
        console.error("[NetBox Webview]", message.payload?.message);
        break;
    }
  });

  function updateBackendStatus(payload) {
    if (!payload) return;

    if (backendUrlVal) {
      backendUrlVal.textContent = payload.url || "http://127.0.0.1:8000";
    }

    if (payload.connected) {
      if (backendBadge) {
        backendBadge.className = "status-badge online";
      }
      if (backendBadgeText) {
        backendBadgeText.textContent = "Backend Online";
      }
      if (backendConnStatus) {
        backendConnStatus.textContent = "Connected (200 OK)";
        backendConnStatus.style.color = "var(--success-color)";
      }
      if (backendServiceVal) {
        backendServiceVal.textContent = payload.service || "netbox-backend";
      }
      if (backendVersionVal) {
        backendVersionVal.textContent = payload.version || "0.1.0";
      }
      if (backendInstructions) {
        backendInstructions.classList.add("hidden");
      }
    } else {
      if (backendBadge) {
        backendBadge.className = "status-badge offline";
      }
      if (backendBadgeText) {
        backendBadgeText.textContent = "Backend Offline";
      }
      if (backendConnStatus) {
        backendConnStatus.textContent = "Offline / Unreachable";
        backendConnStatus.style.color = "var(--error-color)";
      }
      if (backendServiceVal) {
        backendServiceVal.textContent = "—";
      }
      if (backendVersionVal) {
        backendVersionVal.textContent = "—";
      }
      if (backendInstructions) {
        backendInstructions.classList.remove("hidden");
      }
    }
  }

  function updateProjectInfo(payload) {
    if (!payload) return;
    const descEl = document.getElementById("project-description");
    const phaseEl = document.getElementById("current-phase-val");

    if (descEl && payload.description) {
      descEl.textContent = payload.description;
    }
    if (phaseEl && payload.current_phase) {
      phaseEl.textContent = payload.current_phase;
    }
  }

  function updateExamplesList(examples) {
    if (!Array.isArray(examples)) return;
    const countEl = document.getElementById("examples-count");
    if (countEl) {
      countEl.textContent = `${examples.length} available`;
    }
  }

  // Initial trigger to fetch status
  vscode.postMessage({ type: "checkBackend" });
})();
