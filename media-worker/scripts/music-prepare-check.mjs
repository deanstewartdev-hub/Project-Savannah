// No-paid integration check for the music path, run inside the worker image. It uses the real
// prepareMusic(), validateMusicRequest(), withJobWorkDir() and real ffprobe. It does not touch Cloud
// Storage, ElevenLabs, OpenAI or Pexels: the object check and the download are replaced by local
// stand-ins, and the track file is the one passed in on the command line (a verified candidate
// downloaded from its official URL by the build). It exits non-zero if any check fails.
//
// Usage: node scripts/music-prepare-check.mjs <path-to-track.mp3> <minimum-seconds>
import { copyFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareMusic } from "../src/pipeline/prepareMusic.js";
import { validateMusicRequest, musicSummary } from "../src/lib/musicLicence.js";
import { withJobWorkDir } from "../src/lib/tempDir.js";

const execFileAsync = promisify(execFile);
const [trackFile, minSecondsArg] = process.argv.slice(2);
if (!trackFile) throw new Error("usage: node scripts/music-prepare-check.mjs <track.mp3> <minSeconds>");
const minSeconds = Number(minSecondsArg || 30);

// The manifest entry the check uses is the official candidate's details, verified on the artist's page.
// It stays in this script; the repo's music/manifest.json is not changed by this check.
const TRACK = {
  id: "scott-buckley-beyond-these-walls",
  file: "music/scott-buckley-beyond-these-walls.mp3",
  title: "Beyond These Walls",
  licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-check",
  verifiedOn: "2026-11-03",
  attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  monetizationAllowed: true
};
const MANIFEST = { tracks: [TRACK] };

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  if (!ok) failures++;
}

async function probeAudio(path) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  return JSON.parse(stdout);
}

// 1. Request validation: an unknown ID is refused without any download.
const unknown = validateMusicRequest({ musicTrackId: "not-a-track" }, MANIFEST);
check("unknown track ID is refused by the request validator", unknown.ok === false);

const bypass = validateMusicRequest({ musicTrackId: TRACK.id, musicTrackPath: "music/x.mp3" }, MANIFEST);
check("a request that also names a file path is refused", bypass.ok === false);

const good = validateMusicRequest({ musicTrackId: TRACK.id }, MANIFEST);
check("the verified track ID is accepted", good.ok === true);
const summary = musicSummary(good.track);
check("the summary carries the exact credit line", summary.attribution === TRACK.attribution);

// 2. Real download-validate path, with the work directory removed afterwards.
let workDirPath = "";
let downloaded = "";
await withJobWorkDir("integration-check", async (workDir) => {
  workDirPath = workDir.dir;
  const prepared = await prepareMusic({
    musicTrackId: TRACK.id,
    manifest: MANIFEST,
    defaultPath: "music/default-bed.mp3",
    workDir,
    minSeconds,
    existsFn: async () => true,
    downloadFn: async (_path, dest) => { await copyFile(trackFile, dest); downloaded = dest; },
    probeFn: probeAudio
  });
  check("a verified track is downloaded and probed", prepared.info.durationSeconds >= minSeconds,
    `${prepared.info.durationSeconds.toFixed(1)} s, ${prepared.info.codec}, ${prepared.info.sampleRate} Hz`);
  check("the downloaded file is a real audio file on disk", (await stat(prepared.localPath)).size > 0);
  check("the prepared track is not a placeholder", prepared.placeholder === false);
}).catch((error) => check("the verified track passes preparation", false, error.message));

// 3. Failed preparation: an unknown track is refused before download, and nothing is left behind.
let downloadsAttempted = 0;
await withJobWorkDir("integration-check-refusal", async (workDir) => {
  workDirPath = workDir.dir;
  await prepareMusic({
    musicTrackId: "not-a-track",
    manifest: MANIFEST,
    defaultPath: "music/default-bed.mp3",
    workDir,
    minSeconds,
    existsFn: async () => true,
    downloadFn: async () => { downloadsAttempted++; },
    probeFn: probeAudio
  });
}).then(
  () => check("an unknown track fails preparation", false),
  (error) => check("an unknown track fails preparation before any download", downloadsAttempted === 0, error.message)
);
let stillThere = true;
try { await stat(workDirPath); } catch (error) { stillThere = false; }
check("the work directory is removed after the failed preparation", stillThere === false, workDirPath);
check("the downloaded copy from the verified run was in a removed work directory", downloaded !== "" && !(await stat(downloaded).then(() => true, () => false)));

console.log(failures === 0 ? "Music integration check: all checks passed." : `Music integration check: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
