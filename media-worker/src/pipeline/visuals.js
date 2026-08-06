import { writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

async function searchPexelsVideo(query) {
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", "5");

  const response = await fetch(url, {
    headers: { Authorization: config.pexelsApiKey }
  });
  if (!response.ok) {
    throw new Error(`Pexels search failed (${response.status})`);
  }
  const data = await response.json();

  for (const video of data.videos || []) {
    const portraitFiles = (video.video_files || [])
      .filter((f) => f.height > f.width && f.file_type === "video/mp4")
      .sort((a, b) => b.width - a.width);
    if (portraitFiles.length > 0) {
      return { link: portraitFiles[0].link, sourceDurationSeconds: video.duration };
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
