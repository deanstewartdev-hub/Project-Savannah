/****************************************************
 * Project Savannah - Utils_Helpers duplicate-declaration regression test
 * (post-duration-hardening cleanup, 2026-08-19).
 *
 * Utils/Utils_Helpers.js declared deleteSheetIfExists twice, with byte-identical
 * bodies - harmless behaviorally (unlike the Script_Engine.js case), but the same
 * underlying hazard: a future edit to one copy silently has no effect if the other
 * copy is the one actually in effect. Removed the redundant second declaration;
 * this guards against it reappearing.
 *
 * Run with: node node-tests/UtilsHelpersDuplicateDeclaration_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "..", "Utils", "Utils_Helpers.js");
const GUARDED_FUNCTION_NAMES = ["deleteSheetIfExists"];

function runUtilsHelpersDuplicateDeclarationTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  const source = fs.readFileSync(SOURCE_PATH, "utf8");

  GUARDED_FUNCTION_NAMES.forEach(function (name) {
    test("\"" + name + "\" is declared exactly once in Utils_Helpers.js", function () {
      const pattern = new RegExp("function " + name + "\\(", "g");
      const count = (source.match(pattern) || []).length;
      if (count !== 1) {
        throw new Error("Expected exactly one \"function " + name + "(\" declaration, found " + count + ".");
      }
    });
  });

  const failures = results.filter(function (r) { return !r.passed; });
  return { passed: failures.length === 0, total: results.length, failures: failures, results: results };
}

if (require.main === module) {
  const outcome = runUtilsHelpersDuplicateDeclarationTests();
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.passed ? 0 : 1);
}

module.exports = { runUtilsHelpersDuplicateDeclarationTests };
