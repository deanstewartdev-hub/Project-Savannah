import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The bucket lifecycle files are the retention policy. These tests keep the two guarantees that the duplicate protection
// depends on: no rule deletes job-state records, and production never deletes render outputs by age.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(HERE, "..", "storage", name), "utf8"));

function deletedPrefixes(config) {
  return config.rule
    .filter((rule) => rule.action && rule.action.type === "Delete")
    .flatMap((rule) => rule.condition.matchesPrefix || []);
}

for (const name of ["lifecycle.production.json", "lifecycle.staging.json"]) {
  test(name + ": no rule can delete a job-state record", () => {
    const config = load(name);
    for (const prefix of deletedPrefixes(config)) {
      assert.equal(prefix.indexOf("job-states") === 0, false, prefix);
    }
    assert.ok(config.rule.every((rule) => !rule.condition.matchesPrefix || rule.condition.matchesPrefix.every((p) => p !== "")),
      "a rule with an empty prefix would match everything");
  });
}

test("production deletes only request payloads, and never renders by age", () => {
  const prefixes = deletedPrefixes(load("lifecycle.production.json"));
  assert.deepEqual(prefixes, ["job-requests/"]);
  assert.equal(prefixes.indexOf("renders/"), -1);
});

test("staging is a backstop of 14 days at most, so a missed cleanup cannot keep data indefinitely", () => {
  const config = load("lifecycle.staging.json");
  for (const rule of config.rule) assert.ok(rule.condition.age <= 14, "age must be 14 days or less");
  assert.ok(deletedPrefixes(config).indexOf("renders/") !== -1);
});

test("each lifecycle rule states an age and a prefix, and uses the Delete action only", () => {
  for (const name of ["lifecycle.production.json", "lifecycle.staging.json"]) {
    for (const rule of load(name).rule) {
      assert.equal(rule.action.type, "Delete");
      assert.ok(Number.isInteger(rule.condition.age) && rule.condition.age > 0, "age is a positive whole number of days");
      assert.ok(Array.isArray(rule.condition.matchesPrefix) && rule.condition.matchesPrefix.length > 0, "a prefix is required");
    }
  }
});
