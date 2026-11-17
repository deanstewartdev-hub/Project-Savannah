import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// config.js reads secrets at import time. Test-only values. Every search is a stub: no provider call is made.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { planBeatVisuals, VisualCoverageError } = await import("../src/pipeline/visualSelection.js");
const { preflightVisualSupply } = await import("../src/pipeline/visuals.js");
const { validateBeats } = await import("../src/lib/validateBeats.js");

function portraitClip(id, slug, uploader = "Someone") {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration: 9,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
  };
}

// The Antelope scene: a better-matching clip exists, but the reviewed list names another clip.
const BETTER = portraitClip(401, "antelope-canyon-sandstone-light-beams");
const APPROVED = portraitClip(402, "antelope-canyon-walls");
const antelopeSearch = async () => [BETTER, APPROVED];

test("approved clips restrict a beat: the reviewed clip is used even when another clip matches better", async () => {
  const beat = { text: "Scene.", visualQuery: "antelope canyon walls", imagePrompt: "antelope canyon walls",
    location: "Antelope Canyon", coverSeconds: 6, approvedClips: [402] };
  const plan = await planBeatVisuals([beat], antelopeSearch, { allowAiStills: false, landscapeFallback: true });
  assert.deepEqual(plan[0].segments.map((s) => s.pexelsId), [402]);
});

test("approved clips that do not qualify fail the beat: a still if allowed, otherwise a coverage error", async () => {
  const beat = { text: "Scene.", visualQuery: "antelope canyon walls", imagePrompt: "antelope canyon walls",
    location: "Antelope Canyon", coverSeconds: 6, approvedClips: [999] };
  const plan = await planBeatVisuals([beat], antelopeSearch, { allowAiStills: true, landscapeFallback: true });
  assert.equal(plan[0].type, "still");
  await assert.rejects(
    planBeatVisuals([beat], antelopeSearch, { allowAiStills: false, landscapeFallback: true }),
    VisualCoverageError
  );
});

test("an approved montage place uses only its reviewed clip", async () => {
  const beat = { text: "Recap.", coverSeconds: 6, montage: [
    { location: "Antelope Canyon", searchKeywords: "antelope canyon light", approvedClips: [402] },
    { location: "Burano", searchKeywords: "burano colourful houses" },
    { location: "Santorini", searchKeywords: "santorini blue domes" }
  ] };
  const search = async (query) => {
    if (query.includes("antelope")) return [BETTER, APPROVED];
    if (query.includes("burano")) return [portraitClip(411, "colorful-houses-in-burano-canal")];
    if (query.includes("santorini")) return [portraitClip(421, "santorini-blue-domes-view")];
    return [];
  };
  const plan = await planBeatVisuals([beat], search, { allowAiStills: false, landscapeFallback: true });
  assert.deepEqual(plan[0].segments.map((s) => s.pexelsId), [402, 411, 421]);
});

test("a labelled still is planned as a labelled AI still with no footage search", async () => {
  let searches = 0;
  const beat = { text: "Establishing shot.", visualQuery: "antelope canyon drone", imagePrompt: "antelope canyon drone",
    location: "Antelope Canyon", coverSeconds: 7, labelledStill: true };
  const plan = await planBeatVisuals([beat], async () => { searches += 1; return [BETTER]; }, { allowAiStills: true, landscapeFallback: true });
  assert.equal(plan[0].type, "still");
  assert.equal(plan[0].synthetic, true);
  assert.match(plan[0].label, /not authentic footage/);
  assert.equal(searches, 0, "no footage search is made for a labelled still");
});

test("a labelled still is refused when AI stills are not allowed for the job", async () => {
  const beat = { text: "x", visualQuery: "a", imagePrompt: "a", location: "Burano", coverSeconds: 3, labelledStill: true };
  await assert.rejects(
    planBeatVisuals([beat], antelopeSearch, { allowAiStills: false, landscapeFallback: true }),
    (error) => error instanceof VisualCoverageError && /AI stills are not allowed/.test(error.message)
  );
});

test("the preflight counts labelled stills in its lower bound (they are always stills)", async () => {
  const beats = [
    { text: "a", visualQuery: "antelope canyon", imagePrompt: "a", location: "Antelope Canyon", coverSeconds: 4, labelledStill: true },
    { text: "b", visualQuery: "antelope canyon walls", imagePrompt: "b", location: "Antelope Canyon", coverSeconds: 4, approvedClips: [402] }
  ];
  const result = await preflightVisualSupply(beats, { allowAiStills: true, search: antelopeSearch, stillLimit: 2, landscapeFallback: true, requireLocation: true });
  assert.equal(result.lowerBound, 1, "the labelled still is the one still; the approved clip is matched");
});

test("beat controls are validated: a labelled still cannot name clips, and clip IDs must be positive whole numbers", () => {
  const base = { text: "Scene.", visualQuery: "a view" };
  assert.equal(validateBeats([{ ...base, labelledStill: true }]), null);
  assert.equal(validateBeats([{ ...base, approvedClips: [402, 411] }]), null);
  assert.match(validateBeats([{ ...base, labelledStill: true, approvedClips: [402] }]), /cannot also name approved clips/);
  assert.match(validateBeats([{ ...base, approvedClips: [1.5] }]), /positive whole numbers/);
  assert.match(validateBeats([{ ...base, approvedClips: [0] }]), /positive whole numbers/);
  assert.match(validateBeats([{ ...base, approvedClips: [1, 2, 3, 4, 5, 6] }]), /at most 5/);
  assert.match(validateBeats([{ ...base, labelledStill: "yes" }]), /true or false/);
  assert.match(validateBeats([{ text: "Recap.", visualQuery: "recap", labelledStill: true, montage: [{ location: "Burano" }, { location: "Santorini" }] }]), /montage cannot be a labelled still/);
});
