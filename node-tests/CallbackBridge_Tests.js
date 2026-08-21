/****************************************************
 * Project Savannah - SAV-15 access-control regression tests.
 *
 * Proves, deterministically and with no live Apps Script/Sheet/network access:
 * 1. the main project's manifest is not anonymous
 * 2/3/4. CallbackBridge's auth gate rejects missing/wrong secret, accepts a correct one
 * 5. an unknown callback route is rejected
 * 6. CallbackBridge defines no operator-controller function, so there is nothing for
 *    google.script.run to expose beyond doPost even under anonymous access
 *
 * Run with: node node-tests/CallbackBridge_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");

function runCallbackBridgeTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error && error.message || error) });
    }
  }

  // 1. main operator app is not anonymous
  test("1. main appsscript.json access is not ANYONE_ANONYMOUS", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "appsscript.json"), "utf8"));
    if (manifest.webapp.access === "ANYONE_ANONYMOUS") {
      throw new Error("Main project's appsscript.json must not be ANYONE_ANONYMOUS (SAV-15).");
    }
    if (manifest.webapp.access !== "MYSELF") {
      throw new Error("Expected access: MYSELF, got " + manifest.webapp.access);
    }
  });

  // Load CallbackBridge.js's pure functions in a minimal sandbox - no GAS globals
  // needed for resolveRoute_/isAuthorizedCallback_/resolveParameters_, since they take
  // their inputs as plain arguments rather than reading PropertiesService themselves.
  const bridgeSource = fs.readFileSync(path.join(REPO, "CallbackBridge", "CallbackBridge.js"), "utf8");
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox, { filename: "CallbackBridge.js" });

  test("2. missing secret is rejected", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "" }, "the-real-secret") !== false) {
      throw new Error("Expected rejection when the request supplies no secret.");
    }
  });

  test("2b. no secret configured at all is rejected (never treated as open)", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "anything" }, "") !== false) {
      throw new Error("Expected rejection when no secret is configured, even if the request supplies one.");
    }
    if (sandbox.isAuthorizedCallback_({ secret: "anything" }, undefined) !== false) {
      throw new Error("Expected rejection when the configured secret is undefined.");
    }
  });

  test("3. incorrect secret is rejected", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "wrong-guess" }, "the-real-secret") !== false) {
      throw new Error("Expected rejection for a mismatched secret.");
    }
  });

  test("4. a correct synthetic secret is accepted", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "synthetic-test-secret" }, "synthetic-test-secret") !== true) {
      throw new Error("Expected acceptance for a matching secret.");
    }
  });

  test("5. an unknown callback route is rejected", () => {
    if (sandbox.resolveRoute_({ route: "something-else" }) === "media-worker-callback") {
      throw new Error("resolveRoute_ must not treat an unrelated route as the callback route.");
    }
    if (sandbox.resolveRoute_({}) === "media-worker-callback") {
      throw new Error("resolveRoute_ must not treat a missing route as the callback route.");
    }
    if (sandbox.resolveRoute_({ route: "media-worker-callback" }) !== "media-worker-callback") {
      throw new Error("resolveRoute_ must still recognise the real route.");
    }
  });

  // 6. operator functions are not exposed through the anonymous callback surface
  test("6. CallbackBridge defines only its own minimal function set - no operator controller name appears", () => {
    const declaredFunctions = Array.from(bridgeSource.matchAll(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)).map((m) => m[1]);
    const expected = ["doPost", "resolveParameters_", "resolveRoute_", "isAuthorizedCallback_", "handleCallback_",
      "updateRenderJobByRenderId_", "completedChanges_", "failedChanges_", "writeColumn_"];
    const unexpected = declaredFunctions.filter((name) => !expected.includes(name));
    if (unexpected.length) {
      throw new Error("CallbackBridge.js defines unexpected global function(s): " + unexpected.join(", "));
    }
    if (declaredFunctions.filter((name) => name === "doPost").length !== 1) {
      throw new Error("Expected exactly one doPost.");
    }

    // Collect every global function name from the main project's App/ controllers and
    // confirm zero overlap - CallbackBridge.js must never be able to accidentally
    // shadow or coincide with an operator entrypoint name.
    const appDir = path.join(REPO, "App");
    const operatorFunctionNames = [];
    fs.readdirSync(appDir).filter((f) => f.endsWith(".js")).forEach((file) => {
      const source = fs.readFileSync(path.join(appDir, file), "utf8");
      Array.from(source.matchAll(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)).forEach((m) => operatorFunctionNames.push(m[1]));
    });
    // doPost (and doGet, were it ever added) are the standard Apps Script entrypoint
    // names - both projects legitimately define their own doPost, but the two never
    // coexist in one runtime, so this is not a real collision. Any other shared name
    // would be.
    const EXPECTED_SHARED_ENTRYPOINTS = ["doPost", "doGet"];
    const overlap = declaredFunctions.filter((name) => operatorFunctionNames.includes(name) && !EXPECTED_SHARED_ENTRYPOINTS.includes(name));
    if (overlap.length) {
      throw new Error("CallbackBridge.js's function name(s) collide with main-project operator functions: " + overlap.join(", "));
    }
  });

  test("7. CallbackBridge's own manifest is the intentionally anonymous, minimal-scope one", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "CallbackBridge", "appsscript.json"), "utf8"));
    if (manifest.webapp.access !== "ANYONE_ANONYMOUS") {
      throw new Error("CallbackBridge must stay anonymous - that is its whole purpose.");
    }
    if (manifest.oauthScopes.length !== 1 || manifest.oauthScopes[0].indexOf("spreadsheets") === -1) {
      throw new Error("CallbackBridge must request only the spreadsheets scope, nothing broader.");
    }
  });

  const failures = results.filter((r) => !r.passed);
  return { passed: failures.length === 0, total: results.length, failures, results };
}

if (require.main === module) {
  const outcome = runCallbackBridgeTests();
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.passed ? 0 : 1);
}

module.exports = { runCallbackBridgeTests };
