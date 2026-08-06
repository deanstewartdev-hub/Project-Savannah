# Changelog

Notable changes to Project Savannah. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — v1.4 Professional Output (in progress)

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
