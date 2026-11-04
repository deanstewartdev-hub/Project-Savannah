import test from "node:test";
import assert from "node:assert/strict";
import { stagingTestFaults, MAX_INJECTED_CALLBACK_FAILURES } from "../src/lib/stagingTestFaults.js";

// Staging-only controls for S5 and S7. They must be off by default, refused outside staging, and bounded.

test("no faults are set by default", () => {
  assert.deepEqual(stagingTestFaults({ SAVANNAH_ENVIRONMENT: "staging" }), { failRenderAfterMusic: false, callbackTestFaults: {} });
});

test("S7 switch and S5 count are read exactly in staging", () => {
  const faults = stagingTestFaults({ SAVANNAH_ENVIRONMENT: "staging", STAGING_FAIL_RENDER_AFTER_MUSIC: "true", STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS: "1" });
  assert.equal(faults.failRenderAfterMusic, true);
  assert.deepEqual(faults.callbackTestFaults, { failFirstAttempts: 1 });
});

test("any fault is refused outside the staging environment, including production and unset", () => {
  for (const env of [{}, { SAVANNAH_ENVIRONMENT: "production" }, { SAVANNAH_ENVIRONMENT: "Staging" }]) {
    assert.throws(() => stagingTestFaults({ ...env, STAGING_FAIL_RENDER_AFTER_MUSIC: "true" }), /refused outside the staging/);
    assert.throws(() => stagingTestFaults({ ...env, STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS: "1" }), /refused outside the staging/);
  }
});

test("values must be exact", () => {
  const base = { SAVANNAH_ENVIRONMENT: "staging" };
  for (const value of ["TRUE", "1", "yes", " true"]) {
    assert.throws(() => stagingTestFaults({ ...base, STAGING_FAIL_RENDER_AFTER_MUSIC: value }), /exactly 'true'/);
  }
  for (const value of ["-1", "1.5", "x", "1e2"]) {
    assert.throws(() => stagingTestFaults({ ...base, STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS: value }), /whole number/);
  }
});

test("injected callback failures are capped below the retry schedule", () => {
  assert.equal(MAX_INJECTED_CALLBACK_FAILURES, 2);
  assert.throws(() => stagingTestFaults({ SAVANNAH_ENVIRONMENT: "staging", STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS: "3" }), /at most 2/);
  assert.deepEqual(stagingTestFaults({ SAVANNAH_ENVIRONMENT: "staging", STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS: "0" }).callbackTestFaults, {});
});
