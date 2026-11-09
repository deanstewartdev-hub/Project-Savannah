import { writeFile } from "node:fs/promises";
import { config } from "../config.js";

// The request body for the single narration call. Kept separate so it can be checked without any network call.
export function narrationRequestBody(fullScript, narration = config.narration) {
  return {
    text: fullScript,
    model_id: narration.modelId,
    voice_settings: {
      stability: narration.stability,
      similarity_boost: narration.similarityBoost,
      style: narration.style,
      use_speaker_boost: narration.useSpeakerBoost
    }
  };
}

// Generates the ENTIRE narration in a single ElevenLabs call so prosody carries across
// the whole script. Per-scene generation (one call per beat, concatenated after) is what
// produced the audible pitch resets in the Creatomate-era pipeline — see section 2.2 of
// SAVANNAH_AUDIT_AND_PLAN.md.
export async function generateContinuousNarration(fullScript, workDir) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify(narrationRequestBody(fullScript))
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs narration request failed (${response.status}): ${detail}`);
  }

  const audioPath = workDir.path("narration.mp3");
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(audioPath, buffer);
  return audioPath;
}
