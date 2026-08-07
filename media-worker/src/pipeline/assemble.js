import { ffmpeg } from "../lib/ffmpeg.js";
import { writeWordPopAss } from "../lib/ass.js";
import { config } from "../config.js";

function escapeForFilter(filePath) {
  // The subtitles filter's own argument parser splits on ':' (filename:option=value),
  // so a Windows drive letter or any literal colon has to be escaped, and the whole
  // filename wrapped in single quotes below — escaping the colon alone still left
  // ffmpeg misreading the path as filename:original_size=... in local Windows testing.
  // Forward slashes work fine in ffmpeg on both platforms. Linux paths have neither
  // a drive letter nor backslashes, so this is a no-op in the container.
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// Normalizes one beat's resolved visual (real clip or AI still) into a silent clip of
// exactly the beat's duration, filled and cropped to the target vertical frame. Stills
// get a slow Ken Burns push so the hybrid mix doesn't read as "some clips move, some don't".
async function normalizeBeatClip(visual, durationSeconds, outPath) {
  const { width, height, fps } = config.video;
  const frames = Math.max(1, Math.round(durationSeconds * fps));

  // -threads 1 / -preset veryfast: this runs on a memory-constrained single host, not a
  // scaled render farm, so keeping each normalize pass's own footprint small matters more
  // than shaving encode time - a fast multi-threaded encode that gets OOM-killed is slower
  // than a slim single-threaded one that finishes.
  if (visual.type === "still") {
    const zoompan = `zoompan=z='min(zoom+0.0012,1.15)':d=${frames}:s=${width}x${height}:fps=${fps}`;
    await ffmpeg([
      "-loop", "1",
      "-i", visual.path,
      "-t", String(durationSeconds),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${zoompan},format=yuv420p`,
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-threads", "1",
      outPath
    ]);
    return outPath;
  }

  await ffmpeg([
    "-stream_loop", "-1",
    "-i", visual.path,
    "-t", String(durationSeconds),
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p`,
    "-an",
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "1",
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

export async function assembleVideo({ timedBeats, visuals, narrationPath, musicPath, workDir }) {
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
  const isLast = (index) => index === timedBeats.length - 1;
  const normalizedClips = [];
  for (const [index, beat] of timedBeats.entries()) {
    const nominalDuration = beat.end - beat.start;
    const renderDuration = isLast(index)
      ? nominalDuration
      : nominalDuration + config.video.crossfadeSeconds;
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

  const videoLabel = normalizedClips.length > 1 ? "vconcat" : "0:v";
  const captionedLabel = "vfinal";
  const subtitleFilter = `[${videoLabel}]subtitles='${escapeForFilter(captionsPath)}'[${captionedLabel}]`;

  const narrationInputIndex = normalizedClips.length;
  const musicInputIndex = normalizedClips.length + 1;

  const audioFilters = [
    `[${musicInputIndex}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.25[musicTrimmed]`,
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
    "-map", `[${captionedLabel}]`,
    "-map", "[aout]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outPath
  ]);

  return { outPath, durationSeconds: totalDuration, width, height };
}
