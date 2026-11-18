/**
 * NetBox Phase 4 — Automated Unit Tests for Visualizer PacketView Module
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const PacketView = require("../media/visualizer/packetView.js");

describe("NetBox Phase 4 — PacketView Unified Timeline & Classification", () => {
  const socketEvents = [
    {
      sequence: 1,
      timestamp_ns: 1_000_000_000,
      source: "socket_api",
      event_type: "connect",
      process: { pid: 100, name: "client" },
      socket_fd: 3,
      result: 0,
      error_code: null,
    },
    {
      sequence: 2,
      timestamp_ns: 1_002_000_000,
      source: "socket_api",
      event_type: "send",
      process: { pid: 100, name: "client" },
      socket_fd: 3,
      result: 12,
      error_code: null,
    },
  ];

  const packets = [
    {
      sequence: 1,
      source: "packet_capture",
      protocol: "TCP",
      timestamp: { pcap_timestamp_ns: 999999, capture_monotonic_ns: 1_000_500_000 },
      network: { source_ip: "127.0.0.1", destination_ip: "127.0.0.1" },
      transport: { tcp: { source_port: 50001, destination_port: 8080, flags: { syn: true } } },
      payload: { payload_length: 0, captured_bytes: 0 },
      capture: { original_length: 74, captured_length: 74 },
      analysis: { flags_label: "SYN", classification: "SYN" },
    },
    {
      sequence: 2,
      source: "packet_capture",
      protocol: "TCP",
      timestamp: { pcap_timestamp_ns: 999999, capture_monotonic_ns: 1_002_500_000 },
      network: { source_ip: "127.0.0.1", destination_ip: "127.0.0.1" },
      transport: { tcp: { source_port: 50001, destination_port: 8080, flags: { psh: true, ack: true } } },
      payload: { payload_length: 12, captured_bytes: 0 },
      capture: { original_length: 78, captured_length: 78 },
      analysis: { flags_label: "ACK+PSH", classification: "DATA" },
    },
  ];

  it("merges socket_api and packet_capture strictly by monotonic timestamps while preserving source labels", () => {
    const both = PacketView.buildUnifiedTimeline(socketEvents, packets, "both");
    assert.equal(both.length, 4);
    assert.equal(both[0].source, "socket_api");
    assert.equal(both[0].relativeFormatted, "+0.000 ms");
    assert.equal(both[1].source, "packet_capture");
    assert.equal(both[1].relativeFormatted, "+0.500 ms");
    assert.equal(both[2].source, "socket_api");
    assert.equal(both[2].relativeFormatted, "+2.000 ms");
    assert.equal(both[3].source, "packet_capture");
    assert.equal(both[3].relativeFormatted, "+2.500 ms");

    const sockOnly = PacketView.buildUnifiedTimeline(socketEvents, packets, "socket");
    assert.equal(sockOnly.length, 2);
    assert.ok(sockOnly.every((x) => x.source === "socket_api"));

    const pktOnly = PacketView.buildUnifiedTimeline(socketEvents, packets, "packets");
    assert.equal(pktOnly.length, 2);
    assert.ok(pktOnly.every((x) => x.source === "packet_capture"));
  });

  it("assigns distinct CSS classes for SYN, SYN+ACK, DATA, FIN, RST, ACK", () => {
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "SYN" } }), "pkt-badge-syn");
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "SYN+ACK" } }), "pkt-badge-synack");
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "DATA" } }), "pkt-badge-data");
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "FIN+ACK" } }), "pkt-badge-fin");
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "RST" } }), "pkt-badge-rst");
    assert.equal(PacketView.packetFlagClass({ analysis: { classification: "ACK" } }), "pkt-badge-ack");
  });
});
