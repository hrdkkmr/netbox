/**
 * NetBox Phase 3 Visualizer — Deterministic Event Inspector & Explanation Engine
 * Formats all observed schema fields (displaying null/missing as "Not available"),
 * clearly separates directly observed fields from derived fields, and generates
 * deterministic educational explanations without using any LLM.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.EventInspector = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOT_AVAILABLE = "Not available";

  function valOrNA(value) {
    if (value === null || value === undefined || value === "") {
      return NOT_AVAILABLE;
    }
    return String(value);
  }

  function formatEndpoint(ip, port) {
    const hasIp = ip !== null && ip !== undefined && ip !== "";
    const hasPort = port !== null && port !== undefined;
    if (!hasIp && !hasPort) {
      return NOT_AVAILABLE;
    }
    return `${hasIp ? ip : "*"}:${hasPort ? port : "*"}`;
  }

  function isErrorEvent(ev) {
    return Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
  }

  /**
   * Generates a deterministic, factual explanation based strictly on the
   * recorded event type and observed fields. No LLM, no speculation.
   */
  function explainEvent(ev) {
    if (!ev) {
      return "Select an event from the timeline or sequence diagram to inspect its recorded fields.";
    }

    const type = ev.event_type || "unknown";
    const procName = (ev.process && ev.process.name) || "The process";
    const isErr = isErrorEvent(ev);
    const errName = ev.error_name || (ev.error_code !== null && ev.error_code !== undefined ? `errno ${ev.error_code}` : "an error");
    const errMsg = ev.error_message ? ` (${ev.error_message})` : "";

    if (isErr) {
      switch (ev.error_name) {
        case "ECONNREFUSED":
          return `${procName} called ${type}(), which failed with ECONNREFUSED${errMsg}: no server was actively listening and accepting connections at the target endpoint.`;
        case "EADDRINUSE":
          return `${procName} called ${type}(), which failed with EADDRINUSE${errMsg}: the requested local address and port are already bound by another socket.`;
        case "EINTR":
          return `${procName} called ${type}(), which was interrupted by a signal (EINTR${errMsg}) before completion (commonly observed during graceful SIGINT server shutdown).`;
        case "EPIPE":
        case "ECONNRESET":
          return `${procName} called ${type}(), which failed with ${ev.error_name}${errMsg}: the peer closed or reset the connection before the operation completed.`;
        default:
          return `${procName} called ${type}(), which returned ${ev.result} with error ${errName}${errMsg}.`;
      }
    }

    switch (type) {
      case "socket": {
        const domain = ev.socket_domain || "specified address family";
        const stype = ev.socket_type || "specified socket type";
        return `The process created a new socket using ${domain} and ${stype}, returning file descriptor ${valOrNA(ev.result)}.`;
      }
      case "bind": {
        const localEp = ev.connection
          ? formatEndpoint(ev.connection.local_ip, ev.connection.local_port)
          : NOT_AVAILABLE;
        return `The socket (fd=${valOrNA(ev.socket_fd)}) was associated with local endpoint ${localEp}.`;
      }
      case "listen":
        return `The socket (fd=${valOrNA(ev.socket_fd)}) was configured as a passive listening socket ready to accept incoming connections.`;
      case "accept":
      case "accept4": {
        const remoteEp = ev.connection
          ? formatEndpoint(ev.connection.remote_ip, ev.connection.remote_port)
          : NOT_AVAILABLE;
        return `The server accepted an incoming connection from ${remoteEp} and received a new server-side connection socket (fd=${valOrNA(ev.result)}).`;
      }
      case "connect": {
        const remoteEp = ev.connection
          ? formatEndpoint(ev.connection.remote_ip, ev.connection.remote_port)
          : NOT_AVAILABLE;
        return `The process attempted to establish a connection to ${remoteEp}, and the connect() API call returned 0 (success). Note: individual wire handshake packets are not captured in Phase 2/3.`;
      }
      case "send":
      case "sendto":
        return `The process successfully passed ${ev.result} byte(s) to the socket API on fd=${valOrNA(ev.socket_fd)}. Note: this indicates kernel send-buffer handoff, not confirmed receipt by the remote peer.`;
      case "recv":
      case "recvfrom":
        if (ev.result === 0) {
          return `The process called ${type}() on fd=${valOrNA(ev.socket_fd)} and received 0 bytes, indicating end-of-file (EOF) as the peer closed its write side.`;
        }
        return `The process received ${ev.result} byte(s) through the socket API on fd=${valOrNA(ev.socket_fd)}.`;
      case "shutdown":
        return `The process invoked shutdown() on fd=${valOrNA(ev.socket_fd)} to close part or all of the duplex connection.`;
      case "close":
        return `The process closed tracked socket descriptor fd=${valOrNA(ev.socket_fd)} in user space.`;
      default:
        return `Observed socket API event '${type}' with return value ${valOrNA(ev.result)}.`;
    }
  }

  /**
   * Builds a complete structured inspection model separating Directly Observed
   * fields from Visualizer-Derived fields.
   */
  function buildInspectorModel(ev, timingEntry, derivedSocket) {
    if (!ev) {
      return null;
    }

    const simulatedStatus =
      ev.is_simulated === true
        ? `Simulated (${ev.simulation_label || "SIMULATED"})`
        : ev.source === "socket_api" && ev.is_simulated === false
          ? `Actual (${ev.simulation_label || "ACTUAL SOCKET API EVENTS"})`
          : NOT_AVAILABLE;

    const localEndpoint = ev.connection
      ? formatEndpoint(ev.connection.local_ip, ev.connection.local_port)
      : NOT_AVAILABLE;
    const remoteEndpoint = ev.connection
      ? formatEndpoint(ev.connection.remote_ip, ev.connection.remote_port)
      : NOT_AVAILABLE;

    const observedFields = [
      { key: "schema_version", label: "Schema Version", value: valOrNA(ev.schema_version) },
      { key: "run_id", label: "Run ID", value: valOrNA(ev.run_id) },
      { key: "sequence", label: "Sequence", value: valOrNA(ev.sequence) },
      { key: "timestamp_ns", label: "Monotonic Timestamp (ns)", value: valOrNA(ev.timestamp_ns) },
      { key: "source", label: "Source Layer", value: valOrNA(ev.source) },
      { key: "event_type", label: "Event Type", value: valOrNA(ev.event_type) },
      { key: "process_name", label: "Process Name", value: valOrNA(ev.process && ev.process.name) },
      { key: "pid", label: "PID", value: valOrNA(ev.process && ev.process.pid) },
      { key: "tid", label: "TID", value: valOrNA(ev.process && ev.process.tid) },
      { key: "socket_fd", label: "Socket FD", value: valOrNA(ev.socket_fd) },
      { key: "socket_domain", label: "Socket Domain", value: valOrNA(ev.socket_domain) },
      { key: "socket_type", label: "Socket Type", value: valOrNA(ev.socket_type) },
      { key: "local_endpoint", label: "Local Endpoint", value: localEndpoint },
      { key: "remote_endpoint", label: "Remote Endpoint", value: remoteEndpoint },
      {
        key: "payload_bytes",
        label: "Payload Byte Count",
        value: ev.payload && ev.payload.bytes !== null && ev.payload.bytes !== undefined
          ? `${ev.payload.bytes} B`
          : NOT_AVAILABLE,
      },
      { key: "result", label: "Return Value", value: valOrNA(ev.result) },
      { key: "error_code", label: "Error Code", value: valOrNA(ev.error_code) },
      { key: "error_name", label: "Error Name", value: valOrNA(ev.error_name) },
      { key: "error_message", label: "Error Message", value: valOrNA(ev.error_message) },
      { key: "simulated_status", label: "Telemetry Status", value: simulatedStatus },
    ];

    const derivedFields = [
      {
        key: "relative_time",
        label: "Relative Elapsed Time",
        value: timingEntry ? timingEntry.relativeFormatted : NOT_AVAILABLE,
      },
      {
        key: "prev_delta",
        label: "Since Previous Event",
        value: timingEntry ? timingEntry.deltaFormatted : NOT_AVAILABLE,
      },
      {
        key: "derived_socket_state",
        label: "API-Derived Socket State",
        value: derivedSocket ? `${derivedSocket.state} (${derivedSocket.role})` : NOT_AVAILABLE,
      },
    ];

    return {
      sequence: ev.sequence,
      eventType: ev.event_type,
      isError: isErrorEvent(ev),
      explanation: explainEvent(ev),
      observedFields,
      derivedFields,
      rawJson: JSON.stringify(ev, null, 2),
    };
  }

  return {
    NOT_AVAILABLE,
    valOrNA,
    explainEvent,
    buildInspectorModel,
  };
});
