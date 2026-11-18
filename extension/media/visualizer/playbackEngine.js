/**
 * NetBox Phase 3 Visualizer — Timestamp-Aware Playback Engine
 * Advances through events using actual timestamp_ns intervals adjusted by speed
 * multiplier (0.5x, 1x, 2x, 4x), with a readability floor/ceiling so rapid
 * loopback syscalls remain inspectable while preserving original timestamps.
 * Prevents duplicate timer loops and leaks when switching runs or pausing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NetBoxVisualizer = root.NetBoxVisualizer || {};
    root.NetBoxVisualizer.PlaybackEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_SPEEDS = [0.5, 1, 2, 4];
  const DEFAULT_MIN_DELAY_MS = 320;
  const DEFAULT_MAX_DELAY_MS = 2200;

  function createPlaybackEngine(options) {
    const opts = options || {};
    const onStep = typeof opts.onStep === "function" ? opts.onStep : () => {};
    const onStateChange = typeof opts.onStateChange === "function" ? opts.onStateChange : () => {};
    const scheduleFn = typeof opts.setTimeoutFn === "function" ? opts.setTimeoutFn : setTimeout;
    const cancelFn = typeof opts.clearTimeoutFn === "function" ? opts.clearTimeoutFn : clearTimeout;
    const minDelayBaseMs =
      typeof opts.minDelayMs === "number" && opts.minDelayMs > 0
        ? opts.minDelayMs
        : DEFAULT_MIN_DELAY_MS;
    const maxDelayBaseMs =
      typeof opts.maxDelayMs === "number" && opts.maxDelayMs >= minDelayBaseMs
        ? opts.maxDelayMs
        : DEFAULT_MAX_DELAY_MS;

    let events = [];
    let currentIndex = -1;
    let isPlaying = false;
    let speedMultiplier = 1;
    let timerId = null;
    let loopToken = 0; // Guards against stale callbacks after pause/reset/run switch

    function clearPendingTimer() {
      if (timerId !== null) {
        cancelFn(timerId);
        timerId = null;
      }
    }

    function notifyState() {
      onStateChange(getState());
    }

    function getState() {
      return {
        currentIndex,
        totalEvents: events.length,
        isPlaying,
        speedMultiplier,
      };
    }

    /**
     * Computes playback delay from actual timestamp_ns delta between events,
     * scaled by speedMultiplier, clamped to keep microsecond loopback traces usable.
     */
    function computeStepDelayMs(fromIndex, toIndex) {
      const scaledMin = Math.max(80, Math.round(minDelayBaseMs / speedMultiplier));
      const scaledMax = Math.max(scaledMin, Math.round(maxDelayBaseMs / speedMultiplier));

      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= events.length ||
        toIndex >= events.length
      ) {
        return scaledMin;
      }

      const evA = events[fromIndex];
      const evB = events[toIndex];
      if (
        !evA ||
        !evB ||
        typeof evA.timestamp_ns !== "number" ||
        typeof evB.timestamp_ns !== "number"
      ) {
        return scaledMin;
      }

      const realDeltaMs = Math.max(0, (evB.timestamp_ns - evA.timestamp_ns) / 1e6);
      // Scale actual interval by playback speed; boost tiny microsecond differences proportionally
      // above the minimum floor so closer vs. farther events stay perceptibly differentiated.
      const adjustedMs = realDeltaMs / speedMultiplier;
      if (adjustedMs < scaledMin) {
        return scaledMin;
      }
      if (adjustedMs > scaledMax) {
        return scaledMax;
      }
      return Math.round(adjustedMs);
    }

    function scheduleNextStep(token) {
      clearPendingTimer();
      if (!isPlaying || token !== loopToken) {
        return;
      }
      if (currentIndex >= events.length - 1) {
        pause();
        return;
      }

      const nextIndex = currentIndex + 1;
      const delayMs = currentIndex < 0 ? 50 : computeStepDelayMs(currentIndex, nextIndex);

      timerId = scheduleFn(() => {
        timerId = null;
        if (!isPlaying || token !== loopToken) {
          return;
        }
        currentIndex = nextIndex;
        onStep(currentIndex, events[currentIndex]);
        notifyState();

        if (currentIndex < events.length - 1) {
          scheduleNextStep(token);
        } else {
          pause();
        }
      }, delayMs);
    }

    function setEvents(newEvents) {
      pause();
      events = Array.isArray(newEvents) ? newEvents : [];
      currentIndex = -1;
      onStep(-1, null);
      notifyState();
    }

    function play() {
      if (events.length === 0) {
        return false;
      }
      if (isPlaying) {
        return true;
      }
      if (currentIndex >= events.length - 1) {
        currentIndex = -1;
      }
      isPlaying = true;
      loopToken += 1;
      notifyState();
      scheduleNextStep(loopToken);
      return true;
    }

    function pause() {
      const wasPlaying = isPlaying;
      isPlaying = false;
      loopToken += 1;
      clearPendingTimer();
      if (wasPlaying) {
        notifyState();
      }
    }

    function next() {
      pause();
      if (events.length === 0) {
        return currentIndex;
      }
      if (currentIndex < events.length - 1) {
        currentIndex += 1;
        onStep(currentIndex, events[currentIndex]);
        notifyState();
      }
      return currentIndex;
    }

    function prev() {
      pause();
      if (events.length === 0) {
        return currentIndex;
      }
      if (currentIndex > 0) {
        currentIndex -= 1;
        onStep(currentIndex, events[currentIndex]);
        notifyState();
      } else if (currentIndex === 0) {
        currentIndex = -1;
        onStep(-1, null);
        notifyState();
      }
      return currentIndex;
    }

    function reset() {
      pause();
      currentIndex = -1;
      onStep(-1, null);
      notifyState();
      return currentIndex;
    }

    function jumpTo(targetIndex) {
      pause();
      if (typeof targetIndex !== "number" || targetIndex < -1 || targetIndex >= events.length) {
        return currentIndex;
      }
      currentIndex = targetIndex;
      onStep(currentIndex, currentIndex >= 0 ? events[currentIndex] : null);
      notifyState();
      return currentIndex;
    }

    function setSpeed(multiplier) {
      const parsed = Number(multiplier);
      if (!ALLOWED_SPEEDS.includes(parsed)) {
        return speedMultiplier;
      }
      speedMultiplier = parsed;
      notifyState();
      if (isPlaying) {
        loopToken += 1;
        scheduleNextStep(loopToken);
      }
      return speedMultiplier;
    }

    function destroy() {
      pause();
      events = [];
    }

    return {
      ALLOWED_SPEEDS,
      setEvents,
      play,
      pause,
      next,
      prev,
      reset,
      jumpTo,
      setSpeed,
      computeStepDelayMs,
      getState,
      destroy,
    };
  }

  return {
    ALLOWED_SPEEDS,
    createPlaybackEngine,
  };
});
