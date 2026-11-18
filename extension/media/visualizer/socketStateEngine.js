/**
 * NetBox Phase 3 Visualizer — Socket Lifecycle State & Topology Engine
 * Derives visualizer-level socket lifecycle states and network topology
 * strictly from observed socket_api events.
 *
 * IMPORTANT BOUNDARIES:
 * - States are visualizer-derived from POSIX socket API calls, NOT kernel TCP states.
 * - Never infers TIME_WAIT from close().
 * - Never infers CONNECTED from a failed connect().
 * - Never infers peer receipt from send().
 * - Maintains separate identities for:
 *     (1) Server listening socket
 *     (2) Accepted server-side connection socket(s)
 *     (3) Client connection socket(s)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.SocketStateEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = Object.freeze({
    CREATED: "CREATED",
    BOUND: "BOUND",
    LISTENING: "LISTENING",
    CONNECTING: "CONNECTING",
    CONNECTED: "CONNECTED",
    CLOSING: "CLOSING",
    CLOSED: "CLOSED",
    CONNECTION_FAILED: "CONNECTION_FAILED",
    ERROR: "ERROR",
    UNKNOWN: "UNKNOWN",
    UNRESOLVED: "UNRESOLVED",
  });

  const ROLES = Object.freeze({
    SERVER_LISTENER: "server_listener",
    SERVER_ACCEPTED: "server_accepted",
    CLIENT: "client",
    UNKNOWN: "unknown",
  });

  function makeSocketKey(pid, fd) {
    return `${pid}:${fd}`;
  }

  function isErrorResult(ev) {
    return Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
  }

  function extractError(ev) {
    if (!isErrorResult(ev)) {
      return null;
    }
    return {
      code: ev.error_code !== undefined ? ev.error_code : null,
      name: ev.error_name || "ERR",
      message: ev.error_message || "Socket API call returned an error",
    };
  }

  function createSocketRecord(pid, processName, fd, initialRole) {
    return {
      key: makeSocketKey(pid, fd),
      pid,
      processName: processName || "unknown",
      fd,
      role: initialRole || ROLES.UNKNOWN,
      domain: null,
      type: null,
      localIp: null,
      localPort: null,
      remoteIp: null,
      remotePort: null,
      state: STATES.UNKNOWN,
      stateSource: "API-derived",
      stateReason: "No lifecycle event observed yet",
      lastEventType: null,
      lastEventSeq: null,
      lastError: null,
      bytesSent: 0,
      bytesReceived: 0,
      peerEofObserved: false,
      parentListenerFd: null,
      hasCreationEvidence: false,
    };
  }

  function applyConnectionFields(sock, ev) {
    if (!sock || !ev) {
      return;
    }
    if (ev.socket_domain) {
      sock.domain = ev.socket_domain;
    }
    if (ev.socket_type) {
      sock.type = ev.socket_type;
    }
    if (ev.connection) {
      if (ev.connection.local_ip !== null && ev.connection.local_ip !== undefined) {
        sock.localIp = ev.connection.local_ip;
      }
      if (ev.connection.local_port !== null && ev.connection.local_port !== undefined) {
        sock.localPort = ev.connection.local_port;
      }
      if (ev.connection.remote_ip !== null && ev.connection.remote_ip !== undefined) {
        sock.remoteIp = ev.connection.remote_ip;
      }
      if (ev.connection.remote_port !== null && ev.connection.remote_port !== undefined) {
        sock.remotePort = ev.connection.remote_port;
      }
    }
  }

  function inferInitialRoleFromProcessName(processName) {
    const lower = String(processName || "").toLowerCase();
    if (lower === "client" || lower.includes("client")) {
      return ROLES.CLIENT;
    }
    return ROLES.UNKNOWN;
  }

  function findListeningSocketForProcess(socketsMap, pid) {
    for (const sock of socketsMap.values()) {
      if (sock.pid === pid && sock.role === ROLES.SERVER_LISTENER) {
        return sock;
      }
    }
    return null;
  }

  /**
   * Deterministically replays events[0..upToIndex] and produces a complete
   * snapshot of processes, individual socket states, topology links, and
   * active animation metadata.
   */
  function deriveStateAtIndex(events, upToIndex) {
    const list = Array.isArray(events) ? events : [];
    const limit =
      typeof upToIndex === "number" ? Math.min(upToIndex, list.length - 1) : list.length - 1;

    const processesMap = new Map(); // pid -> { pid, name, roles: Set }
    const socketsMap = new Map(); // `${pid}:${fd}` -> SocketRecord
    let activeEventMeta = null;

    if (limit < 0 || list.length === 0) {
      return {
        currentIndex: -1,
        sockets: [],
        socketsByKey: {},
        topology: {
          clients: [],
          servers: [],
          otherProcesses: [],
          links: [],
          activeEvent: null,
        },
        overallSummary: {
          label: "READY",
          hasActiveError: false,
        },
      };
    }

    for (let i = 0; i <= limit; i++) {
      const ev = list[i];
      if (!ev) {
        continue;
      }

      const pid =
        ev.process && ev.process.pid !== undefined && ev.process.pid !== null
          ? ev.process.pid
          : `unknown_${i}`;
      const processName = (ev.process && ev.process.name) || "unknown";

      if (!processesMap.has(pid)) {
        processesMap.set(pid, {
          pid,
          name: processName,
          roles: new Set(),
        });
      }
      const procRec = processesMap.get(pid);

      const hasValidFd =
        ev.socket_fd !== null && ev.socket_fd !== undefined && Number.isFinite(Number(ev.socket_fd));
      const fd = hasValidFd
        ? Number(ev.socket_fd)
        : ev.event_type === "socket" && typeof ev.result === "number" && ev.result >= 0
          ? ev.result
          : null;

      const err = extractError(ev);
      const isErr = err !== null;
      let affectedSocketKey = null;

      switch (ev.event_type) {
        case "socket": {
          const targetFd = fd !== null ? fd : `err_${ev.sequence}`;
          const key = makeSocketKey(pid, targetFd);
          const role = inferInitialRoleFromProcessName(processName);
          const sock = createSocketRecord(pid, processName, fd, role);
          applyConnectionFields(sock, ev);
          sock.lastEventType = "socket";
          sock.lastEventSeq = ev.sequence;

          if (!isErr && typeof ev.result === "number" && ev.result >= 0) {
            sock.state = STATES.CREATED;
            sock.stateReason = "socket() returned a valid file descriptor";
            sock.hasCreationEvidence = true;
            sock.lastError = null;
          } else {
            sock.state = STATES.ERROR;
            sock.stateReason = `socket() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          }
          socketsMap.set(key, sock);
          affectedSocketKey = key;
          break;
        }

        case "bind": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, ROLES.SERVER_LISTENER);
            socketsMap.set(key, sock);
          }
          applyConnectionFields(sock, ev);
          sock.lastEventType = "bind";
          sock.lastEventSeq = ev.sequence;

          if (!isErr && ev.result === 0) {
            sock.state = STATES.BOUND;
            sock.stateReason = `bind() associated socket with ${sock.localIp || "*"}:${sock.localPort ?? "*"}`;
            sock.lastError = null;
            if (sock.role === ROLES.UNKNOWN) {
              sock.role = ROLES.SERVER_LISTENER;
              procRec.roles.add("server");
            }
          } else {
            sock.state = STATES.ERROR;
            sock.stateReason = `bind() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          }
          affectedSocketKey = key;
          break;
        }

        case "listen": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, ROLES.SERVER_LISTENER);
            socketsMap.set(key, sock);
          }
          sock.role = ROLES.SERVER_LISTENER;
          procRec.roles.add("server");
          applyConnectionFields(sock, ev);
          sock.lastEventType = "listen";
          sock.lastEventSeq = ev.sequence;

          if (!isErr && ev.result === 0) {
            sock.state = STATES.LISTENING;
            sock.stateReason = "listen() configured socket to accept incoming connections";
            sock.lastError = null;
          } else {
            sock.state = STATES.ERROR;
            sock.stateReason = `listen() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          }
          affectedSocketKey = key;
          break;
        }

        case "accept":
        case "accept4": {
          const listenerSock = findListeningSocketForProcess(socketsMap, pid);
          procRec.roles.add("server");

          if (!isErr && typeof ev.result === "number" && ev.result >= 0) {
            // Keep listening socket in LISTENING state; create a SEPARATE accepted socket record.
            const acceptedFd = ev.result;
            const acceptedKey = makeSocketKey(pid, acceptedFd);
            const acceptedSock = createSocketRecord(
              pid,
              processName,
              acceptedFd,
              ROLES.SERVER_ACCEPTED
            );
            applyConnectionFields(acceptedSock, ev);
            acceptedSock.state = STATES.CONNECTED;
            acceptedSock.stateReason = `${ev.event_type}() returned new server-side connection fd=${acceptedFd}`;
            acceptedSock.hasCreationEvidence = true;
            acceptedSock.lastEventType = ev.event_type;
            acceptedSock.lastEventSeq = ev.sequence;
            acceptedSock.lastError = null;
            if (listenerSock) {
              acceptedSock.parentListenerFd = listenerSock.fd;
              if (!acceptedSock.domain) {
                acceptedSock.domain = listenerSock.domain;
              }
              if (!acceptedSock.type) {
                acceptedSock.type = listenerSock.type;
              }
              listenerSock.lastEventType = ev.event_type;
              listenerSock.lastEventSeq = ev.sequence;
            }
            socketsMap.set(acceptedKey, acceptedSock);
            affectedSocketKey = acceptedKey;
          } else {
            // Failed accept affects the listening socket without fabricating an accepted socket
            const targetFd = fd !== null ? fd : listenerSock ? listenerSock.fd : null;
            if (targetFd !== null) {
              const key = makeSocketKey(pid, targetFd);
              let sock = socketsMap.get(key);
              if (!sock) {
                sock = createSocketRecord(pid, processName, targetFd, ROLES.SERVER_LISTENER);
                socketsMap.set(key, sock);
              }
              sock.lastEventType = ev.event_type;
              sock.lastEventSeq = ev.sequence;
              sock.lastError = err;
              sock.state = STATES.ERROR;
              sock.stateReason = `${ev.event_type}() failed (${err ? err.name : "error"})`;
              affectedSocketKey = key;
            }
          }
          break;
        }

        case "connect": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, ROLES.CLIENT);
            socketsMap.set(key, sock);
          }
          sock.role = ROLES.CLIENT;
          procRec.roles.add("client");
          applyConnectionFields(sock, ev);
          sock.lastEventType = "connect";
          sock.lastEventSeq = ev.sequence;

          if (!isErr && ev.result === 0) {
            sock.state = STATES.CONNECTED;
            sock.stateReason = "connect() returned 0 (API-level connection succeeded)";
            sock.lastError = null;
          } else if (err && err.name === "EINPROGRESS") {
            sock.state = STATES.CONNECTING;
            sock.stateReason = "connect() returned EINPROGRESS (non-blocking connection in progress)";
            sock.lastError = err;
          } else {
            sock.state = STATES.CONNECTION_FAILED;
            sock.stateReason = `connect() failed (${err ? `${err.name}: ${err.message}` : "error"})`;
            sock.lastError = err;
          }
          affectedSocketKey = key;
          break;
        }

        case "send":
        case "sendto": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          const existed = Boolean(sock);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, inferInitialRoleFromProcessName(processName));
            socketsMap.set(key, sock);
          }
          applyConnectionFields(sock, ev);
          sock.lastEventType = ev.event_type;
          sock.lastEventSeq = ev.sequence;

          if (isErr) {
            sock.state = STATES.ERROR;
            sock.stateReason = `${ev.event_type}() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          } else {
            if (typeof ev.result === "number" && ev.result > 0) {
              sock.bytesSent += ev.result;
            }
            if (!existed) {
              sock.state = STATES.UNRESOLVED;
              sock.stateReason = `${ev.event_type}() observed without prior socket creation/connection evidence`;
            } else {
              sock.stateReason = `${ev.event_type}() passed ${ev.result} byte(s) to OS socket API (peer receipt not inferred)`;
              sock.lastError = null;
            }
          }
          affectedSocketKey = key;
          break;
        }

        case "recv":
        case "recvfrom": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          const existed = Boolean(sock);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, inferInitialRoleFromProcessName(processName));
            socketsMap.set(key, sock);
          }
          applyConnectionFields(sock, ev);
          sock.lastEventType = ev.event_type;
          sock.lastEventSeq = ev.sequence;

          if (isErr) {
            sock.state = STATES.ERROR;
            sock.stateReason = `${ev.event_type}() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          } else {
            if (typeof ev.result === "number" && ev.result > 0) {
              sock.bytesReceived += ev.result;
            } else if (ev.result === 0) {
              sock.peerEofObserved = true;
            }
            if (!existed) {
              sock.state = STATES.UNRESOLVED;
              sock.stateReason = `${ev.event_type}() observed without prior socket creation/connection evidence`;
            } else if (ev.result === 0) {
              sock.stateReason = `${ev.event_type}() returned 0 (EOF observed from peer)`;
              sock.lastError = null;
            } else {
              sock.stateReason = `${ev.event_type}() read ${ev.result} byte(s) from OS socket API`;
              sock.lastError = null;
            }
          }
          affectedSocketKey = key;
          break;
        }

        case "shutdown": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          const existed = Boolean(sock);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, inferInitialRoleFromProcessName(processName));
            socketsMap.set(key, sock);
          }
          applyConnectionFields(sock, ev);
          sock.lastEventType = "shutdown";
          sock.lastEventSeq = ev.sequence;

          if (isErr) {
            sock.state = STATES.ERROR;
            sock.stateReason = `shutdown() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          } else {
            sock.state = existed ? STATES.CLOSING : STATES.UNRESOLVED;
            sock.stateReason = existed
              ? "shutdown() initiated socket half/full close"
              : "shutdown() observed without prior socket lifecycle evidence";
            sock.lastError = null;
          }
          affectedSocketKey = key;
          break;
        }

        case "close": {
          if (fd === null) {
            break;
          }
          const key = makeSocketKey(pid, fd);
          let sock = socketsMap.get(key);
          const existed = Boolean(sock);
          if (!sock) {
            sock = createSocketRecord(pid, processName, fd, inferInitialRoleFromProcessName(processName));
            socketsMap.set(key, sock);
          }
          applyConnectionFields(sock, ev);
          sock.lastEventType = "close";
          sock.lastEventSeq = ev.sequence;

          if (isErr) {
            sock.state = STATES.ERROR;
            sock.stateReason = `close() failed (${err ? err.name : "error"})`;
            sock.lastError = err;
          } else {
            sock.state = existed ? STATES.CLOSED : STATES.UNRESOLVED;
            sock.stateReason = existed
              ? "close() released socket file descriptor (API-level CLOSED; kernel TIME_WAIT not inferred)"
              : "close() observed without prior socket tracking evidence";
            sock.lastError = null;
          }
          affectedSocketKey = key;
          break;
        }

        default: {
          if (fd !== null) {
            const key = makeSocketKey(pid, fd);
            let sock = socketsMap.get(key);
            if (!sock) {
              sock = createSocketRecord(pid, processName, fd, ROLES.UNKNOWN);
              socketsMap.set(key, sock);
            }
            applyConnectionFields(sock, ev);
            sock.lastEventType = ev.event_type || "unknown";
            sock.lastEventSeq = ev.sequence;
            sock.state = isErr ? STATES.ERROR : STATES.UNKNOWN;
            sock.stateReason = `Unrecognized or incomplete socket API event '${ev.event_type || "unknown"}'`;
            sock.lastError = err;
            affectedSocketKey = key;
          }
          break;
        }
      }

      if (i === limit) {
        const affectedSock = affectedSocketKey ? socketsMap.get(affectedSocketKey) : null;
        let direction = "local";
        if (ev.event_type === "connect") {
          direction = "client-to-server";
        } else if (ev.event_type === "accept" || ev.event_type === "accept4") {
          direction = isErr ? "local" : "client-to-server";
        } else if (ev.event_type === "send" || ev.event_type === "sendto") {
          if (affectedSock && affectedSock.role === ROLES.CLIENT) {
            direction = "client-to-server";
          } else if (
            affectedSock &&
            (affectedSock.role === ROLES.SERVER_ACCEPTED || affectedSock.role === ROLES.SERVER_LISTENER)
          ) {
            direction = "server-to-client";
          }
        } else if (ev.event_type === "recv" || ev.event_type === "recvfrom") {
          if (affectedSock && affectedSock.role === ROLES.CLIENT) {
            direction = "server-to-client";
          } else if (affectedSock && affectedSock.role === ROLES.SERVER_ACCEPTED) {
            direction = "client-to-server";
          }
        }

        activeEventMeta = {
          index: i,
          sequence: ev.sequence,
          eventType: ev.event_type,
          pid,
          processName,
          socketFd: fd,
          affectedSocketKey,
          affectedRole: affectedSock ? affectedSock.role : ROLES.UNKNOWN,
          direction,
          isError: isErr,
          errorName: err ? err.name : null,
          bytes:
            (ev.event_type === "send" ||
              ev.event_type === "sendto" ||
              ev.event_type === "recv" ||
              ev.event_type === "recvfrom") &&
            typeof ev.result === "number" &&
            ev.result >= 0
              ? ev.result
              : null,
          result: ev.result,
        };
      }
    }

    // Build topology groupings strictly from observed sockets and processes
    const clients = [];
    const servers = [];
    const otherProcesses = [];

    for (const proc of processesMap.values()) {
      const procSockets = Array.from(socketsMap.values()).filter((s) => s.pid === proc.pid);
      const listenerSockets = procSockets.filter((s) => s.role === ROLES.SERVER_LISTENER);
      const acceptedSockets = procSockets.filter((s) => s.role === ROLES.SERVER_ACCEPTED);
      const clientSockets = procSockets.filter((s) => s.role === ROLES.CLIENT);
      const unknownSockets = procSockets.filter((s) => s.role === ROLES.UNKNOWN);

      const lowerName = String(proc.name || "").toLowerCase();
      const isServerProc =
        proc.roles.has("server") ||
        listenerSockets.length > 0 ||
        acceptedSockets.length > 0 ||
        lowerName === "server";
      const isClientProc =
        !isServerProc &&
        (proc.roles.has("client") || clientSockets.length > 0 || lowerName === "client");

      if (isServerProc) {
        servers.push({
          pid: proc.pid,
          name: proc.name,
          listeningSockets: listenerSockets.length > 0 ? listenerSockets : unknownSockets,
          acceptedSockets,
          allSockets: procSockets,
        });
      } else if (isClientProc) {
        clients.push({
          pid: proc.pid,
          name: proc.name,
          sockets: clientSockets.length > 0 ? clientSockets : procSockets,
          allSockets: procSockets,
        });
      } else {
        otherProcesses.push({
          pid: proc.pid,
          name: proc.name,
          sockets: procSockets,
        });
      }
    }

    // Derive communication links between client sockets and server sockets using actual endpoints
    const links = [];
    const allClientSocks = clients.flatMap((c) => c.allSockets);
    const allServerAccepted = servers.flatMap((s) => s.acceptedSockets);
    const allServerListeners = servers.flatMap((s) => s.listeningSockets);

    for (const cs of allClientSocks) {
      // Match accepted server socket by 4-tuple endpoint symmetry
      let matchedAccepted = allServerAccepted.find(
        (as) =>
          cs.localPort !== null &&
          as.remotePort !== null &&
          cs.localPort === as.remotePort &&
          (cs.remotePort === null || as.localPort === null || cs.remotePort === as.localPort)
      );

      // Fallback: match listening server socket by target port if connect() attempted/failed
      let matchedListener = !matchedAccepted
        ? allServerListeners.find(
            (ls) => cs.remotePort !== null && ls.localPort !== null && cs.remotePort === ls.localPort
          )
        : null;

      if (matchedAccepted) {
        let linkStatus = "active";
        if (cs.state === STATES.CLOSED && matchedAccepted.state === STATES.CLOSED) {
          linkStatus = "closed";
        } else if (cs.state === STATES.CLOSED || matchedAccepted.state === STATES.CLOSED) {
          linkStatus = "half-closed";
        } else if (cs.state === STATES.ERROR || matchedAccepted.state === STATES.ERROR) {
          linkStatus = "error";
        }
        links.push({
          id: `${cs.key}->${matchedAccepted.key}`,
          clientSocketKey: cs.key,
          serverSocketKey: matchedAccepted.key,
          clientEndpoint: formatEndpoint(cs.localIp, cs.localPort),
          serverEndpoint: formatEndpoint(matchedAccepted.localIp, matchedAccepted.localPort),
          status: linkStatus,
          error: cs.lastError || matchedAccepted.lastError || null,
        });
      } else if (cs.remoteIp || cs.remotePort) {
        let linkStatus = "attempting";
        if (cs.state === STATES.CONNECTION_FAILED || cs.state === STATES.ERROR) {
          linkStatus = "failed";
        } else if (cs.state === STATES.CONNECTED) {
          linkStatus = "active";
        } else if (cs.state === STATES.CLOSED) {
          linkStatus = "closed";
        }
        links.push({
          id: `${cs.key}->${matchedListener ? matchedListener.key : "target"}`,
          clientSocketKey: cs.key,
          serverSocketKey: matchedListener ? matchedListener.key : null,
          clientEndpoint: formatEndpoint(cs.localIp, cs.localPort),
          serverEndpoint: formatEndpoint(cs.remoteIp, cs.remotePort),
          status: linkStatus,
          error: cs.lastError || null,
        });
      }
    }

    const socketsArr = Array.from(socketsMap.values());
    const socketsByKey = {};
    socketsArr.forEach((s) => {
      socketsByKey[s.key] = s;
    });

    const hasActiveError = Boolean(
      (activeEventMeta && activeEventMeta.isError) ||
        socketsArr.some((s) => s.state === STATES.ERROR || s.state === STATES.CONNECTION_FAILED)
    );

    let overallLabel = "IDLE";
    if (activeEventMeta && activeEventMeta.isError) {
      overallLabel = `ERROR (${activeEventMeta.errorName || "API"})`;
    } else if (socketsArr.some((s) => s.state === STATES.CONNECTED)) {
      overallLabel = "CONNECTED (API)";
    } else if (socketsArr.some((s) => s.state === STATES.LISTENING)) {
      overallLabel = "LISTENING (API)";
    } else if (socketsArr.length > 0 && socketsArr.every((s) => s.state === STATES.CLOSED)) {
      overallLabel = "ALL SOCKETS CLOSED";
    } else if (socketsArr.some((s) => s.state === STATES.BOUND)) {
      overallLabel = "BOUND (API)";
    } else if (socketsArr.some((s) => s.state === STATES.CREATED)) {
      overallLabel = "SOCKET CREATED";
    }

    return {
      currentIndex: limit,
      sockets: socketsArr,
      socketsByKey,
      topology: {
        clients,
        servers,
        otherProcesses,
        links,
        activeEvent: activeEventMeta,
      },
      overallSummary: {
        label: overallLabel,
        hasActiveError,
      },
    };
  }

  function formatEndpoint(ip, port) {
    if (!ip && (port === null || port === undefined)) {
      return "Not available";
    }
    return `${ip || "*"}:${port !== null && port !== undefined ? port : "*"}`;
  }

  return {
    STATES,
    ROLES,
    makeSocketKey,
    formatEndpoint,
    deriveStateAtIndex,
  };
});
