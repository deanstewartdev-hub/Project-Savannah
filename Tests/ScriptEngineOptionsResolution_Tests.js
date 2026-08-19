/****************************************************
 * Project Savannah - Script Engine option-resolution regression tests
 * (post-duration-hardening cleanup, 2026-08-19).
 *
 * Scripts/Script_Engine.js previously declared resolveOptions_ twice in the same
 * scope. JavaScript function declarations in one scope let the later declaration
 * silently win, so the first (dead) definition was never actually reachable - but
 * it differed from the surviving one in one load-bearing way: it never resolved
 * maxValidationAttempts onto the returned options object at all, and had no upper
 * bound on it. generateValidatedContent_'s retry loop reads
 * options.maxValidationAttempts directly as its loop bound, so if the dead
 * definition had been kept instead of removed, every script generation and preview
 * would have silently stopped after zero attempts. These tests pin the surviving
 * behavior so a future edit can't reintroduce that regression.
 *
 * Pure logic tests only - no AI/provider calls, no Sheet writes.
 ****************************************************/
function runScriptEngineOptionsResolutionTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  test("1. maxValidationAttempts defaults to 3 when not supplied", function () {
    const resolved = ScriptEngine.__test_resolveOptions({});
    if (resolved.maxValidationAttempts !== 3) {
      throw new Error("Expected default maxValidationAttempts of 3, got " + resolved.maxValidationAttempts + ".");
    }
  });

  test("2. a supplied maxValidationAttempts is honoured", function () {
    const resolved = ScriptEngine.__test_resolveOptions({ maxValidationAttempts: 2 });
    if (resolved.maxValidationAttempts !== 2) {
      throw new Error("Expected supplied maxValidationAttempts of 2, got " + resolved.maxValidationAttempts + ".");
    }
  });

  test("3. maxValidationAttempts above 5 is rejected", function () {
    let threw = false;
    try {
      ScriptEngine.__test_resolveOptions({ maxValidationAttempts: 6 });
    } catch (error) {
      threw = error.message.indexOf("Maximum validation attempts cannot exceed 5") !== -1;
    }
    if (!threw) {
      throw new Error("resolveOptions_ must reject a maxValidationAttempts greater than 5.");
    }
  });

  test("4. maximumWordCount below minimumWordCount is rejected", function () {
    let threw = false;
    try {
      ScriptEngine.__test_resolveOptions({ minimumWordCount: 100, maximumWordCount: 50 });
    } catch (error) {
      threw = error.message.indexOf("Maximum word count cannot be lower than minimum word count") !== -1;
    }
    if (!threw) {
      throw new Error("resolveOptions_ must reject maximumWordCount below minimumWordCount.");
    }
  });

  test("5. maximumDurationSeconds below minimumDurationSeconds is rejected", function () {
    let threw = false;
    try {
      ScriptEngine.__test_resolveOptions({ minimumDurationSeconds: 40, maximumDurationSeconds: 20 });
    } catch (error) {
      threw = error.message.indexOf("Maximum duration cannot be lower than minimum duration") !== -1;
    }
    if (!threw) {
      throw new Error("resolveOptions_ must reject maximumDurationSeconds below minimumDurationSeconds.");
    }
  });

  test("6. status defaults to FORMATTED and is upper-cased", function () {
    const resolved = ScriptEngine.__test_resolveOptions({ status: "formatted" });
    if (resolved.status !== "FORMATTED") {
      throw new Error("Expected status to resolve to FORMATTED, got " + resolved.status + ".");
    }
  });

  test("7. an unsupported status is rejected", function () {
    let threw = false;
    try {
      ScriptEngine.__test_resolveOptions({ status: "NOT_A_REAL_STATUS" });
    } catch (error) {
      threw = error.message.indexOf("Unsupported Script Engine status") !== -1;
    }
    if (!threw) {
      throw new Error("resolveOptions_ must reject an unsupported status.");
    }
  });

  // A static check that generatePreview/resolveOptions_ are each declared exactly
  // once (guarding against this exact duplicate-declaration bug recurring) lives in
  // node-tests/ScriptEngineDuplicateDeclaration_Tests.js instead of here: it needs
  // fs/__dirname to read the source file, which aren't available in the Apps Script
  // runtime this file is synced into.

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Script Engine options resolution tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
