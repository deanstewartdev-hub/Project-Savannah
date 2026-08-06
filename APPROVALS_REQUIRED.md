# Approvals Required

These items were intentionally skipped so development could continue without waiting for Dean.

## GitHub authentication

Status: completed.

GitHub CLI is authenticated as `deanstewartdev-hub`. The verified `sprint-2` changes can now be committed, pushed, and tracked in a draft pull request.

## Google background queue worker

Status: waiting for one-time authorization.

The worker code is implemented, but Apps Script needs this additional OAuth scope before it can install a five-minute time trigger:

```text
https://www.googleapis.com/auth/script.scriptapp
```

After the scope is deliberately added to `appsscript.json` and deployed, Dean must reauthorize the app and select **Enable** in Production → Background automation.

Until then, browser-driven scene preparation remains operational and persistent; reopening Production resumes an interrupted task.

## Apps Script API executable

Status: optional developer authorization.

`clasp run runProductionHardeningTests` cannot execute because the project is not deployed as an Apps Script API executable. Local safe tests pass and the web app has been smoke-tested. Creating an API executable would allow command-line execution of safe server tests.

## Advanced YouTube Analytics

Status: optional Phase 4 authorization and Google Cloud setup.

The current Analytics workspace uses the already-authorized YouTube Data API and captures channel/video counts, views, likes, comments, duration, privacy, and growth snapshots.

Watch time, audience retention, subscriber gains by video, and revenue require enabling the YouTube Analytics API in the linked Google Cloud project and adding the appropriate read-only analytics scope. This was not enabled automatically because it changes Google service configuration and OAuth consent.

## Cloud Run media worker setup (v1.4)

Status: blocked on accounts and one deployment step. Not automatic because they involve
spending decisions and external service configuration.

Per `SAVANNAH_AUDIT_AND_PLAN.md`, Creatomate is not being upgraded — its trial resolution
clamp was a symptom, not the real problem. `Production/VideoProcessingProvider.js` and
`media-worker/` are built and default to the new provider, but need:

1. **Google Cloud billing account enabled** on the project that owns this Apps Script
   project, so `savannah-media-worker` can be deployed to Cloud Run and use Cloud Storage.
2. **ElevenLabs Creator plan** ($22/month) for continuous narration, and an API key.
3. **Pexels API key** (free) for stock footage search.
4. Deploy `media-worker/` to Cloud Run (see `media-worker/README.md`), then run, in the
   Apps Script editor:
   ```javascript
   Secrets.setMediaWorkerUrl("https://<cloud-run-url>");
   Secrets.setMediaWorkerSharedSecret("<same value as the worker's JOB_SUBMIT_SECRET>");
   ```
   `Secrets.getVideoProvider()` already defaults to `"cloud-run"` once these are set.
5. Curate 10–20 royalty-free music tracks from the YouTube Audio Library and upload them
   to the `GCS_BUCKET`; point `DEFAULT_MUSIC_TRACK_PATH` at one.

**Do not delete `Production/Creatomate_Service.js` or `CreatomateProviderAdapter`** until
a Cloud Run render has been produced end to end and watched side by side against a
Creatomate render — this is the explicit success condition for v1.4 in `ROADMAP.md`.
`Secrets.setVideoProvider("creatomate")` switches back if the Cloud Run path needs to be
paused without losing the ability to render at all.
