import { writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../config.js";
import { planBeatVisuals, coverageCandidates, matchedFlags, maxDistinctAssignment, memoizeSearch, VisualCoverageError } from "./visualSelection.js";
import { beatRenderSeconds } from "./beatTiming.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Pexels search URL for one query and orientation ("portrait" or "landscape"). Fifteen results per query
// (was eight): portrait-only search with eight results left too few relevant clips for some places.
export function pexelsSearchUrl(query, orientation = "portrait", perPage = 15) {
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error(`Unknown Pexels orientation: ${orientation}`);
  }
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", orientation);
  // "medium" (Full HD) not "large" (4K) - the final output is 1080x1920, so a 4K source
  // just costs extra decode/scale memory and CPU on the render worker for no visual gain.
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", String(perPage));
  return url;
}

async function searchPexelsVideos(query, orientation = "portrait") {
  const response = await fetch(pexelsSearchUrl(query, orientation), {
    headers: { Authorization: config.pexelsApiKey }
  });
  if (!response.ok) {
    throw new Error(`Pexels search failed (${response.status})`);
  }
  const data = await response.json();
  return data.videos || [];
}

async function downloadTo(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await writeFile(destPath, Buffer.from(await response.arrayBuffer()));
  return destPath;
}

export class AiStillLimitError extends Error {
  // lowerBound: the preflight counts only beats with no footage at all, so the true count may be higher.
  constructor(planned, limit, { lowerBound = false } = {}) {
    super(`This job needs ${lowerBound ? "at least " : ""}${planned} AI-generated stills; the limit is ${limit}. No images were generated.`);
    this.name = "AiStillLimitError";
    this.code = "AI_STILL_LIMIT";
    this.planned = planned;
    this.limit = limit;
  }
}

// Counts the planned AI stills and refuses the job before any image request if there are too many.
export function assertAiStillLimit(plan, limit) {
  const planned = plan.filter((entry) => entry.type === "still").length;
  if (planned > limit) throw new AiStillLimitError(planned, limit);
  return planned;
}

// Image requests never retry automatically. The OpenAI SDK retries failed requests by default (up to two
// extra attempts), and each extra attempt could be a billed image. The count limit is per plan, so retries
// must be off for these calls. Verified against the installed SDK (openai 4.104.0): request options override the client default.
export const IMAGE_REQUEST_OPTIONS = Object.freeze({ maxRetries: 0 });

// Generates one labelled AI still with the given client. Separate from the module client so it can be tested
// against a local server, with no call to OpenAI.
export async function generateStillWithClient(client, prompt, destPath) {
  const result = await client.images.generate(
    {
      model: "gpt-image-2",
      prompt,
      size: "1024x1536",
      quality: config.aiStills.quality
    },
    IMAGE_REQUEST_OPTIONS
  );
  const b64 = result.data[0].b64_json;
  await writeFile(destPath, Buffer.from(b64, "base64"));
  return destPath;
}

async function generateFallbackStill(prompt, destPath) {
  return generateStillWithClient(openai, prompt, destPath);
}

// A beat has a place when it names one, or, for a montage, when every part names one.
function beatHasPlace(beat) {
  if (Array.isArray(beat.montage) && beat.montage.length > 0) {
    return beat.montage.every((part) => String(part.location || "").trim());
  }
  return Boolean(String(beat.location || "").trim());
}

// Unpaid preflight, run before narration. Uses Pexels searches only (no ElevenLabs, Whisper or image calls).
// A beat with no relevant clip in any orientation would need a still whatever its timing, so such beats are
// counted here. Refuses the job when footage is missing and stills are not allowed, or when more beats are
// missing than the still limit allows. Beats that have candidates may still fail the duration check later.
export async function preflightVisualSupply(beats, {
  allowAiStills = false,
  search = searchPexelsVideos,
  stillLimit = config.aiStills.maxPerJob,
  landscapeFallback = config.footage.landscapeFallback,
  requireLocation = config.footage.requireLocation
} = {}) {
  // Location check first, before any Pexels request. A beat without a place cannot have its footage checked for
  // the place. Only a beat that is explicitly marked locationExempt (a generic intro or transition, set per beat
  // by the script) is allowed through. The rule itself stays on by default.
  if (requireLocation) {
    const missing = beats
      .map((beat, index) => ({ beat, index }))
      .filter(({ beat }) => !beat.locationExempt && !beatHasPlace(beat))
      .map(({ index }) => index);
    if (missing.length > 0) {
      throw new VisualCoverageError(
        `Beat ${missing[0] + 1} has no location, so its footage cannot be checked for the place. Add the location to the scene before rendering. Checked before any Pexels request or narration; nothing was generated.`,
        missing[0]
      );
    }
  }
  const coverage = await coverageCandidates(beats, search, { landscapeFallback });
  // Montage parts: every part needs its own clip, and a montage is never turned into a still. A part that cannot be
  // matched refuses the job, whatever allowAiStills says.
  const parts = coverage
    .filter((entry) => entry.montage)
    .flatMap((entry) => entry.parts.map((set) => ({ beatIndex: entry.beatIndex, set })));
  const partFlags = matchedFlags(parts.map((part) => part.set));
  const failedPart = parts.find((_, index) => !partFlags[index]);
  if (failedPart) {
    throw new VisualCoverageError(
      `Montage beat ${failedPart.beatIndex + 1} has a place with no distinct relevant clip. A montage is never turned into a still. Checked before narration; nothing was generated.`,
      failedPart.beatIndex
    );
  }
  // Lower bound on stills: the single-clip beats that cannot each get a different clip, matched among themselves.
  // Montage clips are not counted against them, so this can understate the stills. It counts candidate existence only,
  // not clip duration, framing, subject position or per-beat narration timing: a minimum, not a guarantee.
  const normal = coverage.filter((entry) => !entry.montage);
  const lowerBound = normal.length - maxDistinctAssignment(normal.map((entry) => entry.candidateIds));
  const unsupported = normal.filter((entry) => entry.candidateIds.size === 0);
  if (lowerBound === 0) return { stills: 0, lowerBound, stillLimit, unsupported };
  if (!allowAiStills) {
    const first = unsupported[0] || { beatIndex: 0, queriesTried: [] };
    const detail = unsupported.length
      ? `No relevant footage for beat ${first.beatIndex + 1} after queries: ${first.queriesTried.join(" | ")}.`
      : `${lowerBound} beat(s) cannot each get a different relevant clip, because footage is shared between beats.`;
    throw new VisualCoverageError(`${detail} Checked before narration; nothing was generated.`, first.beatIndex);
  }
  if (lowerBound > stillLimit) {
    throw new AiStillLimitError(lowerBound, stillLimit, { lowerBound: true });
  }
  return { stills: lowerBound, lowerBound, stillLimit, unsupported };
}

// One memoised Pexels search for a job: the unpaid preflight and the planner both use it.
export function createSharedPexelsSearch() {
  return memoizeSearch(searchPexelsVideos);
}

// Resolves every beat's visual in two steps. First, a plan: each beat tries its location-
// specific query variants and keeps only Pexels clips that pass the relevance gate, with no
// clip reused across beats. Second, the chosen files are fetched and any labelled AI stills
// are generated. A beat with no acceptable footage either fails the job with a visual-coverage
// error or, when allowAiStills is set, becomes a still that is labelled as AI-generated.
export async function resolveBeatVisuals(beats, workDir, {
  allowAiStills = false,
  log = () => {},
  narrationSeconds,
  search = searchPexelsVideos,
  generateStill = generateFallbackStill,
  stillLimit = config.aiStills.maxPerJob,
  landscapeFallback = config.footage.landscapeFallback
} = {}) {
  // Each beat must be covered for the length assemble.js will render it at: its span on the full
  // narration timeline (speech plus the pauses that belong to it) plus the crossfade into the next beat.
  // Both sides use beatRenderSeconds, so the planner asks for exactly the footage the assembler needs.
  if (!Number.isFinite(narrationSeconds)) {
    throw new Error("resolveBeatVisuals needs the narration length to plan footage.");
  }
  const coverage = beatRenderSeconds(beats, narrationSeconds, config.video.crossfadeSeconds);
  const withCoverage = beats.map((beat, index) => ({ ...beat, coverSeconds: coverage[index] }));
  const plan = await planBeatVisuals(withCoverage, search, { allowAiStills, landscapeFallback });
  // Fail before any image request if the plan needs more AI stills than this job may use.
  assertAiStillLimit(plan, stillLimit);

  return Promise.all(
    plan.map(async (entry) => {
      log(`visual beat ${entry.beatIndex + 1}: ${entry.type}${entry.synthetic ? " (AI, not footage)" : ""} - ${entry.reason || ""}`);
      if (entry.type === "video") {
        const segments = [];
        for (const [k, segment] of entry.segments.entries()) {
          const localPath = workDir.path(`beat-${entry.beatIndex}-seg-${k}.mp4`);
          await downloadTo(segment.link, localPath);
          segments.push({
            path: localPath,
            sourceDurationSeconds: segment.sourceDurationSeconds,
            pexelsId: segment.pexelsId,
            sourceUrl: segment.sourceUrl,
            query: segment.query,
            reason: segment.reason,
            framing: segment.framing,
            cropUpscale: segment.cropUpscale
          });
        }
        return { type: "video", segments };
      }
      const localPath = workDir.path(`beat-${entry.beatIndex}-still.png`);
      await generateStill(entry.prompt, localPath);
      return { type: "still", path: localPath, synthetic: true, label: entry.label, queriesTried: entry.queriesTried };
    })
  );
}
