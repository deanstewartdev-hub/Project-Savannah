/****************************************************
 * Project Savannah - Script_Engine duplicate-declaration regression test
 * (post-duration-hardening cleanup, 2026-08-19).
 *
 * Scripts/Script_Engine.js previously declared both generatePreview and
 * resolveOptions_ twice in the same scope. JavaScript silently lets a later
 * function declaration in the same scope win over an earlier one, so the first
 * definition of each was dead code, invisible at runtime - the resolveOptions_
 * case was load-bearing (see Tests/ScriptEngineOptionsResolution_Tests.js for the
 * behavioral regression tests). This file guards against the duplicate
 * declarations themselves silently returning via a raw source-text check, which
 * needs fs/__dirname and so can't live in the clasp-synced Tests/ directory
 * alongside the Apps Script-runtime-safe behavioral tests.
 *
 * Run with: node node-tests/ScriptEngineDuplicateDeclaration_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "..", "Scripts", "Script_Engine.js");
const GUARDED_FUNCTION_NAMES = ["generatePreview", "resolveOptions_"];

function runScriptEngineDuplicateDeclarationTests() {
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
    test("\"" + name + "\" is declared exactly once in Script_Engine.js", function () {
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
  const outcome = runScriptEngineDuplicateDeclarationTests();
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.passed ? 0 : 1);
}

module.exports = { runScriptEngineDuplicateDeclarationTests };
