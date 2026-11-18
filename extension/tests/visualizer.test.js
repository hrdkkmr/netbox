/**
 * NetBox Phase 3 — Automated Unit & Integration Tests for Visualizer Engines
 * Uses Node.js built-in test runner (node --test) with zero external test frameworks.
 * Covers all 15+ deterministic requirements from Phase 3 specification.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const EventStore = require("../media/visualizer/eventStore.js");
const TimingEngine = require("../media/visualizer/timingEngine.js");
const SocketStateEngine = require("../media/visualizer/socketStateEngine.js");
const EventFilter = require("../media/visualizer/eventFilter.js");
const SequenceMapper = require("../media/visualizer/sequenceMapper.js");
const EventInspector = require("../media/visualizer/eventInspector.js");
const PlaybackEngine = require("../media/visualizer/playbackEngine.js");

/**
 * Representative fixture matching actual Phase 2 LD_PRELOAD output schema (v1.0).
 * Notice both server (pid 3101) and client (pid 3102) allocate fd=3 independently,
 * and server accept() returns a separate accepted connection fd=4.
 */
function buildActualTcpFixture() {
  const base = 5000000000000; // monotonic ns
  return [
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 1,
      timestamp_ns: base,
      source: "socket_api",
      event_type: "socket",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: null,
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 3,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 2,
      timestamp_ns: base + 120000, // +0.120 ms
      source: "socket_api",
      event_type: "bind",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: null, remote_port: null },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 0,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 3,
      timestamp_ns: base + 250000, // +0.250 ms
      source: "socket_api",
      event_type: "listen",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: null, remote_port: null },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 0,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 4,
      timestamp_ns: base + 1240000, // +1.240 ms
      source: "socket_api",
      event_type: "socket",
      process: { pid: 3102, tid: 3102, name: "client" },
      connection: null,
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 3,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 5,
      timestamp_ns: base + 1600000, // +1.600 ms
      source: "socket_api",
      event_type: "connect",
      process: { pid: 3102, tid: 3102, name: "client" },
      connection: { local_ip: "127.0.0.1", local_port: 51234, remote_ip: "127.0.0.1", remote_port: 8080 },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 0,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 6,
      timestamp_ns: base + 1720000, // +1.720 ms
      source: "socket_api",
      event_type: "accept",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: "127.0.0.1", remote_port: 51234 },
      socket_fd: 4,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 4,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 7,
      timestamp_ns: base + 2100000, // +2.100 ms
      source: "socket_api",
      event_type: "send",
      process: { pid: 3102, tid: 3102, name: "client" },
      connection: { local_ip: "127.0.0.1", local_port: 51234, remote_ip: "127.0.0.1", remote_port: 8080 },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      // Intentionally differ payload.bytes (100) vs result (12) to verify accounting uses result
      payload: { bytes: 100, preview_utf8: null, truncated: false },
      result: 12,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 8,
      timestamp_ns: base + 2400000, // +2.400 ms
      source: "socket_api",
      event_type: "recv",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: "127.0.0.1", remote_port: 51234 },
      socket_fd: 4,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: { bytes: 12, preview_utf8: null, truncated: false },
      result: 12,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 9,
      timestamp_ns: base + 2700000, // +2.700 ms
      source: "socket_api",
      event_type: "send",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: "127.0.0.1", remote_port: 51234 },
      socket_fd: 4,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: { bytes: 12, preview_utf8: null, truncated: false },
      result: 12,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 10,
      timestamp_ns: base + 3000000, // +3.000 ms
      source: "socket_api",
      event_type: "recv",
      process: { pid: 3102, tid: 3102, name: "client" },
      connection: { local_ip: "127.0.0.1", local_port: 51234, remote_ip: "127.0.0.1", remote_port: 8080 },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: { bytes: 12, preview_utf8: null, truncated: false },
      result: 12,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 11,
      timestamp_ns: base + 3500000, // +3.500 ms
      source: "socket_api",
      event_type: "close",
      process: { pid: 3102, tid: 3102, name: "client" },
      connection: { local_ip: "127.0.0.1", local_port: 51234, remote_ip: "127.0.0.1", remote_port: 8080 },
      socket_fd: 3,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 0,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
    {
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 12,
      timestamp_ns: base + 3850000, // +3.850 ms
      source: "socket_api",
      event_type: "close",
      process: { pid: 3101, tid: 3101, name: "server" },
      connection: { local_ip: "127.0.0.1", local_port: 8080, remote_ip: "127.0.0.1", remote_port: 51234 },
      socket_fd: 4,
      socket_domain: "AF_INET",
      socket_type: "SOCK_STREAM",
      payload: null,
      result: 0,
      error_code: null,
      error_name: null,
      error_message: null,
      is_simulated: false,
      simulation_label: "ACTUAL SOCKET API EVENTS",
    },
  ];
}

describe("NetBox Phase 3 — SocketStateEngine", () => {
  it("1. transitions socket creation to CREATED", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 0);
    const s = snap.socketsByKey["3101:3"];
    assert.ok(s);
    assert.equal(s.state, "CREATED");
    assert.equal(s.domain, "AF_INET");
    assert.equal(s.type, "SOCK_STREAM");
  });

  it("2. transitions bind() to BOUND with local endpoint", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 1);
    const s = snap.socketsByKey["3101:3"];
    assert.equal(s.state, "BOUND");
    assert.equal(s.localIp, "127.0.0.1");
    assert.equal(s.localPort, 8080);
  });

  it("3. transitions listen() to LISTENING and marks role SERVER_LISTENER", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 2);
    const s = snap.socketsByKey["3101:3"];
    assert.equal(s.state, "LISTENING");
    assert.equal(s.role, "server_listener");
  });

  it("4. transitions successful connect() to CONNECTED", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 4);
    const c = snap.socketsByKey["3102:3"];
    assert.equal(c.state, "CONNECTED");
    assert.equal(c.role, "client");
    assert.equal(c.localPort, 51234);
    assert.equal(c.remotePort, 8080);
  });

  it("5. transitions failed connect() (ECONNREFUSED) to CONNECTION_FAILED, never CONNECTED", () => {
    const failedEvents = [
      {
        schema_version: "1.0",
        run_id: "run_err",
        sequence: 1,
        timestamp_ns: 1000,
        source: "socket_api",
        event_type: "socket",
        process: { pid: 4001, name: "client" },
        socket_fd: 3,
        socket_domain: "AF_INET",
        socket_type: "SOCK_STREAM",
        result: 3,
        error_code: null,
        is_simulated: false,
      },
      {
        schema_version: "1.0",
        run_id: "run_err",
        sequence: 2,
        timestamp_ns: 2000,
        source: "socket_api",
        event_type: "connect",
        process: { pid: 4001, name: "client" },
        connection: { local_ip: null, local_port: null, remote_ip: "127.0.0.1", remote_port: 8080 },
        socket_fd: 3,
        result: -1,
        error_code: 111,
        error_name: "ECONNREFUSED",
        error_message: "Connection refused",
        is_simulated: false,
      },
    ];
    const snap = SocketStateEngine.deriveStateAtIndex(failedEvents, 1);
    const c = snap.socketsByKey["4001:3"];
    assert.equal(c.state, "CONNECTION_FAILED");
    assert.equal(c.lastError.code, 111);
    assert.equal(c.lastError.name, "ECONNREFUSED");
    assert.equal(snap.overallSummary.hasActiveError, true);
    assert.equal(snap.topology.links[0].status, "failed");
  });

  it("6. tracks accepted server connection separately from listening socket", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 5);
    const listener = snap.socketsByKey["3101:3"];
    const accepted = snap.socketsByKey["3101:4"];

    assert.ok(listener, "Listening socket must remain tracked");
    assert.ok(accepted, "Accepted socket must be created separately");
    assert.equal(listener.state, "LISTENING");
    assert.equal(listener.role, "server_listener");
    assert.equal(accepted.state, "CONNECTED");
    assert.equal(accepted.role, "server_accepted");
    assert.equal(accepted.parentListenerFd, 3);
    assert.equal(accepted.remotePort, 51234);

    assert.equal(snap.topology.servers.length, 1);
    assert.equal(snap.topology.servers[0].listeningSockets.length, 1);
    assert.equal(snap.topology.servers[0].acceptedSockets.length, 1);
  });

  it("7. keeps separate client and server socket identities even with identical FD numbers", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 5);
    assert.notEqual(snap.socketsByKey["3101:3"].key, snap.socketsByKey["3102:3"].key);
    assert.equal(snap.socketsByKey["3101:3"].state, "LISTENING");
    assert.equal(snap.socketsByKey["3102:3"].state, "CONNECTED");
    assert.equal(snap.sockets.length, 3); // server listener (3101:3), client (3102:3), server accepted (3101:4)
  });

  it("8. accounts send and recv bytes strictly from positive result values", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 9);
    // Client sent result=12 (NOT payload.bytes=100) and received result=12
    assert.equal(snap.socketsByKey["3102:3"].bytesSent, 12);
    assert.equal(snap.socketsByKey["3102:3"].bytesReceived, 12);
    // Server accepted socket received 12 and sent 12
    assert.equal(snap.socketsByKey["3101:4"].bytesReceived, 12);
    assert.equal(snap.socketsByKey["3101:4"].bytesSent, 12);
  });

  it("9. transitions close() to CLOSED and never infers TIME_WAIT", () => {
    const events = buildActualTcpFixture();
    const snap = SocketStateEngine.deriveStateAtIndex(events, 11);
    assert.equal(snap.socketsByKey["3102:3"].state, "CLOSED");
    assert.equal(snap.socketsByKey["3101:4"].state, "CLOSED");
    // Listening socket 3101:3 was not closed yet in this fixture
    assert.equal(snap.socketsByKey["3101:3"].state, "LISTENING");
    assert.notEqual(snap.socketsByKey["3102:3"].state, "TIME_WAIT");
  });

  it("10. handles unknown or incomplete events as UNKNOWN / UNRESOLVED without guessing", () => {
    const weirdEvents = [
      {
        schema_version: "1.0",
        run_id: "run_weird",
        sequence: 1,
        timestamp_ns: 1000,
        source: "socket_api",
        event_type: "send", // No prior socket() or connect()
        process: { pid: 9001, name: "mystery" },
        socket_fd: 7,
        result: 10,
        error_code: null,
        is_simulated: false,
      },
      {
        schema_version: "1.0",
        run_id: "run_weird",
        sequence: 2,
        timestamp_ns: 2000,
        source: "socket_api",
        event_type: "setsockopt_custom_unknown",
        process: { pid: 9001, name: "mystery" },
        socket_fd: 8,
        result: 0,
        error_code: null,
        is_simulated: false,
      },
    ];
    const snap = SocketStateEngine.deriveStateAtIndex(weirdEvents, 1);
    assert.equal(snap.socketsByKey["9001:7"].state, "UNRESOLVED");
    assert.equal(snap.socketsByKey["9001:8"].state, "UNKNOWN");
  });
});

describe("NetBox Phase 3 — EventFilter (Non-Destructive)", () => {
  it("11. filters by process, eventType, socketFd, errorsOnly, and search without mutating source", () => {
    const events = buildActualTcpFixture();
    events.push({
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 13,
      timestamp_ns: 5000004000000,
      source: "socket_api",
      event_type: "accept",
      process: { pid: 3101, tid: 3101, name: "server" },
      socket_fd: 3,
      result: -1,
      error_code: 4,
      error_name: "EINTR",
      error_message: "Interrupted system call",
      is_simulated: false,
    });
    const originalLength = events.length;

    const byProc = EventFilter.filterEvents(events, { process: "client (3102)" });
    assert.equal(byProc.matchCount, 5);
    assert.ok(byProc.filteredEvents.every((e) => e.process.name === "client"));

    const byType = EventFilter.filterEvents(events, { eventType: "send" });
    assert.equal(byType.matchCount, 2);

    const byFd = EventFilter.filterEvents(events, { socketFd: "4" });
    assert.equal(byFd.matchCount, 4);

    const errsOnly = EventFilter.filterEvents(events, { errorsOnly: true });
    assert.equal(errsOnly.matchCount, 1);
    assert.equal(errsOnly.filteredEvents[0].error_name, "EINTR");

    const bySearch = EventFilter.filterEvents(events, { search: "51234" });
    assert.equal(bySearch.matchCount, 8);

    // Ensure original array was untouched
    assert.equal(events.length, originalLength);
  });
});

describe("NetBox Phase 3 — TimingEngine", () => {
  it("12. computes monotonic relative timestamps, deltas, selected interval, and actual byte totals", () => {
    const events = buildActualTcpFixture();
    const analysis = TimingEngine.analyzeTimeline(events);

    assert.equal(analysis.entries[0].relativeFormatted, "+0.000 ms");
    assert.equal(analysis.entries[3].relativeFormatted, "+1.240 ms");
    assert.equal(analysis.entries[11].relativeFormatted, "+3.850 ms");
    assert.equal(analysis.summary.totalDurationFormatted, "3.850 ms");
    assert.equal(analysis.summary.operationCount, 12);
    // Client sent 12 + server sent 12 = 24 (NOT 100+12!)
    assert.equal(analysis.summary.bytesSent, 24);
    assert.equal(analysis.summary.bytesReceived, 24);
    assert.equal(analysis.summary.errorCount, 0);

    const interval = TimingEngine.calculateSelectedInterval(events, 4, 5);
    assert.equal(interval.formatted, "0.120 ms");
    assert.equal(interval.label, "Observed API-Event Interval");
  });
});

describe("NetBox Phase 3 — SequenceMapper", () => {
  it("13. maps API-level sequence directions accurately and flags unresolved events without inventing SYN/ACK", () => {
    const events = buildActualTcpFixture();
    events.push({
      schema_version: "1.0",
      run_id: "run_fixture_001",
      sequence: 13,
      timestamp_ns: 5000004100000,
      source: "socket_api",
      event_type: "send",
      process: { pid: 9999, name: "mystery_worker" },
      socket_fd: 9,
      result: 5,
      error_code: null,
      is_simulated: false,
    });
    const timing = TimingEngine.analyzeTimeline(events);
    const seq = SequenceMapper.buildSequenceDiagram(events, timing);

    assert.match(seq.headerLabel, /API-Level Communication Sequence/i);
    assert.equal(seq.rows[4].direction, "client-to-server"); // connect
    assert.equal(seq.rows[5].direction, "client-to-server"); // accept
    assert.equal(seq.rows[6].direction, "client-to-server"); // client send
    assert.equal(seq.rows[6].bytes, 12);
    assert.equal(seq.rows[7].direction, "at-server"); // server recv
    assert.equal(seq.rows[8].direction, "server-to-client"); // server send
    assert.equal(seq.rows[9].direction, "at-client"); // client recv
    assert.equal(seq.rows[10].direction, "self-client"); // client close
    assert.equal(seq.rows[12].kind, "unresolved"); // mystery_worker
    assert.equal(seq.hasUnresolved, true);
  });
});

describe("NetBox Phase 3 — PlaybackEngine", () => {
  it("14. supports next, prev, reset, jumpTo, speed scaling, and timestamp-derived delays without duplicate loops", () => {
    const events = buildActualTcpFixture();
    const stepped = [];
    const scheduledDelays = [];
    let nextTimerId = 1;
    const activeTimers = new Map();

    const engine = PlaybackEngine.createPlaybackEngine({
      onStep: (idx) => stepped.push(idx),
      setTimeoutFn: (cb, ms) => {
        const id = nextTimerId++;
        scheduledDelays.push(ms);
        activeTimers.set(id, cb);
        return id;
      },
      clearTimeoutFn: (id) => {
        activeTimers.delete(id);
      },
    });

    engine.setEvents(events);
    assert.equal(engine.getState().currentIndex, -1);

    assert.equal(engine.next(), 0);
    assert.equal(engine.next(), 1);
    assert.equal(engine.prev(), 0);
    assert.equal(engine.prev(), -1);

    assert.equal(engine.jumpTo(5), 5);
    assert.equal(engine.reset(), -1);

    // Verify speed multiplier scales computed delays
    const delay1x = engine.computeStepDelayMs(0, 1);
    engine.setSpeed(2);
    const delay2x = engine.computeStepDelayMs(0, 1);
    assert.ok(delay2x < delay1x, "2x speed should reduce delay compared to 1x");

    // Verify play schedules exactly 1 timer and pause cancels it cleanly
    engine.play();
    assert.equal(engine.getState().isPlaying, true);
    assert.equal(activeTimers.size, 1);

    // Calling play again while already playing must NOT create duplicate timer
    engine.play();
    assert.equal(activeTimers.size, 1);

    engine.pause();
    assert.equal(engine.getState().isPlaying, false);
    assert.equal(activeTimers.size, 0);

    engine.destroy();
  });
});

describe("NetBox Phase 3 — EventStore & EventInspector", () => {
  it("15. strictly distinguishes simulated vs actual socket_api events", () => {
    const actualEvents = buildActualTcpFixture();
    const actualCls = EventStore.classifyDataSource({ isSimulated: false }, actualEvents);
    assert.equal(actualCls.isActual, true);
    assert.equal(actualCls.isSimulated, false);
    assert.equal(actualCls.label, "ACTUAL SOCKET API EVENTS");

    const simEvents = actualEvents.map((e) => ({
      ...e,
      is_simulated: true,
      simulation_label: "SIMULATED",
    }));
    const simCls = EventStore.classifyDataSource({ isSimulated: true, label: "SIMULATED" }, simEvents);
    assert.equal(simCls.isActual, false);
    assert.equal(simCls.isSimulated, true);

    // Mixed stream must NEVER be labeled as actual
    const mixed = [actualEvents[0], simEvents[1]];
    const mixedCls = EventStore.classifyDataSource({ isSimulated: false }, mixed);
    assert.equal(mixedCls.isActual, false);
  });

  it("16. formats null fields as 'Not available' and provides deterministic explanations", () => {
    const events = buildActualTcpFixture();
    const timing = TimingEngine.analyzeTimeline(events);
    const snap = SocketStateEngine.deriveStateAtIndex(events, 0);
    const model = EventInspector.buildInspectorModel(
      events[0],
      timing.entries[0],
      snap.socketsByKey["3101:3"]
    );

    const errorCodeField = model.observedFields.find((f) => f.key === "error_code");
    const localEpField = model.observedFields.find((f) => f.key === "local_endpoint");
    assert.equal(errorCodeField.value, "Not available");
    assert.equal(localEpField.value, "Not available");
    assert.match(model.explanation, /created a new socket/i);

    const errExplanation = EventInspector.explainEvent({
      event_type: "connect",
      process: { pid: 500, name: "client" },
      result: -1,
      error_code: 111,
      error_name: "ECONNREFUSED",
      error_message: "Connection refused",
    });
    assert.match(errExplanation, /ECONNREFUSED/);
  });
});
