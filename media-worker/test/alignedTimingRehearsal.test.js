import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Unpaid timing rehearsal. No narration, Whisper or image call is made. The word timings are synthetic, built from
// the saved estimatedSeconds at several speaking rates, because the approved narration text for every scene is not
// available here. The point is what the planner does when real alignment is stretched or compressed: the reviewed
// clips must still cover each scene, the montage must split evenly, and the two-still limit must hold.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { planBeatVisuals } = await import("../src/pipeline/visualSelection.js");
const { computeBeatTimings, beatRenderSeconds } = await import("../src/pipeline/beatTiming.js");
const { assertAiStillLimit, AiStillLimitError } = await import("../src/pipeline/visuals.js");

const CROSSFADE = 0.4;
const NOMINAL_WORDS_PER_SECOND = 2.3;

// The scenes as they would be planned: estimated seconds and the reviewed metadata from the proposal.
const SCENES = [
  { sec: 7.39, labelledStill: true, location: "Antelope Canyon", searchKeywords: "antelope canyon light" },
  { sec: 9.57, labelledStill: true, location: "Antelope Canyon", searchKeywords: "antelope canyon walls" },
  { sec: 10.87, location: "Burano", searchKeywords: "burano colourful houses", approvedClips: [29918560, 29918559] },
  { sec: 10, location: "Santorini", searchKeywords: "santorini blue domes", approvedClips: [38087413] },
  { sec: 6.52, montage: [
    { location: "Antelope Canyon", searchKeywords: "antelope canyon light", approvedClips: [29510336] },
    { location: "Burano", searchKeywords: "burano colourful houses", approvedClips: [29918561] },
    { location: "Santorini", searchKeywords: "santorini blue domes", approvedClips: [32500600] }
  ] }
];

// Synthetic aligned words: the nominal word count per scene, spoken at `rate` words per second, with a short pause
// between scenes. Each beat's text is that many words, so the timing code counts them the way it does for real text.
function alignedFor(rate) {
  const words = [];
  const beats = [];
  let t = 0;
  for (const scene of SCENES) {
    const count = Math.round(scene.sec * NOMINAL_WORDS_PER_SECOND);
    const start = words.length;
    for (let i = 0; i < count; i += 1) {
      words.push({ word: "w", start: t, end: t + 1 / rate });
      t += 1 / rate;
    }
    t += 0.25;
    beats.push({ text: Array.from({ length: count }, () => "w").join(" "), start, count });
  }
  return { words, narrationSeconds: words[words.length - 1].end + 0.3 };
}

// Every reviewed and rejected clip, as Pexels would return it. Durations are the measured ones.
const POOL = [
  { id: 29918560, url: "https://www.pexels.com/video/colorful-houses-reflected-in-burano-canal-29918560/", duration: 11, portrait: true },
  { id: 29918559, url: "https://www.pexels.com/video/colorful-reflections-in-burano-s-canals-29918559/", duration: 16, portrait: true },
  { id: 29918561, url: "https://www.pexels.com/video/colorful-houses-in-burano-under-clear-blue-sky-29918561/", duration: 12, portrait: true },
  { id: 38087413, url: "https://www.pexels.com/video/aerial-view-of-santorini-at-sunset-38087413/", duration: 14, portrait: true },
  { id: 32500600, url: "https://www.pexels.com/video/santorini-white-cliffs-and-blue-sea-vista-32500600/", duration: 28, portrait: true },
  { id: 29510336, url: "https://www.pexels.com/video/antelope-canyon-sunlight-through-red-rocks-29510336/", duration: 7, portrait: false },
  { id: 16524527, url: "https://www.pexels.com/video/antelope-canyon-16524527/", duration: 9, portrait: true }
];

function clipObject(clip) {
  const files = clip.portrait
    ? [{ link: `https://videos.pexels.com/${clip.id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
    : [{ link: `https://videos.pexels.com/${clip.id}-4k.mp4`, width: 4096, height: 2160, file_type: "video/mp4" }];
  return { id: clip.id, url: clip.url, duration: clip.duration, user: { name: "test" }, video_files: files };
}

const search = async () => POOL.map(clipObject);

function timedBeatsFor(rate, { scene3Approved } = {}) {
  const { words, narrationSeconds } = alignedFor(rate);
  const beats = SCENES.map((scene, index) => {
    const nominal = Math.round(scene.sec * NOMINAL_WORDS_PER_SECOND);
    return { ...scene, text: Array.from({ length: nominal }, () => "w").join(" "), visualQuery: scene.searchKeywords || "recap",
      imagePrompt: "scene " + (index + 1), approvedClips: index === 2 && scene3Approved ? scene3Approved : scene.approvedClips };
  });
  const timed = computeBeatTimings(beats, words);
  const coverSeconds = beatRenderSeconds(timed, narrationSeconds, CROSSFADE);
  return timed.map((beat, index) => ({ ...beat, coverSeconds: coverSeconds[index] }));
}

for (const rate of [2.0, 2.3, 2.6]) {
  test(`timing rehearsal at ${rate} words per second: reviewed clips cover every scene, the montage is even, and the still limit holds`, async () => {
    const beats = timedBeatsFor(rate);
    const plan = await planBeatVisuals(beats, search, { allowAiStills: true, landscapeFallback: true });
    const stills = plan.filter((entry) => entry.type === "still");
    assert.equal(stills.length, 2, "exactly the two labelled stills (scenes 1 and 2)");
    assert.deepEqual(stills.map((entry) => entry.beatIndex).sort(), [0, 1]);

    const scene3 = plan[2];
    assert.equal(scene3.type, "video");
    const scene3Total = scene3.segments.reduce((sum, s) => sum + s.sourceDurationSeconds, 0);
    assert.ok(scene3Total >= beats[2].coverSeconds, `scene 3 footage (${scene3Total}s) covers its timed beat (${beats[2].coverSeconds.toFixed(2)}s)`);
    assert.ok(scene3.segments.every((s) => [29918560, 29918559].includes(s.pexelsId)), "scene 3 uses only its reviewed clips");

    const scene4 = plan[3];
    assert.deepEqual(scene4.segments.map((s) => s.pexelsId), [38087413]);
    assert.ok(scene4.segments[0].sourceDurationSeconds >= beats[3].coverSeconds, "scene 4 clip covers its timed beat");

    const montage = plan[4];
    assert.deepEqual(montage.segments.map((s) => s.pexelsId), [29510336, 29918561, 32500600], "recap order: Antelope, Burano, Santorini");
    const share = beats[4].coverSeconds / 3;
    for (const segment of montage.segments) assert.ok(segment.sourceDurationSeconds >= share, `each recap place covers its ${share.toFixed(2)}s share`);

    const used = plan.flatMap((entry) => (entry.segments || []).map((s) => s.pexelsId));
    assert.equal(new Set(used).size, used.length, "no clip is used twice across the film");
    assert.ok(!used.includes(16524527), "a rejected clip is never chosen");
  });
}

test("if scene 3's reviewed clips are too short for slow speech, the plan needs a third still and the limit refuses it before any image", async () => {
  // Only the 11-second clip is approved for scene 3. At 2.0 words per second the scene needs more than that, so it
  // becomes a third still. The preflight cannot see clip durations (it counts candidates only), so the refusal comes
  // from the planned stills: assertAiStillLimit runs before any image request.
  const beats = timedBeatsFor(2.0, { scene3Approved: [29918560] });
  const plan = await planBeatVisuals(beats, search, { allowAiStills: true, landscapeFallback: true });
  assert.equal(plan.filter((entry) => entry.type === "still").length, 3, "the planner needs a third still");
  assert.throws(() => assertAiStillLimit(plan, 2), (error) => error instanceof AiStillLimitError && error.code === "AI_STILL_LIMIT");
});
