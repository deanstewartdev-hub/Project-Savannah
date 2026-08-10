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
  try {
    const fullScript = beats.map((beat) => beat.text.trim()).join(" ");

    const narrationPath = await generateContinuousNarration(fullScript, workDir);
    const alignedWords = await alignNarration(narrationPath);
    const timedBeats = computeBeatTimings(beats, alignedWords);

    const visuals = await Promise.all(
      timedBeats.map((beat, index) => resolveBeatVisual(beat, index, workDir))
    );

    const musicLocalPath = workDir.path("music.mp3");
    await downloadToFile(musicTrackPath || config.defaultMusicTrackPath, musicLocalPath);

    const assembled = await assembleVideo({
      timedBeats,
      visuals,
      narrationPath,
      musicPath: musicLocalPath,
      workDir
    });

    const probeResult = await probeVideo(assembled.outPath);
    const delivery = await deliverResult(jobId, {
      videoPath: assembled.outPath,
      probeResult,
      workDir
    });

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
