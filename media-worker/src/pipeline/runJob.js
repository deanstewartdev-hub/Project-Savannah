import { createJobWorkDir } from "../lib/tempDir.js";
import { downloadToFile, objectExists } from "../lib/storage.js";
import { generateContinuousNarration } from "./narration.js";
import { alignNarration } from "./alignment.js";
import { computeBeatTimings } from "./beatTiming.js";
import { resolveBeatVisuals } from "./visuals.js";
import { assembleVideo } from "./assemble.js";
import { probeVideo } from "./probe.js";
import { deliverResult } from "./deliver.js";
import { config } from "../config.js";
import { chooseMusicSource, preflightMusic, validateMusicProbe } from "../lib/musicLicence.js";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// The verified music manifest ships inside the image (Dockerfile copies music/). The worker never
// trusts a track description sent in a job request.
const MUSIC_MANIFEST = JSON.parse(readFileSync(new URL("../../music/manifest.json", import.meta.url), "utf8"));

// Estimated spoken length of the beats (about 2.2 words per second), plus a margin, so a music file
// that would have to loop audibly is refused before any paid step.
function estimatedNarrationSeconds(beats) {
  const words = beats.reduce((total, beat) => total + beat.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return words / 2.2 + 2;
}

async function probeAudio(path) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  return JSON.parse(stdout);
}

// Full pipeline for one job, from script to a probed, delivered MP4. Beat visuals are planned
// and fetched together (see resolveBeatVisuals), but narration -> alignment -> assembly stays
// strictly sequential since each stage depends on the previous one's output.
export async function runJob({ jobId, beats, musicTrackId, musicTrackPath, musicTrack, allowAiStills = false }) {
  // Music is checked before any paid provider call: the track must be in the verified manifest, the
  // object must exist, and the downloaded file must hold audio long enough for the video.
  const music = chooseMusicSource({ musicTrackId, manifest: MUSIC_MANIFEST, defaultPath: config.defaultMusicTrackPath, musicTrack, musicTrackPath });
  await preflightMusic({ path: music.path, existsFn: objectExists });
  const workDir = await createJobWorkDir(jobId);
  const log = (stage) => console.log(`[${jobId}] ${stage} (beats=${beats.length})`);
  log(music.track ? `music:track ${music.track.id}` : "music:default");
  const musicLocalPath = workDir.path("music.mp3");
  await downloadToFile(music.path, musicLocalPath);
  const musicInfo = validateMusicProbe(await probeAudio(musicLocalPath), { minSeconds: estimatedNarrationSeconds(beats) });
  log(`music:validated ${musicInfo.durationSeconds.toFixed(1)}s ${musicInfo.codec}`);
  try {
    const fullScript = beats.map((beat) => beat.text.trim()).join(" ");

    log("narration:start");
    const narrationPath = await generateContinuousNarration(fullScript, workDir);
    log("narration:done");
    log("alignment:start");
    const alignedWords = await alignNarration(narrationPath);
    log("alignment:done");
    const timedBeats = computeBeatTimings(beats, alignedWords);

    log("visuals:start");
    const visuals = await resolveBeatVisuals(timedBeats, workDir, {
      allowAiStills,
      log: (message) => console.log(`[${jobId}] ${message}`)
    });
    log("visuals:done");

    log("assembly:start");
    const assembled = await assembleVideo({
      timedBeats,
      visuals,
      narrationPath,
      musicPath: musicLocalPath,
      workDir
    });
    log("assembly:done");

    log("probe:start");
    const probeResult = await probeVideo(assembled.outPath);
    log("probe:done");
    log("deliver:start");
    const delivery = await deliverResult(jobId, {
      videoPath: assembled.outPath,
      probeResult,
      workDir
    });
    log("deliver:done");

    return {
      jobId,
      status: "completed",
      video: {
        url: delivery.videoUrl,
        gcsPath: delivery.gcsPath,
        durationSeconds: probeResult.durationSeconds,
        width: probeResult.width,
        height: probeResult.height
      },
      probe: {
        ...probeResult,
        reportUrl: delivery.reportUrl
      }
    };
  } finally {
    await workDir.cleanup();
  }
}
