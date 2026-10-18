# Single-channel release acceptance

Prepared 19 October 2026. This checklist distinguishes local verification from
the Google-hosted release. Passing local checks does not certify deployment.

## Verified locally

- [x] Parse 68 server files and 8 executable frontend blocks.
- [x] Pass 19 production hardening fixtures.
- [x] Pass 11 upload recovery integration fixtures using mocked Google APIs and persistence.
- [x] Preserve the one-hour publishing gap after recently elapsed slots.
- [x] Block duplicate uploads after ambiguous YouTube insert failures or failed persistence.
- [x] Reconnect one owned, tagged upload; keep missing or ambiguous matches blocked.
- [x] Add a CI workflow using `node Tests/run-local.cjs`.
- [x] Prepare the OAuth scope needed by the existing background worker.

## Required live verification

- [ ] Confirm the deployed version; historical documents disagree (61 versus 72).
- [ ] Authenticate clasp with the project owner's Google account; inspect deployments.
- [ ] Push the reviewed source, create a version, and update the existing deployment.
- [ ] Reauthorize the new trigger scope and enable the worker in Production.
- [ ] Run `runProductionHardeningTests()` in the Apps Script editor (19 fixtures).
- [ ] Load all workspaces and confirm existing Sheet data remains readable.
- [ ] Generate and approve one idea and script, generate SEO, prepare four scenes,
      and exercise pause/resume with persisted progress.
- [ ] Confirm Creatomate has sufficient credits and full-HD capability. The last
      recorded plan was a trial at 49/50 credits with 270×480 output; current
      billing and capacity have not been checked.
- [ ] Render one replacement and verify the actual MP4 is at least 1080×1920.
- [ ] Watch the video and approve narration, timing, captions, and scene relevance.
- [ ] Upload privately and confirm one matching video in YouTube Studio.
- [ ] Refresh YouTube status and capture an Analytics snapshot.
- [ ] Confirm one scheduled worker execution and disable it if unattended
      production is not desired after acceptance.

Reconciliation lookup uses up to five uploads-playlist pages (250 videos).
It does not establish absence, and legacy uploads lack the identifier.
Do not deliberately repeat paid uploads to test timeout behavior in production;
the local integration fixtures cover that failure path.

## Release recovery

Record the current Apps Script deployment version before updating it. If the
release fails smoke checks, redeploy that prior version and disable any newly
enabled production worker. Retain Sheet rows, private videos and cached assets.
Reconcile any upload with an unknown outcome before retrying. This change does
not alter worksheet column layouts.

Public publishing, advanced YouTube Analytics, thumbnails, and multi-channel
features are outside this private-upload acceptance milestone.
