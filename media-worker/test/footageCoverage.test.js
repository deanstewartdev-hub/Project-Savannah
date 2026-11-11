import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// config.js reads secrets at import time. Give it random, test-only values. Every search below is a stub: no
// Pexels, ElevenLabs, Whisper or OpenAI call is made.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { pexelsSearchUrl, preflightVisualSupply, AiStillLimitError } = await import("../src/pipeline/visuals.js");
const {
  buildSearchQueries,
  landscapeCropFile,
  selectClip,
  planBeatVisuals,
  unsupportedBeats,
  VisualCoverageError
} = await import("../src/pipeline/visualSelection.js");
const { config } = await import("../src/config.js");

// Fixtures shaped like the Pexels video search response.
function portraitClip(id, slug, uploader = "Someone") {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration: 9,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
  };
}

function landscapeClip(id, slug, { width = 1920, height = 1080, uploader = "Someone", duration = 9 } = {}) {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}-${width}x${height}.mp4`, width, height, file_type: "video/mp4" }]
  };
}

// The beat whose failing query was "sweeping drone antelope" in the Issue #29 screenshot. Its place is
// given here so the planner can use place-based relevance.
const ANTELOPE = {
  text: "Antelope Canyon light beams carve through the sandstone.",
  visualQuery: "Sweeping drone shot of Antelope Canyon light beams",
  imagePrompt: "Antelope Canyon light beams",
  location: "Antelope Canyon",
  coverSeconds: 6
};

function searchStub(byOrientation) {
  const calls = [];
  const search = async (query, orientation = "portrait") => {
    calls.push(`${orientation}:${query}`);
    return byOrientation(query, orientation);
  };
  search.calls = calls;
  return search;
}

test("the Pexels search asks for the requested orientation, medium size and fifteen results", () => {
  const portrait = pexelsSearchUrl("antelope canyon drone");
  assert.equal(portrait.searchParams.get("orientation"), "portrait");
  assert.equal(portrait.searchParams.get("per_page"), "15");
  assert.equal(portrait.searchParams.get("size"), "medium");
  assert.equal(pexelsSearchUrl("antelope canyon", "landscape").searchParams.get("orientation"), "landscape");
  assert.throws(() => pexelsSearchUrl("antelope canyon", "square"), /Unknown Pexels orientation/);
});

test("query variants pair the place with the drone shot and never use motion words as search terms", () => {
  const queries = buildSearchQueries(ANTELOPE);
  assert.equal(queries[0], "antelope canyon light beams");
  assert.ok(queries.includes("antelope canyon drone"), "the place with the drone shot is tried");
  assert.ok(queries.includes("antelope canyon"), "the place alone is tried");
  assert.ok(queries.every((q) => !/\bsweeping\b/.test(q)), "a motion word is never a search term");
  assert.ok(queries.every((q) => q.split(" ").filter((w) => w === "antelope").length <= 1), "the place is not repeated");
  assert.equal(new Set(queries).size, queries.length, "no duplicate queries");
});

test("a shot word adds a preference between equally relevant clips but does not decide relevance", () => {
  const plain = portraitClip(1, "antelope-canyon-light-beams-sandstone");
  const drone = portraitClip(2, "antelope-canyon-drone-light-beams");
  assert.equal(selectClip([plain, drone], ANTELOPE, new Set()).pexelsId, 2, "the drone clip is preferred");
  // A clip with the place but without the shot is still relevant: "sweeping" is not required.
  const placeOnly = portraitClip(3, "antelope-canyon-walls-at-noon");
  assert.equal(selectClip([placeOnly], ANTELOPE, new Set())?.pexelsId, 3);
});

test("a 1080p 16:9 landscape clip is accepted only when the fallback allows it, with a 1.78x crop upscale", () => {
  const video = landscapeClip(10, "antelope-canyon-light-beams", { width: 1920, height: 1080 });
  const info = landscapeCropFile(video);
  assert.ok(info, "the 1080p clip is a usable crop");
  assert.ok(Math.abs(info.upscale - 1080 / 607.5) < 1e-9, "upscale is output width over the 607.5 px crop");
  assert.equal(selectClip([video], ANTELOPE, new Set()), null, "not chosen without the fallback");
  const chosen = selectClip([video], ANTELOPE, new Set(), 0, null, null, true);
  assert.equal(chosen.framing, "landscape-crop");
  assert.match(chosen.reason, /centre-cropped to 9:16 \(crop upscale 1\.78x\)/);
});

test("a 720p landscape clip is refused, because its crop would need 2.67x upscaling", () => {
  const video = landscapeClip(11, "antelope-canyon-light-beams", { width: 1280, height: 720 });
  assert.equal(landscapeCropFile(video), null);
  assert.equal(selectClip([video], ANTELOPE, new Set(), 0, null, null, true), null);
});

test("a 4:3 landscape clip is refused, because it is not a 16:9 source", () => {
  const video = landscapeClip(12, "antelope-canyon-light-beams", { width: 1440, height: 1080 });
  assert.equal(landscapeCropFile(video), null);
});

test("a 4K landscape clip is accepted and needs no upscaling", () => {
  const video = landscapeClip(13, "antelope-canyon-light-beams", { width: 3840, height: 2160 });
  const info = landscapeCropFile(video);
  assert.ok(info && info.upscale < 1, "a 4K source is downscaled by the crop, never upscaled");
});

test("a portrait clip is preferred over an equally relevant landscape clip", () => {
  const portrait = portraitClip(20, "antelope-canyon-light-beams");
  const landscape = landscapeClip(21, "antelope-canyon-light-beams");
  assert.equal(selectClip([landscape, portrait], ANTELOPE, new Set(), 0, null, null, true).pexelsId, 20);
});

test("a landscape clip without the place is refused, even with the fallback on", () => {
  const video = landscapeClip(22, "light-beams-through-sandstone-walls");
  assert.equal(selectClip([video], ANTELOPE, new Set(), 0, null, null, true), null);
});

test("the planner tries landscape footage only after portrait fails, and only with the fallback on", async () => {
  const search = searchStub((query, orientation) => (orientation === "landscape"
    ? [landscapeClip(30, "antelope-canyon-light-beams")]
    : []));
  const plan = await planBeatVisuals([ANTELOPE], search, { allowAiStills: false, landscapeFallback: true });
  assert.equal(plan[0].type, "video");
  assert.equal(plan[0].segments[0].framing, "landscape-crop");
  assert.equal(search.calls[0].startsWith("portrait:"), true, "portrait is searched first");
  assert.ok(search.calls.some((call) => call.startsWith("landscape:")), "landscape is searched after portrait fails");

  const offSearch = searchStub((query, orientation) => (orientation === "landscape"
    ? [landscapeClip(31, "antelope-canyon-light-beams")]
    : []));
  await assert.rejects(
    planBeatVisuals([ANTELOPE], offSearch, { allowAiStills: false }),
    VisualCoverageError,
    "with the fallback off, the same landscape clip is not used"
  );
  assert.equal(offSearch.calls.some((call) => call.startsWith("landscape:")), false, "no landscape request is made when off");
});

test("a plan that portrait footage can cover makes no landscape request at all", async () => {
  const search = searchStub(() => [portraitClip(40, "antelope-canyon-light-beams")]);
  const plan = await planBeatVisuals([ANTELOPE], search, { landscapeFallback: true });
  assert.equal(plan[0].segments[0].framing, "portrait");
  assert.ok(search.calls.every((call) => call.startsWith("portrait:")), "no landscape request was needed");
});

test("the landscape fallback is on by default in configuration", () => {
  assert.equal(config.footage.landscapeFallback, true);
});

test("unsupportedBeats flags only the beat with no candidate in any orientation", async () => {
  const supported = { ...ANTELOPE, coverSeconds: 6 };
  const missing = {
    text: "Blue domes over white walls.",
    visualQuery: "Blue domes over white walls",
    imagePrompt: "Blue domes",
    location: "Santorini",
    coverSeconds: 4
  };
  const search = searchStub((query, orientation) => (
    query.includes("antelope") && orientation === "portrait" ? [portraitClip(50, "antelope-canyon-light-beams")] : []
  ));
  const result = await unsupportedBeats([supported, missing], search, { landscapeFallback: false });
  assert.deepEqual(result.map((r) => r.beatIndex), [1]);
  assert.ok(result[0].queriesTried.includes("santorini"), "the place query was tried for the missing beat");
});

test("preflight refuses a script needing more stills than the limit, using only searches", async () => {
  const beats = [0, 1, 2].map((i) => ({
    text: `Scene ${i}.`,
    visualQuery: `Unseen view ${i}`,
    imagePrompt: `Unseen view ${i}`,
    location: `Nowhere ${i}`,
    coverSeconds: 3
  }));
  await assert.rejects(
    preflightVisualSupply(beats, { allowAiStills: true, search: async () => [], stillLimit: 2, landscapeFallback: true }),
    (error) =>
      error instanceof AiStillLimitError &&
      error.code === "AI_STILL_LIMIT" &&
      error.planned === 3 &&
      /at least 3/.test(error.message) &&
      /No images were generated/.test(error.message)
  );
});

test("preflight refuses a beat with no footage when stills are not allowed, before narration", async () => {
  const beats = [{ text: "Unseen.", visualQuery: "Unseen view", imagePrompt: "Unseen", location: "Nowhere", coverSeconds: 3 }];
  await assert.rejects(
    preflightVisualSupply(beats, { allowAiStills: false, search: async () => [], landscapeFallback: true }),
    (error) => error instanceof VisualCoverageError && /beat 1/.test(error.message) && /Checked before narration/.test(error.message)
  );
});

test("preflight allows two unsupported beats when two stills are allowed, and passes when all beats have footage", async () => {
  const unseen = (i) => ({ text: "x", visualQuery: `Unseen ${i}`, imagePrompt: `Unseen ${i}`, location: `Nowhere ${i}`, coverSeconds: 3 });
  const two = await preflightVisualSupply([unseen(0), unseen(1), ANTELOPE], {
    allowAiStills: true,
    search: searchStub((q, o) => (q.includes("antelope") && o === "portrait" ? [portraitClip(60, "antelope-canyon-light-beams")] : [])),
    stillLimit: 2,
    landscapeFallback: true
  });
  assert.equal(two.stills, 2);

  const clear = await preflightVisualSupply([ANTELOPE], {
    allowAiStills: false,
    search: searchStub(() => [portraitClip(61, "antelope-canyon-light-beams")]),
    landscapeFallback: true
  });
  assert.equal(clear.stills, 0);
});
