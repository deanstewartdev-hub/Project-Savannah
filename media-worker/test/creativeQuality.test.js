import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTrack, resolveTrack, chooseMusicSource, buildMusicGainFilter, MUSIC_VOLUME_LIMITS } from "../src/lib/musicLicence.js";
import { groupCaptionChunks, chunkWithinLimits, CAPTION_LIMITS } from "../src/lib/captionChunks.js";
import { buildCaptionAss, SAFE_MARGIN_BOTTOM, SAFE_MARGIN_X } from "../src/lib/captionAss.js";
import { selectClip, previousUploaders, planBeatVisuals } from "../src/pipeline/visualSelection.js";

const GOOD_TRACK = {
  id: "bed-01",
  file: "music/bed-01.mp3",
  title: "Quiet Street",
  licence: "CC0-1.0",
  sourceUrl: "https://example.org/track",
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
  const entry = Object.assign({}, GOOD_TRACK, { licence: "CC-BY-4.0" });
  assert.ok(validateTrack(entry).some((p) => /attribution text is required/.test(p)));
  assert.deepEqual(validateTrack(Object.assign({}, entry, { attribution: "Music by Someone, CC BY 4.0" })), []);
});

test("verifiedOn must be an ISO date", () => {
  assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { verifiedOn: "3 Nov 2026" })).some((p) => /YYYY-MM-DD/.test(p)));
});

test("file paths must stay inside the music folder", () => {
  for (const file of ["../secrets.mp3", "/abs/track.mp3", "C:/track.mp3"]) {
    assert.ok(validateTrack(Object.assign({}, GOOD_TRACK, { file })).some((p) => /relative path/.test(p)), file);
  }
});

test("resolveTrack refuses a missing or unverified track instead of falling back", () => {
  const manifest = { tracks: [GOOD_TRACK, Object.assign({}, GOOD_TRACK, { id: "bad", verifiedBy: "" })] };
  assert.equal(resolveTrack(manifest, "bed-01").file, "music/bed-01.mp3");
  assert.throws(() => resolveTrack(manifest, "missing"), /not in the manifest/);
  assert.throws(() => resolveTrack(manifest, "bad"), /not usable/);
});

test("chooseMusicSource uses a verified track, then an explicit path, then the default bed", () => {
  assert.equal(chooseMusicSource({ musicTrack: GOOD_TRACK, defaultPath: "default.mp3" }).path, "music/bed-01.mp3");
  assert.equal(chooseMusicSource({ musicTrackPath: "custom.mp3", defaultPath: "default.mp3" }).path, "custom.mp3");
  assert.equal(chooseMusicSource({ defaultPath: "default.mp3" }).path, "default.mp3");
});

test("chooseMusicSource fails on an unverified track rather than using the default", () => {
  assert.throws(() => chooseMusicSource({ musicTrack: Object.assign({}, GOOD_TRACK, { verifiedOn: "" }), defaultPath: "d.mp3" }), /not usable/);
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
