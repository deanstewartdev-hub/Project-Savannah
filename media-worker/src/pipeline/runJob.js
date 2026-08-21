import { createJobWorkDir } from "../lib/tempDir.js";
import { downloadToFile } from "../lib/storage.js";
import { generateContinuousNarration } from "./narration.js";
import { alignNarration } from "./alignment.js";
import { computeBeatTimings } from "./beatTiming.js";
import { resolveBeatVisual } from "./visuals.js";
import { assembleVideo } from "./assemble.js";
import { probeVideo } from "./probe.js";
import { deliverResult } from "./deliver.js";
import { config } from "../config.js";

// Full pipeline for one job, from script to a probed, delivered MP4. Runs beat-visual
// resolution concurrently since each beat's Pexels/gpt-image-2 call is independent, but
// keeps narration -> alignment -> assembly strictly sequential since each stage depends
// on the previous one's output.
export async function runJob({ jobId, beats, musicTrackPath }) {
  const workDir = await createJobWorkDir(jobId);
  const log = (stage) => console.log(`[${jobId}] ${stage} (beats=${beats.length})`);
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
    const visuals = await Promise.all(
      timedBeats.map((beat, index) => resolveBeatVisual(beat, index, workDir))
    );
    log("visuals:done");

    const musicLocalPath = workDir.path("music.mp3");
    await downloadToFile(musicTrackPath || config.defaultMusicTrackPath, musicLocalPath);

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
