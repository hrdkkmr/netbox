/**
 * NetBox Phase 3 Visualizer — Timing & Performance Analysis Engine
 * Converts CLOCK_MONOTONIC timestamp_ns values into relative elapsed times
 * and observed API-event intervals. Never displays monotonic values as wall-clock dates.
 * Byte totals strictly sum successful positive return values of send/recv operations.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.TimingEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEND_TYPES = new Set(["send", "sendto"]);
  const RECV_TYPES = new Set(["recv", "recvfrom"]);

  function nsToMs(ns) {
    if (typeof ns !== "number" || !Number.isFinite(ns)) {
      return null;
    }
    return ns / 1e6;
  }

  function formatRelativeMs(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
      return "Not available";
    }
    const sign = ms < 0 ? "-" : "+";
    return `${sign}${Math.abs(ms).toFixed(3)} ms`;
  }

  function formatDurationMs(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
      return "Not available";
    }
    return `${ms.toFixed(3)} ms`;
  }

  function isErrorEvent(ev) {
    return Boolean(
      ev &&
        ((typeof ev.result === "number" && ev.result < 0) ||
          (ev.error_code !== null && ev.error_code !== undefined))
    );
  }

  /**
   * Computes relative timestamps, consecutive event deltas, and summary metrics
   * from an ordered array of NetworkEvent objects.
   */
  function analyzeTimeline(events) {
    const list = Array.isArray(events) ? events : [];
    if (list.length === 0) {
      return {
        baseTimestampNs: null,
        entries: [],
        summary: {
          totalDurationNs: 0,
          totalDurationMs: 0,
          totalDurationFormatted: "0.000 ms",
          operationCount: 0,
          bytesSent: 0,
          bytesReceived: 0,
          errorCount: 0,
          timingNote: "Relative elapsed time from CLOCK_MONOTONIC (API-event timing)",
        },
      };
    }

    const firstValid = list.find(
      (ev) => ev && typeof ev.timestamp_ns === "number" && Number.isFinite(ev.timestamp_ns)
    );
    const baseTimestampNs = firstValid ? firstValid.timestamp_ns : null;

    let bytesSent = 0;
    let bytesReceived = 0;
    let errorCount = 0;
    let maxTimestampNs = baseTimestampNs;
    let prevValidTs = baseTimestampNs;

    const entries = list.map((ev, idx) => {
      const ts =
        ev && typeof ev.timestamp_ns === "number" && Number.isFinite(ev.timestamp_ns)
          ? ev.timestamp_ns
          : null;

      let relativeNs = null;
      let relativeMs = null;
      let deltaNs = null;
      let deltaMs = null;

      if (ts !== null && baseTimestampNs !== null) {
        relativeNs = ts - baseTimestampNs;
        relativeMs = nsToMs(relativeNs);
        if (maxTimestampNs === null || ts > maxTimestampNs) {
          maxTimestampNs = ts;
        }
        if (idx === 0 || prevValidTs === null) {
          deltaNs = 0;
          deltaMs = 0;
        } else {
          deltaNs = Math.max(0, ts - prevValidTs);
          deltaMs = nsToMs(deltaNs);
        }
        prevValidTs = ts;
      }

      if (ev) {
        // Strictly use actual successful return value of send/recv, never requested buffer length
        if (SEND_TYPES.has(ev.event_type) && typeof ev.result === "number" && ev.result > 0) {
          bytesSent += ev.result;
        }
        if (RECV_TYPES.has(ev.event_type) && typeof ev.result === "number" && ev.result > 0) {
          bytesReceived += ev.result;
        }
        if (isErrorEvent(ev)) {
          errorCount += 1;
        }
      }

      return {
        index: idx,
        sequence: ev ? ev.sequence : idx + 1,
        timestampNs: ts,
        relativeNs,
        relativeMs,
        relativeFormatted: formatRelativeMs(relativeMs),
        deltaNs,
        deltaMs,
        deltaFormatted: deltaMs !== null ? formatDurationMs(deltaMs) : "Not available",
      };
    });

    const totalDurationNs =
      baseTimestampNs !== null && maxTimestampNs !== null
        ? Math.max(0, maxTimestampNs - baseTimestampNs)
        : 0;
    const totalDurationMs = nsToMs(totalDurationNs) || 0;

    return {
      baseTimestampNs,
      entries,
      summary: {
        totalDurationNs,
        totalDurationMs,
        totalDurationFormatted: formatDurationMs(totalDurationMs),
        operationCount: list.length,
        bytesSent,
        bytesReceived,
        errorCount,
        timingNote: "Relative elapsed time from CLOCK_MONOTONIC (API-event timing)",
      },
    };
  }

  /**
   * Computes observed API-event interval between two selected event indices.
   * Explicitly labeled as observed operation interval, never network latency.
   */
  function calculateSelectedInterval(events, indexA, indexB) {
    if (
      !Array.isArray(events) ||
      indexA < 0 ||
      indexB < 0 ||
      indexA >= events.length ||
      indexB >= events.length
    ) {
      return null;
    }

    const evA = events[indexA];
    const evB = events[indexB];
    if (
      !evA ||
      !evB ||
      typeof evA.timestamp_ns !== "number" ||
      typeof evB.timestamp_ns !== "number"
    ) {
      return null;
    }

    const earlier = indexA <= indexB ? evA : evB;
    const later = indexA <= indexB ? evB : evA;
    const intervalNs = Math.abs(later.timestamp_ns - earlier.timestamp_ns);
    const intervalMs = nsToMs(intervalNs);

    return {
      fromIndex: Math.min(indexA, indexB),
      toIndex: Math.max(indexA, indexB),
      fromSeq: earlier.sequence,
      toSeq: later.sequence,
      fromType: earlier.event_type,
      toType: later.event_type,
      intervalNs,
      intervalMs,
      formatted: formatDurationMs(intervalMs),
      label: "Observed API-Event Interval",
    };
  }

  return {
    nsToMs,
    formatRelativeMs,
    formatDurationMs,
    analyzeTimeline,
    calculateSelectedInterval,
  };
});
