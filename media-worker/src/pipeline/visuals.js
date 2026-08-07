import { writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

async function searchPexelsVideo(query) {
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  // "medium" (Full HD) not "large" (4K) - the final output is 1080x1920, so a 4K source
  // just costs extra decode/scale memory and CPU on the render worker for no visual gain.
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", "5");

  const response = await fetch(url, {
    headers: { Authorization: config.pexelsApiKey }
  });
  if (!response.ok) {
    throw new Error(`Pexels search failed (${response.status})`);
  }
  const data = await response.json();

  for (const video of data.videos || []) {
    // Prefer the smallest rendition that still meets our 1080px target width, so we're
    // not decoding/scaling a needlessly large file for a 1080x1920 output. Falls back to
    // the largest available if nothing clears 1080 (rare, but better than no clip).
    const portraitFiles = (video.video_files || [])
      .filter((f) => f.height > f.width && f.file_type === "video/mp4")
      .sort((a, b) => a.width - b.width);
    const chosen = portraitFiles.find((f) => f.width >= 1080) || portraitFiles[portraitFiles.length - 1];
    if (chosen) {
      return { link: chosen.link, sourceDurationSeconds: video.duration };
    }
  }
  return null;
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

// Resolves one beat's visual: a real Pexels clip when a decent match exists, otherwise
// an AI still (Ken Burns motion is added later in assemble.js). This is the "hybrid"
// approach — real footage where it fits, AI stills as fallback, never the other way round.
export async function resolveBeatVisual(beat, index, workDir) {
  const match = await searchPexelsVideo(beat.visualQuery);
  if (match) {
    const localPath = workDir.path(`beat-${index}-source.mp4`);
    await downloadTo(match.link, localPath);
    return { type: "video", path: localPath };
  }

  const localPath = workDir.path(`beat-${index}-still.png`);
  await generateFallbackStill(beat.imagePrompt || beat.visualQuery, localPath);
  return { type: "still", path: localPath };
}
