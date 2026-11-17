# Environment Audit

**Audit Date:** 2026-11-12  
**Project Directory:** `~/projects/netbox` (`\\wsl.localhost\Ubuntu\home\hardik_kumar\projects\netbox`)

---

## 1. Detected Environment

| Property | Observed Value |
| :--- | :--- |
| **Host OS** | Windows 11 (`Hardik-Laptop`) |
| **WSL Distribution** | `Ubuntu` — Ubuntu 26.04 LTS (`Resolute Raccoon`) |
| **WSL Version (`Ubuntu`)** | **WSL 1** (`VERSION: 1`, State: `Running`) |
| **Default WSL Distribution** | `docker-desktop` (`*`, `VERSION: 2`, State: `Stopped`) |
| **Linux Kernel (in Ubuntu)** | `4.4.0-26100-Microsoft #9818-Microsoft` (`x86_64`) |
| **CPU** | Intel Core Ultra 5 125H — **18** logical processors |
| **Memory** | **15 GiB** visible in WSL (`16 GB` physical RAM), ~844 MiB free at audit time, 39 GiB swap |

---

## 2. Available Tools & Versions (Inside Ubuntu WSL)

All tools below were verified directly via read-only commands inside `wsl -d Ubuntu`:

| Tool / Package | Status | Observed Version / Path | Notes |
| :--- | :--- | :--- | :--- |
| `gcc` | Installed | `15.2.0` (`/usr/bin/gcc`) | Working |
| `g++` | Installed | `15.2.0` (`/usr/bin/g++`) | Working |
| `make` | Installed | GNU Make `4.4.1` (`/usr/bin/make`) | Working |
| `gdb` | Installed | GNU gdb `17.1` (`/usr/bin/gdb`) | `gdb-multiarch` also installed |
| `build-essential` | Installed | `12.12ubuntu2.26.04.2` | `dpkg` state: `ii` |
| `curl` | Installed | `8.18.0` (`/usr/bin/curl`) | Working |
| `git` | Installed | `2.53.0` (`/usr/bin/git`) | Repo is not yet `git init`'d |
| `gh` | Installed | `2.46.0-4` (`/usr/bin/gh`) | GitHub CLI |
| `python3` | Installed | `3.14.4` (`/usr/bin/python3`) | Working |
| `iproute2` (`ip`, `ss`) | Installed | `6.19.0-1ubuntu1` (`/usr/sbin/ip`, `/usr/bin/ss`) | `ip addr show lo` succeeds |
| `iputils-ping` (`ping`) | Installed | `3:20250605-1ubuntu1` (`/usr/bin/ping`) | `ping -c 1 127.0.0.1` succeeds (0% loss) |
| `netcat-openbsd` (`nc`) | Installed | `/usr/bin/nc`, `/usr/bin/netcat` | Installed |

---

## 3. Missing / Unavailable Dependencies

| Dependency | Status | Details & Impact |
| :--- | :--- | :--- |
| `strace` | **Missing** | `command not found`; candidate `6.19+ds-0ubuntu5` in `apt`. Not needed for Phase 0; useful for syscall debugging in Phase 2. |
| `python3-venv` / `python3.14-venv` (`ensurepip`) | **Missing** | `python3 -m ensurepip --version` fails (`No module named ensurepip`). `python3 -m venv --help` works, so `--without-pip` works, while standard `venv` creation with `pip` requires installing `python3-venv` / `python3.14-venv`. Not needed for Phase 0. |
| Linux `node` / `npm` | **Missing (Intentionally deferred)** | No native Linux Node.js installed in Ubuntu. Running `npm` resolves via Windows interop to `/mnt/c/Program Files/nodejs//npm`, which exits with error: `WSL 1 is not supported. Please upgrade to WSL 2 or above.` Per Phase 0 scope, Node.js is **not** installed yet. |
| `tcpdump` / `libpcap-dev` | **Missing** | Not installed (`tcpdump` candidate `4.99.6-1`, `libpcap-dev` candidate `1.10.6-1ubuntu1`). Not needed until Phase 4. |
| VS Code Remote-WSL (`ms-vscode-remote.remote-wsl`) | **Missing** | `code --list-extensions` on Windows shows `ms-vscode-remote.remote-containers@0.469.0`, but `ms-vscode-remote.remote-wsl` is **not** installed and `~/.vscode-server` does not exist inside Ubuntu. |

---

## 4. WSL Version Status & Why WSL 2 Is Required

### Current Status
`wsl -l -v` reports:
- `docker-desktop` — Version **2**, Stopped (**currently set as default `*`**)
- `Ubuntu` — Version **1**, Running

Because `Ubuntu` is on **WSL 1**, it runs on Microsoft's syscall translation kernel (`4.4.0-26100-Microsoft`) rather than a real Linux kernel, and `docker-desktop` being the default distro causes bare `wsl <cmd>` invocations without `-d Ubuntu` to fail trying to run inside `docker-desktop`.

### Why WSL 2 Is Needed for NetBox
WSL 1 is sufficient for compiling and running basic Phase 0 POSIX loopback TCP code, but **WSL 2 is required for NetBox's later phases**:
1. **Packet Capture (Phase 4):** `tcpdump`, `libpcap`, and `AF_PACKET` raw sockets require a real Linux kernel network stack; WSL 1 lacks full raw packet capture and Linux kernel `netfilter`/packet socket support.
2. **Syscall & Socket Tracing (Phase 2):** `strace` (`ptrace` edge cases), socket options, and `LD_PRELOAD` behavior across `fork()`/`exec()` are reliable on a real Linux kernel in WSL 2, whereas WSL 1 syscall translation has known incompatibilities (for example, during Phase 0 testing we observed that `SO_REUSEADDR` on WSL 1 inherits Windows Winsock semantics and allows binding a second listening socket on `127.0.0.1:8080`, unlike Linux/WSL 2 where `bind()` rejects an active listener with `EADDRINUSE`).
3. **Node.js & VS Code Extension Host (Phase 1):** Windows Node.js/npm explicitly rejects WSL 1 (`WSL 1 is not supported`), and modern VS Code Remote-WSL (`~/.vscode-server`) and Node.js tooling target WSL 2.
4. **LAN / Hotspot & Service Hosting (Phase 6):** Predictable Linux networking interfaces, port forwarding / mirrored networking mode, and local service isolation require WSL 2's virtualized Linux network stack.

### Manual Migration Steps (For User Execution)
> **Note:** No distribution conversion or Windows configuration changes were performed automatically.

Run the following commands in **Windows PowerShell** (not inside Ubuntu):

1. Terminate running WSL instances cleanly:
   ```powershell
   wsl --shutdown
   ```
2. Convert `Ubuntu` from WSL 1 to WSL 2 (this may take several minutes; ensure Virtual Machine Platform / Hyper-V features are enabled in Windows):
   ```powershell
   wsl --set-version Ubuntu 2
   ```
3. Set `Ubuntu` as your default WSL distribution (so `wsl` commands target `Ubuntu` instead of `docker-desktop`):
   ```powershell
   wsl --set-default Ubuntu
   ```
4. Verify the migration:
   ```powershell
   wsl -l -v
   ```
   Expected result: `Ubuntu` listed with `*`, `VERSION 2`.
5. Inside Ubuntu, verify the Linux kernel version shows `WSL2` (e.g., `uname -r`).

---

## 5. `apt` Package Database & Partial Install Audit

- **`dpkg --audit`:** Returned empty (exit code `0`) — no broken or half-configured packages.
- **`dpkg -l` non-`ii` check:** **0** non-installed/half-installed packages (`build-essential`, `gdb`, `iproute2`, `iputils-ping`, and `gh` all completed cleanly).
- **`/var/log/apt/history.log`:** Shows the last recorded `apt` installs succeeded on `2026-09-01` (`build-essential`, `gdb`, `make`, `python3`, etc.) and `2026-09-08` (`gh`).
- **Why previous `apt` downloads failed with 404 errors:**
  - The cached package indexes in `/var/lib/apt/lists/` are **stale** — last refreshed around **`2026-09-01`** (over 2 months old as of `2026-11-12`).
  - Ubuntu `resolute-updates` and `resolute-security` mirrors rotate superseded `.deb` package versions out of the archive, so attempting `apt install` against 2-month-old `Packages` lists produces HTTP `404 Not Found`.
- **Recommended Action (run when ready to install packages, after WSL 2 migration):**
  ```bash
  sudo apt update
  ```
  *(Optionally followed later by `sudo apt install -y strace python3-venv` when needed.)*

---

## 6. VS Code WSL Integration Status

- Windows VS Code CLI (`code`) is accessible from WSL via Windows PATH interop (`/mnt/c/Users/Hardik Kumar/AppData/Local/Programs/Microsoft VS Code/bin/code`).
- However, **VS Code WSL integration is not yet active**:
  - `ms-vscode-remote.remote-wsl` is missing from Windows VS Code extensions.
  - `/home/hardik_kumar/.vscode-server` does not exist in Ubuntu.
- **Recommended Action:**
  1. Migrate `Ubuntu` to WSL 2.
  2. Install the **WSL** extension (`ms-vscode-remote.remote-wsl`) in VS Code on Windows.
  3. Open the repository inside WSL (`code --remote wsl+Ubuntu ~/projects/netbox` or via the VS Code Remote indicator `><` → *Connect to WSL*).

---

## 7. Phase 0 Readiness Verdict

- **Ready for Phase 0:** **YES.**
  - GCC 15.2.0, Make 4.4.1, `build-essential`, `iproute2`, `iputils-ping`, Python 3.14.4, Git 2.53.0, and POSIX loopback TCP sockets (`127.0.0.1`) are all installed and verified working in `Ubuntu` right now.
- **Blocking for Phase 1+:**
  - `Ubuntu` must be migrated from **WSL 1 → WSL 2**.
  - `sudo apt update` must be run before installing `strace`, `python3-venv`, `tcpdump`, or `libpcap-dev`.
  - VS Code `ms-vscode-remote.remote-wsl` and a Linux Node.js setup (decided in Phase 1) must be configured before VS Code extension development.
