/**
 * NetBox Phase 3 Visualizer — Non-Destructive Event Filter Engine
 * Supports filtering by process, event type, errors only, socket FD, and search query.
 * Never modifies or mutates the original event stream.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.EventFilter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_FILTERS = Object.freeze({
    process: "all",
    eventType: "all",
    errorsOnly: false,
    socketFd: "all",
    search: "",
  });

  function isEventError(ev) {
    return Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
  }

  function processKey(ev) {
    if (!ev || !ev.process) {
      return "unknown";
    }
    const name = ev.process.name || "unknown";
    const pid = ev.process.pid !== undefined && ev.process.pid !== null ? ev.process.pid : "?";
    return `${name} (${pid})`;
  }

  function extractFilterOptions(events) {
    const list = Array.isArray(events) ? events : [];
    const processSet = new Set();
    const typeSet = new Set();
    const fdSet = new Set();

    list.forEach((ev) => {
      if (!ev) {
        return;
      }
      processSet.add(processKey(ev));
      if (ev.event_type) {
        typeSet.add(ev.event_type);
      }
      if (ev.socket_fd !== null && ev.socket_fd !== undefined) {
        fdSet.add(String(ev.socket_fd));
      }
    });

    return {
      processes: Array.from(processSet).sort(),
      eventTypes: Array.from(typeSet).sort(),
      socketFds: Array.from(fdSet).sort((a, b) => Number(a) - Number(b)),
    };
  }

  function matchesSearch(ev, queryLower) {
    if (!queryLower) {
      return true;
    }

    const parts = [
      ev.sequence,
      ev.event_type,
      ev.source,
      ev.run_id,
      ev.socket_fd !== null && ev.socket_fd !== undefined ? `fd=${ev.socket_fd}` : "",
      ev.socket_fd,
      ev.socket_domain,
      ev.socket_type,
      ev.result,
      ev.error_code,
      ev.error_name,
      ev.error_message,
      ev.process && ev.process.name,
      ev.process && ev.process.pid,
      ev.connection && ev.connection.local_ip,
      ev.connection && ev.connection.local_port,
      ev.connection && ev.connection.remote_ip,
      ev.connection && ev.connection.remote_port,
    ];

    const haystack = parts
      .filter((p) => p !== null && p !== undefined && p !== "")
      .join(" ")
      .toLowerCase();

    return haystack.includes(queryLower);
  }

  /**
   * Filters events without mutating the source array.
   * Returns both original indices and matching event references.
   */
  function filterEvents(events, criteria) {
    const list = Array.isArray(events) ? events : [];
    const cfg = { ...DEFAULT_FILTERS, ...(criteria || {}) };
    const queryLower = (cfg.search || "").trim().toLowerCase();

    const filteredIndices = [];
    const filteredEvents = [];

    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (!ev) {
        continue;
      }

      if (cfg.process && cfg.process !== "all") {
        const pKey = processKey(ev);
        const pName = (ev.process && ev.process.name) || "";
        if (pKey !== cfg.process && pName !== cfg.process) {
          continue;
        }
      }

      if (cfg.eventType && cfg.eventType !== "all" && ev.event_type !== cfg.eventType) {
        continue;
      }

      if (cfg.errorsOnly && !isEventError(ev)) {
        continue;
      }

      if (cfg.socketFd && cfg.socketFd !== "all") {
        if (ev.socket_fd === null || ev.socket_fd === undefined) {
          continue;
        }
        if (String(ev.socket_fd) !== String(cfg.socketFd)) {
          continue;
        }
      }

      if (queryLower && !matchesSearch(ev, queryLower)) {
        continue;
      }

      filteredIndices.push(i);
      filteredEvents.push(ev);
    }

    return {
      filteredIndices,
      filteredEvents,
      totalCount: list.length,
      matchCount: filteredEvents.length,
    };
  }

  return {
    DEFAULT_FILTERS,
    processKey,
    extractFilterOptions,
    filterEvents,
  };
});
