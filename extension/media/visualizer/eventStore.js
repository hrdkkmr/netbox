/**
 * NetBox Phase 3 Visualizer — Event Store & Source Classification
 * Handles immutable event storage, null-safe formatting, and strict
 * Actual vs. Simulated telemetry classification.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.EventStore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOT_AVAILABLE = "Not available";

  function formatOrNotAvailable(value) {
    if (value === null || value === undefined || value === "") {
      return NOT_AVAILABLE;
    }
    return String(value);
  }

  function isEventError(ev) {
    if (!ev) {
      return false;
    }
    return (
      (typeof ev.result === "number" && ev.result < 0) ||
      (ev.error_code !== null && ev.error_code !== undefined)
    );
  }

  function isActualSocketEvent(ev) {
    return Boolean(
      ev &&
        ev.source === "socket_api" &&
        ev.is_simulated === false
    );
  }

  /**
   * Strictly determines whether a loaded dataset qualifies for the
   * ACTUAL SOCKET API EVENTS indicator.
   * Rule: Must have payload.isSimulated === false AND every event must have
   * source === "socket_api" and is_simulated === false.
   */
  function classifyDataSource(payload, events) {
    const list = Array.isArray(events) ? events : [];
    const payloadSimulated = payload ? payload.isSimulated : undefined;

    if (list.length === 0) {
      if (payloadSimulated === true) {
        return {
          isActual: false,
          isSimulated: true,
          label: "SIMULATED DATA (0 events)",
          badgeClass: "simulated-badge",
          description: "Simulated demonstration trace (no events loaded).",
        };
      }
      return {
        isActual: false,
        isSimulated: false,
        label: "NO EVENTS LOADED",
        badgeClass: "neutral-badge",
        description: "No socket API events recorded for this run.",
      };
    }

    const anySimulated =
      payloadSimulated === true || list.some((ev) => ev && ev.is_simulated === true);
    const allActualSocketApi =
      payloadSimulated === false && list.every((ev) => isActualSocketEvent(ev));

    if (allActualSocketApi) {
      return {
        isActual: true,
        isSimulated: false,
        label: "ACTUAL SOCKET API EVENTS",
        badgeClass: "actual-badge",
        description: "Captured from real C program execution via LD_PRELOAD (source: socket_api).",
      };
    }

    if (anySimulated && !list.some((ev) => isActualSocketEvent(ev))) {
      return {
        isActual: false,
        isSimulated: true,
        label: `SIMULATED DATA (${(payload && payload.label) || "SIMULATED"})`,
        badgeClass: "simulated-badge",
        description: "Simulated demonstration events for UI walkthrough (not live execution).",
      };
    }

    return {
      isActual: false,
      isSimulated: anySimulated,
      label: "MIXED / UNVERIFIED TELEMETRY",
      badgeClass: "warning-badge",
      description: "Event stream contains mixed or unverified source metadata.",
    };
  }

  function createStore() {
    let state = {
      runId: null,
      runStatus: "idle",
      mode: "demo", // "live" | "demo"
      runMeta: null,
      events: [],
      sourceClassification: classifyDataSource({ isSimulated: false }, []),
    };

    return {
      setRunData(payload) {
        const rawEvents = Array.isArray(payload && payload.events)
          ? payload.events.map((ev) => Object.freeze({ ...ev }))
          : [];
        const classification = classifyDataSource(payload, rawEvents);
        state = {
          runId: (payload && payload.runId) || null,
          runStatus:
            (payload && payload.runStatus) ||
            (classification.isSimulated ? "simulated" : rawEvents.length > 0 ? "completed" : "empty"),
          mode: classification.isSimulated ? "demo" : "live",
          runMeta: (payload && payload.runMeta) || null,
          events: Object.freeze(rawEvents),
          sourceClassification: classification,
        };
        return state;
      },

      getState() {
        return state;
      },

      getEvents() {
        return state.events;
      },

      getEvent(index) {
        if (index < 0 || index >= state.events.length) {
          return null;
        }
        return state.events[index];
      },

      clear() {
        state = {
          runId: null,
          runStatus: "idle",
          mode: "demo",
          runMeta: null,
          events: Object.freeze([]),
          sourceClassification: classifyDataSource({ isSimulated: false }, []),
        };
      },
    };
  }

  return {
    NOT_AVAILABLE,
    formatOrNotAvailable,
    isEventError,
    isActualSocketEvent,
    classifyDataSource,
    createStore,
  };
});
