/****************************************************
 * Project Savannah - SAV-15/SAV-16 access-control and pre-deploy hardening tests.
 *
 * Proves, deterministically and with no live Apps Script/Sheet/network access:
 * SAV-15: 1. main manifest not anonymous; 2/3/4. auth gate; 5. unknown route rejected;
 *         6. no operator-controller function exposed; 7. bridge manifest stays minimal
 * SAV-16: strict render ID format; explicit completed/failed status allow-list; exact
 *         Render Jobs header-schema match before any write; single setValues() write
 *         (no partial-write window); root clasp sync isolation
 *
 * Run with: node node-tests/CallbackBridge_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..");
const VALID_RENDER_ID = "cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9";

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

  const bridgeSource = fs.readFileSync(path.join(REPO, "CallbackBridge", "CallbackBridge.js"), "utf8");

  // ============================================================
  // SAV-15
  // ============================================================

  test("SAV-15.1 main appsscript.json access is not ANYONE_ANONYMOUS", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "appsscript.json"), "utf8"));
    if (manifest.webapp.access === "ANYONE_ANONYMOUS") {
      throw new Error("Main project's appsscript.json must not be ANYONE_ANONYMOUS (SAV-15).");
    }
    if (manifest.webapp.access !== "MYSELF") {
      throw new Error("Expected access: MYSELF, got " + manifest.webapp.access);
    }
  });

  // Load CallbackBridge.js's pure functions in a minimal sandbox - no GAS globals
  // needed for the pure functions, since they take their inputs as plain arguments
  // rather than reading PropertiesService/SpreadsheetApp themselves.
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox, { filename: "CallbackBridge.js" });

  test("SAV-15.2 missing secret is rejected", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "" }, "the-real-secret") !== false) {
      throw new Error("Expected rejection when the request supplies no secret.");
    }
  });

  test("SAV-15.2b no secret configured at all is rejected (never treated as open)", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "anything" }, "") !== false) {
      throw new Error("Expected rejection when no secret is configured, even if the request supplies one.");
    }
    if (sandbox.isAuthorizedCallback_({ secret: "anything" }, undefined) !== false) {
      throw new Error("Expected rejection when the configured secret is undefined.");
    }
  });

  test("SAV-15.3 incorrect secret is rejected", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "wrong-guess" }, "the-real-secret") !== false) {
      throw new Error("Expected rejection for a mismatched secret.");
    }
  });

  test("SAV-15.4 a correct synthetic secret is accepted", () => {
    if (sandbox.isAuthorizedCallback_({ secret: "synthetic-test-secret" }, "synthetic-test-secret") !== true) {
      throw new Error("Expected acceptance for a matching secret.");
    }
  });

  test("SAV-15.5 an unknown callback route is rejected", () => {
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

  test("SAV-15.6 CallbackBridge defines only its own minimal function set - no operator controller name appears", () => {
    const declaredFunctions = Array.from(bridgeSource.matchAll(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)).map((m) => m[1]);
    const expected = ["doPost", "resolveParameters_", "resolveRoute_", "isAuthorizedCallback_", "isValidRenderId_",
      "isValidCallbackStatus_", "headersMatchExpected_", "handleCallback_", "updateRenderJobByRenderId_",
      "writeCompletionColumns_", "completedChanges_", "failedChanges_"];
    const unexpected = declaredFunctions.filter((name) => !expected.includes(name));
    if (unexpected.length) {
      throw new Error("CallbackBridge.js defines unexpected global function(s): " + unexpected.join(", "));
    }
    if (declaredFunctions.filter((name) => name === "doPost").length !== 1) {
      throw new Error("Expected exactly one doPost.");
    }

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

  test("SAV-15.7 CallbackBridge's own manifest is the intentionally anonymous, minimal-scope one", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "CallbackBridge", "appsscript.json"), "utf8"));
    if (manifest.webapp.access !== "ANYONE_ANONYMOUS") {
      throw new Error("CallbackBridge must stay anonymous - that is its whole purpose.");
    }
    if (manifest.oauthScopes.length !== 1 || manifest.oauthScopes[0].indexOf("spreadsheets") === -1) {
      throw new Error("CallbackBridge must request only the spreadsheets scope, nothing broader.");
    }
  });

  // ============================================================
  // SAV-16.1 render ID validation
  // ============================================================

  test("SAV-16.1 a valid cr-UUID is accepted", () => {
    if (sandbox.isValidRenderId_(VALID_RENDER_ID) !== true) {
      throw new Error("Expected a well-formed cr-<UUID> to be accepted.");
    }
  });

  test("SAV-16.2 malformed render IDs are rejected", () => {
    const malformed = [
      "../../../etc/passwd",
      "cr-not-a-uuid",
      "cr-" + "a".repeat(36),
      "renders/cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9/final.mp4",
      "cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9/../secrets",
      "CR-C68C66F5-B646-4C1C-A88A-8748C5C0F1D9-extra",
      "sk-proj-arbitrary-string",
      42
    ];
    malformed.forEach((candidate) => {
      if (sandbox.isValidRenderId_(candidate) !== false) {
        throw new Error("Expected rejection for malformed render ID: " + JSON.stringify(candidate));
      }
    });
  });

  test("SAV-16.3 a missing/blank render ID is rejected", () => {
    [undefined, null, "", "   "].forEach((candidate) => {
      if (sandbox.isValidRenderId_(candidate) !== false) {
        throw new Error("Expected rejection for missing/blank render ID: " + JSON.stringify(candidate));
      }
    });
  });

  // ============================================================
  // SAV-16.2 callback status validation
  // ============================================================

  test("SAV-16.4 status \"completed\" is accepted", () => {
    if (sandbox.isValidCallbackStatus_("completed") !== true) throw new Error("Expected \"completed\" to be accepted.");
  });

  test("SAV-16.5 status \"failed\" is accepted", () => {
    if (sandbox.isValidCallbackStatus_("failed") !== true) throw new Error("Expected \"failed\" to be accepted.");
  });

  test("SAV-16.6 an unknown status is rejected", () => {
    ["unknown", "pending", "Completed", "COMPLETED", "success", ""].forEach((candidate) => {
      if (sandbox.isValidCallbackStatus_(candidate) !== false) {
        throw new Error("Expected rejection for unknown status: " + JSON.stringify(candidate));
      }
    });
  });

  test("SAV-16.7 a missing status is rejected", () => {
    [undefined, null].forEach((candidate) => {
      if (sandbox.isValidCallbackStatus_(candidate) !== false) {
        throw new Error("Expected rejection for missing status: " + JSON.stringify(candidate));
      }
    });
  });

  // ============================================================
  // SAV-16.3 sheet schema guard
  // ============================================================

  test("SAV-16.8 the exact expected header row is accepted", () => {
    if (sandbox.headersMatchExpected_(sandbox.RENDER_JOBS_HEADERS.slice()) !== true) {
      throw new Error("Expected the real header row to match itself.");
    }
  });

  test("SAV-16.9 a single changed header is rejected", () => {
    const headers = sandbox.RENDER_JOBS_HEADERS.slice();
    headers[5] = "State"; // was "Status"
    if (sandbox.headersMatchExpected_(headers) !== false) {
      throw new Error("Expected rejection when one header text differs.");
    }
  });

  test("SAV-16.10 a shortened header list is rejected", () => {
    const headers = sandbox.RENDER_JOBS_HEADERS.slice(0, sandbox.RENDER_JOBS_HEADERS.length - 1);
    if (sandbox.headersMatchExpected_(headers) !== false) {
      throw new Error("Expected rejection when the header row is missing a column.");
    }
  });

  test("SAV-16.11 reordered headers are rejected", () => {
    const headers = sandbox.RENDER_JOBS_HEADERS.slice();
    const tmp = headers[0]; headers[0] = headers[1]; headers[1] = tmp; // swap Job ID / Render ID
    if (sandbox.headersMatchExpected_(headers) !== false) {
      throw new Error("Expected rejection when headers are present but reordered.");
    }
  });

  // ============================================================
  // SAV-16.4 no partial writes - mock SpreadsheetApp/PropertiesService, track calls
  // ============================================================

  function makeMockRange(sheetState, row, col, numRows, numCols) {
    return {
      getDisplayValues: () => sheetState.rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols).map(String)),
      getValues: () => sheetState.rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
      setValues: (values) => {
        sheetState.calls.push({ type: "setValues", row, col, numRows, numCols, values });
        for (let r = 0; r < values.length; r++) {
          for (let c = 0; c < values[r].length; c++) {
            sheetState.rows[row - 1 + r][col - 1 + c] = values[r][c];
          }
        }
      },
      setValue: (value) => { sheetState.calls.push({ type: "setValue", row, col, value }); sheetState.rows[row - 1][col - 1] = value; }
    };
  }

  function makeMockSheet(headerRow, dataRows) {
    const state = { rows: [headerRow].concat(dataRows), calls: [] };
    return {
      state,
      getLastRow: () => state.rows.length,
      getRange: (row, col, numRows, numCols) => makeMockRange(state, row, col, numRows || 1, numCols || 1)
    };
  }

  function runInFreshSandboxWithMocks(mockSheet, scriptProperties) {
    const freshSandbox = {
      console,
      PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => scriptProperties[name] }) },
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => mockSheet }) },
      Logger: { log: () => {} },
      ContentService: { createTextOutput: (s) => ({ text: s, setMimeType: function () { return this; } }), MimeType: { JSON: "JSON" } }
    };
    vm.createContext(freshSandbox);
    vm.runInContext(bridgeSource, freshSandbox, { filename: "CallbackBridge.js" });
    return freshSandbox;
  }

  const REAL_HEADERS = ["Job ID", "Render ID", "Script ID", "SEO Pack ID", "Template ID", "Status",
    "Progress", "Video URL", "Snapshot URL", "Error Message", "Request JSON", "Response JSON",
    "Created At", "Updated At", "Version", "Model Version"];

  test("SAV-16.12 a schema mismatch throws before any write occurs", () => {
    const badHeaders = REAL_HEADERS.slice();
    badHeaders[5] = "State"; // corrupted "Status" column
    const dataRow = new Array(REAL_HEADERS.length).fill("");
    dataRow[1] = VALID_RENDER_ID;
    const mockSheet = makeMockSheet(badHeaders, [dataRow]);
    const freshSandbox = runInFreshSandboxWithMocks(mockSheet, { RENDER_JOBS_SPREADSHEET_ID: "fake-id" });

    let threw = false;
    try {
      freshSandbox.updateRenderJobByRenderId_(VALID_RENDER_ID, { status: "completed" });
    } catch (error) {
      threw = /schema/i.test(error.message);
    }
    if (!threw) throw new Error("Expected updateRenderJobByRenderId_ to throw on a schema mismatch.");
    if (mockSheet.state.calls.length !== 0) {
      throw new Error("Expected zero writes on a schema mismatch, got: " + JSON.stringify(mockSheet.state.calls));
    }
  });

  test("SAV-16.13 a malformed callback (bad render ID / bad status) never reaches SpreadsheetApp at all", () => {
    let spreadsheetAppCalled = false;
    const freshSandbox = {
      console,
      PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => (name === "MEDIA_WORKER_SHARED_SECRET" ? "real-secret" : undefined) }) },
      SpreadsheetApp: { openById: () => { spreadsheetAppCalled = true; throw new Error("should not be reached"); } },
      Logger: { log: () => {} }
    };
    vm.createContext(freshSandbox);
    vm.runInContext(bridgeSource, freshSandbox, { filename: "CallbackBridge.js" });

    const malformedIdResult = freshSandbox.handleCallback_(
      { postData: { contents: JSON.stringify({ jobId: "not-a-real-id", status: "completed" }) } },
      { secret: "real-secret" }
    );
    if (malformedIdResult.success !== false) throw new Error("Expected failure for a malformed render ID.");

    const badStatusResult = freshSandbox.handleCallback_(
      { postData: { contents: JSON.stringify({ jobId: VALID_RENDER_ID, status: "not-a-real-status" }) } },
      { secret: "real-secret" }
    );
    if (badStatusResult.success !== false) throw new Error("Expected failure for an unknown status.");

    if (spreadsheetAppCalled) {
      throw new Error("SpreadsheetApp must never be reached for a malformed render ID or status.");
    }
  });

  test("SAV-16.4b a valid completed callback writes exactly once, in a single setValues() call", () => {
    const dataRow = new Array(REAL_HEADERS.length).fill("existing-value");
    dataRow[1] = VALID_RENDER_ID;
    dataRow[8] = "existing-snapshot-url"; // Snapshot URL - inside the write span, must survive untouched
    dataRow[10] = "existing-request-json"; // Request JSON - also inside the span
    dataRow[12] = "existing-created-at"; // Created At - also inside the span
    const mockSheet = makeMockSheet(REAL_HEADERS.slice(), [dataRow]);
    const freshSandbox = runInFreshSandboxWithMocks(mockSheet, { RENDER_JOBS_SPREADSHEET_ID: "fake-id" });

    const updated = freshSandbox.updateRenderJobByRenderId_(VALID_RENDER_ID, { status: "completed", video: { url: "https://example.test/final.mp4" } });
    if (updated !== true) throw new Error("Expected the update to report success.");

    const writeCalls = mockSheet.state.calls.filter((c) => c.type === "setValues");
    if (writeCalls.length !== 1) {
      throw new Error("Expected exactly one setValues() write, got " + writeCalls.length);
    }
    // Columns this bridge does not own must be preserved unchanged, not blanked.
    const finalRow = mockSheet.state.rows[1];
    if (finalRow[8] !== "existing-snapshot-url") throw new Error("Snapshot URL must be preserved untouched.");
    if (finalRow[10] !== "existing-request-json") throw new Error("Request JSON must be preserved untouched.");
    if (finalRow[12] !== "existing-created-at") throw new Error("Created At must be preserved untouched.");
    if (finalRow[5] !== "SUCCEEDED") throw new Error("Status must be updated to SUCCEEDED.");
  });

  // ============================================================
  // SAV-16.5 clasp isolation guard
  // ============================================================

  test("SAV-16.16a root .claspignore does not whitelist CallbackBridge", () => {
    const rootClaspignore = fs.readFileSync(path.join(REPO, ".claspignore"), "utf8");
    if (/!\s*CallbackBridge/i.test(rootClaspignore)) {
      throw new Error("Root .claspignore must never explicitly allow CallbackBridge into the main project's clasp sync.");
    }
  });

  test("SAV-16.16b CallbackBridge/.claspignore allows only its own two files", () => {
    const bridgeClaspignore = fs.readFileSync(path.join(REPO, "CallbackBridge", ".claspignore"), "utf8");
    const allowed = Array.from(bridgeClaspignore.matchAll(/^!\s*(\S+)/gm)).map((m) => m[1]);
    const expected = ["CallbackBridge.js", "appsscript.json"];
    if (allowed.length !== expected.length || !expected.every((f) => allowed.includes(f))) {
      throw new Error("Expected CallbackBridge/.claspignore to allow exactly " + expected.join(", ") + ", got " + allowed.join(", "));
    }
  });

  test("SAV-16.16c CallbackBridge has no main-operator-controller source (App/, Production/, Services/, etc. absent)", () => {
    const bridgeDir = path.join(REPO, "CallbackBridge");
    const entries = fs.readdirSync(bridgeDir);
    const requiredEntries = ["CallbackBridge.js", "appsscript.json", ".claspignore"];
    // .clasp.json is the standalone project's own local clasp binding (script ID). It is
    // expected to exist on disk once the bridge project has been created, but must never
    // be committed - see the untracked check below.
    const optionalLocalEntries = [".clasp.json"];
    const allowedEntries = requiredEntries.concat(optionalLocalEntries);

    const unexpected = entries.filter((e) => !allowedEntries.includes(e));
    if (unexpected.length > 0) {
      throw new Error("CallbackBridge/ must contain only its own minimal files, found unexpected: " + unexpected.join(", "));
    }
    const missingRequired = requiredEntries.filter((e) => !entries.includes(e));
    if (missingRequired.length > 0) {
      throw new Error("CallbackBridge/ is missing required files: " + missingRequired.join(", "));
    }

    if (entries.includes(".clasp.json")) {
      let isTracked = true;
      try {
        execFileSync("git", ["ls-files", "--error-unmatch", "CallbackBridge/.clasp.json"], { cwd: REPO, stdio: "pipe" });
      } catch (error) {
        isTracked = false;
      }
      if (isTracked) {
        throw new Error("CallbackBridge/.clasp.json must never be tracked by Git.");
      }
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
