/**
 * NetBox Phase 5 — Automated Unit Tests for Frontend AI Assistant Module
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const AIAssistant = require("../media/visualizer/aiAssistant.js");

describe("NetBox Phase 5 — AIAssistant Evidence Linkification & Chips", () => {
  it("converts ONLY verified evidence references into clickable buttons and escapes untrusted HTML", () => {
    const rawText =
      "Observed SYN [PACKET: pkt_1] and socket [SOCKET: sock_5]. " +
      "Unverified [PACKET: pkt_999] must NOT become clickable. <script>alert(1)</script>";

    const verifiedRefs = [
      {
        tag: "[PACKET: pkt_1]",
        kind: "packet",
        id: "pkt_1",
        target_sequence: 1,
        verified: true,
        label: "Packet #1",
      },
      {
        tag: "[SOCKET: sock_5]",
        kind: "socket",
        id: "sock_5",
        target_sequence: 5,
        verified: true,
        label: "Socket Event #5",
      },
    ];

    const html = AIAssistant.formatAnswerWithVerifiedLinks(rawText, verifiedRefs);
    assert.match(html, /data-ev-kind="packet" data-ev-seq="1"/);
    assert.match(html, /data-ev-kind="socket" data-ev-seq="5"/);
    assert.ok(!html.includes('data-ev-seq="999"'), "Unverified pkt_999 must not become a link");
    assert.ok(!html.includes("<script>"), "Raw HTML tags must be escaped");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("provides execution-grounded chips for live runs and textbook chips when no live run is active", () => {
    const generalChips = AIAssistant.getSuggestedChips({ hasLiveRun: false });
    assert.ok(generalChips.length >= 3);
    assert.ok(generalChips.every((c) => c.action === "general"));

    const liveChips = AIAssistant.getSuggestedChips({ hasLiveRun: true, selectedPacketSeq: 4 });
    assert.ok(liveChips.some((c) => c.action === "explain_execution"));
    assert.ok(liveChips.some((c) => c.action === "explain_timeline"));
    assert.ok(liveChips.some((c) => c.action === "explain_packet" && c.packetId === 4));
  });
});
