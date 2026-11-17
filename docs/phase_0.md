# Phase 0 Checklist & Exit Criteria

This checklist tracks all deliverables, verification steps, and exit criteria required to complete **Phase 0 — Foundation**.

---

## 1. Deliverables Checklist

- [x] **Repository Inspection & Preservation:** Inspected full directory tree; preserved all 9 PDFs in [`cn_lab/`](../cn_lab/) unmodified.
- [x] **CN Lab Material Analysis:** Created [`docs/cn_lab_index.md`](./cn_lab_index.md) covering `lab1.pdf` through `lab9.pdf`, separating PDF facts from NetBox visualizer recommendations and documenting missing/unclear items.
- [x] **Environment Audit:** Created [`docs/environment_audit.md`](./environment_audit.md) and read-only [`scripts/check_environment.sh`](../scripts/check_environment.sh) documenting WSL 1 status, compiler/tool versions, stale `apt` indexes, and VS Code WSL integration state.
- [x] **Architecture Documentation:** Created [`docs/architecture.md`](./architecture.md) defining NetBox Core, NetBox CN Assistant, execution pipeline, risks, and open decisions.
- [x] **TCP Server & Client Example:** Implemented [`examples/tcp/server.c`](../examples/tcp/server.c), [`examples/tcp/client.c`](../examples/tcp/client.c), and [`examples/tcp/README.md`](../examples/tcp/README.md) using POSIX sockets on `127.0.0.1:8080`.
- [x] **Makefile:** Created root [`Makefile`](../Makefile) with `server`, `client`, `all`, and `clean` targets using `-std=c11 -Wall -Wextra -Wpedantic -g`.
- [x] **Event Schema:** Created [`docs/event_schema.md`](./event_schema.md) defining v1.0 JSON event format with strict separation of `socket_api` and `packet_capture`.
- [x] **Roadmap & Decision Log:** Created [`docs/roadmap.md`](./roadmap.md) and [`docs/decisions.md`](./decisions.md).
- [x] **Root README & `.gitignore`:** Created [`README.md`](../README.md) and [`.gitignore`](../.gitignore).

---

## 2. Verification Commands (Executed & Passed in Phase 0)

Run from `~/projects/netbox` inside Ubuntu WSL:

```bash
# 1. Environment check (read-only)
./scripts/check_environment.sh

# 2. Build verification
make clean
make server
make client
make clean
make all

# 3. Invalid connection test (server stopped -> expects connect: Connection refused, exit 1)
./examples/tcp/client

# 4. Invalid argument test (empty message -> expects error, exit 1)
./examples/tcp/client ""

# 5. Live echo + sequential clients + clean shutdown
# Terminal 1:
./examples/tcp/server
# Terminal 2:
./examples/tcp/client
./examples/tcp/client "NetBox sequential echo test"
# Stop Terminal 1 with Ctrl+C (SIGINT -> clean socket close, exit 0)
```

---

## 3. Known Blockers & Manual Actions Required Before Phase 1

These items do **not** block Phase 0 C compilation/testing, but **must** be resolved before starting **Phase 1**:

1. **Ubuntu is running on WSL 1 (`docker-desktop` is WSL 2 and set as default):**
   - Run in Windows PowerShell:
     ```powershell
     wsl --shutdown
     wsl --set-version Ubuntu 2
     wsl --set-default Ubuntu
     wsl -l -v
     ```
2. **Stale `apt` package indexes (last updated `2026-09-01`, 72 days old as of `2026-11-12`):**
   - After migrating to WSL 2, refresh package indexes inside Ubuntu:
     ```bash
     sudo apt update
     ```
   - Install later-phase utilities (`strace`, `python3-venv`, and Node.js once decided in Phase 1).
3. **VS Code WSL Integration not active:**
   - Install `ms-vscode-remote.remote-wsl` in VS Code on Windows and reopen `~/projects/netbox` inside WSL 2.
4. **Git repository not yet initialized:**
   - Decide when to run `git init` in `~/projects/netbox` if version control is desired before Phase 1.

---

## 4. Phase 0 Exit Criteria

Phase 0 is ready to be marked **Complete** once:
1. All checklist items in Section 1 and verification commands in Section 2 pass (verified).
2. The user reviews the generated documentation, CN lab index, environment audit, and TCP test results.
3. The user explicitly approves proceeding toward Phase 1 (after completing the WSL 2 migration steps above).
