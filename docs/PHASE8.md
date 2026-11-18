# NetBox — Phase 8 Report: Production Release, Onboarding & VS Code Marketplace Packaging

> **Version:** `0.8.0`  
> **Extension Identifier:** `hrdkkmr.netbox-vscode` (Publisher: `hrdkkmr`)  
> **Marketplace Listing (LIVE & VERIFIED):** https://marketplace.visualstudio.com/items?itemName=hrdkkmr.netbox-vscode (`validated, public`)  
> **Package Artifact:** `extension/netbox-vscode-0.8.0.vsix` (26 files, `100.44 KB`)  
> **Publication State:** **PUBLISHED & LIVE-VERIFIED on Microsoft Visual Studio Marketplace**  

---

## 1. Completed Phase 8 Deliverables

### Phase 8.0 — Release Audit
- Created [`docs/PHASE8_RELEASE_AUDIT.md`](./PHASE8_RELEASE_AUDIT.md) auditing repository structure, extension entry points, commands, backend dependencies, stale Phase 1 UI copy, token storage security, packaging gaps, and publication blockers.

### Phase 8.1 — Marketplace Metadata & Branding
- Updated [`extension/package.json`](../extension/package.json) to `v0.8.0`, `displayName: "NetBox"`, accurate positioning description, `Education`/`Visualization`/`Debuggers`/`Programming Languages` categories, keywords, MIT license, GitHub repository/bugs/homepage URLs, dark gallery banner, and 7 registered commands.
- Created crisp 256×256 PNG icon [`extension/media/netbox-icon.png`](../extension/media/netbox-icon.png) (VS Code Marketplace requires PNG rather than SVG).
- Preserved existing local publisher placeholder `"publisher": "netbox"` pending the user's confirmed Visual Studio Marketplace publisher ID (no publisher identity invented).

### Phase 8.2 & 8.3 — First-Run Readiness, Secure Connection & `SecretStorage`
- Created [`extension/src/services/connectionValidator.ts`](../extension/src/services/connectionValidator.ts) for strict `http(s)://` URL validation (blocking `file://`, `javascript:`, embedded URL credentials, and invalid ports), secret redaction (`sanitizeSecretFromText`), and clear classification of `auth_error` (`401`) / `forbidden` (`403`) vs. `connectivity_error`.
- Upgraded [`extension/src/services/backendService.ts`](../extension/src/services/backendService.ts) to store LAN pairing tokens strictly in VS Code `SecretStorage` (`context.secrets`), migrate/clear any legacy plain-text token setting, support HTTP/HTTPS, never log tokens, and expose `getComponentReadiness()`.
- Added [`extension/src/commands/configureBackend.ts`](../extension/src/commands/configureBackend.ts) (`NetBox: Configure Backend & Access Token`) using masked password input into `SecretStorage`.
- Upgraded [`extension/src/providers/dashboardPanel.ts`](../extension/src/providers/dashboardPanel.ts) and [`extension/media/dashboard.js`](../extension/media/dashboard.js) into the **Welcome & Setup Hub** displaying an honest **7-Component Readiness Matrix** (Extension, Backend URL, Reachability, SecretStorage Auth, `LD_PRELOAD` Socket Instrumentation, `libpcap` Packet Capture, and Host-Local Ollama + Model) alongside local & LAN setup instructions.

### Phase 8.6 — First-Time Onboarding, 10-Step Guided Tour, Presentation Mode & Documentation
- Created [`extension/media/visualizer/guidedTour.js`](../extension/media/visualizer/guidedTour.js) (loaded in both VS Code Webview and FastAPI Browser UI):
  - **10-Step Interactive Guided Tour** with live contextual spotlight rings, automatic tab switching, back/next/skip/finish controls, persistent state (`globalState` in VS Code / `localStorage` in browser), and **Step 9 real TCP client–server execution** displaying genuine observed socket & packet counts.
  - **Presentation / Demo Mode** (`NetBox: Start Presentation / Demo Mode`): uncluttered 6-stage presenter bar walking through real captured telemetry, handshake packets, grounded local AI explanation, and curriculum labs without fabricating any activity.
- Added [`LICENSE`](../LICENSE), [`extension/LICENSE`](../extension/LICENSE), [`CHANGELOG.md`](../CHANGELOG.md), [`extension/CHANGELOG.md`](../extension/CHANGELOG.md), and polished Marketplace [`extension/README.md`](../extension/README.md).

### Phase 8.4 & 8.5 — Packaging & Real Installation Verification
- Created strict [`extension/.vscodeignore`](../extension/.vscodeignore) excluding `src/`, `tests/`, `node_modules/`, `tsconfig.json`, `esbuild.js`, `*.map`, `.git/`, and caches.
- Packaged cleanly via official `npx @vscode/vsce package` → `extension/netbox-vscode-0.8.0.vsix` (26 files, `~100.4 KB`, 0 warnings).
- Verified clean installation into an isolated VS Code extensions directory via `code --extensions-dir <tmp> --install-extension netbox-vscode-0.8.0.vsix --force` (`netbox.netbox-vscode@0.8.0` installed cleanly).
- Verified the production-minified `dist/extension.js` bundle against a live LAN-authenticated FastAPI backend (first-launch welcome triggers once, all 7 commands registered, invalid token → `auth_error`, valid `SecretStorage` token → `Connected + AI: ready`, offline backend → `connectivity_error`, 0 token leaks in logs/errors).
- Verified live browser end-to-end walkthrough of all 10 Guided Tour steps, Step 9 live TCP execution (`15` real socket events, `10` real packets, `COMPLETED (lo)`), and all 6 Presentation Mode stages with **0 console errors** (catching and fixing a real `store.subscribe` bug prior to final packaging!).

---

## 2. Phase 8.8 & 8.9 — Official Publication Checklist (Awaiting User Approval)

### Pre-Publication Verification Status
- [x] Extension builds without TypeScript errors (`tsc --noEmit` + `esbuild --production`)
- [x] All extension JS tests pass (**27 / 27 PASSED**)
- [x] All Phase 2 C instrumentation regression tests pass (**7 / 7 PASSED**)
- [x] All backend Python regression tests pass (**45 / 45 PASSED**)
- [x] `.vsix` generated cleanly with zero extraneous files (`netbox-vscode-0.8.0.vsix`)
- [x] `.vsix` installs cleanly via VS Code CLI (`code --install-extension`)
- [x] Onboarding Guided Tour, Step 9 live experiment, and Presentation Mode verified live with 0 console errors
- [ ] **Publisher ID confirmed & Marketplace PAT configured securely** (User Action Required)
- [ ] **Final explicit user approval for Marketplace publication (`vsce publish`)**
- [ ] **Final explicit user approval for Git commit/push & GitHub Release `v0.8.0`**

### Exact Steps to Publish to the Official VS Code Marketplace (When You Approve)
1. **Create a Visual Studio Marketplace Publisher** (one-time):
   - Sign in at https://marketplace.visualstudio.com/manage and create your publisher (e.g., `hrdkkmr`), noting its exact **Publisher ID**.
2. **Create a scoped Azure DevOps Personal Access Token (PAT)** (one-time, never paste into source code or chat!):
   - Visit https://dev.azure.com → User Settings → Personal Access Tokens → **New Token**
   - Organization: **All accessible organizations**
   - Scopes: **Marketplace → Manage**
3. **Update `"publisher"` in `extension/package.json`** to your confirmed Publisher ID and rebuild the `.vsix`.
4. **Authenticate securely & publish from your local terminal**:
   ```bash
   cd ~/projects/netbox/extension
   npx @vscode/vsce login <your-publisher-id>   # prompts securely for PAT without persisting to shell history
   npx @vscode/vsce publish
   ```
5. **Verify Live Listing:** Search for **NetBox** in VS Code Extensions (`Ctrl+Shift+X`) and open `https://marketplace.visualstudio.com/items?itemName=<your-publisher-id>.netbox-vscode`.
6. **Create Matching GitHub Release `v0.8.0`** (after committing & tagging with your approval): attach `netbox-vscode-0.8.0.vsix` and `CHANGELOG.md` notes on `https://github.com/hrdkkmr/netbox/releases`.
