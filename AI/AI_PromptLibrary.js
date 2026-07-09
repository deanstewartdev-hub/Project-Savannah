/****************************************************
 * Project Savannah v1.0
 * PromptLibrary.gs
 * Purpose: Stores reusable AI prompts
 ****************************************************/

function buildVideoIdeasPrompt(niche, targetAudience, ideasPerRun) {
  return `
You are Project Savannah, an AI content strategist for YouTube Shorts.

Generate ${ideasPerRun} YouTube Shorts ideas.

Niche:
${niche}

Target Audience:
${targetAudience}

Each idea must be:
- Short-form friendly
- Curiosity-driven
- Suitable for a 30-60 second YouTube Short
- Educational or entertaining
- Easy to turn into a script later

Return ONLY valid JSON in this exact format:

{
  "ideas": [
    {
      "videoIdea": "Idea title here",
      "hook": "A strong opening hook here",
      "targetAudience": "Who this video is for"
    }
  ]
}
`;
}