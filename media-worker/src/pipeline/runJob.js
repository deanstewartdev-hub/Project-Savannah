import { withJobWorkDir } from "../lib/tempDir.js";
import { downloadToFile, objectExists } from "../lib/storage.js";
import { generateContinuousNarration } from "./narration.js";
import { alignNarration } from "./alignment.js";
import { computeBeatTimings } from "./beatTiming.js";
import { createSharedPexelsSearch, preflightVisualSupply, resolveBeatVisuals } from "./visuals.js";
import { assembleVideo } from "./assemble.js";
import { probeVideo } from "./probe.js";
import { assertNarrationComplete } from "./narrationCompleteness.js";
import { deliverResult } from "./deliver.js";
import { config } from "../config.js";
import { prepareMusic } from "./prepareMusic.js";
import { MUSIC_MANIFEST } from "../lib/musicManifest.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
//
// The whole job runs inside withJobWorkDir, so its temporary files are removed whether it succeeds,
// fails in a later stage, or is refused during music preparation before any paid step.
export async function runJob({ jobId, beats, musicTrackId, musicTrackPath, musicTrack, legacyPlaceholderMusic, allowAiStills = false }) {
  return withJobWorkDir(jobId, async (workDir) => {
    const log = (stage) => console.log(`[${jobId}] ${stage} (beats=${beats.length})`);
    const music = await prepareMusic({
      musicTrackId,
      legacyPlaceholderMusic,
      manifest: MUSIC_MANIFEST,
      defaultPath: config.defaultMusicTrackPath,
      musicTrack,
      musicTrackPath,
      workDir,
      minSeconds: estimatedNarrationSeconds(beats),
      existsFn: objectExists,
      downloadFn: downloadToFile,
      probeFn: probeAudio
    });
    log(music.track ? `music:track ${music.track.id}` : "music:placeholder (legacy run)");
    log(`music:validated ${music.info.durationSeconds.toFixed(1)}s ${music.info.codec}`);

    const fullScript = beats.map((beat) => beat.text.trim()).join(" ");

    // Unpaid: Pexels searches only. A script whose beats cannot be illustrated is refused before ElevenLabs
    // or Whisper is called, instead of after.
    // One memoised search per job: the preflight and the planner share every Pexels result.
    const visualSearch = createSharedPexelsSearch();
    log("visual-preflight:start");
    const preflight = await preflightVisualSupply(beats, { allowAiStills, search: visualSearch });
    log(`visual-preflight:passed (minimum stills required ${preflight.lowerBound}; maximum allowed ${preflight.stillLimit}; the timed planner may need more)`);

    log("narration:start");
    const narrationPath = await generateContinuousNarration(fullScript, workDir);
    log("narration:done");
    log("alignment:start");
    const alignedWords = await alignNarration(narrationPath);
    log("alignment:done");
    const timedBeats = computeBeatTimings(beats, alignedWords);

    // The narration file's own measured length is the reference for completeness (Issue #29), and the
    // visual planner needs it too, so it is measured before any footage is planned.
    const narrationSeconds = Number((await probeAudio(narrationPath)).format.duration);

    log("visuals:start");
    const visuals = await resolveBeatVisuals(timedBeats, workDir, {
      allowAiStills,
      narrationSeconds,
      search: visualSearch,
      log: (message) => console.log(`[${jobId}] ${message}`)
    });
    log("visuals:done");

    log("assembly:start");
    const assembled = await assembleVideo({
      timedBeats,
      visuals,
      narrationPath,
      narrationSeconds,
      musicPath: music.localPath,
      workDir
    });
    log("assembly:done");

    log("probe:start");
    const probeResult = await probeVideo(assembled.outPath);
    log("probe:done");
    // Fail closed before delivery: a video that does not carry the whole narration is never delivered.
    assertNarrationComplete({
      narrationSeconds,
      videoSeconds: probeResult.videoDurationSeconds ?? probeResult.durationSeconds,
      audioSeconds: probeResult.audioDurationSeconds,
      alignedWords,
      scriptWordCount: fullScript.split(/\s+/).filter(Boolean).length
    });
    log("completeness:passed");
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
      music: music.track ? { id: music.track.id, attribution: music.track.attributionRequired ? music.track.attribution : "" } : { id: "", attribution: "" },
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
  });
}
