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

## Full-HD replacement upload

Status: blocked by Creatomate plan decision.

The Creatomate dashboard reports:

- free trials are limited to low-resolution renders;
- 49 of 50 trial credits have been used.

The MP4 stream was independently verified at 270×480 even when the API requested a larger render scale. A paid Creatomate plan is required to unlock the template's native high-quality export. This is a spending decision and was not made automatically.

After upgrading, create one replacement at native 1× scale. Do not approve or upload it until Savannah reports at least 1080×1920 and the video has been watched for scene timing, narration continuity, subtitles, and visual relevance.

When it passes, upload it as **private** first. Public visibility remains a separate explicit decision.
