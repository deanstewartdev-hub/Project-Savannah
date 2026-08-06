# savannah-media-worker

Cloud Run service that replaces Creatomate in Project Savannah's render pipeline. Node 22
+ FFmpeg. See `SAVANNAH_AUDIT_AND_PLAN.md` at the repo root and [ROADMAP.md](../ROADMAP.md)
(v1.4) for why this exists.

## Pipeline

1. **Narration** — one continuous ElevenLabs take for the whole script (not one call per
   beat), so prosody doesn't reset at every scene boundary.
2. **Alignment** — OpenAI Whisper word-level timestamps on that single narration file.
   Beat boundaries and captions are derived from these timestamps instead of an estimated
   words-per-second rate.
3. **Visuals** — per beat, a Pexels portrait video search; if nothing suitable comes back,
   a `gpt-image-2` still with a Ken Burns push as fallback.
4. **Assembly** — FFmpeg: crossfaded beats, word-pop captions burned in from the alignment
   data, a music bed sidechain-ducked under the narration, loudnorm to −14 LUFS, encoded
   1080×1920 H.264.
5. **Probe** — ffprobe plus silencedetect/blackdetect/loudnorm read the *finished file*,
   not the request that produced it.
6. **Deliver** — upload to GCS, generate a signed URL, POST the result to the caller's
   `callbackUrl`.

## Job API

`POST /jobs` (Authorization: `Bearer <JOB_SUBMIT_SECRET>` if that env var is set)

```json
{
  "jobId": "optional, generated if omitted",
  "beats": [
    { "text": "narration for this beat", "visualQuery": "pexels search terms", "imagePrompt": "fallback still prompt" }
  ],
  "musicTrackPath": "optional GCS object path, defaults to DEFAULT_MUSIC_TRACK_PATH",
  "callbackUrl": "https://script.google.com/macros/s/.../exec"
}
```

Responds `202 { jobId, status: "queued" }` immediately. The pipeline then runs in the
background and POSTs the result to `callbackUrl` exactly as given — Apps Script web apps
can't read custom request headers in `doPost`, so `callbackUrl` itself must already carry
whatever the caller needs to authenticate the callback (Apps Script embeds a secret in its
own query string and re-checks it on the way back in; see `VideoProcessingProvider.js`):

```json
{
  "jobId": "...",
  "status": "completed",
  "video": { "url": "signed GCS URL", "gcsPath": "renders/<jobId>/final.mp4", "durationSeconds": 47.2, "width": 1080, "height": 1920 },
  "probe": { "silences": [], "blackFrames": [], "loudness": { "integratedLufs": -14.1 }, "clippingDetected": false, "passesResolutionGate": true, "passesSilenceGate": true, "passesBlackFrameGate": true, "reportUrl": "signed GCS URL to full probe-report.json" }
}
```

or, on failure: `{ "jobId": "...", "status": "failed", "error": { "message": "..." } }`.

Apps Script's `RenderQualityService` should read `probe`, not `video`, when deciding
whether a render passes — that's the whole point of moving quality checks onto the
rendered file.

## Local development

```bash
npm install
cp .env.example .env   # fill in API keys and GCS_BUCKET
npm run dev
```

`GOOGLE_APPLICATION_CREDENTIALS` should point at a service account key with Storage Object
Admin on `GCS_BUCKET` for local runs. On Cloud Run, omit it and grant the role to the
service's runtime service account instead.

## Deploying to Cloud Run

```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/savannah-media-worker
gcloud run deploy savannah-media-worker \
  --image gcr.io/<PROJECT_ID>/savannah-media-worker \
  --region <REGION> \
  --cpu 2 --memory 2Gi \
  --timeout 900 \
  --no-cpu-throttling \
  --set-env-vars GCS_BUCKET=savannah-media,DEFAULT_MUSIC_TRACK_PATH=music/default-bed.mp3 \
  --set-secrets OPENAI_API_KEY=openai-api-key:latest,ELEVENLABS_API_KEY=elevenlabs-api-key:latest,ELEVENLABS_VOICE_ID=elevenlabs-voice-id:latest,PEXELS_API_KEY=pexels-api-key:latest,JOB_SUBMIT_SECRET=job-submit-secret:latest
```

`--no-cpu-throttling` is not optional: `/jobs` responds before the pipeline finishes, and
the render work happens after the HTTP response is sent. Cloud Run only keeps CPU
allocated to a background task like that when throttling is disabled — without this flag
the instance can be frozen mid-render.

## What isn't here yet

Retries, concurrency limits, and a dead-letter state are v1.5 work (see ROADMAP.md) — this
is deliberately a single-attempt-per-job v1.4 scaffold, matched to "prove one genuinely
good Short end to end" rather than production-grade queueing.
