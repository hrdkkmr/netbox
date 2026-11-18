/**
 * NetBox Phase 3 — End-to-End Live Phase 2 -> Phase 3 Integration Test
 * Executes the real compiled C TCP server & client through Phase 2's RunManager
 * under LD_PRELOAD, then feeds the real recorded socket_api event stream into
 * every Phase 3 visualizer module to verify real-world consumption.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const EventStore = require("../media/visualizer/eventStore.js");
const TimingEngine = require("../media/visualizer/timingEngine.js");
const SocketStateEngine = require("../media/visualizer/socketStateEngine.js");
const EventFilter = require("../media/visualizer/eventFilter.js");
const SequenceMapper = require("../media/visualizer/sequenceMapper.js");
const EventInspector = require("../media/visualizer/eventInspector.js");
const PlaybackEngine = require("../media/visualizer/playbackEngine.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV_PYTHON = path.join(REPO_ROOT, "backend", ".venv", "bin", "python3");

function executeRealTcpRun(message) {
  const pyCode = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(REPO_ROOT, "backend"))})
from app.services.run_manager import RunManager
mgr = RunManager.get_instance()
run_res = mgr.create_run("tcp-echo", [${JSON.stringify(message)}])
events_res = mgr.get_run_events(run_res.run_id)
print(json.dumps({
    "run": run_res.model_dump(),
    "eventsResponse": events_res.model_dump()
}))
`;
  const stdout = execFileSync(VENV_PYTHON, ["-c", pyCode], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 15000,
  });
  return JSON.parse(stdout);
}

describe("NetBox Phase 3 — Real Phase 2 TCP Execution Integration", () => {
  it("consumes actual LD_PRELOAD socket_api events across all visualizer engines", () => {
    const testMessage = "Phase 3 live trace test!";
    const expectedMsgBytes = Buffer.byteLength(testMessage, "utf8"); // 24 bytes

    const { run, eventsResponse } = executeRealTcpRun(testMessage);

    assert.equal(run.status, "completed");
    assert.equal(run.exit_code, 0);
    assert.equal(eventsResponse.is_simulated, false);
    assert.ok(eventsResponse.events.length >= 12, `Expected >=12 real events, got ${eventsResponse.events.length}`);

    // 1. EventStore strict classification
    const store = EventStore.createStore();
    const state = store.setRunData({
      runId: eventsResponse.run_id,
      runStatus: run.status,
      isSimulated: eventsResponse.is_simulated,
      label: eventsResponse.simulation_label,
      events: eventsResponse.events,
    });
    assert.equal(state.sourceClassification.isActual, true);
    assert.equal(state.sourceClassification.isSimulated, false);
    assert.equal(state.sourceClassification.label, "ACTUAL SOCKET API EVENTS");

    const events = store.getEvents();

    // 2. TimingEngine monotonic calculations & actual byte totals
    const timing = TimingEngine.analyzeTimeline(events);
    assert.equal(timing.entries[0].relativeFormatted, "+0.000 ms");
    assert.ok(timing.summary.totalDurationMs >= 0);
    assert.equal(timing.summary.operationCount, events.length);
    // Client sent expectedMsgBytes, server echoed expectedMsgBytes => 2 * expectedMsgBytes
    assert.equal(timing.summary.bytesSent, expectedMsgBytes * 2);
    assert.equal(timing.summary.bytesReceived, expectedMsgBytes * 2);

    // 3. SocketStateEngine dynamic derivation across every step
    let sawListener = false;
    let sawAccepted = false;
    let sawClientConnected = false;

    for (let i = 0; i < events.length; i++) {
      const snap = SocketStateEngine.deriveStateAtIndex(events, i);
      for (const s of snap.sockets) {
        assert.notEqual(s.state, "TIME_WAIT", "Must never infer kernel TIME_WAIT");
        if (s.role === "server_listener" && s.state === "LISTENING") sawListener = true;
        if (s.role === "server_accepted" && s.state === "CONNECTED") sawAccepted = true;
        if (s.role === "client" && s.state === "CONNECTED") sawClientConnected = true;
      }
    }

    assert.ok(sawListener, "Expected server listening socket in LISTENING state");
    assert.ok(sawAccepted, "Expected separate accepted server connection socket in CONNECTED state");
    assert.ok(sawClientConnected, "Expected client socket in CONNECTED state");

    const finalSnap = SocketStateEngine.deriveStateAtIndex(events, events.length - 1);
    assert.equal(finalSnap.topology.servers.length, 1);
    assert.equal(finalSnap.topology.clients.length, 1);
    assert.equal(finalSnap.topology.servers[0].listeningSockets.length, 1);
    assert.equal(finalSnap.topology.servers[0].acceptedSockets.length, 1);
    assert.ok(finalSnap.topology.links.length >= 1, "Expected derived client-server communication link");

    // 4. SequenceMapper API-level mapping
    const seq = SequenceMapper.buildSequenceDiagram(events, timing);
    assert.equal(seq.rows.length, events.length);
    assert.equal(seq.hasUnresolved, false, "All real TCP echo events should map cleanly");
    assert.ok(seq.rows.some((r) => r.eventType === "connect" && r.direction === "client-to-server"));
    assert.ok(seq.rows.some((r) => r.eventType === "send" && r.direction === "client-to-server"));
    assert.ok(seq.rows.some((r) => r.eventType === "send" && r.direction === "server-to-client"));

    // 5. EventFilter non-destructive check
    const sendOnly = EventFilter.filterEvents(events, { eventType: "send" });
    assert.equal(sendOnly.matchCount, 2);
    assert.equal(store.getEvents().length, events.length);

    // 6. EventInspector on every real event
    for (let i = 0; i < events.length; i++) {
      const snap = SocketStateEngine.deriveStateAtIndex(events, i);
      const activeKey = snap.topology.activeEvent && snap.topology.activeEvent.affectedSocketKey;
      const model = EventInspector.buildInspectorModel(
        events[i],
        timing.entries[i],
        activeKey ? snap.socketsByKey[activeKey] : null
      );
      assert.ok(model.explanation.length > 10);
      assert.equal(model.observedFields.length, 20);
    }

    // 7. PlaybackEngine step-through across all real events
    const visited = [];
    const pb = PlaybackEngine.createPlaybackEngine({
      onStep: (idx) => visited.push(idx),
    });
    pb.setEvents(events);
    for (let i = 0; i < events.length; i++) {
      pb.next();
    }
    assert.equal(pb.getState().currentIndex, events.length - 1);
    pb.reset();
    assert.equal(pb.getState().currentIndex, -1);
    pb.destroy();
  });
});
