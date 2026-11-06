import test from "node:test";
import assert from "node:assert/strict";
import { beatRenderSeconds, beatVisualSpans } from "../src/pipeline/beatTiming.js";

// Regression for the "Visual segments do not cover 10.54 s" failure: the planner used to ask for footage
// covering only each beat's speech, while the assembler renders each beat over the full narration span
// (speech plus the pause that belongs to it). Both must now use the same length.

const CROSSFADE = 0.5;

// Beat 0 speaks 0-3 s, then a 7 s pause; beat 1 speaks 10-13 s; narration ends at 13.5 s.
const timedBeats = [
  { start: 0.2, end: 3 },
  { start: 10, end: 13 }
];
const NARRATION = 13.5;

test("each beat's render length is its full narration span plus the crossfade, except the last", () => {
  const render = beatRenderSeconds(timedBeats, NARRATION, CROSSFADE);
  assert.deepEqual(render.map((d) => Number(d.toFixed(3))), [10.5, 3.5]);
});

test("the render lengths sum to the narration once each crossfade is subtracted", () => {
  const render = beatRenderSeconds(timedBeats, NARRATION, CROSSFADE);
  const total = render.reduce((sum, d) => sum + d, 0) - CROSSFADE * (render.length - 1);
  assert.ok(Math.abs(total - NARRATION) < 1e-9, `total ${total} should equal ${NARRATION}`);
});

test("the planner's requirement matches the assembler's render length, including a long pause", () => {
  // Assembler's length for beat 0 is its span on the narration timeline plus the crossfade.
  const assemblerSpan = beatVisualSpans(timedBeats, NARRATION)[0].duration + CROSSFADE;
  const plannerRequirement = beatRenderSeconds(timedBeats, NARRATION, CROSSFADE)[0];
  assert.equal(plannerRequirement, assemblerSpan);
  // The old speech-only requirement was far shorter than the 10.5 s the assembler cuts.
  const speechOnly = (timedBeats[0].end - timedBeats[0].start) + CROSSFADE;
  assert.ok(speechOnly < assemblerSpan - 6, "the pause must be covered by footage");
});

test("a beat that is not last but has no pause still gets its speech plus the crossfade", () => {
  const tight = [
    { start: 0, end: 2 },
    { start: 2, end: 4 }
  ];
  const render = beatRenderSeconds(tight, 4, CROSSFADE);
  assert.deepEqual(render.map((d) => Number(d.toFixed(3))), [2.5, 2]);
});
