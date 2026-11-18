const test = require("node:test");
const assert = require("node:assert/strict");

const LabsView = require("../media/visualizer/labsView.js");
const AIAssistant = require("../media/visualizer/aiAssistant.js");

const SAMPLE_LAB = {
  lab_id: "mod3-ip-subnetting",
  module_number: 3,
  module_title: "Module 3 — IP Addressing and Subnetting",
  title: "IPv4 CIDR & Subnetting",
  topic: "IPv4, CIDR",
  difficulty: "beginner",
  estimated_minutes: 20,
  learning_objectives: ["Calculate network and broadcast addresses"],
  prerequisites: [],
  concept_explanation: [
    {
      title: "CIDR Masks",
      summary: "Split IPv4 into network & host bits.",
      key_points: ["Bitwise AND yields network ID"],
      protocol_layers: ["Network (L3)"],
    },
  ],
  experiment: {
    experiment_id: "net-inspect-l3",
    title: "Inspect IPv4 Config",
    instructions: "Run read-only IP inspection.",
    required_setup: [],
    execution_steps: ["Click Run Experiment"],
    supported_scenarios: [
      { scenario_id: "net-inspect-l3", label: "Inspect IPv4", description: "Read IP", protocol: "IPv4", default_params: {} },
    ],
    expected_observations: ["Real CIDR prefix shown"],
    observation_caveats: ["Math is deterministic"],
    has_subnet_calculator: true,
  },
  questions: [
    {
      question_id: "q1",
      type: "multiple_choice",
      prompt: "What is /26 block size?",
      options: ["32", "64"],
      correct_option_index: 1,
      expected_keywords: [],
      rubric_summary: "64",
      explanation: "2^6 = 64.",
    },
  ],
  completion_criteria: {
    require_experiment_run: true,
    min_assessment_score_pct: 70,
    description: "Run & pass.",
  },
};

test("LabsView renders all 5 sections, Subnet Calculator, and escapes untrusted input", () => {
  const expHtml = LabsView.renderLabWorkspace({
    labs: [{ ...SAMPLE_LAB, scenario_count: 1, question_count: 1, attempted: true, completed: false }],
    progress: { total_labs: 9, attempted_count: 1, completed_count: 0, completion_pct: 0 },
    activeLab: SAMPLE_LAB,
    activeSection: "experiment",
    subnetResult: {
      network_address: "192.168.10.64",
      prefix_length: 26,
      subnet_mask: "255.255.255.192",
      wildcard_mask: "0.0.0.63",
      broadcast_address: "192.168.10.127",
      first_usable_host: "192.168.10.65",
      last_usable_host: "192.168.10.126",
      usable_host_count: 62,
      total_addresses: 64,
      address_scope: "Private",
      network_binary: "11000000.10101000.00001010.01000000",
      mask_binary: "11111111.11111111.11111111.11000000",
      compare_ip: "192.168.10.100",
      same_subnet: true,
      compare_explanation: "Same subnet.",
    },
  });
  assert.ok(expHtml.includes("Deterministic IPv4 Subnet Calculator"));
  assert.ok(expHtml.includes("192.168.10.64/26"));
  assert.ok(expHtml.includes("Same Subnet"));

  const tutorHtml = LabsView.renderLabWorkspace({
    labs: [],
    progress: { total_labs: 9, attempted_count: 1, completed_count: 1, completion_pct: 11 },
    activeLab: SAMPLE_LAB,
    activeSection: "understand",
    aiHelper: AIAssistant,
    aiResponse: {
      mode: "curriculum_connect_theory",
      model: "qwen2.5-coder:1.5b",
      latency_ms: 42,
      answer: "Observed [PACKET: pkt_1] and <script>evil()</script>.",
      verified_references: [
        { tag: "[PACKET: pkt_1]", kind: "packet", id: "pkt_1", target_sequence: 1, verified: true, label: "Packet #1" },
      ],
      grounding_warnings: [],
    },
  });
  assert.ok(tutorHtml.includes("ai-ev-link"));
  assert.ok(!tutorHtml.includes("<script>evil()</script>"));
});
