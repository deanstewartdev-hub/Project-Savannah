# savannah-media-worker

Node 22 + FFmpeg service that replaces Creatomate in Project Savannah's render pipeline.
See `SAVANNAH_AUDIT_AND_PLAN.md` at the repo root and [ROADMAP.md](../ROADMAP.md) (v1.4)
for why this exists.

**Currently deployed on Railway; a Cloud Run dispatcher + render Job pair is provisioned
and infra-smoke-tested but not yet the live path** (`MEDIA_WORKER_URL` still points at
Railway). The Google-side routing bug that originally blocked Cloud Run (billing account
trial→paid upgrade broke a `SetIamPolicy` call; Cloud Support case #74041894 →
#74051643, unresolved as of 11 August 2026) only affects Cloud Run *Services* that
existed before that billing change — a canary deploy and the new dispatcher service both
confirmed a **brand-new** Cloud Run Service is reachable externally. See "Architecture:
dispatcher + render Job" below for the current design, and `../CHANGELOG.md` for the
full story, including three real bugs found via live testing on Railway that equally
apply on Cloud Run.

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

## Architecture: dispatcher + render Job (Cloud Run)

A single Cloud Run *Service* running ffmpeg synchronously in the background after
responding (the original design below `--no-cpu-throttling` line, now obsolete) has the
same fragility Railway's healthcheck problem exposed: a platform that expects a request
handler to finish quickly doesn't mix well with a multi-minute render running after the
HTTP response is already sent. The Cloud Run path is now split into two resources instead:

- **`savannah-media-worker-dispatcher`** (Cloud Run *Service*, always responsive, 1
  vCPU/512Mi) — `src/dispatcher.js`. Auth + validates the request exactly like
  `routes/jobs.js` always has, writes it to `gs://<GCS_BUCKET>/job-requests/<jobId>.json`,
  triggers a `savannah-render-job` execution via the Cloud Run Admin API
  (`JobsClient.runJob()`, accepted-not-awaited — the call returns once the execution is
  scheduled, not once it finishes), and responds `202 { jobId, status: "queued" }`
  immediately. Never imports `pipeline/*` or any provider SDK, so it never needs
  `OPENAI_API_KEY`/`ELEVENLABS_API_KEY`/`PEXELS_API_KEY` just to boot.
- **`savannah-render-job`** (Cloud Run *Job*, not public, 2 vCPU/2Gi, `taskCount=1`,
  `parallelism=1`, `maxRetries=0`, 1200s timeout) — `src/job-runner.js`. Reads `JOB_ID`
  from its environment, downloads and deletes its GCS request object, calls the
  **unmodified** `runJob()`/`postCallback()` pipeline, exits 0/1. `maxRetries=0` is
  deliberate for now — a transient failure re-running the whole pipeline would silently
  duplicate OpenAI/ElevenLabs/Pexels API spend; revisit once there's real timing/failure
  data to reason from.

Both run from the same image (`Dockerfile` is unchanged — entrypoint selected at deploy
time via `--command`/`--args`, not baked in), reuse the same Secret Manager secrets as
Railway, and use attached service-account identities with no key files
(`savannah-dispatcher@…` and `savannah-render-job@…`, least-privilege: bucket
`storage.objectAdmin`, per-secret `secretAccessor`, and — dispatcher only —
`run.invoker` scoped to just the `savannah-render-job` resource).

```bash
gcloud builds submit --tag <REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO>/media-worker:<TAG> .

gcloud run jobs deploy savannah-render-job \
  --image <REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO>/media-worker:<TAG> \
  --region <REGION> --command node --args src/job-runner.js \
  --cpu 2 --memory 2Gi --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 1200 \
  --service-account savannah-render-job@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars "GCS_BUCKET=savannah-media" \
  --set-secrets "OPENAI_API_KEY=openai-api-key:latest,ELEVENLABS_API_KEY=elevenlabs-api-key:latest,ELEVENLABS_VOICE_ID=elevenlabs-voice-id:latest,PEXELS_API_KEY=pexels-api-key:latest,JOB_SUBMIT_SECRET=job-submit-secret:latest"

gcloud run deploy savannah-media-worker-dispatcher \
  --image <REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO>/media-worker:<TAG> \
  --region <REGION> --command node --args src/dispatcher.js \
  --cpu 1 --memory 512Mi --allow-unauthenticated \
  --service-account savannah-dispatcher@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars "GCS_BUCKET=savannah-media,CLOUD_RUN_PROJECT=<PROJECT_ID>,CLOUD_RUN_REGION=<REGION>,RENDER_JOB_NAME=savannah-render-job" \
  --set-secrets "JOB_SUBMIT_SECRET=job-submit-secret:latest"
```

`--allow-unauthenticated` on the dispatcher is safe: the app-level `Bearer
JOB_SUBMIT_SECRET` check in `requireAuth()` still gates `/jobs` exactly as it always has.
The render Job has no HTTP ingress at all — it can only be started via the Admin API by an
identity holding `run.invoker` on that specific Job resource.

**Known Cloud Run platform quirk:** `GET /healthz` is intercepted before it ever reaches
the container — confirmed via Cloud Logging (zero log entries for `/healthz`, while `/`,
`/jobs`, and even `/readyz` all route through and get logged normally on the same
revision). Root cause not fully diagnosed and not worth chasing further; the fix is to
not use that literal path. Both `dispatcher.js` and `server.js` serve `/health` (the real,
externally-reachable path) alongside the legacy `/healthz` (kept for back-compat, works
fine on Railway, silently unreachable on Cloud Run), and
`VideoProcessingProvider.js#testConnection()` calls `/health` for exactly this reason.

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
