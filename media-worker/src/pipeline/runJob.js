import { createJobWorkDir } from "../lib/tempDir.js";
import { downloadToFile } from "../lib/storage.js";
import { generateContinuousNarration } from "./narration.js";
import { alignNarration } from "./alignment.js";
import { computeBeatTimings } from "./beatTiming.js";
import { resolveBeatVisuals } from "./visuals.js";
import { assembleVideo } from "./assemble.js";
import { probeVideo } from "./probe.js";
import { deliverResult } from "./deliver.js";
import { config } from "../config.js";
import { chooseMusicSource } from "../lib/musicLicence.js";

// Full pipeline for one job, from script to a probed, delivered MP4. Beat visuals are planned
// and fetched together (see resolveBeatVisuals), but narration -> alignment -> assembly stays
// strictly sequential since each stage depends on the previous one's output.
export async function runJob({ jobId, beats, musicTrackPath, musicTrack, allowAiStills = false }) {
  // The music source is checked first: an unverified track fails the job before any paid provider call.
  const music = chooseMusicSource({ musicTrack, musicTrackPath, defaultPath: config.defaultMusicTrackPath });
  const workDir = await createJobWorkDir(jobId);
  const log = (stage) => console.log(`[${jobId}] ${stage} (beats=${beats.length})`);
  log(music.track ? `music:track ${music.track.id}` : "music:default");
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

    const musicLocalPath = workDir.path("music.mp3");
    await downloadToFile(music.path, musicLocalPath);

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
