import { test } from "node:test";
import assert from "node:assert/strict";
import { planBeatVisuals, segmentLengths, VisualCoverageError } from "../src/pipeline/visualSelection.js";

// Pexels-shaped results. `duration` is the source clip length in seconds.
function clip(id, slug, duration, uploader = "Earth Photart") {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
  };
}

const BLUE_A = clip(1001, "blue-streets-of-chefchaouen-morocco", 6);
const BLUE_B = clip(1002, "blue-alleys-of-chefchaouen", 5);
const BLUE_C = clip(1003, "blue-doors-in-chefchaouen", 7);
const UNRELATED = clip(2001, "a-cat-on-a-street-somewhere", 9, "Someone");

const BEAT = {
  text: "Some residents say the blue stands for peace.",
  visualQuery: "blue street",
  imagePrompt: "blue street",
  location: "Chefchaouen",
  searchKeywords: "blue street"
};

test("segmentLengths shares the beat evenly across clips, with no short tail", () => {
  assert.deepEqual(segmentLengths([6, 5], 9), [4.5, 4.5]);
  assert.deepEqual(segmentLengths([6], 6), [6]);
  const pieces = segmentLengths([9, 6], 9.3);
  assert.ok(pieces.every((p) => p >= 4.5), "no cut is a fraction of a second");
});

test("segmentLengths gives a short clip its full length and spreads the rest", () => {
  assert.deepEqual(segmentLengths([2, 9], 9), [2, 7]);
});

test("segmentLengths uses spare length from a long clip when a short one runs out", () => {
  const pieces = segmentLengths([9, 6], 12.7);
  assert.ok(Math.abs(pieces[0] + pieces[1] - 12.7) < 0.001);
  assert.ok(pieces[0] <= 9 && pieces[1] <= 6);
  assert.ok(pieces[0] > 6, "the long clip carries the excess");
});

test("segmentLengths returns null when the sources are too short, so no clip is looped", () => {
  assert.equal(segmentLengths([6, 5], 15), null);
});

test("a long beat is covered by several clips, each used once", async () => {
  const beat = { ...BEAT, coverSeconds: 10 };
  const plan = await planBeatVisuals([beat], async () => [BLUE_A, BLUE_B, BLUE_C]);
  const ids = plan[0].segments.map((s) => s.pexelsId);
  assert.equal(plan[0].type, "video");
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(plan[0].segments.reduce((total, s) => total + s.sourceDurationSeconds, 0) >= 10);
});

test("a beat that cannot be covered with relevant clips fails instead of looping", async () => {
  const beat = { ...BEAT, coverSeconds: 30 };
  await assert.rejects(
    () => planBeatVisuals([beat], async () => [BLUE_A, BLUE_B]),
    (error) => error instanceof VisualCoverageError && error.beatIndex === 0
  );
});

test("clips used for an uncovered beat are released for the next beat", async () => {
  // Beat 1 needs 30 s and cannot be covered, so with a still allowed its clips must be free
  // for beat 2, which needs only one clip.
  const first = { ...BEAT, coverSeconds: 30 };
  const second = { ...BEAT, text: "Another scene.", coverSeconds: 5 };
  const plan = await planBeatVisuals([first, second], async () => [BLUE_A, BLUE_B], { allowAiStills: true });
  assert.equal(plan[0].type, "still");
  assert.equal(plan[1].type, "video");
  assert.equal(plan[1].segments[0].pexelsId, BLUE_A.id);
});

test("irrelevant clips never count toward coverage", async () => {
  const beat = { ...BEAT, coverSeconds: 6 };
  await assert.rejects(
    () => planBeatVisuals([beat], async () => [UNRELATED]),
    VisualCoverageError
  );
});

test("a beat with no coverSeconds keeps the single-clip behaviour", async () => {
  const plan = await planBeatVisuals([BEAT], async () => [BLUE_A]);
  assert.equal(plan[0].segments.length, 1);
});

test("the plan records the queries tried and a reason for every clip", async () => {
  const beat = { ...BEAT, coverSeconds: 10 };
  const plan = await planBeatVisuals([beat], async () => [BLUE_A, BLUE_B]);
  assert.ok(plan[0].queriesTried.length >= 1);
  for (const segment of plan[0].segments) {
    assert.match(segment.reason, /supporting evidence/);
  }
});
