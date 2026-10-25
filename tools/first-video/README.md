# First controlled video: Chefchaouen, Morocco's blue city

Prepared 25 October 2026 for the first real render and private upload (`RELEASE_READINESS.md` §11). No paid API was
called to prepare it. It was checked against Savannah's own rules, locally:
- `Scripts/Script_Validator.js`: **valid**: 104 words (preferred range 100–120), 6 scenes, 55 s planned, 0 long sentences.
- The worker's `validateBeats`: **OK**. Expected narration is about **45–47 s** (measured pace 2.21–2.30 words per second).
- Pexels (free) with the worker's exact search settings: **all 6 scenes return genuine Chefchaouen portrait footage**,
  so the paid `gpt-image-2` fallback should not run. Short clips loop.
- Upload: private by default. The AI-voice disclosure is appended automatically (`Production/YouTube_Service.js`).

## Concept

**Title:** Why Is This Moroccan Town Painted Blue?
**Angle:** a calm, curious explainer. The town's founding is fact (1471, a mountain fortress). The reason for the blue is
**presented as disputed**, as the channel's voice rules require: a popular 1930s story, plus the practical and
aesthetic explanations locals give. No claim is stated as settled.

The full script is `chefchaouen-script.json`, in the exact shape `ScriptValidator.validate` accepts. Each scene's
`visualDirection` is the Pexels query the worker uses verbatim.

## How to use it in the real workflow (owner)

The app always generates scripts with AI from an approved idea; there is no "paste a script" screen. To keep the
first run on this topic:

1. In the production spreadsheet's **Ideas** tab, add one row. Leave every other row untouched.

   | ID | Created At | Niche | Video Idea | Hook | Target Audience | Status | AI Model | Prompt Version | Run ID |
   |---|---|---|---|---|---|---|---|---|---|
   | `IDEA-C4EF1471` | today's date | *(copy the niche from an existing row)* | Why Chefchaouen, Morocco's blue city, is painted blue | In Morocco's Rif Mountains, a whole town is painted blue, and nobody agrees why. | *(copy from an existing row)* | `Approved` | `manual` | `manual` | `MANUAL-FIRST-VIDEO` |

2. **Scripts → Generate script** for that idea. This is one gpt-4o-mini call, well under 1p.
3. Compare the result with `chefchaouen-script.json`:
   - facts hedged, not invented;
   - 90–130 words;
   - 4–6 scenes;
   - visual directions that name Chefchaouen. Generic directions such as "colourful street" can pull footage of
     another country, as testing found.

   Regenerate if needed (each try is under 1p), then send it for review and approve it.
4. SEO, render, review and the private upload follow `LIVE_ACCEPTANCE.md`.

If you would rather skip steps 1–3 and not use AI for the script at all, that needs a small "import a reviewed script"
feature. That is deliberately **not** built (out of scope); say so if you want it.

## Expected cost of this video

| Item | Estimate |
|---|---|
| Script and SEO generation (gpt-4o-mini, 2–3 calls) | under £0.01 |
| ElevenLabs narration (635 characters, `eleven_multilingual_v2`) | about 635 credits from your plan (about 2% of a 30,000-credit month) |
| Whisper word timing (about 47 s) | under £0.01 |
| Pexels footage | free |
| Cloud Run render (August renders took about 2.5 min on 2 vCPU / 2 GiB) | about £0.01, likely inside the free tier |
| YouTube private upload | free |
| **Total** | **about £0.05 plus 635 ElevenLabs credits.** A re-render repeats the narration, timing and render costs |
