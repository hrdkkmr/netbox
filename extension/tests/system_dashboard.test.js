const test = require("node:test");
const assert = require("node:assert/strict");

const SystemDashboard = require("../media/visualizer/systemDashboard.js");

test("SystemDashboard maps Running, Degraded, Unavailable, Disconnected distinctly", () => {
  assert.deepEqual(SystemDashboard.mapStatusBadge("running"), { label: "Running", cls: "sys-badge-running" });
  assert.deepEqual(SystemDashboard.mapStatusBadge("degraded"), { label: "Degraded", cls: "sys-badge-degraded" });
  assert.deepEqual(SystemDashboard.mapStatusBadge("unavailable"), { label: "Unavailable", cls: "sys-badge-unavailable" });
  assert.deepEqual(SystemDashboard.mapStatusBadge("disconnected"), { label: "Disconnected", cls: "sys-badge-disconnected" });
});

test("SystemDashboard escapes XSS and sanitizes QR SVG", () => {
  assert.equal(SystemDashboard.sanitizeSvgMarkup('<svg onclick="alert(1)"></svg>'), "");
  assert.ok(SystemDashboard.sanitizeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"></svg>').startsWith("<svg "));

  const html = SystemDashboard.renderSystemDashboard({
    connected: true,
    health: {
      overall_status: "degraded",
      components: {
        backend: { name: "FastAPI", status: "running", detail: "OK" },
        ollama: { name: "Ollama", status: "unavailable", detail: "<script>alert(1)</script>" },
      },
    },
    info: { version: "0.6.0", mode: "lan", total_runs: 2, active_runs: 0, hostname: "host-a", wsl_network_mode: "wsl2_nat" },
    network: { local_url: "http://127.0.0.1:8000", recommended_lan_url: "http://192.168.137.1:8000", interfaces: [], troubleshooting: [] },
    connection: { auth_required: true, allow_remote_execution: true, pairing_token: null, pairing_token_preview: "nbx-...ab", connected_clients: [] },
    clientSettings: { backendUrl: "http://192.168.137.1:8000", accessToken: "" },
    isWebBrowser: true,
  });

  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Degraded"));
  assert.ok(html.includes("Unavailable"));
});

test("SystemDashboard displays Disconnected banner when host unreachable", () => {
  const html = SystemDashboard.renderSystemDashboard({
    connected: false,
    clientSettings: { backendUrl: "http://192.168.137.1:8000" },
    isWebBrowser: true,
  });
  assert.ok(html.includes("Host Disconnected"));
  assert.ok(html.includes("Disconnected"));
});
