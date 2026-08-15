/****************************************************
 * Project Savannah - Production UI delivery-recovery tests (Increment 2B).
 *
 * The classification logic under test (isDeliveryRecoveryRequired, isDeliveredSuccess,
 * classifyReadyJobs_, renderJobCard, ...) lives in client-side script inside
 * Frontend/Assets/Scripts/Production.html, which the Apps Script test runner (see
 * Tests/ProductionHardening_Tests.js) has no way to execute - there is no DOM there. This
 * file instead extracts the pure, DOM-free functions verbatim from that file's own source
 * (never a re-implementation, so it can't silently drift from the shipped behavior) and
 * exercises them directly under plain Node.
 *
 * Run with: node Tests/ProductionUI_Reconciliation_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "..", "Frontend", "Assets", "Scripts", "Production.html");
const FUNCTION_NAMES = [
  "escapeHtml", "reconciliationReason", "isDeliveryRecoveryRequired", "isDeliveredSuccess",
  "classifyReadyJobs_", "jobStatusBadgeClass", "jobStatusLabel", "renderJobCard",
  "countScriptNarrationWords_"
];

function extractFunction(source, name) {
  const marker = "function " + name + "(";
  const start = source.indexOf(marker);
  if (start === -1) throw new Error("Could not find function " + name + " in " + SOURCE_PATH);
  const braceStart = source.indexOf("{", start);
  let depth = 0, end = braceStart;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}") { depth--; if (depth === 0) { end++; break; } }
  }
  if (depth !== 0) throw new Error("Unbalanced braces extracting function " + name);
  return source.slice(start, end);
}

function loadProductionUiFunctions() {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const extracted = FUNCTION_NAMES.map(function (name) { return extractFunction(source, name); }).join("\n\n");
  const factory = new Function(extracted + "\nreturn { " + FUNCTION_NAMES.join(", ") + " };");
  return factory();
}

function runProductionUiReconciliationTests() {
  const ui = loadProductionUiFunctions();
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function includes(haystack, needle, message) { assert(haystack.indexOf(needle) !== -1, message); }
  function excludes(haystack, needle, message) { assert(haystack.indexOf(needle) === -1, message); }

  function job(overrides) {
    return Object.assign({
      id: "RND-TEST", renderId: "cr-11111111-1111-1111-1111-111111111111",
      status: "RENDERING", progress: 40, videoUrl: "", errorMessage: "",
      seoPack: { titleOptions: ["Test Title"] }, quality: { passed: true },
      review: { approved: true }, publishingJob: null, providerResponse: {}
    }, overrides || {});
  }
  function recoveryJob(reason, statusOverrides) {
    return job(Object.assign({
      providerResponse: { reconciliation: { reason: reason, reconciledAt: "2026-08-13T00:00:00.000Z", evidence: {} } }
    }, statusOverrides || {}));
  }

  test("1. Active RENDERING with no reconciliation reason -> ordinary Rendering state", function () {
    const html = ui.renderJobCard(job({ status: "RENDERING" }));
    includes(html, "badge-info", "expected the ordinary in-progress badge class");
    includes(html, "Rendering</span>", "expected the ordinary 'Rendering' badge label");
    includes(html, 'data-active="true"', "an active render must animate the progress bar");
    excludes(html, "Delivery recovery required", "must not show recovery UI with no reconciliation reason");
    excludes(html, "Re-render safely", "an active render must not offer Re-render safely");
  });

  test("2. FAILED with no artifact (ordinary retryable failure) -> Re-render safely", function () {
    const html = ui.renderJobCard(job({ status: "FAILED", errorMessage: "Cloud Run execution failed." }));
    includes(html, "badge-danger", "expected the ordinary failure badge class");
    includes(html, "Re-render safely", "an ordinary failure must remain retryable");
    excludes(html, "Delivery recovery required", "must not show recovery UI for an ordinary failure");
  });

  test("3. Active job + DELIVERY_RECOVERY_REQUIRED -> recovery UI, no rerender, not active", function () {
    const recovering = recoveryJob("DELIVERY_RECOVERY_REQUIRED", { status: "RENDERING" });
    const html = ui.renderJobCard(recovering);
    includes(html, "badge-warning", "expected the warning badge class for recovery-required");
    includes(html, "Delivery recovery required", "expected the distinct recovery-required label");
    includes(html, "Rendering appears to have completed, but delivery did not finish", "expected the explanatory copy");
    excludes(html, "Re-render safely", "must not expose Re-render safely on a recovery-required job");
    excludes(html, ">Create Short<", "must not expose Create Short on a recovery-required job");
    excludes(html, 'data-active="true"', "must not animate the progress bar as if still rendering");

    const classified = ui.classifyReadyJobs_([recovering]);
    assert(classified.recovery === recovering, "classifyReadyJobs_ must classify this job as recovery");
    assert(!classified.active, "a recovery-required job must not also classify as active");
    assert(!classified.succeeded, "a recovery-required job must not also classify as succeeded");
    assert(!classified.failed, "a recovery-required job must not also classify as failed");
  });

  test("4. External FAILED + artifact (recovery-required) -> recovery UI", function () {
    const html = ui.renderJobCard(recoveryJob("DELIVERY_RECOVERY_REQUIRED", {
      status: "RENDERING", errorMessage: "Cloud Run execution failed but a video artifact already exists - delivery recovery required, not an automatic re-render."
    }));
    includes(html, "Delivery recovery required", "expected recovery UI for the FAILED+artifact case");
    excludes(html, "Re-render safely", "must not expose Re-render safely for the FAILED+artifact case");
  });

  test("5. External SUCCEEDED + artifact but delivery missing (still active locally) -> recovery UI", function () {
    const html = ui.renderJobCard(recoveryJob("DELIVERY_RECOVERY_REQUIRED", {
      status: "RENDERING", errorMessage: "Cloud Run execution succeeded and a video artifact exists, but no delivery callback has been recorded - delivery recovery required."
    }));
    includes(html, "Delivery recovery required", "expected recovery UI for the SUCCEEDED-but-undelivered case");
    excludes(html, "Re-render safely", "must not expose Re-render safely for the SUCCEEDED-but-undelivered case");
  });

  test("6. Local SUCCEEDED + videoUrl wins even over older reconciliation metadata", function () {
    const delivered = recoveryJob("DELIVERY_RECOVERY_REQUIRED", {
      status: "SUCCEEDED", videoUrl: "https://example.com/video.mp4"
    });
    const html = ui.renderJobCard(delivered);
    includes(html, "Open video", "a genuinely delivered success must show Open video");
    excludes(html, "Delivery recovery required", "a delivered success must not regress to recovery-required");
    excludes(html, "Re-render safely", "quality/review both pass by default in this fixture, so no retry action is expected");

    const classified = ui.classifyReadyJobs_([delivered]);
    assert(classified.succeeded === delivered, "classifyReadyJobs_ must classify a delivered success as succeeded, not recovery");
    assert(!classified.recovery, "a delivered success must never classify as recovery");
  });

  test("7. No job -> Create Short behavior unchanged", function () {
    const classified = ui.classifyReadyJobs_([]);
    assert(!classified.active && !classified.succeeded && !classified.failed && !classified.recovery,
      "with no existing jobs, every classification must be null so the Create Short branch applies");
  });

  test("8. Historical Creatomate FAILED (no providerResponse.reconciliation at all) unchanged", function () {
    const creatomateJob = job({ status: "FAILED", providerResponse: { duration: 40 }, errorMessage: "Creatomate render failed." });
    const html = ui.renderJobCard(creatomateJob);
    includes(html, "Re-render safely", "a Creatomate failure with no reconciliation field must remain retryable");
    excludes(html, "Delivery recovery required", "must not misclassify a Creatomate job as recovery-required");
  });

  test("9. Meet Dean / STALE_NO_OPERATION -> remains ordinary FAILED / Re-render safely", function () {
    const meetDean = recoveryJob("STALE_NO_OPERATION", {
      status: "FAILED", seoPack: { titleOptions: ["Meet Dean: Ballycastle's App King!"] },
      errorMessage: "No execution identifiers and no artifact 3054 minutes after submission; treated as a stale, never-started job."
    });
    const html = ui.renderJobCard(meetDean);
    includes(html, "Re-render safely", "STALE_NO_OPERATION must remain an ordinary retryable failure");
    excludes(html, "Delivery recovery required", "STALE_NO_OPERATION is not a delivery-recovery condition");
  });

  test("10. Raveena stale / STALE_NO_OPERATION -> remains ordinary FAILED / Re-render safely, no special-casing", function () {
    const raveena = recoveryJob("STALE_NO_OPERATION", {
      status: "FAILED", seoPack: { titleOptions: ["Raveena's Bold Escape Unveiled"] },
      errorMessage: "No execution identifiers and no artifact 9692 minutes after submission; treated as a stale, never-started job."
    });
    const html = ui.renderJobCard(raveena);
    includes(html, "Re-render safely", "STALE_NO_OPERATION must remain an ordinary retryable failure");
    excludes(html, "Delivery recovery required", "STALE_NO_OPERATION is not a delivery-recovery condition");
  });

  test("11. countScriptNarrationWords_ counts scenes[].narration, not voiceoverScript (2026-08-14 fix)", function () {
    const script = {
      voiceoverScript: "A completely different independently-written voiceover field with about twenty words in it that must never be counted here at all.",
      scenes: [
        { narration: "Six words go right here now." },
        { narration: "Four more words here." }
      ]
    };
    const count = ui.countScriptNarrationWords_(script);
    if (count !== 10) throw new Error("Expected 10 words summed from scenes[].narration, got " + count);
  });

  test("12. countScriptNarrationWords_ matches the real Render A/B shapes (37 and 59 words)", function () {
    const renderA = { scenes: [7, 5, 14, 3, 3, 5].map(function (n) {
      return { narration: Array.from({ length: n }, function (_, i) { return "w" + i; }).join(" ") };
    }) };
    const renderB = { scenes: [6, 15, 11, 10, 7, 10].map(function (n) {
      return { narration: Array.from({ length: n }, function (_, i) { return "w" + i; }).join(" ") };
    }) };
    if (ui.countScriptNarrationWords_(renderA) !== 37) throw new Error("Render A shape must count to 37 words.");
    if (ui.countScriptNarrationWords_(renderB) !== 59) throw new Error("Render B shape must count to 59 words.");
  });

  const failures = results.filter(function (r) { return !r.passed; });
  return { passed: failures.length === 0, total: results.length, failures: failures, results: results };
}

if (require.main === module) {
  const outcome = runProductionUiReconciliationTests();
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.passed ? 0 : 1);
}

module.exports = { runProductionUiReconciliationTests };
