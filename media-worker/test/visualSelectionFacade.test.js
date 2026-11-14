// Refactoring safety net: src/pipeline/visualSelection.js is what the rest of the worker, the
// tools and the tests import. Its logic may live in focused modules beside it, but the names
// it exports, and the values of its public constants, must not change.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as facade from "../src/pipeline/visualSelection.js";

// Captured at the tip of PR #32 (4e4967c), before the file was split.
const PUBLIC_NAMES = [
  "MAX_CROP_UPSCALE", "MIN_KEPT_WIDTH_FRACTION", "MONTAGE_MAX_PARTS", "MONTAGE_MIN_PARTS", "VisualCoverageError",
  "approvedCandidates", "approvedClipsError", "approvedSet", "beatControlsError", "buildSearchQueries",
  "coverageCandidates", "deriveKeywords", "evidenceFor", "isMontage", "judgeVideo", "landscapeCropFile",
  "matchedFlags", "maxDistinctAssignment", "memoizeSearch", "montageError", "montagePartBeat", "planBeatVisuals",
  "previousTokens", "previousUploaders", "segmentLengths", "selectClip", "shotWordsFor", "slugTokens", "stillPrompt",
  "tokenize", "unsupportedBeats"
];

test("visualSelection.js exports exactly the names it exported before the split", () => {
  assert.deepEqual(Object.keys(facade).sort(), PUBLIC_NAMES);
});

test("every exported name except the constants is still a function or class", () => {
  const constants = ["MAX_CROP_UPSCALE", "MIN_KEPT_WIDTH_FRACTION", "MONTAGE_MAX_PARTS", "MONTAGE_MIN_PARTS"];
  for (const name of PUBLIC_NAMES) {
    assert.equal(typeof facade[name], constants.includes(name) ? "number" : "function", name);
  }
});

test("the public crop and montage limits keep their values", () => {
  assert.equal(facade.MAX_CROP_UPSCALE, 1.8);
  assert.equal(facade.MIN_KEPT_WIDTH_FRACTION, 0.28);
  assert.equal(facade.MONTAGE_MIN_PARTS, 2);
  assert.equal(facade.MONTAGE_MAX_PARTS, 3);
});

test("a visual-coverage error keeps its name, code and beat index", () => {
  const error = new facade.VisualCoverageError("no footage", 3);
  assert.equal(error.name, "VisualCoverageError");
  assert.equal(error.code, "PRODUCTION_VISUAL_COVERAGE");
  assert.equal(error.beatIndex, 3);
  assert.ok(error instanceof Error);
});
