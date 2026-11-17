import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ffmpeg } from "../lib/ffmpeg.js";
import { writeWordPopAss } from "../lib/ass.js";
import { config } from "../config.js";
import { segmentLengths } from "./visualSelection.js";
import { buildMusicGainFilter } from "../lib/musicLicence.js";
import { beatRenderSeconds } from "./beatTiming.js";

function escapeForFilter(filePath) {
  // The subtitles filter's own argument parser splits on ':' (filename:option=value),
  // so a Windows drive letter or any literal colon has to be escaped, and the whole
  // filename wrapped in single quotes below — escaping the colon alone still left
  // ffmpeg misreading the path as filename:original_size=... in local Windows testing.
  // Forward slashes work fine in ffmpeg on both platforms. Linux paths have neither
  // a drive letter nor backslashes, so this is a no-op in the container.
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// The visible disclosure drawn on every AI still for its whole length: a boxed caption along the bottom third.
// Throws when the font is missing, so a still can never be rendered without its label.
export function stillLabelFilter(label = config.aiStillLabel) {
  if (!existsSync(label.fontFile)) {
    throw new Error(`AI still label font not found at ${label.fontFile}; refusing to render an unlabelled AI still.`);
  }
  return `drawtext=fontfile='${escapeForFilter(label.fontFile)}':text='${label.text}':fontsize=44:fontcolor=white:` +
    "box=1:boxcolor=black@0.6:boxborderw=24:x=(w-text_w)/2:y=h-260";
}

// Normalizes one beat's resolved visual (real clip or AI still) into a silent clip of
// exactly the beat's duration, filled and cropped to the target vertical frame. Stills
// get a slow Ken Burns push so the hybrid mix doesn't read as "some clips move, some don't".
export async function normalizeBeatClip(visual, durationSeconds, outPath) {
  const { width, height, fps } = config.video;
  const frames = Math.max(1, Math.round(durationSeconds * fps));

  // -threads 1 / -preset veryfast: this runs on a memory-constrained single host, not a
  // scaled render farm, so keeping each normalize pass's own footprint small matters more
  // than shaving encode time - a fast multi-threaded encode that gets OOM-killed is slower
  // than a slim single-threaded one that finishes.
  if (visual.type === "still") {
    // The zoom reaches its end exactly at the end of the beat, so a still never holds still for long. (The old rate
    // stopped after about 4 s, which left a 9 s still frozen for its last 5 s.)
    const zoompan = `zoompan=z='1+0.15*on/${frames}':d=${frames}:s=${width}x${height}:fps=${fps}`;
    // Every AI still is labelled on the picture for its whole length. Without a usable font the still is not rendered:
    // an unlabelled AI image must never reach a video.
    const label = stillLabelFilter();
    await ffmpeg([
      "-loop", "1",
      "-i", visual.path,
      "-t", String(durationSeconds),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${zoompan},${label},format=yuv420p`,
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-threads", "1",
      outPath
    ]);
    return outPath;
  }

  return normalizeSegmentedClip(visual.segments, durationSeconds, outPath);
}

// Video beats are built from several clips cut in order, never looped: each piece is trimmed
// to its share of the beat, encoded to the same frame format, then joined. The planner has
// already checked that the segments cover the duration.
async function normalizeSegmentedClip(segments, durationSeconds, outPath) {
  const { width, height, fps } = config.video;
  const lengths = segmentLengths(segments.map((s) => s.sourceDurationSeconds), durationSeconds);
  if (lengths === null) {
    throw new Error(`Visual segments do not cover ${durationSeconds.toFixed(2)} s; refusing to loop a clip`);
  }

  const pieces = [];
  for (const [k, segment] of segments.entries()) {
    if (k >= lengths.length) break;
    const piecePath = outPath.replace(/\.mp4$/, `-piece-${k}.mp4`);
    await ffmpeg([
      "-i", segment.path,
      "-t", lengths[k].toFixed(3),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p`,
      "-an",
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-threads", "1",
      piecePath
    ]);
    pieces.push(piecePath);
  }

  const listPath = outPath.replace(/\.mp4$/, "-pieces.txt");
  await writeFile(listPath, pieces.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  await ffmpeg([
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    "-t", durationSeconds.toFixed(3),
    outPath
  ]);
  return outPath;
}

// Chains pairwise xfade transitions across N normalized clips. xfade's `offset` is where
// the transition starts on the running (already-merged) timeline, so each step subtracts
// the previous crossfade overlap from the cumulative duration.
function buildCrossfadeGraph(clipDurations, crossfadeSeconds) {
  const filters = [];
  let runningLabel = "0:v";
  let runningDuration = clipDurations[0];

  for (let i = 1; i < clipDurations.length; i += 1) {
    const outLabel = i === clipDurations.length - 1 ? "vconcat" : `v${i}`;
    const offset = Math.max(0, runningDuration - crossfadeSeconds);
    filters.push(
      `[${runningLabel}][${i}:v]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${offset.toFixed(3)}[${outLabel}]`
    );
    runningDuration = runningDuration - crossfadeSeconds + clipDurations[i];
    runningLabel = outLabel;
  }

  return { filters, totalDuration: runningDuration };
}

export async function assembleVideo({ timedBeats, visuals, narrationPath, narrationSeconds, musicPath, workDir }) {
  const { width, height, fps } = config.video;

  // Every clip except the last is rendered `crossfadeSeconds` longer than its nominal
  // narration-derived duration, and that surplus is exactly what each xfade transition
  // consumes. Padding this way keeps the merged video's total duration equal to the sum
  // of the nominal durations, which is what keeps the crossfaded video in sync with the
  // (untouched, un-crossfaded) narration track instead of drifting a little further out
  // of sync at every transition.
  // Sequential, not Promise.all: running N ffmpeg encodes concurrently multiplies peak
  // memory by N, which SIGKILLs the process on memory-constrained hosts (observed on
  // Railway's trial tier) even though no single beat's encode is large on its own.
  // The beat visuals cover the whole narration timeline (speech and the pauses that belong to each beat),
  // so the finished video is exactly as long as the narration. See beatVisualSpans.
  const renderDurations = beatRenderSeconds(timedBeats, narrationSeconds, config.video.crossfadeSeconds);
  const normalizedClips = [];
  for (const [index] of timedBeats.entries()) {
    const renderDuration = renderDurations[index];
    const outPath = workDir.path(`beat-${index}-norm.mp4`);
    await normalizeBeatClip(visuals[index], renderDuration, outPath);
    normalizedClips.push({ path: outPath, duration: renderDuration });
  }

  const captionsPath = workDir.path("captions.ass");
  const allWords = timedBeats.flatMap((beat) => beat.words || []);
  await writeWordPopAss(allWords, captionsPath);

  const clipDurations = normalizedClips.map((c) => c.duration);
  const { filters: crossfadeFilters, totalDuration } =
    normalizedClips.length > 1
      ? buildCrossfadeGraph(clipDurations, config.video.crossfadeSeconds)
      : { filters: [], totalDuration: clipDurations[0] };
  // Fail closed: the video, the music and the output must all be the narration's length.
  if (Math.abs(totalDuration - narrationSeconds) > 0.05) {
    throw new Error(`Assembled timeline (${totalDuration.toFixed(3)} s) does not match the narration (${narrationSeconds.toFixed(3)} s).`);
  }

  const videoLabel = normalizedClips.length > 1 ? "vconcat" : "0:v";
  const captionedLabel = "vfinal";
  const subtitleFilter = `[${videoLabel}]subtitles='${escapeForFilter(captionsPath)}'[${captionedLabel}]`;

  const narrationInputIndex = normalizedClips.length;
  const musicInputIndex = normalizedClips.length + 1;

  const audioFilters = [
    `[${musicInputIndex}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,${buildMusicGainFilter({
      volume: config.video.musicVolume,
      fadeInSeconds: config.video.musicFadeInSeconds,
      fadeOutSeconds: config.video.musicFadeOutSeconds,
      totalSeconds: totalDuration
    })}[musicTrimmed]`,
    `[musicTrimmed][${narrationInputIndex}:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[ducked]`,
    `[ducked][${narrationInputIndex}:a]amix=inputs=2:duration=first:normalize=0[mixed]`,
    `[mixed]loudnorm=I=${config.video.targetLufs}:TP=${config.video.truePeakDb}:LRA=${config.video.loudnessRangeLu}[aout]`
  ];

  const filterComplex = [...crossfadeFilters, subtitleFilter, ...audioFilters].join(";");

  const inputs = normalizedClips.flatMap((c) => ["-i", c.path]);
  inputs.push("-i", narrationPath);
  inputs.push("-stream_loop", "-1", "-i", musicPath);

  const outPath = workDir.path("final.mp4");
  await ffmpeg([
    ...inputs,
    "-filter_complex", filterComplex,
    "-filter_threads", "1",
    "-filter_complex_threads", "1",
    "-map", `[${captionedLabel}]`,
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "1",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    // Explicit length, not -shortest: -shortest would end the output at whichever stream ends first and
    // could quietly cut the narration. Both streams are built to exactly the narration length.
    "-t", totalDuration.toFixed(3),
    outPath
  ]);

  return { outPath, durationSeconds: totalDuration, width, height };
}
