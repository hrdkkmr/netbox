const test = require("node:test");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const path = require("node:path");

const GuidedTour = require("../media/visualizer/guidedTour.js");

function loadConnectionValidator() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "services", "connectionValidator.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const mod = { exports: {} };
  const fn = new Function("exports", "module", result.outputFiles[0].text);
  fn(mod.exports, mod);
  return mod.exports;
}

test("Phase 8 GuidedTour includes all 10 required steps, real TCP experiment step, and Presentation Mode", () => {
  assert.equal(GuidedTour.TOUR_STEPS.length, 10);
  assert.equal(GuidedTour.TOUR_STEPS[0].id, "welcome");
  assert.equal(GuidedTour.TOUR_STEPS[1].id, "backend-connection");
  assert.equal(GuidedTour.TOUR_STEPS[8].isExperimentStep, true);
  assert.equal(GuidedTour.TOUR_STEPS[9].isCompletionStep, true);

  const step9Html = GuidedTour.renderTourCard(8, {
    experimentStatus: "Live run run_123: 15 socket events <script>bad()</script>",
  });
  assert.ok(step9Html.includes("Run Real TCP Experiment"));
  assert.ok(!step9Html.includes("<script>bad()</script>"));
  assert.ok(step9Html.includes("Step 9 of 10"));

  assert.equal(GuidedTour.DEMO_STAGES.length, 6);
  const demoHtml = GuidedTour.renderPresentationBar(1);
  assert.ok(demoHtml.includes("PRESENTATION MODE"));
  assert.ok(demoHtml.includes("Execute Real TCP Run"));
});

test("Phase 8 connectionValidator enforces URL safety, scrubs secrets, and classifies auth vs connectivity", () => {
  const cv = loadConnectionValidator();

  assert.equal(cv.validateBackendUrl("http://127.0.0.1:8000/").valid, true);
  assert.equal(cv.validateBackendUrl("http://127.0.0.1:8000/").normalized, "http://127.0.0.1:8000");
  assert.equal(cv.validateBackendUrl("http://192.168.137.1:8000").isLocalhost, false);
  assert.equal(cv.validateBackendUrl("file:///etc/passwd").valid, false);
  assert.equal(cv.validateBackendUrl("javascript:alert(1)").valid, false);
  assert.equal(cv.validateBackendUrl("http://user:secret@192.168.1.5:8000").valid, false);
  assert.equal(cv.validateBackendUrl("").valid, false);

  const scrubbed = cv.sanitizeSecretFromText(
    "Failed with Bearer nbx-deadbeef123 and token mySecretToken99",
    "mySecretToken99"
  );
  assert.ok(!scrubbed.includes("nbx-deadbeef123"));
  assert.ok(!scrubbed.includes("mySecretToken99"));
  assert.ok(scrubbed.includes("[REDACTED]"));

  assert.equal(cv.classifyConnectionError(401, "HTTP 401: Unauthorized"), "auth_error");
  assert.equal(cv.classifyConnectionError(403, "HTTP 403: Forbidden"), "forbidden");
  assert.equal(cv.classifyConnectionError(undefined, "connect ECONNREFUSED 127.0.0.1:8000"), "connectivity_error");
});
