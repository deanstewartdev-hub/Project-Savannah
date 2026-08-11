# Changelog

Notable changes to Project Savannah. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — v1.4 Professional Output (in progress)

### 11 August 2026 — Cloud Run dispatcher + render Job migration (infra provisioned and smoke-tested, not yet the live path)

**Why.** Two real renders were SIGKILLed on Railway (`cr-a8fc4832...`,
`cr-52423380...`, both `signal: SIGKILL, stderr: (empty)` — the OOM-kill signature)
despite every practical memory mitigation already in place (serialized job execution,
sequential beat normalization, `-threads 1`, `-filter_threads 1`/
`-filter_complex_threads 1`, `-preset veryfast`). Railway's plan hard-caps each replica
at 2 vCPU/1GB — there was no more headroom to reclaim by tuning; the fix is
infrastructure. Also verified (via a throwaway canary deploy) that the Google-side
routing bug blocking Cloud Run since the 7 August billing incident only affects Cloud Run
Services that existed *before* that incident — a brand-new Service is reachable
externally, which unblocked moving back to Cloud Run at all.

**What changed.** The single-Cloud-Run-service design is retired in favor of a
lightweight, always-responsive dispatcher (`savannah-media-worker-dispatcher`, a Cloud
Run Service) that validates + hands a job off, and a separate Cloud Run *Job*
(`savannah-render-job`, 2 vCPU/2Gi) that does the actual rendering with real memory
headroom, triggered via the Cloud Run Admin API and decoupled from any HTTP request
lifecycle. See `media-worker/README.md` → "Architecture: dispatcher + render Job" for the
full design. The render pipeline itself (`pipeline/runJob.js`, ffmpeg, narration,
alignment, visuals) is unchanged — this is purely an infrastructure split.

**Also found and fixed while wiring this up:**

- Cloud Run's platform layer silently intercepts `GET /healthz` before it reaches any
  container (confirmed via Cloud Logging: zero log entries for that exact path, while
  `/`, `/jobs`, and even `/readyz` on the same revision all route through and log
  normally). Worked around by adding `/health` as the real health-check path on both
  `dispatcher.js` and `server.js`, and pointing
  `VideoProcessingProvider.js#testConnection()` at it.
- `dispatcher.js`'s first deploy crashed on boot (`Missing required environment variable:
  OPENAI_API_KEY`) because `storage.js` imported the full `config.js`, whose
  `required()` throws synchronously at import time — but the dispatcher process
  intentionally has none of the render-only API keys. Fixed by decoupling `storage.js` to
  read `GCS_BUCKET`/`GOOGLE_APPLICATION_CREDENTIALS_B64` directly from `process.env`.

**Verified via infrastructure smoke tests (no paid API calls):** dispatcher `/health` →
200, unauthenticated `/jobs` → 401, IAM confirmed on the bucket/secrets/Job resource for
both service accounts, and a `DRY_RUN=true` Job execution against a synthetic
`job-requests/<id>.json` proved the full trigger → GCS write → Admin API → ADC → GCS read
→ clean exit path end to end.

**Not done yet:** no real render has been triggered through this path — that's a
separate, explicitly approval-gated next step. `MEDIA_WORKER_URL` still points at
Railway; cutover requires one manual Script Property change (no safe automated path
exists — see `APPROVALS_REQUIRED.md`). Railway itself is untouched and remains the
rollback path until a real Cloud Run render is verified end-to-end and compared against
the legacy result.

### 7 August 2026 (later) — found and fixed a second real bug: both Apps Script deployments were unreachable by the callback

**Status for whoever picks this up next (human or AI): the render pipeline is proven
end-to-end via direct API testing, but a full run *through the app's own UI* — click
"Create Short" or "Re-render safely" → render completes → publish to YouTube — has not
yet been observed succeeding. This is the next thing to verify. See "Open item" below.**

**The bug:** Apps Script web app deployments have a "Who has access" setting. Both the
`@HEAD` test deployment and the pinned production deployment (v78) were set to **"Only
myself"**. This means `handleMediaWorkerCallback_`/`doPost` can only be reached by a
request carrying Dean's own Google session — an unauthenticated server-to-server POST
(from Railway, or from Cloud Run once that's fixed) gets redirected to a generic Google
Drive "Sorry, unable to open the file at this time" error page (HTTP 401) instead of ever
reaching `doPost`. Confirmed directly in Railway's deploy logs: `postCallback` failures
showing that literal Drive error page as the response body.

**Why this matters:** without this fix, **no render job could ever complete from the
app's perspective**, regardless of whether Cloud Run or Railway is doing the actual
rendering — the worker would always finish the video successfully and then fail to tell
Apps Script about it. Every prior "verified working" claim in this file refers to the
worker pipeline itself (confirmed via direct `POST /jobs` calls with a manual dummy
`callbackUrl`), not the full app-driven flow.

**The fix:** created **Version 79** of the Apps Script deployment (same production URL,
`AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw`), running the
current `sprint-3` code with **"Who has access" set to "Anyone"**. The shared-secret
check already built into `handleMediaWorkerCallback_` (via the query-string secret
embedded in `callbackUrl_()` in `VideoProcessingProvider.js`) is what actually gates the
endpoint now — "Anyone" just means an unauthenticated request can *reach* the handler,
not that it can do anything without the correct secret.

**Open item — needs verification:** a script run through the app's own UI (Production
page → "Create Short" or "Re-render safely") has not yet been confirmed to complete and
publish to YouTube using the fixed deployment. Attempts so far were inconclusive:

- Most "Ready for production" scripts already have a completed render from the
  Creatomate era, which trips a pre-existing duplicate-render guard in
  `ProductionController.js` (`"This script already has a completed render. Use an
  explicit re-render action to replace it."`) before the job ever reaches the worker.
  The actual bypass is `retry({jobId})` (the "Re-render safely" button on a FAILED job
  card, which passes `forceRerender: true`) — this needs a script with an existing
  FAILED render job, e.g. "Raveena's Bold Escape Unveiled" or "Wild Travel Laws You
  Won't Believe!" (both failed under the old Creatomate provider with "Insufficient
  credits", visible in Production → Render and publishing jobs).
- A "Re-render safely" click was made on "Raveena's Bold Escape Unveiled" through the
  fixed (v79, "Anyone" access) deployment. Apps Script Execution logs confirm
  `productionStartPreparation`/`productionControlPreparation` ran. **But Railway's deploy
  logs show zero new activity since 02:55:21 that session** (checked ~22 hours later) —
  no new job ID, no new `postCallback` entry, nothing. This means the click either didn't
  fully register, or the resubmission stalled somewhere between scene preparation and
  actually calling `POST /jobs` on the worker. Root cause not yet found.

**To continue debugging this:** reproduce by opening the production URL above, scrolling
to a FAILED render job, clicking "Re-render safely", and watching **both** Apps Script's
Executions log (filter by function name, look for `productionRetryRender` or similar —
the exact RPC name wasn't confirmed) **and** Railway's Deploy Logs (filter for the job's
UUID once `submitCore_` logs it, or watch for a new `POST /jobs` hitting
`project-savannah-production.up.railway.app`) at the same time, end to end, without
navigating away. If scene preparation is required (old scripts may not have cached scene
assets compatible with the current pipeline), that alone takes several minutes per scene
(ElevenLabs/Whisper/Pexels calls) — don't conclude it's stuck until well past that.

### 7 August 2026 — media worker deployed to Railway, first verified end-to-end render

**Why Railway and not Cloud Run.** Cloud Run deployment succeeded (container healthy,
logs show `listening on port 8080`) but external HTTPS traffic 404s — traced via Cloud
Logging to a failed `SetIamPolicy` call around the billing account's trial→paid upgrade.
This is a Google-side platform bug, not something fixable from our end. Escalated to
Google Cloud Support (case #74041894, follow-up #74051643); no resolution as of this
writing. Railway is a **temporary bridge**, not a replacement decision — the plan is to
move back to Cloud Run once support resolves the routing bug. See
`media-worker/README.md` → "Deploying to Railway" for the actual deploy steps and the
operational gotchas below.

**GCS credentials made host-portable.** `storage.js` previously relied on Cloud Run's
attached-service-account metadata server (`new Storage()` with no args). Railway has no
equivalent, so `config.js` now accepts an inline service-account key via
`GOOGLE_APPLICATION_CREDENTIALS_B64` (base64-encoded — raw JSON with embedded quotes and
`\n`-escaped newlines proved fragile to paste into plain env-var UIs; base64 sidesteps
that entirely). Falls back to Cloud Run's ADC when unset, so this is additive, not a
Cloud Run regression.

**Three real bugs found via live testing on Railway, not theoretical:**

1. **Jobs vanishing with zero error logs.** Root cause: Railway's active-container
   healthcheck (`/healthz`) almost certainly can't get scheduled promptly enough while
   ffmpeg/Whisper are contending for CPU, so Railway marked the container unhealthy and
   restarted it under our own `ON_FAILURE` policy — killing whatever job was mid-flight,
   with no chance to log anything. Fixed by removing the healthcheck entirely
   (`railway.json`'s `deploy.healthcheckPath`) — this is a single always-on worker, not a
   scaled HTTP service, so the healthcheck bought nothing worth this cost. Confirmed by
   direct before/after observation: identical job, identical container, only the
   healthcheck config changed between a silent full-container restart and a clean,
   logged failure.
2. **`ffmpeg failed: SIGKILL`, empty stdout/stderr** (the OOM-kill signature) once the
   healthcheck stopped masking it. Root cause: `assemble.js` normalized every beat's clip
   **concurrently** via `Promise.all`, multiplying peak ffmpeg memory by beat count on a
   memory-constrained instance. Fixed by making beat normalization sequential, capping
   every ffmpeg call to `-threads 1 -preset veryfast` (and `-filter_threads 1
   -filter_complex_threads 1` on the heavier final-assembly call), and serializing job
   execution in `jobs.js` (an in-process promise-chain queue) so two `/jobs` requests can
   never run ffmpeg concurrently either.
3. **Requesting 4K Pexels sources for a 1080×1920 output.** `visuals.js` searched with
   `size=large` (4K) and always picked the single largest available rendition — pure
   waste of decode/scale memory for a 1080-wide final frame. Now requests `size=medium`
   and picks the smallest rendition that still clears 1080px wide.

**Result:** a real job (`manual-test-009`) completed the full pipeline — narration,
alignment, visuals, sequential normalize, final assembly, ffprobe quality gates, GCS
delivery — producing a genuine 1080×1920 MP4 that passed all three quality gates
(resolution, silence, black-frame) at −14.25 LUFS. This is the first video Project
Savannah has produced through the new pipeline, on any host.

**Also fixed:** `music/default-bed.mp3` didn't exist in the bucket at all (this was
explicitly deferred to Dean's taste — see `APPROVALS_REQUIRED.md`); uploaded a 60s silent
MP3 as a placeholder so testing could proceed. **Still needs a real royalty-free track.**

`Secrets.getMediaWorkerUrl()` now points at the Railway URL
(`https://project-savannah-production.up.railway.app`); `Secrets.getVideoProvider()`
still defaults to `"cloud-run"` (the provider name refers to the *shape* of the
integration — HTTP job submission + webhook callback — not literally Cloud Run as a
host, so no rename was needed).

### App UI overhaul

Restyled Dashboard/Production/SEO/Analytics/Settings around the shared
`.list-card`/`.progress-bar`/`.empty-state` components (previously a mix of leftover BEM
classes that didn't match the actual design system, rendering unstyled), reordered
navigation to match the production pipeline flow (Dashboard → Ideas → Scripts → Approval
→ SEO → Production → Analytics → Settings), and added a pipeline stepper to the
dashboard with ambient background motion (`prefers-reduced-motion` respected throughout).

### Changed

- Reconciled `README.md`, `ROADMAP.md`, and `Config.js` on `sprint-3` / Apps Script
  deployment version 78 (previously contradictory: README referenced `sprint-2`/v61,
  `Config.js` reported `VERSION: "1.0.0"` against v1.3 service headers).
- Restructured `ROADMAP.md` from a seven-phase completion-percentage framing to three
  concrete releases (v1.4, v1.5, v1.6), each with a success condition. Phases 5–7
  (intelligent automation, multi-channel, enterprise) moved to `FUTURE.md`.
- Rewrote `ARCHITECTURE.md` — the previous version had an unclosed code fence that
  swallowed the directory listing and truncated the rest of the document.
- Populated `COMPONENT_LIBRARY.md`, previously empty.

### Added

- `media-worker/`: a new Node 22 + FFmpeg Cloud Run service (`savannah-media-worker`)
  that replaces Creatomate. Continuous ElevenLabs narration, Whisper word-level
  alignment (beat timing and word-pop captions derived from it instead of an estimated
  words-per-second rate), Pexels video search with `gpt-image-2` + Ken Burns fallback,
  FFmpeg assembly (crossfades, burned-in captions, sidechain-ducked music bed, loudnorm
  to −14 LUFS), ffprobe/silencedetect/blackdetect quality probing, and GCS delivery with
  a signed URL and webhook callback. See `media-worker/README.md` for the job contract
  and deploy steps. **Not yet deployed or tested against real API keys or Cloud Run** —
  that's Dean, see `APPROVALS_REQUIRED.md`.
- `Production/VideoProcessingProvider.js`: provider abstraction with `CloudRunFFmpegProvider`
  (new default) and `CreatomateProviderAdapter` (wraps the existing `CreatomateService`
  unchanged). `ProductionController.js` now submits renders and polls status through this
  abstraction instead of calling `CreatomateService` directly.
- `Production/MediaWorkerCallback_Service.js` and a new `doPost` handler in `App/App.js`:
  receive `savannah-media-worker`'s completion webhook and update the render job record.
- `RenderQualityService` now evaluates real ffprobe/silence/black-frame/loudness results
  for jobs that have them (Cloud Run path), falling back to the original request-payload
  checks for Creatomate jobs.
- Three new Script Properties via `Services_Secrets.js`: `MEDIA_WORKER_URL`,
  `MEDIA_WORKER_SHARED_SECRET`, `VIDEO_PROVIDER`.

### Planned (rest of v1.4, see ROADMAP.md)

- Deploy the worker, wire up real API keys, and run one verified end-to-end render
  compared side by side against Creatomate before deleting `CreatomateProviderAdapter`.
- Downgrade `ScenePlanService`'s pre-flight duration estimate from a throw to a warning
  (legacy Creatomate path only).
- Shrink the render queue to job submission + polling; retire per-scene resume,
  pause/cancel, and priority levels in `ProductionTaskRepository` now that the worker has
  no six-minute ceiling to work around.

## Earlier history

Prior work (Apps Script foundation through Phase 4 analytics: idea/script/SEO pipeline,
Creatomate rendering, production hardening, YouTube publishing and analytics) predates
this changelog. See `git log` and the "Shipped foundation" section of `ROADMAP.md` for a
summary.
