// NetBox Welcome & Component Readiness Dashboard Client Logic (Phase 8)
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const badge = document.getElementById("backend-status-badge");
  const badgeLabel = badge?.querySelector(".status-label");
  const summaryBanner = document.getElementById("readiness-summary-banner");

  const compUrl = document.getElementById("comp-url");
  const compReach = document.getElementById("comp-reach");
  const compAuth = document.getElementById("comp-auth");
  const compSock = document.getElementById("comp-sock");
  const compPcap = document.getElementById("comp-pcap");
  const compAi = document.getElementById("comp-ai");

  document.getElementById("btn-recheck-backend")?.addEventListener("click", () => {
    if (badgeLabel) badgeLabel.textContent = "Checking...";
    if (badge) badge.className = "status-badge connecting";
    vscode.postMessage({ type: "checkBackend" });
  });

  document.getElementById("btn-open-visualizer")?.addEventListener("click", () => {
    vscode.postMessage({ type: "openVisualizer" });
  });

  document.getElementById("btn-start-tour")?.addEventListener("click", () => {
    vscode.postMessage({ type: "startGuidedTour" });
  });

  document.getElementById("btn-configure-backend")?.addEventListener("click", () => {
    vscode.postMessage({ type: "configureBackend" });
  });

  document.getElementById("btn-presentation-mode")?.addEventListener("click", () => {
    vscode.postMessage({ type: "startPresentationMode" });
  });

  document.getElementById("btn-view-docs")?.addEventListener("click", () => {
    vscode.postMessage({ type: "openDocs" });
  });

  function setStatus(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.style.color = ok === true ? "var(--success-color, #34d399)" : ok === false ? "var(--error-color, #f87171)" : "#fbbf24";
  }

  function renderReadiness(r) {
    if (!r) return;
    if (compUrl) compUrl.textContent = r.backendUrl || "http://127.0.0.1:8000";

    if (!r.backendConfigured) {
      if (badge) badge.className = "status-badge offline";
      if (badgeLabel) badgeLabel.textContent = "Invalid Backend URL";
      setStatus(compReach, "Not checked (invalid URL)", false);
      setStatus(compAuth, "—", false);
      setStatus(compSock, "Unavailable", false);
      setStatus(compPcap, "Unavailable", false);
      setStatus(compAi, "Unavailable", false);
      if (summaryBanner) {
        summaryBanner.classList.remove("hidden");
        summaryBanner.textContent = r.errorDetail || "Configure a valid http:// or https:// NetBox backend URL.";
      }
      return;
    }

    if (!r.backendReachable) {
      if (badge) badge.className = "status-badge offline";
      if (badgeLabel) badgeLabel.textContent = "Backend Unreachable";
      setStatus(compReach, `Offline (${r.errorDetail || "connection refused"})`, false);
      setStatus(compAuth, r.hasStoredToken ? "Token stored (unverified while offline)" : "No token stored", null);
      setStatus(compSock, "Unavailable (backend offline)", false);
      setStatus(compPcap, "Unavailable (backend offline)", false);
      setStatus(compAi, "Unavailable (backend offline)", false);
      if (summaryBanner) {
        summaryBanner.classList.remove("hidden");
        summaryBanner.textContent =
          "Backend is not reachable. Start your local NetBox host with './scripts/start_netbox.sh' or click 'Connect to NetBox Backend' to point at a LAN host.";
      }
      return;
    }

    setStatus(compReach, `Reachable (v${r.backendVersion || "0.8.0"}, ${r.mode || "localhost"} mode)`, true);

    if (r.authenticated) {
      setStatus(compAuth, r.hasStoredToken ? "Authenticated (SecretStorage token)" : "Authenticated (Localhost)", true);
    } else {
      setStatus(compAuth, `Auth Required / Failed (${r.errorDetail || "401 Unauthorized"})`, false);
    }

    const sockOk = r.socketInstrumentation && r.socketInstrumentation.status === "running";
    setStatus(compSock, `${(r.socketInstrumentation?.status || "unavailable").toUpperCase()} — ${r.socketInstrumentation?.detail || ""}`, sockOk ? true : null);

    const pcapOk = r.packetCapture && r.packetCapture.status === "running";
    setStatus(compPcap, `${(r.packetCapture?.status || "unavailable").toUpperCase()} — ${r.packetCapture?.detail || ""}`, pcapOk ? true : null);

    const aiReady = r.ollama?.status === "running" && r.aiModel?.status === "running";
    const aiText = aiReady
      ? `READY — ${r.aiModel?.detail || "Ollama ready"}`
      : `${(r.ollama?.status || "unavailable").toUpperCase()} — ${r.aiModel?.detail || r.ollama?.detail || "Ollama unavailable"}`;
    setStatus(compAi, aiText, aiReady ? true : null);

    const fullyReady = r.backendReachable && r.authenticated && sockOk && pcapOk && aiReady;
    if (!r.authenticated) {
      if (badge) badge.className = "status-badge offline";
      if (badgeLabel) badgeLabel.textContent = "Auth Required";
      if (summaryBanner) {
        summaryBanner.classList.remove("hidden");
        summaryBanner.textContent =
          "Backend is reachable, but LAN authentication failed. Click 'Connect to NetBox Backend' to enter the host pairing token securely.";
      }
    } else if (fullyReady) {
      if (badge) badge.className = "status-badge online";
      if (badgeLabel) badgeLabel.textContent = "All Systems Ready";
      if (summaryBanner) summaryBanner.classList.add("hidden");
    } else {
      if (badge) badge.className = "status-badge connecting";
      if (badgeLabel) badgeLabel.textContent = "Connected (Partial Components)";
      if (summaryBanner) {
        summaryBanner.classList.remove("hidden");
        summaryBanner.textContent =
          "Backend is connected, though optional components (packet capture or local Ollama AI) are not fully active. Core labs and visualization remain usable.";
      }
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "readinessReport") {
      renderReadiness(msg.payload);
    }
  });

  vscode.postMessage({ type: "checkBackend" });
})();
