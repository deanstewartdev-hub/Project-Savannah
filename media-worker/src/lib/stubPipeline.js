import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareMusic } from "../pipeline/prepareMusic.js";
import { withJobWorkDir } from "./tempDir.js";

const execFileAsync = promisify(execFile);

export async function probeAudioFile(path) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  return JSON.parse(stdout);
}

// A pipeline for staging. It runs the real music preparation (manifest lookup, existence check, download, probe,
// refusal and cleanup) and skips every paid step: narration, alignment, visuals, assembly and delivery. Its
// result has the same shape as runJob's, with a stub video URL that points at no real object.
//   fail: true makes the render fail after the music is prepared (for failure-path tests).
export function createStubPipeline({ manifest, existsFn, downloadFn, probeFn = probeAudioFile, minSeconds = 3, fail = false }) {
  return async function stubRunJob({ jobId, musicTrackId, legacyPlaceholderMusic }) {
    return withJobWorkDir(jobId, async (workDir) => {
      const music = await prepareMusic({
        musicTrackId,
        legacyPlaceholderMusic,
        manifest,
        defaultPath: "music/default-bed.mp3",
        workDir,
        minSeconds,
        existsFn,
        downloadFn,
        probeFn
      });
      if (fail) throw new Error("Simulated render failure after music preparation.");
      return {
        jobId,
        status: "completed",
        music: music.track
          ? { id: music.track.id, attribution: music.track.attributionRequired ? music.track.attribution : "" }
          : { id: "", attribution: "" },
        video: { url: "https://storage.invalid/stub/" + jobId + "/final.mp4", gcsPath: "renders/" + jobId + "/final.mp4", durationSeconds: minSeconds, width: 1080, height: 1920 },
        probe: { durationSeconds: minSeconds, width: 1080, height: 1920, reportUrl: "" }
      };
    });
  };
}
