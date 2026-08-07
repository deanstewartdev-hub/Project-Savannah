import { execFile } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
      if (error) {
        const detail = [
          `exit code: ${error.code ?? "unknown"}`,
          `signal: ${error.signal ?? "none"}`,
          `args: ${args.join(" ")}`,
          `stderr: ${stderr && stderr.trim() ? stderr.trim() : "(empty)"}`,
          `stdout: ${stdout && stdout.trim() ? stdout.trim() : "(empty)"}`
        ].join("\n");
        reject(new Error(`${command} failed (${error.message})\n${detail}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function ffmpeg(args) {
  return run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

// A second variant that returns stderr text even on success, because several probes
// (silencedetect, blackdetect, loudnorm) report their findings on stderr rather than stdout.
export function ffmpegCapture(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-hide_banner", "-nostats", ...args],
      { maxBuffer: 1024 * 1024 * 64 },
      (error, stdout, stderr) => {
        // silencedetect/blackdetect intentionally produce no output file in some call
        // shapes, which ffmpeg reports as a non-zero-looking exit even though the
        // analysis itself is valid; only surface a real failure if stderr is empty too.
        if (error && !stderr) {
          reject(new Error(`ffmpeg analysis failed: ${error.message}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export async function ffprobe(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);
  return JSON.parse(stdout);
}
