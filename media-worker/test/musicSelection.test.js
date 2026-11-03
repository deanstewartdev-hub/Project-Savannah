import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseMusicSource, musicSummary, validateMusicRequest } from "../src/lib/musicLicence.js";
import { prepareMusic } from "../src/pipeline/prepareMusic.js";
import { withJobWorkDir } from "../src/lib/tempDir.js";

// A fixture manifest with one verified track and one that is not usable. Nothing here is real music.
const TRACK = {
  id: "fixture-track",
  file: "music/fixture-track.mp3",
  title: "Fixture Track",
  licence: "CC-BY-4.0",
  sourceUrl: "https://example.test/track",
  termsUrl: "https://example.test/track",
  verifiedBy: "owner",
  verifiedOn: "2026-11-03",
  attributionRequired: true,
  attribution: "'Fixture Track' by Example - released under CC-BY 4.0.",
  monetizationAllowed: true
};
const MANIFEST = { tracks: [TRACK, { ...TRACK, id: "unverified-track", monetizationAllowed: false }] };
const DEFAULT_PATH = "music/default-bed.mp3";
const BEATS_SECONDS = 30;
const AUDIO_PROBE = { streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100" }], format: { duration: "60.0" } };

// A work directory stand-in that records whether it was cleaned up.
function fakeWorkDir() {
  const state = { cleaned: 0 };
  return {
    state,
    dir: "/tmp/fake",
    path: (...segments) => ["/tmp/fake", ...segments].join("/"),
    cleanup: async () => { state.cleaned++; }
  };
}

function fakeIo({ exists = true, probe = AUDIO_PROBE } = {}) {
  const calls = { exists: [], download: [], probe: [] };
  return {
    calls,
    existsFn: async (path) => { calls.exists.push(path); return exists; },
    downloadFn: async (path, dest) => { calls.download.push([path, dest]); },
    probeFn: async (path) => { calls.probe.push(path); return probe; }
  };
}

test("a job with no musicTrackId is refused before any download", async () => {
  const io = fakeIo();
  await assert.rejects(
    prepareMusic({ manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: fakeWorkDir(), minSeconds: BEATS_SECONDS, ...io }),
    /musicTrackId from the verified manifest is required/
  );
  assert.equal(io.calls.download.length, 0);
});

test("an unknown musicTrackId is refused before any download or existence check", async () => {
  const io = fakeIo();
  await assert.rejects(
    prepareMusic({ musicTrackId: "not-a-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: fakeWorkDir(), minSeconds: BEATS_SECONDS, ...io }),
    /is not in the manifest/
  );
  assert.equal(io.calls.exists.length, 0);
  assert.equal(io.calls.download.length, 0);
});

test("a track that is in the manifest but not usable is refused", () => {
  assert.throws(
    () => chooseMusicSource({ musicTrackId: "unverified-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH }),
    /is not usable/
  );
});

test("a legacy placeholder run is the only run that may use the default bed, and it is marked as such", () => {
  const source = chooseMusicSource({ manifest: MANIFEST, defaultPath: DEFAULT_PATH, legacyPlaceholderMusic: true });
  assert.equal(source.path, DEFAULT_PATH);
  assert.equal(source.placeholder, true);
  assert.equal(source.track, null);
});

test("a legacy placeholder run cannot also name a track", () => {
  assert.throws(
    () => chooseMusicSource({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, legacyPlaceholderMusic: true }),
    /cannot also name a musicTrackId/
  );
});

test("validateMusicRequest refuses missing, unknown, and bypass fields with safe messages", () => {
  assert.equal(validateMusicRequest({}, MANIFEST).ok, false);
  assert.equal(validateMusicRequest({ musicTrackId: "  " }, MANIFEST).ok, false);
  const unknown = validateMusicRequest({ musicTrackId: "not-a-track" }, MANIFEST);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /not an approved track/);
  assert.equal(validateMusicRequest({ musicTrackId: "fixture-track", musicTrackPath: "music/x.mp3" }, MANIFEST).ok, false);
  assert.equal(validateMusicRequest({ musicTrackId: "fixture-track", musicTrack: TRACK }, MANIFEST).ok, false);
  assert.equal(validateMusicRequest({ legacyPlaceholderMusic: "yes" }, MANIFEST).ok, false);
  assert.equal(validateMusicRequest({ legacyPlaceholderMusic: true, musicTrackId: "fixture-track" }, MANIFEST).ok, false);
});

test("validateMusicRequest accepts a verified track and returns its summary with the credit text", () => {
  const result = validateMusicRequest({ musicTrackId: "fixture-track" }, MANIFEST);
  assert.equal(result.ok, true);
  assert.equal(result.musicTrackId, "fixture-track");
  assert.deepEqual(musicSummary(result.track), {
    id: "fixture-track",
    title: "Fixture Track",
    licence: "CC-BY-4.0",
    attributionRequired: true,
    attribution: "'Fixture Track' by Example - released under CC-BY 4.0.",
    sourceUrl: "https://example.test/track"
  });
});

test("a track that needs no credit gives an empty credit in its summary", () => {
  const cc0 = { ...TRACK, id: "cc0-track", licence: "CC0-1.0", attributionRequired: false, attribution: undefined };
  assert.equal(musicSummary(cc0).attribution, "");
  assert.equal(musicSummary(cc0).attributionRequired, false);
});

test("the work directory is removed when music preflight fails", async () => {
  const workDir = fakeWorkDir();
  const io = fakeIo({ exists: false });
  await assert.rejects(
    withJobWorkDir("job-1", (dir) => prepareMusic({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: dir, minSeconds: BEATS_SECONDS, ...io }), async () => workDir),
    /does not exist or is not accessible/
  );
  assert.equal(workDir.state.cleaned, 1);
});

test("the work directory is removed when the download fails", async () => {
  const workDir = fakeWorkDir();
  const io = fakeIo();
  io.downloadFn = async () => { throw new Error("download failed"); };
  await assert.rejects(
    withJobWorkDir("job-2", (dir) => prepareMusic({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: dir, minSeconds: BEATS_SECONDS, ...io }), async () => workDir),
    /download failed/
  );
  assert.equal(workDir.state.cleaned, 1);
});

test("the work directory is removed when the downloaded file fails the audio probe", async () => {
  const workDir = fakeWorkDir();
  const io = fakeIo({ probe: { streams: [{ codec_type: "video" }], format: { duration: "60" } } });
  await assert.rejects(
    withJobWorkDir("job-3", (dir) => prepareMusic({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: dir, minSeconds: BEATS_SECONDS, ...io }), async () => workDir),
    /no audio stream/
  );
  assert.equal(workDir.state.cleaned, 1);
});

test("the work directory is removed on success too, and a verified track is downloaded and probed", async () => {
  const workDir = fakeWorkDir();
  const io = fakeIo();
  const result = await withJobWorkDir("job-4", (dir) => prepareMusic({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: dir, minSeconds: BEATS_SECONDS, ...io }), async () => workDir);
  assert.equal(result.track.id, "fixture-track");
  assert.equal(io.calls.download[0][0], "music/fixture-track.mp3");
  assert.equal(result.info.durationSeconds, 60);
  assert.equal(workDir.state.cleaned, 1);
});

test("a track shorter than the video is refused after download and the work directory is removed", async () => {
  const workDir = fakeWorkDir();
  const io = fakeIo({ probe: { streams: [{ codec_type: "audio" }], format: { duration: "10" } } });
  await assert.rejects(
    withJobWorkDir("job-5", (dir) => prepareMusic({ musicTrackId: "fixture-track", manifest: MANIFEST, defaultPath: DEFAULT_PATH, workDir: dir, minSeconds: 30, ...io }), async () => workDir),
    /shorter than the 30\.0 s video/
  );
  assert.equal(workDir.state.cleaned, 1);
});
