import { writeFile } from "node:fs/promises";
import { config } from "../config.js";

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
      body: JSON.stringify({
        text: fullScript,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
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
