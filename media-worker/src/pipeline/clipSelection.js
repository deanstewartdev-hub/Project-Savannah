// Judging and choosing one Pexels clip for a beat: relevance evidence from the clip's metadata,
// portrait or landscape-crop framing, and the scoring that picks the best acceptable clip.
// Pure: no network, no filesystem. Pexels metadata is supporting evidence only, not proof of location.
// Split out of visualSelection.js (modular refactor, November 2026); the code is unchanged.
// Import from visualSelection.js, which re-exports this module's public names.
import { tokenize, deriveKeywords, shotWordsFor } from "./visualQueries.js";

// Landscape footage (16:9) is centre-cropped to 9:16 by the assembler. Its effective resolution is the
// width of that crop in source pixels, scaled up to the 1080-pixel output width. A crop that would need
// more than MAX_CROP_UPSCALE times upscaling (for example 720p source) is refused.
const OUTPUT_WIDTH = 1080;
export const MAX_CROP_UPSCALE = 1.8;
const LANDSCAPE_ASPECT_MIN = 1.7;
// 1.95:1 admits 2048x1080 (1.90:1) footage from Pexels. The 9:16 centre crop keeps (9/16) / aspect of the
// frame's width: 28.8% at 1.95:1. A crop keeping less than MIN_KEPT_WIDTH_FRACTION cuts out too much of the
// frame, so it is refused.
const LANDSCAPE_ASPECT_MAX = 1.95;
export const MIN_KEPT_WIDTH_FRACTION = 0.28;
// A landscape clip must be clearly more relevant than a portrait one to be chosen over it.
const LANDSCAPE_PENALTY = 3;

// Pexels video URLs end in "<slug>-<id>", e.g. ".../charming-streets-of-chefchaouen-34499594".
export function slugTokens(url) {
  const path = String(url || "").split("?")[0].replace(/\/+$/, "");
  const slug = path.split("/").pop().replace(/-\d+$/, "");
  return tokenize(slug.replace(/-/g, " "));
}

export function evidenceFor(video, beat) {
  const tokens = new Set([...slugTokens(video.url), ...tokenize(video.user && video.user.name)]);
  const place = tokenize(beat.location);
  const keywords = deriveKeywords(beat);
  const locationMatch = place.length === 0 ? null : place.every((word) => tokens.has(word));
  const matchedKeywords = keywords.filter((word) => tokens.has(word));
  const shotMatches = shotWordsFor(beat).filter((word) => tokens.has(word)).length;
  return { locationMatch, matchedKeywords, keywordCount: keywords.length, shotMatches };
}

// Decides whether one Pexels result is acceptable for a beat. A location is required when
// the beat names one; otherwise at least two subject words must appear in the metadata.
export function judgeVideo(video, beat) {
  const evidence = evidenceFor(video, beat);
  const hasPlace = evidence.locationMatch !== null;
  const subjectHits = evidence.matchedKeywords.length;
  const subjectNeeded = Math.min(2, evidence.keywordCount);
  // The first keyword is the scene's main subject (for example "blue"). Matching only a
  // secondary word such as "street" lets in clips of the wrong subject, so a clip must match
  // the main subject or at least two subject words.
  const primaryHit = evidence.keywordCount > 0 && evidence.matchedKeywords.includes(deriveKeywords(beat)[0]);
  const accepted = hasPlace
    ? evidence.locationMatch && (evidence.keywordCount === 0 || primaryHit || subjectHits >= 2)
    : subjectHits >= subjectNeeded && subjectNeeded > 0;
  return { accepted, evidence, reason: explain(evidence, hasPlace, accepted, beat) };
}

function explain(evidence, hasPlace, accepted, beat) {
  const place = hasPlace
    ? (evidence.locationMatch ? "place name found" : "place name missing")
    : "no place required";
  const subject = evidence.matchedKeywords.length + " of " + evidence.keywordCount + " subject words found";
  const verdict = accepted ? "accepted" : "rejected";
  return verdict + ": " + place + "; " + subject + " (Pexels metadata is supporting evidence, not proof of location)";
}

function portraitFile(video) {
  const files = (video.video_files || [])
    .filter((f) => f.height > f.width && f.file_type === "video/mp4")
    .sort((a, b) => a.width - b.width);
  return files.find((f) => f.width >= 1080) || files[files.length - 1] || null;
}

// The best 16:9 landscape file that can be centre-cropped to 9:16 without exceeding MAX_CROP_UPSCALE.
// Returns null when no file qualifies (wrong aspect ratio, or too low a resolution for a clean crop).
export function landscapeCropFile(video) {
  let best = null;
  for (const file of video.video_files || []) {
    if (file.file_type !== "video/mp4" || !(file.width > file.height)) continue;
    const aspect = file.width / file.height;
    if (aspect < LANDSCAPE_ASPECT_MIN || aspect > LANDSCAPE_ASPECT_MAX) continue;
    const cropWidth = (file.height * 9) / 16; // source pixels in the 9:16 centre crop
    const upscale = OUTPUT_WIDTH / cropWidth;
    if (upscale > MAX_CROP_UPSCALE) continue;
    const keptWidthFraction = (9 / 16) / aspect;
    if (keptWidthFraction < MIN_KEPT_WIDTH_FRACTION) continue;
    if (!best || upscale < best.upscale) best = { file, upscale, cropWidth, keptWidthFraction };
  }
  return best;
}

// How a clip can be used: portrait as it is, or (only when allowed) a landscape clip centre-cropped.
export function framingFor(video, allowLandscape) {
  const portrait = portraitFile(video);
  if (portrait) return { file: portrait, framing: "portrait", cropUpscale: null };
  if (!allowLandscape) return null;
  const landscape = landscapeCropFile(video);
  return landscape
    ? { file: landscape.file, framing: "landscape-crop", cropUpscale: landscape.upscale, keptWidthFraction: landscape.keptWidthFraction }
    : null;
}

// Chooses the best acceptable, not-yet-used clip from one query's results. Returns null when
// nothing qualifies, which makes the caller try the next query variant.
// avoidUploaders: uploaders of the previous scene's footage. A clip from the same uploader is only
// chosen when nothing else qualifies, so consecutive scenes come from different sources.
// allowLandscape: also accept 16:9 clips that pass the crop checks (portrait clips are still preferred).
export function selectClip(videos, beat, usedIds, minSeconds = 0, avoidUploaders = null, avoidTokens = null, allowLandscape = false) {
  let best = null;
  for (const video of videos || []) {
    if (usedIds.has(video.id)) continue;
    if (Number(video.duration) < minSeconds) continue;
    const framing = framingFor(video, allowLandscape);
    if (!framing) continue;
    const judgement = judgeVideo(video, beat);
    if (!judgement.accepted) continue;
    const uploader = video.user && video.user.name ? String(video.user.name) : "";
    const repeatsUploader = avoidUploaders && uploader && avoidUploaders.has(uploader);
    // Near-identical footage: most of this clip's descriptive words also describe the previous scene.
    const tokens = slugTokens(video.url);
    const overlap = avoidTokens && tokens.length
      ? tokens.filter((t) => avoidTokens.has(t)).length / tokens.length
      : 0;
    const nearDuplicate = overlap >= 0.5;
    const score = (judgement.evidence.locationMatch ? 10 : 0) +
      judgement.evidence.matchedKeywords.length +
      judgement.evidence.shotMatches -
      (framing.framing === "landscape-crop" ? LANDSCAPE_PENALTY : 0) -
      (nearDuplicate ? 4 : 0) -
      (repeatsUploader ? 5 : 0);
    if (!best || score > best.score) {
      best = { score, video, framing, uploader, reason: judgement.reason };
    }
  }
  if (!best) return null;
  const reason = best.framing.framing === "landscape-crop"
    ? best.reason + "; landscape footage centre-cropped to 9:16 (crop upscale " + best.framing.cropUpscale.toFixed(2) + "x, keeps " +
      Math.round(best.framing.keptWidthFraction * 100) + "% of the width)"
    : best.reason;
  return {
    type: "video",
    pexelsId: best.video.id,
    link: best.framing.file.link,
    sourceUrl: best.video.url,
    sourceDurationSeconds: best.video.duration,
    uploader: best.uploader,
    tokens: slugTokens(best.video.url),
    framing: best.framing.framing,
    cropUpscale: best.framing.cropUpscale,
    reason
  };
}
