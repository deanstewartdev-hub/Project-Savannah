// Background-music support. A track is used only when its manifest entry records where it came
// from, which licence applies, who verified it and when, and what attribution is required. No
// track is used on an unverified entry, and the default bed is used when no track is requested.
//
// Pure functions only (no file access), so they are testable without secrets or media files.

// Licences the owner has accepted for Shorts. Adding one is a policy decision, recorded in
// RELEASE_READINESS.md, not a code change made per track.
export const ALLOWED_LICENCES = Object.freeze({
  "CC0-1.0": { attributionRequired: false },
  "CC-BY-4.0": { attributionRequired: true },
  "Pixabay-Content-Licence": { attributionRequired: false },
  "YouTube-Audio-Library": { attributionRequired: false }
});

const REQUIRED_FIELDS = ["id", "file", "title", "licence", "sourceUrl", "verifiedBy", "verifiedOn"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Returns the list of problems with one manifest entry. An empty list means it may be used.
export function validateTrack(entry) {
  const problems = [];
  if (!entry || typeof entry !== "object") return ["entry is not an object"];
  for (const field of REQUIRED_FIELDS) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") problems.push(`${field} is required`);
  }
  const licence = ALLOWED_LICENCES[entry.licence];
  if (typeof entry.licence === "string" && entry.licence.trim() !== "" && !licence) {
    problems.push(`licence "${entry.licence}" is not on the allowed list`);
  }
  if (licence && licence.attributionRequired && (typeof entry.attribution !== "string" || entry.attribution.trim() === "")) {
    problems.push("attribution text is required for this licence");
  }
  if (typeof entry.verifiedOn === "string" && !ISO_DATE.test(entry.verifiedOn)) {
    problems.push("verifiedOn must be a YYYY-MM-DD date");
  }
  if (typeof entry.file === "string" && (entry.file.includes("..") || entry.file.startsWith("/") || /^[a-zA-Z]:/.test(entry.file))) {
    problems.push("file must be a relative path inside the music folder");
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

// Chooses the music file for a job. A verified track entry wins; an unverified entry is an error,
// never a silent fallback. Without a track, the existing path or the default bed is used.
export function chooseMusicSource({ musicTrack, musicTrackPath, defaultPath }) {
  if (musicTrack !== undefined && musicTrack !== null) {
    const problems = validateTrack(musicTrack);
    if (problems.length > 0) throw new Error(`Music track is not usable: ${problems.join("; ")}`);
    return { path: musicTrack.file, track: musicTrack };
  }
  return { path: musicTrackPath || defaultPath, track: null };
}
