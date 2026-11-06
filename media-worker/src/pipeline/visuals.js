import { writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../config.js";
import { planBeatVisuals } from "./visualSelection.js";
import { beatRenderSeconds } from "./beatTiming.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

async function searchPexelsVideos(query) {
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  // "medium" (Full HD) not "large" (4K) - the final output is 1080x1920, so a 4K source
  // just costs extra decode/scale memory and CPU on the render worker for no visual gain.
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", "8");

  const response = await fetch(url, {
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

async function generateFallbackStill(prompt, destPath) {
  const result = await openai.images.generate({
    model: "gpt-image-2",
    prompt,
    size: "1024x1536"
  });
  const b64 = result.data[0].b64_json;
  await writeFile(destPath, Buffer.from(b64, "base64"));
  return destPath;
}

// Resolves every beat's visual in two steps. First, a plan: each beat tries its location-
// specific query variants and keeps only Pexels clips that pass the relevance gate, with no
// clip reused across beats. Second, the chosen files are fetched and any labelled AI stills
// are generated. A beat with no acceptable footage either fails the job with a visual-coverage
// error or, when allowAiStills is set, becomes a still that is labelled as AI-generated.
export async function resolveBeatVisuals(beats, workDir, { allowAiStills = false, log = () => {}, narrationSeconds } = {}) {
  // Each beat must be covered for the length assemble.js will render it at: its span on the full
  // narration timeline (speech plus the pauses that belong to it) plus the crossfade into the next beat.
  // Both sides use beatRenderSeconds, so the planner asks for exactly the footage the assembler needs.
  if (!Number.isFinite(narrationSeconds)) {
    throw new Error("resolveBeatVisuals needs the narration length to plan footage.");
  }
  const coverage = beatRenderSeconds(beats, narrationSeconds, config.video.crossfadeSeconds);
  const withCoverage = beats.map((beat, index) => ({ ...beat, coverSeconds: coverage[index] }));
  const plan = await planBeatVisuals(withCoverage, searchPexelsVideos, { allowAiStills });

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
            reason: segment.reason
          });
        }
        return { type: "video", segments };
      }
      const localPath = workDir.path(`beat-${entry.beatIndex}-still.png`);
      await generateFallbackStill(entry.prompt, localPath);
      return { type: "still", path: localPath, synthetic: true, label: entry.label, queriesTried: entry.queriesTried };
    })
  );
}
