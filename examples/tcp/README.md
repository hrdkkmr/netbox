# TCP Echo Client & Server Example (Phase 0)

A minimal POSIX C11 TCP echo server and client communicating over loopback (`127.0.0.1:8080`).

## Build

From the repository root (`~/projects/netbox`):

```bash
make all
```

Or build targets individually:

```bash
make server
make client
```

Remove compiled binaries:

```bash
make clean
```

## Run

1. **Terminal 1 — Start the server:**
   ```bash
   ./examples/tcp/server
   ```
   The server binds to `127.0.0.1:8080`, handles multiple clients sequentially, and closes cleanly on `Ctrl+C` (`SIGINT`).

2. **Terminal 2 — Run the client:**
   ```bash
   ./examples/tcp/client
   ```
   Or pass a custom message:
   ```bash
   ./examples/tcp/client "Test message from NetBox"
   ```

## Error Scenarios Covered

- **Server not running:** Running `./examples/tcp/client` before `./examples/tcp/server` prints `[client] connect: Connection refused`, closes the socket, and exits with failure status (`1`).
- **Empty / oversized / invalid CLI input:** Passing `""`, a message `>= 4096` bytes, or extra arguments is rejected cleanly before creating a socket.
- **Abrupt or 0-byte client disconnect:** Server logs client closure, closes `client_fd`, and continues listening for subsequent clients.
- **Port already in use (`SO_REUSEADDR` note):** On a real Linux kernel (WSL 2), starting a second `./examples/tcp/server` while `127.0.0.1:8080` is actively listening fails at `bind()` with `Address already in use`. On **WSL 1**, `SO_REUSEADDR` inherits Windows Winsock semantics and can permit binding a second socket onto an active port — another reason migrating to WSL 2 is recommended before Phase 1+.
