# NetBox — Phase 8 Release Audit

> **Audit Date:** 2026-11-18  
> **Repository:** `https://github.com/hrdkkmr/netbox` (branch `main`, base commit `bfd8cd9` + Phases 3–7 uncommitted work preserved)  
> **Audited Backend Version:** `0.7.0`  
> **Audited Extension Version:** `0.1.0` (stale Phase 1 version; must align to `0.8.0` for Phase 8 production release)  

---

## 1. Existing Architecture Verified

- **Backend (`backend/app/`):** FastAPI + Uvicorn (`v0.7.0`) providing:
  - Phase 1–2 execution & `LD_PRELOAD` socket API telemetry (`/api/runs`, `/api/runs/{id}/events`)
  - Phase 4 `libpcap` packet capture, TCP flow analysis & 4-tuple correlation (`/packets`, `/flows`, `/correlations`)
  - Phase 5 Grounded Local AI Assistant on host-local Ollama (`127.0.0.1:11434`, zero cloud fallback)
  - Phase 6 NetBox Core & LAN hosting (`/api/system/*`, pairing token auth, standalone browser Web UI at `GET /` & `/media/*`)
  - Phase 7 9-module Computer Networks curriculum, safe experiment runner, deterministic subnet calculator, assessments, persisted local progress, and 5-mode grounded AI tutor (`/api/curriculum/*`, `/api/ai/curriculum/interact`)
- **VS Code Extension (`extension/`):**
  - Entry point: `extension/dist/extension.js` bundled from `extension/src/extension.ts` via `esbuild.js` (`external: ["vscode"]`)
  - Existing Commands: `netbox.openDashboard`, `netbox.openVisualizer`, `netbox.checkBackend`, `netbox.showProjectInfo`
  - Existing Views: Activity Bar container `netbox-sidebar`, tree view `netbox.quickActions`, `DashboardPanel`, `VisualizerPanel`
  - Media Assets: `media/dashboard.{css,js}`, `media/visualizer.{css,js}`, `media/visualizer/*.js` (12 UMD modules), `media/netbox-icon.svg`
- **External / Backend Runtime Dependencies (NOT bundled in `.vsix`):**
  - Python 3 + FastAPI/Uvicorn backend (`backend/.venv`)
  - Linux `gcc` + `libnetbox_trace.so` (`LD_PRELOAD` socket tracing)
  - Optional `libpcap-dev` + `packet_capture/netbox_pcap` (`cap_net_raw,cap_net_admin=eip`)
  - Optional host-local Ollama runtime (`127.0.0.1:11434`) + quantized model (e.g., `qwen2.5-coder:1.5b`)
- **Pre-Audit Verification Baseline:**
  - Phase 2 C instrumentation regression (`instrumentation/tests/test_suite.py`): **7 / 7 PASSED**
  - Backend Python tests (Phases 4–7): **45 / 45 PASSED**
  - Extension TypeScript check (`tsc --noEmit`), `esbuild` build, and JS tests (`node --test`): **25 / 25 PASSED**
  - All 9 original PDFs in `cn_lab/` verified untouched.
  - VS Code CLI verified installed (`code 1.146.0` on Windows host).

---

## 2. Packaging & Marketplace Readiness Gaps Identified

| # | Area | Current Gap | Required Phase 8 Remediation |
| :--- | :--- | :--- | :--- |
| 1 | **Publisher Identity** | `extension/package.json` has placeholder `"publisher": "netbox"` | Do NOT invent or claim an existing Marketplace publisher; prompt user for confirmed Visual Studio Marketplace Publisher ID before `vsce publish`. |
| 2 | **Version Alignment** | Extension is `0.1.0`, backend is `0.7.0` | Align release version cleanly to `0.8.0` across `extension/package.json`, backend `APP_VERSION`, `CHANGELOG.md`, and release notes. |
| 3 | **Marketplace Metadata** | Missing `icon` (PNG), `keywords`, `repository`, `bugs`, `homepage`, `license`, `galleryBanner`, accurate `displayName: "NetBox"` & `categories` | Populate complete, honest Marketplace metadata; generate crisp 256×256 PNG icon (`extension/media/netbox-icon.png`) since VS Code Marketplace rejects SVG icons. |
| 4 | **`.vscodeignore` Missing** | No `extension/.vscodeignore`; packaging would bundle `src/`, `tests/`, `tsconfig.json`, `esbuild.js`, `package-lock.json` | Add strict `extension/.vscodeignore` shipping only `dist/extension.js`, `media/**`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`. |
| 5 | **Extension README / CHANGELOG / LICENSE** | Missing `extension/README.md`, `extension/CHANGELOG.md`, root `CHANGELOG.md`, and `LICENSE` | Author polished Marketplace `extension/README.md`, `CHANGELOG.md`, and MIT `LICENSE`. |
| 6 | **Token Security (`SecretStorage`)** | `netbox.accessToken` stored in plain-text VS Code `settings.json`; no URL validation or auth-vs-connectivity distinction | Store LAN access tokens in VS Code `ExtensionContext.secrets` (`SecretStorage`), validate `http(s)://` URLs, never log tokens or include them in errors, and distinguish `401/403` auth failures from network/connectivity failures. |
| 7 | **Stale Phase 1 Dashboard & Missing First-Run Onboarding** | `DashboardPanel` displays outdated `"Phase 1"` / `"Simulated"` copy; `extension.ts` fires a popup on every activation | Replace stale copy with Phase 8.2/8.6 Welcome & Setup Hub showing independent 7-item component readiness (`Extension`, `Backend Configured`, `Backend Reachable`, `Socket Instrumentation`, `Packet Capture`, `Ollama`, `AI Model`), first-launch onboarding, 10-step Interactive Guided Tour highlighting live UI elements + real TCP experiment, persistent onboarding state, and Presentation / Demo Mode. |
| 8 | **Real `.vsix` Packaging & Clean Install Test** | Never packaged with `@vscode/vsce` or installed into an isolated VS Code extensions directory | Package with `@vscode/vsce package`, inspect every file inside the `.vsix`, install cleanly via `code --extensions-dir <isolated_dir> --install-extension`, and verify activation, commands, connection, auth, onboarding, labs, and AI states. |

---

## 3. Release Blockers Before Public Marketplace Publication (Phase 8.8 Gate)

1. **Confirmed Visual Studio Marketplace Publisher Account & ID:** User must create/confirm their publisher ID at `https://marketplace.visualstudio.com/manage` and supply a Personal Access Token (PAT) securely via `npx @vscode/vsce login <publisher>` (never committed to repo or logs).
2. **Explicit Final Approval:** Per Phase 8.8 and project rules, do not run `vsce publish`, `git commit`, `git push`, or GitHub Release creation without explicit user confirmation after inspecting the final `.vsix` build and test results.
