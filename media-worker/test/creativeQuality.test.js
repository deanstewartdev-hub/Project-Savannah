import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTrack, resolveTrack, chooseMusicSource, buildMusicGainFilter, MUSIC_VOLUME_LIMITS, preflightMusic, validateMusicProbe } from "../src/lib/musicLicence.js";
import { groupCaptionChunks, chunkWithinLimits, CAPTION_LIMITS } from "../src/lib/captionChunks.js";
import { buildCaptionAss, SAFE_MARGIN_BOTTOM, SAFE_MARGIN_X } from "../src/lib/captionAss.js";
import { selectClip, previousUploaders, previousTokens, planBeatVisuals } from "../src/pipeline/visualSelection.js";

const GOOD_TRACK = {
  id: "bed-01",
  file: "music/bed-01.mp3",
  title: "Quiet Street",
  licence: "CC0-1.0",
  sourceUrl: "https://example.org/track",
  termsUrl: "https://example.org/terms",
  attributionRequired: false,
  monetizationAllowed: true,
  verifiedBy: "owner",
  verifiedOn: "2026-11-03"
};

// ---- Music licensing ----

test("a complete CC0 track record passes validation", () => {
  assert.deepEqual(validateTrack(GOOD_TRACK), []);
});

test("every required field is needed", () => {
  for (const field of ["id", "file", "title", "licence", "sourceUrl", "verifiedBy", "verifiedOn"]) {
    const entry = Object.assign({}, GOOD_TRACK, { [field]: "" });
    assert.ok(validateTrack(entry).some((p) => p.startsWith(field)), field + " is required");
  }
});

test("a licence outside the allowed list is refused", () => {
  const problems = validateTrack(Object.assign({}, GOOD_TRACK, { licence: "All-Rights-Reserved" }));
  assert.ok(problems.some((p) => /not on the allowed list/.test(p)));
});

test("CC-BY requires attribution text", () => {
  const entry = Object.assign({}, GOOD_TRACK, { licence: "CC-BY-4.0", attributionRequired: true });
  assert.ok(validateTrack(entry).some((p) => /attribution text is required/.test(p)));
  assert.deepEqual(validateTrack(Object.assign({}, entry, { attribution: "Music by Someone, CC BY 4.0" })), []);
});

test("attribution is decided per track, not by the licence name (YouTube Audio Library is not assumed attribution-free)", () => {
  const yal = Object.assign({}, GOOD_TRACK, { licence: "YouTube-Audio-Library" });
  delete yal.attributionRequired;
  assert.ok(validateTrack(yal).some((p) => /attributionRequired must be true or false/.test(p)), "the record must state it");
  assert.deepEqual(validateTrack(Object.assign({}, yal, { attributionRequired: false })), []);
  const withCredit = Object.assign({}, yal, { attributionRequired: true, attribution: "Track by Someone" });
  assert.deepEqual(validateTrack(withCredit), []);
});

test("CC-BY cannot be recorded as attribution-free", () => {
  const entry = Object.assign({}, GOOD_TRACK, { licence: "CC-BY-4.0", attributionRequired: false });
  assert.ok(validateTrack(entry).some((p) => /always requires attribution/.test(p)));
});

test("monetised use must be recorded as allowed", () => {
  assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { monetizationAllowed: false })).some((p) => /monetizationAllowed/.test(p)));
  const missing = Object.assign({}, GOOD_TRACK);
  delete missing.monetizationAllowed;
  assert.ok(validateTrack(missing).some((p) => /monetizationAllowed/.test(p)));
});

test("a terms link is required", () => {
  assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { termsUrl: "" })).some((p) => /termsUrl is required/.test(p)));
});

test("verifiedOn must be an ISO date", () => {
  assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { verifiedOn: "3 Nov 2026" })).some((p) => /YYYY-MM-DD/.test(p)));
});

test("file paths must stay inside the music folder", () => {
  for (const file of ["../secrets.mp3", "/abs/track.mp3", "C:/track.mp3", "other/track.mp3", "music/../secrets.mp3", "music/track.exe"]) {
    assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { file })).some((p) => /music folder/.test(p)), file);
  }
});

test("resolveTrack refuses a missing or unverified track instead of falling back", () => {
  const manifest = { tracks: [GOOD_TRACK, Object.assign({}, GOOD_TRACK, { id: "bad", verifiedBy: "" })] };
  assert.equal(resolveTrack(manifest, "bed-01").file, "music/bed-01.mp3");
  assert.throws(() => resolveTrack(manifest, "missing"), /not in the manifest/);
  assert.throws(() => resolveTrack(manifest, "bad"), /not usable/);
});



// ---- Missing-file and storage preflight (runs before any paid step) ----

test("a music object that exists passes the preflight", async () => {
  const seen = [];
  const path = await preflightMusic({ path: "music/bed-01.mp3", existsFn: async (p) => { seen.push(p); return true; } });
  assert.equal(path, "music/bed-01.mp3");
  assert.deepEqual(seen, ["music/bed-01.mp3"]);
});

test("a missing music object fails the preflight with a clear reason", async () => {
  await assert.rejects(
    () => preflightMusic({ path: "music/gone.mp3", existsFn: async () => false }),
    /does not exist or is not accessible/
  );
});

test("a storage error during the check is reported, not treated as present", async () => {
  await assert.rejects(
    () => preflightMusic({ path: "music/bed-01.mp3", existsFn: async () => { throw new Error("permission denied"); } }),
    /could not be checked: permission denied/
  );
});

test("the preflight refuses paths outside the approved folder before asking storage", async () => {
  let asked = false;
  await assert.rejects(
    () => preflightMusic({ path: "secrets/key.json", existsFn: async () => { asked = true; return true; } }),
    /approved music folder/
  );
  assert.equal(asked, false, "storage is not queried for a refused path");
});

test("the preflight never reports a non-true answer as present", async () => {
  await assert.rejects(() => preflightMusic({ path: "music/x.mp3", existsFn: async () => "yes" }), /does not exist/);
});


// ---- Music gain, ducking input and fades ----

test("music volume is clamped to the safe range", () => {
  assert.match(buildMusicGainFilter({ volume: 5, totalSeconds: 40 }), new RegExp("volume=" + MUSIC_VOLUME_LIMITS.max.toFixed(3)));
  assert.match(buildMusicGainFilter({ volume: -1, totalSeconds: 40 }), /volume=0\.000/);
  assert.throws(() => buildMusicGainFilter({ volume: "loud", totalSeconds: 40 }), /must be a number/);
});

test("fades start at the beginning and end of the video", () => {
  const filter = buildMusicGainFilter({ volume: 0.25, fadeInSeconds: 0.5, fadeOutSeconds: 1, totalSeconds: 41.1 });
  assert.match(filter, /afade=t=in:st=0:d=0\.500/);
  assert.match(filter, /afade=t=out:st=40\.100:d=1\.000/);
});

test("a fade longer than the video is shortened, and zero fades are omitted", () => {
  const filter = buildMusicGainFilter({ volume: 0.2, fadeInSeconds: 99, fadeOutSeconds: 0, totalSeconds: 10 });
  assert.match(filter, /afade=t=in:st=0:d=10\.000/);
  assert.doesNotMatch(filter, /afade=t=out/);
});

// ---- Caption grouping and layout ----

const W = (word, start, end) => ({ word, start, end });

test("captions group up to three words per phrase", () => {
  const chunks = groupCaptionChunks([W("one", 0, 0.2), W("two", 0.2, 0.4), W("three", 0.4, 0.6), W("four", 0.6, 0.8)]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, "ONE TWO THREE");
  assert.equal(chunks[1].text, "FOUR");
});

test("a longer phrase is split before it exceeds the character limit", () => {
  const chunks = groupCaptionChunks([W("extraordinary", 0, 0.5), W("architecture", 0.5, 1.0)]);
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) assert.ok(chunk.text.length <= CAPTION_LIMITS.maxCharacters);
});

test("a clear pause starts a new phrase", () => {
  const chunks = groupCaptionChunks([W("alpha", 0, 0.2), W("beta", 0.9, 1.1)]);
  assert.equal(chunks.length, 2, "a 0.7 s gap breaks the phrase");
});

test("phrases never run longer than the duration limit", () => {
  const words = Array.from({ length: 6 }, (_, i) => W("w" + i, i * 0.4, i * 0.4 + 0.3));
  for (const chunk of groupCaptionChunks(words)) assert.ok(chunkWithinLimits(chunk), chunk.text);
});

test("empty or blank words produce no captions and no crash", () => {
  assert.deepEqual(groupCaptionChunks([]), []);
  assert.deepEqual(groupCaptionChunks([W("  ", 0, 0.1), null]), []);
});

test("braces in spoken text cannot inject ASS override tags", () => {
  const ass = buildCaptionAss([W("{\\an8}hi", 0, 0.5)], { width: 1080, height: 1920 });
  assert.doesNotMatch(ass, /\{\\an8\}/);
});

test("captions sit above the Shorts overlay band and inside side margins", () => {
  const ass = buildCaptionAss([W("hello", 0, 0.5)], { width: 1080, height: 1920 });
  const style = ass.split("\n").find((line) => line.startsWith("Style: WordPop"));
  const fields = style.split(",");
  assert.equal(Number(fields[fields.length - 2]), SAFE_MARGIN_BOTTOM(1920), "bottom margin");
  assert.equal(Number(fields[fields.length - 4]), SAFE_MARGIN_X(1080), "left margin");
  assert.ok(SAFE_MARGIN_BOTTOM(1920) >= 1920 * 0.2, "bottom margin clears the overlay band");
});

test("each caption phrase becomes one dialogue line with a fade", () => {
  const ass = buildCaptionAss([W("one", 0, 0.2), W("two", 0.2, 0.4), W("three", 0.4, 0.6), W("four", 0.6, 0.8)], { width: 1080, height: 1920 });
  const dialogue = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogue.length, 2);
  assert.ok(dialogue.every((line) => line.includes("\\fad(60,60)")));
});

// ---- Footage variety ----

function clip(id, uploader, slug = "blue-street-in-chefchaouen") {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration: 9,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
  };
}

const LOCATION_BEAT = { text: "scene", visualQuery: "blue street", imagePrompt: "blue street", location: "Chefchaouen", searchKeywords: "blue street" };

test("previousUploaders reads the uploaders used by the last scene", () => {
  const plan = [{ segments: [{ uploader: "A" }, { uploader: "B" }] }];
  assert.deepEqual([...previousUploaders(plan)].sort(), ["A", "B"]);
  assert.equal(previousUploaders([]).size, 0);
});

test("selectClip prefers a different uploader when an equally good clip exists", () => {
  const videos = [clip(1, "Same Person"), clip(2, "Someone Else")];
  const chosen = selectClip(videos, LOCATION_BEAT, new Set(), 0, new Set(["Same Person"]));
  assert.equal(chosen.pexelsId, 2);
  assert.equal(chosen.uploader, "Someone Else");
});

test("selectClip still uses the same uploader when nothing else qualifies", () => {
  const chosen = selectClip([clip(1, "Same Person")], LOCATION_BEAT, new Set(), 0, new Set(["Same Person"]));
  assert.equal(chosen.pexelsId, 1);
});

test("consecutive scenes come from different uploaders when the search allows it", async () => {
  const beats = [LOCATION_BEAT, Object.assign({}, LOCATION_BEAT, { text: "second scene" })];
  const search = async () => [clip(10, "Alpha"), clip(11, "Beta")];
  const plan = await planBeatVisuals(beats, search);
  assert.notEqual(plan[0].segments[0].uploader, plan[1].segments[0].uploader);
});

test("selectClip prefers footage that does not repeat the previous scene's subject words", () => {
  const sameLook = clip(20, "Uploader A", "blue-alley-steps-chefchaouen");
  const differentLook = clip(21, "Uploader B", "blue-rooftops-aerial-chefchaouen");
  const previous = new Set(["alley", "steps", "staircase", "chefchaouen"]);
  const chosen = selectClip([sameLook, differentLook], LOCATION_BEAT, new Set(), 0, null, previous);
  assert.equal(chosen.pexelsId, 21, "the clip with new subject words wins");
});

test("previousTokens collects the descriptive words of the last scene", () => {
  const plan = [{ segments: [{ tokens: ["blue", "alley"] }, { tokens: ["steps"] }] }];
  assert.deepEqual([...previousTokens(plan)].sort(), ["alley", "blue", "steps"]);
});

test("the widest allowed caption phrase fits inside the side margins (Arial uppercase estimate)", () => {
  const width = 1080;
  const height = 1920;
  const fontPx = Math.round(height * 0.044);
  const usable = width - 2 * SAFE_MARGIN_X(width);
  // Measured on a rendered frame: about 0.61 em per uppercase character with spaces, measured on a rendered frame; 0.62 is used.
  assert.ok(CAPTION_LIMITS.maxCharacters * 0.62 * fontPx <= usable, "longest phrase fits");
});

test("candidate tracks are not in the verified manifest, so the worker cannot use them", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../music/manifest.json", import.meta.url), "utf8"));
  const candidates = JSON.parse(readFileSync(new URL("../music/candidates.json", import.meta.url), "utf8"));
  const verifiedIds = new Set(manifest.tracks.map((t) => t.id));
  for (const candidate of candidates.candidates) {
    assert.equal(verifiedIds.has(candidate.id), false, candidate.id + " must not be in the manifest yet");
    assert.equal(candidate.attributionRequired, true, "CC BY 4.0 candidates require credit");
    assert.match(candidate.attribution, /released under CC-BY 4\.0/);
  }
});

// ---- Music selection: ID only, from the worker's own verified manifest ----

const MANIFEST = { tracks: [GOOD_TRACK] };

test("a job chooses music by musicTrackId from the verified manifest", () => {
  assert.equal(chooseMusicSource({ musicTrackId: "bed-01", manifest: MANIFEST, defaultPath: "music/default.mp3" }).path, "music/bed-01.mp3");
  assert.equal(chooseMusicSource({ manifest: MANIFEST, defaultPath: "music/default.mp3" }).path, "music/default.mp3");
});

test("an unknown or unverified musicTrackId fails instead of falling back", () => {
  assert.throws(() => chooseMusicSource({ musicTrackId: "nope", manifest: MANIFEST, defaultPath: "music/d.mp3" }), /not in the manifest/);
  const unverified = { tracks: [Object.assign({}, GOOD_TRACK, { verifiedOn: "" })] };
  assert.throws(() => chooseMusicSource({ musicTrackId: "bed-01", manifest: unverified, defaultPath: "music/d.mp3" }), /not usable/);
});

test("a job cannot bypass licence verification with a track object or a file path", () => {
  assert.throws(() => chooseMusicSource({ musicTrack: GOOD_TRACK, manifest: MANIFEST, defaultPath: "music/d.mp3" }), /musicTrack object is not accepted/);
  assert.throws(() => chooseMusicSource({ musicTrackPath: "music/unverified.mp3", manifest: MANIFEST, defaultPath: "music/d.mp3" }), /musicTrackPath is not accepted/);
});

test("the default bed path must still be inside the approved folder", () => {
  assert.throws(() => chooseMusicSource({ manifest: MANIFEST, defaultPath: "../default.mp3" }), /approved music folder/);
});

// ---- Downloaded-file check (ffprobe output), run before any paid step ----

const PROBE_OK = { format: { duration: "120.5" }, streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100" }] };

test("a downloaded track with audio long enough for the video passes", () => {
  const info = validateMusicProbe(PROBE_OK, { minSeconds: 45 });
  assert.equal(info.codec, "mp3");
  assert.equal(info.sampleRate, 44100);
  assert.ok(Math.abs(info.durationSeconds - 120.5) < 0.001);
});

test("a downloaded file with no audio stream is refused", () => {
  assert.throws(() => validateMusicProbe({ format: { duration: "60" }, streams: [{ codec_type: "video" }] }, { minSeconds: 30 }), /no audio stream/);
});

test("a track shorter than the video is refused rather than looped audibly", () => {
  assert.throws(() => validateMusicProbe({ format: { duration: "20" }, streams: [{ codec_type: "audio" }] }, { minSeconds: 40 }), /shorter than the/);
});

test("a file with no readable duration is refused", () => {
  assert.throws(() => validateMusicProbe({ format: {}, streams: [{ codec_type: "audio" }] }, { minSeconds: 10 }), /no readable duration/);
  assert.throws(() => validateMusicProbe({ format: { duration: "0" }, streams: [{ codec_type: "audio" }] }, { minSeconds: 10 }), /no readable duration/);
});
