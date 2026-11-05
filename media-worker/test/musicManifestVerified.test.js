import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateTrack, resolveTrack, musicSummary } from "../src/lib/musicLicence.js";

// The one music track the owner has approved for the first Savannah Atlas video (Issue #29). The entry must
// stay in step with the owner's approval, the artist's licence, and the track ID and credit the Apps Script
// and the dispatcher use. These are checks of the repository, not of the audio file.

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "..", "music", "manifest.json"), "utf8"));
const TRACK_ID = "scott-buckley-beyond-these-walls";
const CREDIT = "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";

test("the approved track is in the manifest and passes the licence validator", () => {
  const track = resolveTrack(manifest, TRACK_ID);
  assert.deepEqual(validateTrack(track), []);
});

test("the manifest entry matches the owner's approved metadata exactly", () => {
  const track = manifest.tracks.find((t) => t.id === TRACK_ID);
  assert.equal(track.title, "Beyond These Walls");
  assert.equal(track.artist, "Scott Buckley");
  assert.equal(track.licence, "CC-BY-4.0");
  assert.equal(track.file, "music/scott-buckley-beyond-these-walls.mp3");
  assert.equal(track.sourceUrl, "https://www.scottbuckley.com.au/library/beyond-these-walls/");
  assert.equal(track.termsUrl, "https://www.scottbuckley.com.au/library/using-this-music/");
  assert.equal(track.attributionRequired, true);
  assert.equal(track.attribution, CREDIT);
  assert.equal(track.monetizationAllowed, true);
  assert.equal(track.verifiedOn, "2026-11-05");
});

test("the verified provenance does not claim the owner inspected or downloaded the audio", () => {
  const track = manifest.tracks.find((t) => t.id === TRACK_ID);
  assert.match(track.verifiedBy, /Owner approval recorded in GitHub Issue #29/);
  assert.match(track.verifiedBy, /not been downloaded/);
});

test("the summary the main app records carries the same track ID and credit", () => {
  const summary = musicSummary(resolveTrack(manifest, TRACK_ID));
  assert.equal(summary.id, TRACK_ID);
  assert.equal(summary.attribution, CREDIT);
  assert.equal(summary.attributionRequired, true);
});
