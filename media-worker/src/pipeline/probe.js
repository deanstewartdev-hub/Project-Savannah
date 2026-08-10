import { ffprobe, ffmpegCapture } from "../lib/ffmpeg.js";
import { config } from "../config.js";

function parseIntervals(stderr, startTag, endTag) {
  const intervals = [];
  const startRe = new RegExp(`${startTag}:\\s*([\\d.]+)`, "g");
  const endRe = new RegExp(`${endTag}:\\s*([\\d.]+)`, "g");
  const starts = [...stderr.matchAll(startRe)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(endRe)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    intervals.push({ start: starts[i], end: ends[i] ?? null });
  }
  return intervals;
}

async function detectSilence(filePath) {
  const { stderr } = await ffmpegCapture([
    "-i", filePath,
    "-af", "silencedetect=noise=-30dB:d=0.5",
    "-f", "null", "-"
  ]);
  return parseIntervals(stderr, "silence_start", "silence_end");
}

async function detectBlackFrames(filePath) {
  const { stderr } = await ffmpegCapture([
    "-i", filePath,
    "-vf", "blackdetect=d=0.5:pic_th=0.98",
    "-an",
    "-f", "null", "-"
  ]);
  return parseIntervals(stderr, "black_start", "black_end");
}

async function measureLoudness(filePath) {
  const { stderr } = await ffmpegCapture([
    "-i", filePath,
    "-af",
    `loudnorm=I=${config.video.targetLufs}:TP=${config.video.truePeakDb}:LRA=${config.video.loudnessRangeLu}:print_format=json`,
    "-f", "null", "-"
  ]);
  const jsonMatch = stderr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("loudnorm did not report measurement JSON");
  }
  const measured = JSON.parse(jsonMatch[0]);
  return {
    integratedLufs: Number(measured.input_i),
    truePeakDb: Number(measured.input_tp),
    loudnessRangeLu: Number(measured.input_lra)
  };
}

// This is what makes the gate real: everything here reads the finished file rather than
// trusting the request that produced it. See section 2.4 of SAVANNAH_AUDIT_AND_PLAN.md —
// the Creatomate-era RenderQualityService only ever checked that URLs were present in the
// render request, never that the resulting media matched what was asked for.
export async function probeVideo(filePath) {
  const info = await ffprobe(filePath);
  const videoStream = info.streams.find((s) => s.codec_type === "video");
  const audioStream = info.streams.find((s) => s.codec_type === "audio");

  const [silences, blackFrames, loudness] = await Promise.all([
    detectSilence(filePath),
    detectBlackFrames(filePath),
    measureLoudness(filePath)
  ]);

  const durationSeconds = Number(info.format.duration);
  const clippingDetected = loudness.truePeakDb > -0.5;

  return {
    durationSeconds,
    width: videoStream ? Number(videoStream.width) : null,
    height: videoStream ? Number(videoStream.height) : null,
    hasAudio: Boolean(audioStream),
    silences,
    blackFrames,
    loudness,
    clippingDetected,
    passesResolutionGate:
      Boolean(videoStream) &&
      Number(videoStream.width) >= config.video.width &&
      Number(videoStream.height) >= config.video.height,
    passesSilenceGate: silences.every((s) => s.end !== null && s.end - s.start < 1.5),
    passesBlackFrameGate: blackFrames.length === 0
  };
}
