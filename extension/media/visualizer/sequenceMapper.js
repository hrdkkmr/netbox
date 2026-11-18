/**
 * NetBox Phase 3 Visualizer — API-Level Communication Sequence Mapper
 * Generates dynamic sequence diagram entries between Client and Server lifelines
 * strictly from observed socket_api events.
 *
 * IMPORTANT:
 * - Explicitly labeled as an API-level communication sequence.
 * - Never invents TCP three-way handshake packets (SYN, SYN-ACK, ACK).
 * - Unmappable events are explicitly classified as "unresolved" rather than guessed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.SequenceMapper = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HEADER_LABEL = "API-Level Communication Sequence (Observed POSIX Socket Calls — Not Wire Packets)";

  function isErrorEvent(ev) {
    return Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
  }

  /**
   * Infers actor roles (client / server / unresolved) per PID from observed API behavior.
   * Primary evidence: bind/listen/accept => server; connect => client.
   * Secondary evidence: explicit process.name ("client" / "server") only if non-contradictory.
   */
  function inferProcessRoles(events) {
    const rolesByPid = new Map();

    events.forEach((ev) => {
      if (!ev || !ev.process || ev.process.pid === undefined || ev.process.pid === null) {
        return;
      }
      const pid = ev.process.pid;
      const type = ev.event_type;
      if (type === "bind" || type === "listen" || type === "accept" || type === "accept4") {
        rolesByPid.set(pid, "server");
      } else if (type === "connect") {
        if (!rolesByPid.has(pid)) {
          rolesByPid.set(pid, "client");
        }
      }
    });

    events.forEach((ev) => {
      if (!ev || !ev.process || ev.process.pid === undefined || ev.process.pid === null) {
        return;
      }
      const pid = ev.process.pid;
      if (!rolesByPid.has(pid)) {
        const name = String(ev.process.name || "").toLowerCase();
        if (name === "server") {
          rolesByPid.set(pid, "server");
        } else if (name === "client") {
          rolesByPid.set(pid, "client");
        } else {
          rolesByPid.set(pid, "unresolved");
        }
      }
    });

    return rolesByPid;
  }

  function buildSequenceDiagram(events, timingAnalysis) {
    const list = Array.isArray(events) ? events : [];
    const rolesByPid = inferProcessRoles(list);
    const timingEntries = (timingAnalysis && timingAnalysis.entries) || [];

    const rows = list.map((ev, idx) => {
      const tEntry = timingEntries[idx] || {};
      const pid = ev && ev.process ? ev.process.pid : null;
      const processName = (ev && ev.process && ev.process.name) || "unknown";
      const actor = pid !== null && rolesByPid.has(pid) ? rolesByPid.get(pid) : "unresolved";
      const err = isErrorEvent(ev);
      const type = (ev && ev.event_type) || "unknown";
      const fd = ev && ev.socket_fd !== null && ev.socket_fd !== undefined ? ev.socket_fd : null;

      let kind = "unresolved";
      let direction = "unresolved";
      let bytes = null;
      let label = `${type}()`;
      let detail = "";

      if (actor === "unresolved") {
        kind = "unresolved";
        direction = "unresolved";
        label = `${type}() [Unresolved Actor/Direction]`;
        detail = `Process '${processName}' cannot be confidently mapped to client or server`;
      } else {
        switch (type) {
          case "socket":
            kind = "lifecycle";
            direction = `self-${actor}`;
            label = err ? `socket() FAILED` : `socket() → fd=${ev.result}`;
            detail = `${ev.socket_domain || "?"} / ${ev.socket_type || "?"}`;
            break;

          case "bind":
            kind = "lifecycle";
            direction = `self-${actor}`;
            label = err
              ? `bind() FAILED`
              : `bind(${(ev.connection && ev.connection.local_ip) || "*"}:${
                  (ev.connection && ev.connection.local_port) ?? "*"
                })`;
            detail = fd !== null ? `fd=${fd}` : "";
            break;

          case "listen":
            kind = "lifecycle";
            direction = `self-${actor}`;
            label = err ? `listen() FAILED` : `listen(fd=${fd !== null ? fd : "?"})`;
            detail = "Passive listener ready";
            break;

          case "connect":
            if (actor === "client") {
              kind = "arrow";
              direction = "client-to-server";
              const target = ev.connection
                ? `${ev.connection.remote_ip || "*"}:${ev.connection.remote_port ?? "*"}`
                : "remote";
              label = err
                ? `connect(${target}) FAILED (${ev.error_name || ev.error_code})`
                : `connect(${target})`;
              detail = "API call (not SYN packet)";
            } else {
              kind = "unresolved";
              direction = "unresolved";
              label = `connect() [Unexpected Actor]`;
            }
            break;

          case "accept":
          case "accept4":
            if (actor === "server") {
              if (err) {
                kind = "lifecycle";
                direction = "self-server";
                label = `${type}() FAILED (${ev.error_name || ev.error_code})`;
                detail = ev.error_message || "";
              } else {
                kind = "arrow";
                direction = "client-to-server";
                const peer = ev.connection
                  ? `${ev.connection.remote_ip || "*"}:${ev.connection.remote_port ?? "*"}`
                  : "client";
                label = `${type}() → fd=${ev.result}`;
                detail = `Accepted from ${peer}`;
              }
            } else {
              kind = "unresolved";
              direction = "unresolved";
              label = `${type}() [Unexpected Actor]`;
            }
            break;

          case "send":
          case "sendto":
            bytes = typeof ev.result === "number" && ev.result >= 0 ? ev.result : null;
            kind = "arrow";
            direction = actor === "client" ? "client-to-server" : "server-to-client";
            label = err
              ? `${type}() FAILED (${ev.error_name || ev.error_code})`
              : `${type}(${bytes !== null ? `${bytes} B` : "0 B"})`;
            detail = fd !== null ? `fd=${fd}` : "";
            break;

          case "recv":
          case "recvfrom":
            bytes = typeof ev.result === "number" && ev.result >= 0 ? ev.result : null;
            kind = "receive";
            direction = actor === "server" ? "at-server" : "at-client";
            if (err) {
              label = `${type}() FAILED (${ev.error_name || ev.error_code})`;
            } else if (bytes === 0) {
              label = `${type}(0 B / EOF)`;
            } else {
              label = `${type}(${bytes !== null ? `${bytes} B` : "?"})`;
            }
            detail = fd !== null ? `fd=${fd}` : "";
            break;

          case "shutdown":
            kind = "lifecycle";
            direction = `self-${actor}`;
            label = err ? `shutdown() FAILED` : `shutdown(fd=${fd !== null ? fd : "?"})`;
            detail = "API shutdown";
            break;

          case "close":
            kind = "lifecycle";
            direction = `self-${actor}`;
            label = err ? `close() FAILED` : `close(fd=${fd !== null ? fd : "?"})`;
            detail = "Socket descriptor closed";
            break;

          default:
            kind = "unresolved";
            direction = "unresolved";
            label = `${type}() [Unresolved Event]`;
            detail = "Event cannot be mapped confidently to a communication direction";
            break;
        }
      }

      return {
        index: idx,
        sequence: ev ? ev.sequence : idx + 1,
        eventType: type,
        actor,
        processName,
        pid,
        socketFd: fd,
        kind,
        direction,
        bytes,
        label,
        detail,
        isError: err,
        errorName: ev ? ev.error_name || null : null,
        relativeTime: tEntry.relativeFormatted || "Not available",
        deltaTime: tEntry.deltaFormatted || "Not available",
      };
    });

    const hasUnresolved = rows.some((r) => r.kind === "unresolved");

    return {
      headerLabel: HEADER_LABEL,
      hasUnresolved,
      rows,
    };
  }

  return {
    HEADER_LABEL,
    inferProcessRoles,
    buildSequenceDiagram,
  };
});
