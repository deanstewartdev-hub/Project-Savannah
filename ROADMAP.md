# Project Savannah Roadmap

Last updated: 3 August 2026
Live Apps Script deployment: version 78
Canonical branch: `sprint-3`

This roadmap was restructured following the 3 August 2026 audit
(`SAVANNAH_AUDIT_AND_PLAN.md`). The previous seven-phase framing measured progress by
feature checklist and put "51% complete" on a channel that hadn't yet published a video
worth showing anyone. It has been replaced by three concrete releases, each with a
success condition instead of a percentage. Phases 5 through 7 (intelligent automation,
multi-channel, enterprise) are parked in [FUTURE.md](FUTURE.md) — they are premature for
a channel at this stage and are not scheduled.

## Shipped foundation (Phases 1–4, historical)

Completed and in production:

- Apps Script layered architecture: controllers, services, models, repositories
- Google Sheets/Drive persistence, application shell, routing, design system
- Dashboard, Ideas, Scripts, Approval, SEO, Settings, and Production workspaces
- OpenAI provider abstraction, prompt libraries, logging, and cost records
- idea generation, script generation/repair/validation, approval queue
- SEO titles, descriptions, tags, hashtags, keywords
- OpenAI narration, measured duration, four-scene planning (superseded by v1.4, see below)
- Creatomate JSON generation, polling, and render history (removed in v1.4)
- YouTube authorization, metadata, private upload, scheduling
- error handling, retry classification, structured logs, duplicate/reconciliation guards
- render quality gate (currently request-payload based, rewritten in v1.4)
- publishing schedule rules, recurring cadence templates, one-hour conflict prevention
- YouTube read-only analytics: snapshots, growth deltas, channel-health score, CSV export

Known-outstanding items from this era that v1.4 does not replace on its own:

- authorize the background time trigger (needs the `script.scriptapp` OAuth scope — see
  [APPROVALS_REQUIRED.md](APPROVALS_REQUIRED.md))
- optional email notification after repeated unattended worker failures
- Apps Script API executable for CLI-driven test runs (optional, developer convenience)

## v1.4 — Professional Output

**Goal:** one Short that is genuinely good, produced end to end without manual
intervention — not one that merely passes the automated checklist.

Why this release exists: the platform's actual bottleneck was never Creatomate's
resolution clamp. It was the output shape — four still images held ~10s each, hard cuts,
no motion — which is what determines whether anyone watches, and it's also the exact
pattern YouTube's inauthentic-content policy targets at channel level. See section 1 of
`SAVANNAH_AUDIT_AND_PLAN.md` for the full reasoning.

Repository hygiene (no external dependencies):

- [x] Reconcile README/ROADMAP/Config.js onto `sprint-3`
- [x] Fix the ARCHITECTURE.md code fence and populate COMPONENT_LIBRARY.md
- [x] Split Phases 5–7 into FUTURE.md, restructure this file around releases
- [x] Add CHANGELOG.md

`savannah-media-worker` (Node 22 + FFmpeg) — **deployed and verified end to end** as of
7 August 2026, currently running on **Railway** (`project-savannah-production.up.railway.app`)
as a temporary bridge, not Cloud Run — Cloud Run's external HTTPS routing 404s due to a
Google-side platform bug (case #74041894/#74051643 with Google Cloud Support, unresolved).
See `CHANGELOG.md`'s 7 August entry for the three real bugs found and fixed via live
testing (healthcheck-triggered restarts, concurrent-ffmpeg OOM, oversized Pexels sources)
and `media-worker/README.md` → "Deploying to Railway" for the actual deploy steps:

- [x] Job submission endpoint + GCS bucket for assets and outputs
- [x] ElevenLabs narration as one continuous take (not four per-scene calls)
- [x] Whisper word-level alignment → caption timing and beat boundaries
- [x] Pexels video search per beat, `gpt-image-2` still + Ken Burns as fallback
- [x] FFmpeg assembly: variable-length beats, crossfades, word-pop captions, music bed
      with sidechain ducking, loudnorm to −14 LUFS, 1080×1920 H.264
- [x] ffprobe inspection: duration, resolution, silence, black/frozen frames, loudness
- [x] Signed-URL delivery + webhook callback into Apps Script

Apps Script adaptation:

- [x] Introduce `VideoProcessingProvider`, add `CloudRunFFmpegProvider` alongside the
      existing `CreatomateProvider` (default; switch back with
      `Secrets.setVideoProvider("creatomate")`)
- [x] Replace the hard-coded four-slot loop with a variable-length beat list, for the
      Cloud Run submission path (beats come straight from `script.scenes`)
- [x] Rewrite `RenderQualityService` to consume real probe results instead of the request
      payload, for jobs that carry one
- [ ] Downgrade the pre-flight duration estimate from a throw to a warning (only affects
      `ScenePlanService`, i.e. the legacy Creatomate path)
- [x] Move asset delivery from public Drive links to signed GCS URLs, for the worker's own
      render output
- [ ] Shrink the render queue to job submission + polling; retire per-scene resume,
      pause/cancel, and priority levels now that the worker has no six-minute ceiling
      (`ProductionTaskRepository`'s prepare-scene flow is still wired to the Creatomate
      path only and untouched — Cloud Run submission bypasses it entirely already)

**Still required before the v1.4 success condition is met:**

- **A full app-driven run has not yet been confirmed working, end to end.** A second real
  bug was found and fixed after the note above was first written: both Apps Script
  deployments had `Who has access: Only myself`, meaning the worker's callback could
  never reach `doPost` regardless of which host renders the video. Fixed by deploying
  Version 79 with `Who has access: Anyone`. But a script clicked through the app's own
  Production page (not the direct API test used to verify the worker itself) has not yet
  been observed completing and publishing to YouTube — see `CHANGELOG.md`'s "found and
  fixed a second real bug" entry for the full debugging trail and exact repro steps.
  **This is the current top-priority open item.**
- A real royalty-free music track (currently a silent placeholder — see
  `APPROVALS_REQUIRED.md`).
- Running a verified render against a real production script from the approval queue
  (all verified renders so far used either a hand-written two-line test script via the
  direct API, or hit a pre-existing duplicate-render guard when attempted through the UI).
- A side by side comparison against a Creatomate render before Creatomate is deleted.

Moving back from Railway to Cloud Run once Google Support resolves the routing bug is
v1.4-adjacent cleanup, not a blocker — the provider abstraction means it's a one-property
change
(`Secrets.setMediaWorkerUrl`).

**Success condition:** a new idea travels from generation to a verified private YouTube
upload with no manual database repair, and the finished video is one you'd show someone
without apologising for it. Creatomate is deleted from the codebase only after this bar
is met on a side-by-side comparison — see `APPROVALS_REQUIRED.md`.

## v1.5 — Reliability and Templates

- Authorize the background worker and daily analytics triggers
- Worker-side retries, concurrency limits, dead-letter state
- Thumbnail generation and selection workflow
- Template versioning (each job records which look it was produced under)
- Two or three genuinely distinct visual/pacing templates — the most direct mitigation
  against the inauthentic-content risk in section 1 of the audit

## v1.6 — Analytics and Feedback

- YouTube Analytics API ingestion for watch time and retention
- Cost per video / cost per thousand views joined against the `Costs` sheet
- Retention curves compared across template versions, hook patterns, and cut rates
- Decide, with real data, whether generated-motion clips (Runway/Kling/Veo/Sora) are worth
  their per-video cost — not before this point

## Longer term

Parked in [FUTURE.md](FUTURE.md): intelligent automation, multi-channel platform,
enterprise platform. Not scheduled.
