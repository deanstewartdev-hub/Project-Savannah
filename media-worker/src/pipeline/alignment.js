import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { config } from "../config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Word-level timestamps for the single continuous narration file. This is the mechanism
// that replaces the flat "2.0 words/second" estimate in the old ScenePlan_Service.js —
// cut points and captions are derived from where the words actually land, not guessed.
export async function alignNarration(audioPath) {
  const transcription = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"]
  });

  const words = (transcription.words || []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end
  }));

  if (words.length === 0) {
    throw new Error("Whisper alignment returned no word-level timestamps");
  }

  return words;
}
