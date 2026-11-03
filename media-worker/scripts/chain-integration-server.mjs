// Test-only worker for the integration check (node-tests/ChainIntegration_Tests.cjs). It runs the real
// in-process job route (validation, 202 contract, callback), the real music preparation (manifest lookup,
// download, real ffprobe on a real file) and the real callback sender. It replaces only the paid steps:
// narration, alignment, visuals, assembly and delivery. Nothing here calls Google Cloud or a paid API.
import express from "express";
import { copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJobsRouter } from "../src/routes/jobs.js";
import { prepareMusic } from "../src/pipeline/prepareMusic.js";
import { withJobWorkDir } from "../src/lib/tempDir.js";
import { postCallbackWithRetry } from "../src/lib/callback.js";
import { MUSIC_PROTOCOL } from "../src/lib/renderJobGuard.js";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT);
const secret = process.env.JOB_SUBMIT_SECRET;
const manifest = JSON.parse(process.env.TEST_MANIFEST_JSON);
const musicFile = process.env.TEST_MUSIC_FILE;
const runs = [];

async function probeAudio(path) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  return JSON.parse(stdout);
}

// Same contract as pipeline/runJob.js for the music part and the result shape; the paid steps are skipped.
async function stubbedRunJob({ jobId, beats, musicTrackId, legacyPlaceholderMusic }) {
  runs.push({ jobId, beats: beats.length, musicTrackId: musicTrackId || null, legacyPlaceholderMusic: legacyPlaceholderMusic === true });
  return withJobWorkDir(jobId, async (workDir) => {
    const music = await prepareMusic({
      musicTrackId,
      legacyPlaceholderMusic,
      manifest,
      defaultPath: "music/default-bed.mp3",
      workDir,
      minSeconds: 3,
      existsFn: async () => true,
      downloadFn: (_path, dest) => copyFile(musicFile, dest),
      probeFn: probeAudio
    });
    return {
      jobId,
      status: "completed",
      music: music.track ? { id: music.track.id, attribution: music.track.attributionRequired ? music.track.attribution : "" } : { id: "", attribution: "" },
      video: { url: "https://example.test/" + jobId + "/final.mp4", gcsPath: "renders/" + jobId + "/final.mp4", durationSeconds: 3, width: 1080, height: 1920 },
      probe: { durationSeconds: 3, width: 1080, height: 1920, reportUrl: "" }
    };
  });
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/health", (req, res) => res.status(200).json({ status: "ok", musicProtocol: MUSIC_PROTOCOL }));
// Test-only: how many jobs have actually started. A refused request must leave this unchanged.
app.get("/__runs", (req, res) => res.json(runs));
app.use(createJobsRouter({ secret, runJob: stubbedRunJob, postCallback: postCallbackWithRetry, manifest }));
app.listen(port, "127.0.0.1", () => console.log("READY " + port));
