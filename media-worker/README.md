# savannah-media-worker

Node 22 + FFmpeg service that replaces Creatomate in Project Savannah's render pipeline.
See `SAVANNAH_AUDIT_AND_PLAN.md` at the repo root and [ROADMAP.md](../ROADMAP.md) (v1.4)
for why this exists.

**Currently deployed on Railway, not Cloud Run** — Cloud Run's own deployment succeeds but
external HTTPS traffic 404s due to a Google-side platform bug (billing account
trial→paid upgrade broke a `SetIamPolicy` call; Google Cloud Support case #74041894,
unresolved as of 7 August 2026). Railway is a temporary bridge; both deploy paths below
are documented and the code is host-agnostic. See `../CHANGELOG.md`'s 7 August entry for
the full story, including three real bugs found via live testing on Railway that would
equally have hit Cloud Run once it's usable again.

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
service's runtime service account instead. On a host with no attached-identity metadata
server (e.g. Railway), set `GOOGLE_APPLICATION_CREDENTIALS_B64` instead — the same key
file, base64-encoded (`node -e "console.log(Buffer.from(require('fs').readFileSync('key.json')).toString('base64'))"`).
Raw JSON with embedded quotes and `\n`-escaped newlines is fragile to paste into plain
env-var UIs; base64 sidesteps that entirely. `storage.js` checks for the base64 variant
first and falls back to Cloud Run's ADC when neither is set.

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

## Deploying to Railway

This is the **currently active** deployment (see the note at the top of this file for
why). Root directory `media-worker/`, `railway.json` in this directory configures the
Dockerfile builder and restart policy — Railway's dashboard settings can override
config-as-code on existing services, so if behavior doesn't match `railway.json`, check
Settings → Build/Deploy in the dashboard directly.

**Do not set a healthcheck path.** `railway.json` deliberately has no
`deploy.healthcheckPath`. This is a single always-on worker, not a scaled HTTP service —
an active-container healthcheck almost certainly can't get scheduled promptly enough
while ffmpeg/Whisper are contending for CPU, so Railway marks the container unhealthy and
kills it mid-job under whatever restart policy is configured. This was root-caused via
live testing (see `../CHANGELOG.md`, 7 August 2026 entry) after jobs were silently
vanishing with zero error logs. If a health check is ever reintroduced (e.g. once this
runs on a higher tier with real headroom), verify a real job survives it before trusting
the deployment.

Environment variables (Railway dashboard → Variables, or Raw Editor for bulk paste):

- Same as Cloud Run's `--set-secrets` list (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
  `ELEVENLABS_VOICE_ID`, `PEXELS_API_KEY`, `JOB_SUBMIT_SECRET`) plus `GCS_BUCKET` and
  `DEFAULT_MUSIC_TRACK_PATH` as plain values.
- `GOOGLE_APPLICATION_CREDENTIALS_B64` — required (see "Local development" above for how
  to produce it). Without it, `storage.js` falls back to `new Storage()` with no
  credentials, which fails at the first GCS call, not at startup.
- No `PORT` — Railway injects its own; `config.js` already reads `process.env.PORT` with
  an 8080 fallback, so leave it unset rather than hard-coding 8080.

On Railway's memory-constrained trial tier, every ffmpeg call in `assemble.js` is capped
to `-threads 1 -preset veryfast` (`-filter_threads 1 -filter_complex_threads 1` on the
heavier final-assembly call), beat normalization runs sequentially rather than via
`Promise.all`, and `jobs.js` serializes job execution with an in-process promise-chain
queue — running N ffmpeg encodes concurrently multiplies peak memory by N, which gets the
process SIGKILLed (empty stdout/stderr is the tell — see `run()` in `src/lib/ffmpeg.js`
for how that gets surfaced instead of just "Command failed"). If this moves to a host
with real headroom, these caps are safe to relax but shouldn't be assumed unnecessary
without testing a full multi-beat job first.

## What isn't here yet

Retries and a dead-letter state are v1.5 work (see ROADMAP.md) — this is deliberately a
single-attempt-per-job v1.4 scaffold, matched to "prove one genuinely good Short end to
end" rather than production-grade queueing. Job execution *is* now serialized
(one-at-a-time, in-process promise chain in `jobs.js`) — that was added as an operational
fix for the memory-constrained Railway tier (see "Deploying to Railway" above), not as
planned v1.5 work arriving early; it's a simple FIFO with no priority, persistence across
restarts, or visibility into queue depth.
