import test from "node:test";
import assert from "node:assert/strict";
import { computeBeatTimings, beatVisualSpans } from "../src/pipeline/beatTiming.js";
import { assertNarrationComplete, NarrationIncompleteError, NARRATION_COMPLETENESS } from "../src/pipeline/narrationCompleteness.js";

// Pure tests for the Issue #29 fix. No ffmpeg, no paid call. The ffmpeg end-to-end test is in
// narrationCompleteness.integration.test.js.

// Six beats of four words, with pauses between beats, and a lead-in and a tail. Same shape as the integration test.
function speech() {
  const words = [];
  const beats = [];
  let t = 0.8;
  for (let b = 0; b < 6; b += 1) {
    const texts = [];
    for (let w = 0; w < 4; w += 1) {
      words.push({ word: `w${b}${w}`, start: t, end: t + 0.5 });
      texts.push(`w${b}${w}`);
      t += 0.65;
    }
    beats.push({ text: texts.join(" ") });
    t += 2.4 - 0.15;
  }
  return { words, beats, lastWordEnd: words[words.length - 1].end, totalSeconds: words[words.length - 1].end + 1.5 };
}

test("beat visuals cover the whole narration: durations sum to the narration length, pauses included", () => {
  const s = speech();
  const timed = computeBeatTimings(s.beats, s.words);
  const spans = beatVisualSpans(timed, s.totalSeconds);
  const total = spans.reduce((sum, span) => sum + span.duration, 0);
  assert.ok(Math.abs(total - s.totalSeconds) < 1e-9, `spans sum ${total} != narration ${s.totalSeconds}`);
});

test("each beat keeps its place on the narration timeline: it starts at its first word, and the lead-in belongs to beat 0", () => {
  const s = speech();
  const timed = computeBeatTimings(s.beats, s.words);
  const spans = beatVisualSpans(timed, s.totalSeconds);
  assert.equal(spans[0].start, 0, "beat 0 starts at the top of the narration, including the lead-in");
  for (let i = 1; i < spans.length; i += 1) {
    assert.equal(spans[i].start, timed[i].start, `beat ${i} starts at its first spoken word`);
  }
  // The pause after beat 0 is inside beat 0's visual, not lost.
  assert.ok(spans[0].end - timed[0].end > 2, "the pause after a beat stays with that beat's visual");
});

test("the last beat runs to the end of the narration, so the tail is kept", () => {
  const s = speech();
  const timed = computeBeatTimings(s.beats, s.words);
  const spans = beatVisualSpans(timed, s.totalSeconds);
  assert.equal(spans[spans.length - 1].end, s.totalSeconds);
});

test("a narration shorter than its last aligned word is refused, not silently shortened", () => {
  const s = speech();
  const timed = computeBeatTimings(s.beats, s.words);
  assert.throws(() => beatVisualSpans(timed, s.lastWordEnd - 1), /ends before its last aligned word/);
  assert.throws(() => beatVisualSpans(timed, 0), /positive number/);
});

const good = { narrationSeconds: 30, videoSeconds: 30.02, audioSeconds: 30.01, scriptWordCount: 20 };
const words20 = Array.from({ length: 20 }, (_, i) => ({ word: `x${i}`, start: i, end: i + 0.8 }));
// last word ends at 19.8 s; a 30 s narration has 10.2 s after it, so use a narration that ends right after speech.
const wordsEnding = (endAt) => words20.map((w, i) => ({ word: w.word, start: (i * endAt) / 20, end: ((i + 1) * endAt) / 20 }));

test("the gate passes a complete finished video", () => {
  const alignedWords = wordsEnding(29.4);
  assert.deepEqual(assertNarrationComplete({ ...good, alignedWords }), { ok: true });
});

test("the gate refuses a video shorter than the narration, even when its container looks long enough", () => {
  const alignedWords = wordsEnding(29.4);
  assert.throws(() => assertNarrationComplete({ ...good, videoSeconds: 25, alignedWords }), (error) => {
    assert.ok(error instanceof NarrationIncompleteError);
    assert.match(error.message, /video is 25\.00 s, shorter than the 30\.00 s narration/);
    return true;
  });
});

test("the gate refuses audio shorter than the narration", () => {
  const alignedWords = wordsEnding(29.4);
  assert.throws(() => assertNarrationComplete({ ...good, audioSeconds: 14.7, alignedWords }), /audio is 14\.70 s, shorter/);
});

test("the gate refuses a long unrecognised stretch after the last word: speech may have been missed", () => {
  const alignedWords = wordsEnding(20); // last word at 20 s, 10 s of narration after it
  assert.throws(() => assertNarrationComplete({ ...good, alignedWords }), /10\.00 s of narration follow the last recognised word/);
});

test("a normal outro breath after the last word is allowed", () => {
  const alignedWords = wordsEnding(30 - NARRATION_COMPLETENESS.maxUnalignedTailSeconds + 0.5);
  assert.deepEqual(assertNarrationComplete({ ...good, alignedWords }), { ok: true });
});

test("the gate refuses too few recognised words for the script", () => {
  const alignedWords = wordsEnding(29.4).slice(0, 15);
  assert.throws(() => assertNarrationComplete({ ...good, alignedWords }), /Only 15 of 20 script words were recognised/);
});

test("the gate refuses when a measurement is missing, and when no words were recognised", () => {
  const alignedWords = wordsEnding(29.4);
  assert.throws(() => assertNarrationComplete({ ...good, audioSeconds: undefined, alignedWords }), /audio length could not be measured/);
  assert.throws(() => assertNarrationComplete({ ...good, alignedWords: [] }), /No words were recognised/);
});

test("a video that a duration-only check would pass can still fail completeness (the reported case)", () => {
  // The old probe passed 30-60 s videos without comparing them to the narration. Here the video is inside the
  // Shorts range, but the narration is longer, so speech is cut off. The gate refuses it.
  const alignedWords = wordsEnding(44);
  assert.throws(() => assertNarrationComplete({ narrationSeconds: 46, videoSeconds: 40, audioSeconds: 40, alignedWords, scriptWordCount: 20 }), /shorter than the 46\.00 s narration/);
});
