// Background-music support. A track is used only when its manifest entry records where it came
// from, which licence applies, who verified it and when, whether attribution is required and
// whether monetised use is allowed. Nothing is inferred from the licence name: each track states
// its own conditions. The default bed is used when no track is requested.
//
// Pure functions only (no file access), so they are testable without secrets or media files.
// The storage preflight takes its existence check as a parameter, so it is testable too.

// Licences the owner accepts for Shorts. Accepting a licence is a policy decision (RELEASE_READINESS
// section 18), not a per-track code change. Each track still states its own attribution and
// monetisation conditions; a licence name alone never settles them.
export const ALLOWED_LICENCES = Object.freeze(["CC0-1.0", "CC-BY-4.0", "Pixabay-Content-Licence", "YouTube-Audio-Library"]);

// Only files inside this folder can be used, so a manifest cannot point the worker at arbitrary
// objects in the bucket.
export const APPROVED_MUSIC_FOLDER = "music/";
const MUSIC_FILE_PATTERN = /^music\/[A-Za-z0-9._\-\/]+\.(mp3|m4a|wav)$/;

// True only for a path inside the approved folder: the right shape, the right extension, and no
// parent-folder segments (a pattern alone allows "music/../x.mp3").
export function isApprovedMusicPath(path) {
  return typeof path === "string" && MUSIC_FILE_PATTERN.test(path) && path.split("/").indexOf("..") === -1;
}

const REQUIRED_FIELDS = ["id", "file", "title", "licence", "sourceUrl", "termsUrl", "verifiedBy", "verifiedOn"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Returns the list of problems with one manifest entry. An empty list means it may be used.
export function validateTrack(entry) {
  const problems = [];
  if (!entry || typeof entry !== "object") return ["entry is not an object"];
  for (const field of REQUIRED_FIELDS) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") problems.push(`${field} is required`);
  }
  if (typeof entry.licence === "string" && entry.licence.trim() !== "" && ALLOWED_LICENCES.indexOf(entry.licence) === -1) {
    problems.push(`licence "${entry.licence}" is not on the allowed list`);
  }
  // Per-track conditions, stated explicitly by whoever verified the track.
  if (typeof entry.attributionRequired !== "boolean") problems.push("attributionRequired must be true or false");
  if (entry.attributionRequired === true && (typeof entry.attribution !== "string" || entry.attribution.trim() === "")) {
    problems.push("attribution text is required when attributionRequired is true");
  }
  if (entry.licence === "CC-BY-4.0" && entry.attributionRequired !== true) {
    problems.push("CC-BY-4.0 always requires attribution");
  }
  if (entry.monetizationAllowed !== true) problems.push("monetizationAllowed must be true for a monetised channel");
  if (typeof entry.verifiedOn === "string" && !ISO_DATE.test(entry.verifiedOn)) {
    problems.push("verifiedOn must be a YYYY-MM-DD date");
  }
  if (typeof entry.file === "string" && entry.file.trim() !== "" && !isApprovedMusicPath(entry.file)) {
    problems.push("file must be an .mp3, .m4a or .wav path inside the music folder, with no '..' or absolute path");
  }
  return problems;
}

// Finds a usable track by ID. Throws (rather than falling back) when the requested track is missing
// or unverified, so a job never renders with a different track than the one that was asked for.
export function resolveTrack(manifest, trackId) {
  const tracks = manifest && Array.isArray(manifest.tracks) ? manifest.tracks : [];
  const track = tracks.find((entry) => entry && entry.id === trackId);
  if (!track) throw new Error(`Music track "${trackId}" is not in the manifest.`);
  const problems = validateTrack(track);
  if (problems.length > 0) throw new Error(`Music track "${trackId}" is not usable: ${problems.join("; ")}`);
  return track;
}

// Music gain and fades as one FFmpeg filter chain. The volume is clamped so a bad request cannot
// drown the narration; narration ducking is applied separately by sidechaincompress.
export const MUSIC_VOLUME_LIMITS = Object.freeze({ min: 0, max: 0.6 });

export function buildMusicGainFilter({ volume, fadeInSeconds, fadeOutSeconds, totalSeconds }) {
  const v = Math.min(MUSIC_VOLUME_LIMITS.max, Math.max(MUSIC_VOLUME_LIMITS.min, Number(volume)));
  if (!Number.isFinite(v)) throw new Error("music volume must be a number");
  const fadeIn = Math.max(0, Math.min(Number(fadeInSeconds) || 0, totalSeconds));
  const fadeOut = Math.max(0, Math.min(Number(fadeOutSeconds) || 0, totalSeconds));
  const parts = [`volume=${v.toFixed(3)}`];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, totalSeconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  return parts.join(",");
}

// Chooses the music for a job. Music is chosen only by musicTrackId, which is resolved against the
// worker's own verified manifest. A job that passes a track object or a file path is refused, so
// a request cannot skip licence verification. A job with no track ID is refused too, unless it is an
// explicitly identified legacy or technical run (legacyPlaceholderMusic === true), which gets the
// silent placeholder bed. That bed is never a publishable music selection.
export function chooseMusicSource({ musicTrackId, manifest, defaultPath, musicTrack, musicTrackPath, legacyPlaceholderMusic }) {
  if (musicTrack !== undefined && musicTrack !== null) {
    throw new Error("Music must be chosen with musicTrackId from the verified manifest; a musicTrack object is not accepted.");
  }
  if (musicTrackPath !== undefined && musicTrackPath !== null && musicTrackPath !== "") {
    throw new Error("Music must be chosen with musicTrackId from the verified manifest; a musicTrackPath is not accepted.");
  }
  const hasTrackId = musicTrackId !== undefined && musicTrackId !== null && musicTrackId !== "";
  if (legacyPlaceholderMusic === true) {
    if (hasTrackId) throw new Error("A legacy placeholder run cannot also name a musicTrackId.");
    if (!isApprovedMusicPath(defaultPath)) {
      throw new Error(`Default music path "${defaultPath}" is outside the approved music folder.`);
    }
    return { path: defaultPath, track: null, placeholder: true };
  }
  if (!hasTrackId) throw new Error("A musicTrackId from the verified manifest is required.");
  const track = resolveTrack(manifest, String(musicTrackId));
  return { path: track.file, track: track, placeholder: false };
}

// The part of a track that the main app records and turns into the YouTube credit. Only verified,
// usable tracks reach this point (resolveTrack has already run).
export function musicSummary(track) {
  return {
    id: track.id,
    title: track.title,
    licence: track.licence,
    attributionRequired: track.attributionRequired === true,
    attribution: track.attributionRequired === true ? track.attribution : "",
    sourceUrl: track.sourceUrl
  };
}

// Validates a /jobs request body's music fields before anything is uploaded or started. Returns
// { ok: true, ... } with the normalised fields, or { ok: false, error } with a message that is safe
// to return to the caller.
export function validateMusicRequest(body, manifest) {
  const { musicTrackId, musicTrackPath, musicTrack, legacyPlaceholderMusic } = body || {};
  if (musicTrack !== undefined || musicTrackPath !== undefined) {
    return { ok: false, error: "Music is chosen with musicTrackId from the verified manifest; musicTrack and musicTrackPath are not accepted." };
  }
  if (legacyPlaceholderMusic !== undefined && typeof legacyPlaceholderMusic !== "boolean") {
    return { ok: false, error: "legacyPlaceholderMusic must be true or false." };
  }
  if (legacyPlaceholderMusic === true) {
    if (musicTrackId !== undefined) return { ok: false, error: "A legacy placeholder run cannot also name a musicTrackId." };
    return { ok: true, legacyPlaceholderMusic: true, track: null };
  }
  if (typeof musicTrackId !== "string" || musicTrackId.trim() === "") {
    return { ok: false, error: "musicTrackId from the verified manifest is required." };
  }
  try {
    const track = resolveTrack(manifest, musicTrackId.trim());
    return { ok: true, legacyPlaceholderMusic: false, musicTrackId: track.id, track: track };
  } catch (caught) {
    return { ok: false, error: `musicTrackId "${musicTrackId.trim().slice(0, 80)}" is not an approved track in the verified manifest.` };
  }
}

// Checks the downloaded music file itself, from ffprobe output, before any paid step. It must contain an
// audio stream and run at least minSeconds (the video length, so the track is never looped audibly).
export function validateMusicProbe(probe, { minSeconds }) {
  const streams = probe && Array.isArray(probe.streams) ? probe.streams : [];
  const audio = streams.find((s) => s && s.codec_type === "audio");
  if (!audio) throw new Error("Music file has no audio stream.");
  const duration = Number(probe.format && probe.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Music file has no readable duration.");
  if (duration < minSeconds) {
    throw new Error(`Music file is ${duration.toFixed(1)} s, shorter than the ${minSeconds.toFixed(1)} s video.`);
  }
  return { durationSeconds: duration, codec: audio.codec_name || "unknown", sampleRate: Number(audio.sample_rate) || 0 };
}

// Before any paid step (narration, alignment, images), confirm the music object exists in storage.
// existsFn(path) resolves to true or false. A missing object fails the job here, with a clear reason.
export async function preflightMusic({ path, existsFn }) {
  if (!isApprovedMusicPath(path)) {
    throw new Error(`Music path "${path}" is outside the approved music folder.`);
  }
  let exists;
  try {
    exists = await existsFn(path);
  } catch (caught) {
    throw new Error(`Music object "${path}" could not be checked: ${caught.message}`);
  }
  if (exists !== true) throw new Error(`Music object "${path}" does not exist or is not accessible.`);
  return path;
}
