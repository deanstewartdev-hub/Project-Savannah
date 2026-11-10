import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// config.js reads secrets at import time. Give it random, test-only values. No network or paid call is made:
// the search and image functions are injected as stubs below.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { assertAiStillLimit, AiStillLimitError, resolveBeatVisuals } = await import("../src/pipeline/visuals.js");
const { config } = await import("../src/config.js");

const still = { type: "still" };
const video = { type: "video" };

test("the configured limit is two AI stills, generated at medium quality", () => {
  assert.equal(config.aiStills.maxPerJob, 2);
  assert.equal(config.aiStills.quality, "medium");
});

test("a plan with no more than the limit of stills passes and reports the count", () => {
  assert.equal(assertAiStillLimit([video, still], 2), 1);
  assert.equal(assertAiStillLimit([still, still, video], 2), 2);
  assert.equal(assertAiStillLimit([video, video], 2), 0);
});

test("a plan needing more stills than the limit is refused with a clear error", () => {
  assert.throws(
    () => assertAiStillLimit([still, still, still, video], 2),
    (error) =>
      error instanceof AiStillLimitError &&
      error.code === "AI_STILL_LIMIT" &&
      error.planned === 3 &&
      error.limit === 2 &&
      /No images were generated/.test(error.message)
  );
});

function beatsForTest(count) {
  const beats = [];
  for (let i = 0; i < count; i += 1) {
    beats.push({
      text: `Beat ${i}`,
      start: i * 4,
      end: i * 4 + 3.5,
      location: `Place ${i}`,
      visualQuery: `distinct scene ${i}`,
      imagePrompt: `prompt ${i}`
    });
  }
  return beats;
}

const noFootage = async () => []; // every beat then needs a still

test("three stills are refused before any image request is made", async () => {
  const beats = beatsForTest(3);
  const narrationSeconds = beats[beats.length - 1].end + 0.5;
  let imageRequests = 0;
  const countingStill = async () => {
    imageRequests += 1;
    return "unused";
  };
  await assert.rejects(
    resolveBeatVisuals(beats, { path: (name) => `/tmp/${name}` }, {
      allowAiStills: true,
      narrationSeconds,
      search: noFootage,
      generateStill: countingStill
    }),
    AiStillLimitError
  );
  assert.equal(imageRequests, 0, "no image may be requested when the plan exceeds the limit");
});

test("two stills are generated, one request each, at the planned prompts", async () => {
  const beats = beatsForTest(2);
  const narrationSeconds = beats[beats.length - 1].end + 0.5;
  const prompts = [];
  const fakeStill = async (prompt, destPath) => {
    prompts.push(prompt);
    return destPath;
  };
  const visuals = await resolveBeatVisuals(beats, { path: (name) => `/tmp/${name}` }, {
    allowAiStills: true,
    narrationSeconds,
    search: noFootage,
    generateStill: fakeStill
  });
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every((p) => p.includes("One real scene")));
  assert.equal(visuals.filter((v) => v.type === "still" && v.synthetic === true).length, 2);
});
