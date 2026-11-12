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
  assert.match(chosen.reason, /centre-cropped to 9:16 \(crop upscale 1\.78x, keeps 32% of the width\)/);
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

// ---- Follow-up: 1.95:1 landscape, shared memoised search, duplicate footage, missing locations ----

const { memoizeSearch, maxDistinctAssignment } = await import("../src/pipeline/visualSelection.js");

test("2048x1080 (1.90:1) landscape footage is accepted, and its centre crop keeps 30% of the width", () => {
  const video = landscapeClip(80, "antelope-canyon-light-beams", { width: 2048, height: 1080 });
  const info = landscapeCropFile(video);
  assert.ok(info, "2048x1080 is now a usable crop");
  assert.ok(info.keptWidthFraction >= 0.28 && info.keptWidthFraction < 0.3, "9:16 from 1.90:1 keeps about 29.7% of the width");
  const chosen = selectClip([video], ANTELOPE, new Set(), 0, null, null, true);
  assert.equal(chosen.framing, "landscape-crop");
  assert.match(chosen.reason, /keeps 30% of the width/);
});

test("the aspect ceiling is 1.95:1 (accepted at the limit), and wider footage is refused", () => {
  assert.ok(landscapeCropFile(landscapeClip(81, "antelope-canyon", { width: 2106, height: 1080 })), "1.95:1 is accepted");
  assert.equal(landscapeCropFile(landscapeClip(82, "antelope-canyon", { width: 2140, height: 1080 })), null, "1.98:1 is refused");
  assert.equal(landscapeCropFile(landscapeClip(83, "antelope-canyon", { width: 2560, height: 1080 })), null, "2.37:1 is refused");
});

test("every accepted landscape crop keeps at least 28% of the frame width", () => {
  for (const [width, height] of [[1920, 1080], [2048, 1080], [2106, 1080], [3840, 2160]]) {
    const info = landscapeCropFile(landscapeClip(90, "antelope-canyon", { width, height }));
    assert.ok(info && info.keptWidthFraction >= 0.28, `${width}x${height} keeps enough of the frame`);
  }
});

test("memoised search: the preflight and the planner share results, so the planner adds no Pexels requests", async () => {
  const raw = [];
  const memo = memoizeSearch(async (query, orientation) => {
    raw.push(`${orientation}:${query}`);
    return [portraitClip(100, "antelope-canyon-light-beams")];
  });
  await preflightVisualSupply([ANTELOPE], { allowAiStills: false, search: memo, landscapeFallback: true });
  const afterPreflight = raw.length;
  await planBeatVisuals([ANTELOPE], memo, { landscapeFallback: true });
  assert.equal(raw.length, afterPreflight, "the planner made no new request");
  assert.equal(memo.calls(), raw.length, "every request was counted once");
  assert.equal(new Set(raw).size, raw.length, "no query was requested twice");
});

test("duplicate footage: two beats that can only use the same clip need a still for one of them", async () => {
  const beatA = { ...ANTELOPE, coverSeconds: 3 };
  const beatB = { ...ANTELOPE, text: "Another line.", coverSeconds: 3 };
  const onlyClip = async () => [portraitClip(110, "antelope-canyon-light-beams")];
  await assert.rejects(
    preflightVisualSupply([beatA, beatB], { allowAiStills: false, search: onlyClip, landscapeFallback: true }),
    (error) => error instanceof VisualCoverageError && /cannot each get a different relevant clip/.test(error.message)
  );
  const allowed = await preflightVisualSupply([beatA, beatB], {
    allowAiStills: true, search: onlyClip, stillLimit: 2, landscapeFallback: true
  });
  assert.equal(allowed.lowerBound, 1, "one beat must become a still");
  assert.equal(allowed.stills, 1);
});

test("the bipartite bound: beats are matched to distinct clips", () => {
  assert.equal(maxDistinctAssignment([new Set([1]), new Set([1]), new Set([1, 2])]), 2);
  assert.equal(maxDistinctAssignment([new Set([1, 2]), new Set([1, 2]), new Set([1, 2])]), 2);
  assert.equal(maxDistinctAssignment([new Set([1, 2]), new Set([2, 3]), new Set([3, 1])]), 3);
  assert.equal(maxDistinctAssignment([new Set(), new Set([4])]), 1, "a beat with no candidate matches nothing");
});

test("a beat with no location is refused before any Pexels request, and the rule stays on by default", async () => {
  const noLocation = { ...ANTELOPE, location: "" };
  let searches = 0;
  const search = async () => {
    searches += 1;
    return [portraitClip(120, "antelope-canyon-light-beams-x")];
  };
  await assert.rejects(
    preflightVisualSupply([ANTELOPE, noLocation], { allowAiStills: true, search, landscapeFallback: true, requireLocation: true }),
    (error) => error instanceof VisualCoverageError && /Beat 2 has no location/.test(error.message) && /before any Pexels request/.test(error.message)
  );
  assert.equal(searches, 0, "zero search requests were made for a script that fails the location check");
});

test("a beat explicitly marked locationExempt may have no location; the rule still applies to the others", async () => {
  const exempt = { ...ANTELOPE, location: "", locationExempt: true };
  const search = async () => [portraitClip(121, "antelope-canyon-light-beams-x")];
  const passed = await preflightVisualSupply([exempt], { allowAiStills: true, search, landscapeFallback: true, requireLocation: true });
  assert.equal(passed.stills, 0);
  await assert.rejects(
    preflightVisualSupply([exempt, { ...ANTELOPE, location: "  " }], { allowAiStills: true, search, landscapeFallback: true, requireLocation: true }),
    (error) => error instanceof VisualCoverageError && /Beat 2 has no location/.test(error.message)
  );
});

test("with the location check lifted, a beat without a place can still use subject-only relevance", async () => {
  const noLocation = { ...ANTELOPE, location: "" };
  const search = async () => [portraitClip(122, "antelope-canyon-light-beams-x")];
  const lifted = await preflightVisualSupply([noLocation], {
    allowAiStills: true, search, landscapeFallback: true, requireLocation: false
  });
  assert.equal(lifted.stills, 0);
});

test("the preflight reports the minimum required and the maximum allowed separately", async () => {
  const unseen = (i) => ({ text: "x", visualQuery: `Unseen ${i}`, imagePrompt: `Unseen ${i}`, location: `Nowhere ${i}`, coverSeconds: 3 });
  const result = await preflightVisualSupply([unseen(0), unseen(1), unseen(2)], {
    allowAiStills: true, search: async () => [], stillLimit: 5, landscapeFallback: true
  });
  assert.equal(result.lowerBound, 3, "minimum stills required");
  assert.equal(result.stillLimit, 5, "maximum allowed is reported as the limit, not as a count");
  assert.equal(result.stills, 3);
});

test("the location requirement is on in configuration by default", () => {
  assert.equal(config.footage.requireLocation, true);
});

// ---- Montage: one clip per place for a recap beat ----

const { coverageCandidates } = await import("../src/pipeline/visualSelection.js");

const RECAP = {
  text: "You'd be mad to miss these gems!",
  coverSeconds: 6,
  montage: [
    { location: "Burano", searchKeywords: "burano colourful houses" },
    { location: "Santorini", searchKeywords: "santorini blue domes" },
    { location: "Antelope Canyon", searchKeywords: "antelope canyon light" }
  ]
};

function recapSearch({ withAntelope = true } = {}) {
  return async (query) => {
    if (query.includes("burano")) return [portraitClip(201, "colorful-houses-in-burano-canal")];
    if (query.includes("santorini")) return [portraitClip(202, "santorini-blue-domes-view")];
    if (query.includes("antelope") && withAntelope) return [portraitClip(203, "antelope-canyon-light-beams")];
    return [];
  };
}

test("a montage beat takes one clip per place, in order, with the beat's seconds shared equally", async () => {
  const plan = await planBeatVisuals([RECAP], recapSearch(), { allowAiStills: false, landscapeFallback: true });
  assert.equal(plan[0].type, "video");
  assert.deepEqual(plan[0].segments.map((s) => s.pexelsId), [201, 202, 203]);
  assert.ok(plan[0].segments.every((s) => s.sourceDurationSeconds >= 2), "each share fits its clip");
});

test("a montage with a missing place fails closed: a coverage error even when stills are allowed, never a still", async () => {
  await assert.rejects(
    planBeatVisuals([RECAP], recapSearch({ withAntelope: false }), { allowAiStills: true, landscapeFallback: true }),
    (error) => error instanceof VisualCoverageError && /never turned into a still/.test(error.message)
  );
  await assert.rejects(
    planBeatVisuals([RECAP], recapSearch({ withAntelope: false }), { allowAiStills: false, landscapeFallback: true }),
    VisualCoverageError
  );
});

test("a montage takes exactly one clip per part, even when a place has several clips", async () => {
  const search = async (query) => {
    if (query.includes("burano")) return [portraitClip(211, "colorful-houses-in-burano-canal"), portraitClip(212, "burano-canal-boats")];
    if (query.includes("santorini")) return [portraitClip(213, "santorini-blue-domes-view")];
    if (query.includes("antelope")) return [portraitClip(214, "antelope-canyon-light-beams")];
    return [];
  };
  const plan = await planBeatVisuals([RECAP], search, { allowAiStills: false, landscapeFallback: true });
  assert.equal(plan[0].segments.length, 3, "one segment per part, never an extra cut");
  assert.deepEqual(plan[0].segments.map((s) => s.pexelsId), [211, 213, 214]);
});

test("timing: each part gets an equal share of the timed beat, and every clip covers its share", async () => {
  const { segmentLengths } = await import("../src/pipeline/visualSelection.js");
  const timed = { ...RECAP, coverSeconds: 7.3 };
  const plan = await planBeatVisuals([timed], recapSearch(), { allowAiStills: false, landscapeFallback: true });
  const durations = plan[0].segments.map((s) => s.sourceDurationSeconds);
  const lengths = segmentLengths(durations, 7.3);
  assert.ok(lengths, "the segments cover the altered timing");
  for (const length of lengths) assert.ok(Math.abs(length - 7.3 / 3) < 1e-9, "each destination gets 7.3 / 3 seconds");
});

test("unique footage: a montage part never reuses a clip an earlier scene already used", async () => {
  const search = async (query) => {
    if (query.includes("burano")) return [portraitClip(221, "colorful-houses-in-burano-canal"), portraitClip(222, "burano-canal-boats")];
    if (query.includes("santorini")) return [portraitClip(223, "santorini-blue-domes-view")];
    if (query.includes("antelope")) return [portraitClip(224, "antelope-canyon-light-beams")];
    return [];
  };
  const earlier = { text: "Burano.", visualQuery: "burano houses", imagePrompt: "burano", location: "Burano", coverSeconds: 3 };
  const plan = await planBeatVisuals([earlier, RECAP], search, { allowAiStills: false, landscapeFallback: true });
  const ids = plan.flatMap((entry) => entry.segments.map((s) => s.pexelsId));
  assert.equal(new Set(ids).size, ids.length, "no clip is used twice across the job");
  assert.equal(plan[0].segments[0].pexelsId, 221);
  assert.equal(plan[1].segments[0].pexelsId, 222, "the recap's Burano part takes the next clip");
});

test("shared clip: an earlier scene that takes the only clip a montage part needs makes the montage fail closed", async () => {
  const search = async (query) => {
    if (query.includes("burano")) return [portraitClip(231, "colorful-houses-in-burano-canal")];
    if (query.includes("santorini")) return [portraitClip(232, "santorini-blue-domes-view")];
    if (query.includes("antelope")) return [portraitClip(233, "antelope-canyon-light-beams")];
    return [];
  };
  const earlier = { text: "Burano.", visualQuery: "burano houses", imagePrompt: "burano", location: "Burano", coverSeconds: 3 };
  await assert.rejects(
    planBeatVisuals([earlier, RECAP], search, { allowAiStills: true, landscapeFallback: true }),
    (error) => error instanceof VisualCoverageError && /Montage beat 2/.test(error.message)
  );
});

test("preflight: two montage parts that can only share one clip refuse the job, whatever allowAiStills says", async () => {
  const onlyOne = async (query) => (query.includes("burano") || query.includes("santorini") ? [portraitClip(241, "colorful-houses-in-burano-canal")] : []);
  const twoPlaces = { text: "x", coverSeconds: 6, montage: [
    { location: "Burano", searchKeywords: "burano colourful houses" },
    { location: "Santorini", searchKeywords: "santorini blue domes" }
  ] };
  for (const allowAiStills of [false, true]) {
    await assert.rejects(
      preflightVisualSupply([twoPlaces], { allowAiStills, search: onlyOne, landscapeFallback: true, requireLocation: true }),
      (error) => error instanceof VisualCoverageError && /never turned into a still/.test(error.message)
    );
  }
});

test("preflight: the still count is a labelled lower bound that counts only single-clip beats", async () => {
  const unseen = { text: "x", visualQuery: "Unseen view", imagePrompt: "Unseen view", location: "Nowhere", coverSeconds: 3 };
  const result = await preflightVisualSupply([unseen, RECAP], {
    allowAiStills: true, search: recapSearch(), stillLimit: 2, landscapeFallback: true, requireLocation: true
  });
  assert.equal(result.lowerBound, 1, "the single-clip beat with no footage needs one still; the montage is not counted");
  assert.equal(result.stills, 1);
});

test("coverage: a montage with a missing place is unsupported; with all places it is supported", async () => {
  const missing = await unsupportedBeats([RECAP], recapSearch({ withAntelope: false }), { landscapeFallback: true });
  assert.deepEqual(missing.map((m) => m.beatIndex), [0]);
  const complete = await coverageCandidates([RECAP], recapSearch(), { landscapeFallback: true });
  assert.equal(complete[0].candidateIds.size, 3, "the three places each contribute a candidate");
});

test("the location gate applies to every montage part: a part with no place is refused before any search", async () => {
  let searches = 0;
  const search = async () => { searches += 1; return []; };
  const noPlacePart = { ...RECAP, montage: [...RECAP.montage, { location: "", searchKeywords: "sunset" }] };
  await assert.rejects(
    preflightVisualSupply([noPlacePart], { allowAiStills: true, search, landscapeFallback: true, requireLocation: true }),
    (error) => error instanceof VisualCoverageError && /has no location/.test(error.message)
  );
  assert.equal(searches, 0);
  const passed = await preflightVisualSupply([RECAP], { allowAiStills: false, search: recapSearch(), landscapeFallback: true, requireLocation: true });
  assert.equal(passed.stills, 0);
});
