# NetBox Socket Instrumentation Library (`libnetbox_trace.so`)

`libnetbox_trace.so` is a user-space C dynamic shared library that intercepts POSIX socket API calls via Linux `LD_PRELOAD` and outputs structured JSONL events conforming to [`docs/event_schema.md`](../docs/event_schema.md) v1.0.

## Architecture & How It Works

1. **Symbol Interception:** Uses `dlsym(RTLD_NEXT, ...)` to locate the next libc symbols and transparently wraps them.
2. **Re-entrancy Prevention:** Implements a thread-local guard (`__thread int in_trace_hook`) ensuring any call triggered within an intercepted hook or logger bypasses instrumentation.
3. **Dedicated Output Transport:** Uses direct `write()` to a file descriptor or dedicated JSONL file (`NETBOX_EVENT_FILE`), bypassing intercepted socket APIs.
4. **Metadata Tracking:** Maintains an in-memory thread-safe registry of active socket file descriptors, their domains, types, and bound/connected IPv4 endpoints.
5. **Privacy Default:** Records requested and transferred byte counts without logging raw application data payloads.

## Intercepted Functions

| Function | Operation Recorded |
| :--- | :--- |
| `socket()` | Domain, type, protocol, allocated socket file descriptor |
| `bind()` | Bound local IP address and port |
| `listen()` | Listening state flag on server socket |
| `accept()`, `accept4()` | Accepted client socket descriptor, local & remote IP and ports |
| `connect()` | Target remote IP & port, local ephemeral port, connection result |
| `send()`, `sendto()` | Bytes transferred, local & remote endpoints, errors |
| `recv()`, `recvfrom()` | Bytes received, local & remote endpoints, clean EOF (0 bytes) |
| `shutdown()` | Half-close direction |
| `close()` | Socket release and metadata untracking (non-socket FDs bypass logging) |

## Build

From repository root:
```bash
make instrumentation
```
Or directly inside `instrumentation/`:
```bash
make
```

## Environment Variables

- `NETBOX_RUN_ID`: Execution run identifier string (default: `"run_default"`).
- `NETBOX_PROCESS_NAME`: Process name label (`"server"`, `"client"`, etc.). If unset, reads from `/proc/self/comm`.
- `NETBOX_EVENT_FILE`: Path to write JSONL events (default: `stderr`).

## Standalone Usage Example

```bash
# Terminal 1: Run server under instrumentation
NETBOX_RUN_ID=demo_01 NETBOX_PROCESS_NAME=server NETBOX_EVENT_FILE=/tmp/server.jsonl \
  LD_PRELOAD=./instrumentation/libnetbox_trace.so ./examples/tcp/server

# Terminal 2: Run client under instrumentation
NETBOX_RUN_ID=demo_01 NETBOX_PROCESS_NAME=client NETBOX_EVENT_FILE=/tmp/client.jsonl \
  LD_PRELOAD=./instrumentation/libnetbox_trace.so ./examples/tcp/client "Testing NetBox Phase 2"
```

## Technical Limitations

- **Dynamic Linking:** Intercepts dynamically linked binaries calling standard libc socket functions. Statically linked binaries or direct `syscall` instructions bypass `LD_PRELOAD`.
- **User-space Observation:** Captures POSIX socket API layer (`source: "socket_api"`), not raw wire-level network packets (`source: "packet_capture"`), which will be introduced in Phase 4 via `libpcap`.
