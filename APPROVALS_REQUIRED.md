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

## Media worker deployment (v1.4)

Status: **deployed and verified working**, on Railway rather than Cloud Run (see below).
Remaining item needs Dean's judgment/taste, not an account or spending decision.

Per `SAVANNAH_AUDIT_AND_PLAN.md`, Creatomate is not being upgraded — its trial resolution
clamp was a symptom, not the real problem. `Production/VideoProcessingProvider.js` and
`media-worker/` are built, deployed, and have produced a real, quality-gate-passing video
end to end (7 August 2026).

Completed:

1. ~~Google Cloud billing account enabled~~ — done, but see "Cloud Run is currently
   broken" below.
2. ~~ElevenLabs Creator plan + API key~~ — done.
3. ~~Pexels API key~~ — done.
4. ~~Deploy `media-worker/`~~ — done, on **Railway** (see `media-worker/README.md` →
   "Deploying to Railway"). `Secrets.getMediaWorkerUrl()` points at
   `https://project-savannah-production.up.railway.app`; `Secrets.getVideoProvider()`
   defaults to `"cloud-run"` (that name refers to the HTTP-job-submission integration
   shape, not literally the Cloud Run host).
5. Music track — **placeholder only.** A 60-second silent MP3 was uploaded to
   `gs://savannah-media/music/default-bed.mp3` purely to unblock end-to-end testing (a
   real render needs *something* there or the job fails outright). **This still needs
   Dean:** curate 10–20 royalty-free tracks from the YouTube Audio Library, pick one as
   the new default, upload to `GCS_BUCKET`, and point `DEFAULT_MUSIC_TRACK_PATH` at it.

### Cloud Run is currently broken (Google-side, not ours to fix)

Cloud Run deployment itself succeeds — container healthy, logs show `listening on port
8080` — but external HTTPS traffic 404s. Traced via Cloud Logging to a failed
`SetIamPolicy` call around the billing account's trial→paid upgrade. Escalated to Google
Cloud Support: case **#74041894**, follow-up **#74051643**. No resolution as of 7 August
2026, past their stated 24–48h window. This is why the worker currently runs on Railway
instead — a temporary bridge, not a replacement decision. Moving back once support fixes
the routing bug is a one-line `Secrets.setMediaWorkerUrl()` change.

**Do not delete `Production/Creatomate_Service.js` or `CreatomateProviderAdapter`** until
a render has been produced end to end from a real production script (not just the
hand-written test script used to verify the pipeline) and watched side by side against a
Creatomate render — this is the explicit success condition for v1.4 in `ROADMAP.md`.
`Secrets.setVideoProvider("creatomate")` switches back if the worker path needs to be
paused without losing the ability to render at all.

**Note (11 August 2026, night):** the Cloud Run migration this section describes as
blocked is no longer blocked — a real render completed narration through FFmpeg
assembly through delivery on Cloud Run with no SIGKILL, `MEDIA_WORKER_URL` now points at
the dispatcher, and Railway is retained only as the rollback. This section's "Cloud Run
is currently broken" framing is stale and needs a fuller rewrite as separate follow-up
work - not done here to keep this cleanup pass scoped to what was asked.

## Media worker callback secret rotation

Status: **completed.**

`MEDIA_WORKER_SHARED_SECRET` (the Apps Script Script Property that authenticates the
media worker's callback, embedded in `callbackUrl_()`'s query string) had a copy of its
value pass through a command transcript during the Cloud Run migration's delivery
recovery work on 11 August 2026. That value was treated as compromised. Per
`HANDOFF.md`'s 11–13 August entry, a new random value was generated locally and the
corresponding Apps Script Script Property was updated and saved manually the same
session; `MEDIA_WORKER_CALLBACK_URL` was separately confirmed to still point at the
production `/exec` URL. Neither the old nor the current secret value is reproduced
here, in `HANDOFF.md`, in logs, or in tests.

(Reconciled 19 August 2026 — this section previously still said "waiting for
one-time manual action," which had drifted out of sync with `HANDOFF.md`'s own
"completed" status from two days earlier.)
