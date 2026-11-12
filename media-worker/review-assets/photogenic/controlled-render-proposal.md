# Controlled paid render: The Most Photogenic Places on Earth

Status: PROPOSAL ONLY. Not authorised. Nothing here has been deployed, rendered, narrated, generated or uploaded.
Planned maximum: £5 for one test render. This is a planning figure, not a provider-enforced cap (see section 8).

## 1. Checks (GitHub, branch `fix/photogenic-scene-metadata`, PR #32 draft on top of PR #31 draft)

- Code head checked: `706f6aa` (the commit that added this document changes review files only; the PR shows the final head).
- Validate Savannah: `app-checks` (Apps Script offline suite) and `media-worker` (360 of 360 worker tests) pass on the `pull_request` run.
- Local: worker 368 of 368; Apps Script montage 8 of 8; full Apps Script offline suite exits 0.
- CI fixes made on the branch: FFmpeg install (ChatGPT, unchanged), media-worker dependencies for the Apps Script runner, and curl portability in the chain test.

## 2. Exact script and scene metadata for the test

Script: `The Most Photogenic Places on Earth`, `SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef`, APPROVED (record version 3 observed). Narration, on-screen text, visual direction and estimated seconds are unchanged. The metadata is in `review-assets/photogenic/scene-metadata-proposal.json`.

| Scene | Planned source | Reviewed by |
|---|---|---|
| 1 Antelope Canyon, establishing | Labelled AI still (no verified footage) | — |
| 2 Antelope Canyon, sandstone close-ups | Labelled AI still (no verified footage) | — |
| 3 Burano, colourful houses | Pexels 29918560 (portrait) | contact sheet |
| 4 Santorini, aerial terraces | Pexels 38087413 (portrait) | contact sheet |
| 5 recap: Antelope → Burano → Santorini | Pexels 29510336 (4K landscape, 0.89x crop) / 29918561 / 32500600 | contact sheets |

Rejected after review: 16524527, 16524525, 16524530 (Horseshoe Bend labelled as Antelope Canyon); 31573932 (not clearly Santorini).

Decision needed before any render: whether scenes 1 and 2 may be labelled AI stills, given that no verified Antelope Canyon establishing or close-up footage exists in what I could find.

## 3. Footage coverage (final timing)

Measured with the worker's planner and preflight, free Pexels metadata only (18 search requests):

- Preflight lower bound: 2 stills. Planner: 2 stills. Limit: 2.
- Every footage segment covers its share: scene 3 (11 s for 10.87 s), scene 4 (14 s for 10 s), and each montage part (at least 7 s for 2.17 s).
- Caveat: these numbers use the saved `estimatedSeconds`. The render uses aligned beat timings, which change both the shares and the coverage. The check must be rerun on the aligned timings before rendering; the worker stops (does not loop footage) if coverage is short.

## 4. AI stills

Two, both labelled "AI-generated illustration, not authentic footage", at OpenAI medium quality, 1024×1536. The two-still maximum is enforced before any image request. Image requests have automatic retries off.

## 5. Itemised estimate (USD; GBP at a planning rate of 0.79, to be confirmed)

Prices from public pages checked on 12 November 2026 (see sources below). Planning values are upper estimates.

| Item | Basis | Estimate |
|---|---|---|
| Narration, ElevenLabs Eleven v4 | $0.08 per 1,000 characters; planning 1,000 characters | $0.080 |
| Alignment, OpenAI whisper-1 | $0.006 per minute; planning 1 minute of audio | $0.006 |
| AI stills, gpt-image-2 medium 1024×1536 | $0.041 per image × 2 | $0.082 |
| Render, Cloud Run Jobs (2 vCPU, 2 GiB, 5 min) | ~$0.0000216/vCPU-s and ~$0.0000024/GiB-s (London rate not confirmed; US rate lower) | $0.015 |
| Footage (Pexels API and downloads) | free | $0.000 |
| Storage and egress (GCS), dispatcher, callbacks | negligible at this size | < $0.01 |
| **Total planned** | | **≈ $0.19 ≈ £0.15** |

Contingency: doubling every line gives ≈ £0.30, still far below £5. Costs not included: ElevenLabs plan credits (the API rate applies only if billed per character), and any retry (none is permitted by the design).

## 6. Duplicate submissions, retries and unintended charges

What exists now:
- The dispatcher refuses a submission whose `jobId` already has a waiting request or a delivered video (`legacyDuplicate`), and it fails closed on storage errors.
- Cloud Run job retries are 0. OpenAI image requests use `maxRetries: 0`. The two-still limit is checked before any image request.
- Narration and alignment run before footage planning. The planner's refusals (missing montage place, still limit) happen after those charges. The unpaid preflight can refuse most bad scripts before ElevenLabs and Whisper, but it cannot prove the timed plan will pass.

What is not guaranteed (and failed on 10 November):
- Two separate clicks create two different `cr-` IDs, and the dispatcher only refuses the same `jobId`. The two accepted submissions 15 minutes apart were not blocked.

Required before the paid render (separate development and deployment approval):
1. The Apps Script sends one stable idempotency key per submit intent, stored in the Render Jobs row, and the dispatcher refuses any second submission for the same script and key, and any submission while a render for that script is QUEUED or RENDERING.
2. The single-render procedure below is followed exactly.

## 7. Deployment and rollback (not authorised; needs separate approval)

Deploy, in order:
1. Worker: build the media-worker image from the reviewed commit; create a candidate dispatcher revision with no traffic and the new allowlist; check `/health`, the unknown-track refusal and the montage validation; then move traffic. Render job: update the image only, keep `ELEVENLABS_MODEL_ID=eleven_v4` and voice secret version 2.
2. Apps Script: push the reviewed commit with clasp; create a new version; redeploy the existing web-app deployment to it. Record the previous version number.
3. Scripts: the metadata change is applied to the saved script only after a dry run shows the narration matches byte-for-byte, with a backup row written first (the same pattern as the Chefchaouen maintenance script).

Rollback:
- Worker: move dispatcher traffic back to the previous revision (`savannah-media-worker-dispatcher-00030-wam` at the time of writing) and set the render job image back to the previous digest (`sha256:576bb6de…`).
- Apps Script: redeploy the recorded previous version.
- Script metadata: restore from the backup row (restore dry run first).

## 8. Budget enforcement: what can and cannot be enforced

There is no provider-enforced £5 hard cap on this setup:
- Google Cloud budgets send alerts; they do not stop spending unless separate automation disables billing (not built).
- OpenAI: project usage limits can be set in the dashboard. This would be an owner action and is the strongest option for the image spend.
- ElevenLabs: a plan with a fixed monthly credit allowance acts as a practical cap (requests fail when credits run out). The owner needs to confirm the plan.

The £5 figure is therefore a planning ceiling: the planned cost is about £0.15, so the margin is large, but nothing technical stops a larger charge.

## 9. Single-render procedure (for when authorised)

1. Confirm the commit, CI and deployment state; confirm no render row for the script is QUEUED, PLANNED, SUBMITTING or RENDERING.
2. Confirm the scene metadata in the saved script matches the approved proposal, and the narration matches the saved text.
3. Generate one request ID (UUID v4) for this attempt and record it in the approval note before submitting.
4. Submit once from the production page, with AI stills allowed and automation paused. Do not click again.
5. Monitor the single execution. If it fails, stop: do not resubmit. Record the render ID, the execution ID and the error.
6. Review the finished video (narration, coverage, labels, music credit) before any upload. Upload is a separate approval.

## 10. Remaining risks

- Antelope Canyon coverage is weak (one verified clip); scenes 1 and 2 are AI stills and labelled as such.
- Estimated versus aligned timing; the recap shares are about 2.2 s and need a pacing check.
- Visual quality: the 4K Antelope clip crop keeps about 30% of the width.
- Duplicate-submission protection is not yet in place (section 6).
- Provider charges are estimates from public list prices; they are not measured from invoices.
- The sheet's error text for `RND-B375A60D` disagrees with its backend job, so sheet error columns should not be used to judge a render.
- The Request JSON client-request-ID and version values for the two earlier failed renders are still not read.

## Sources (prices, checked 12 November 2026)

- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api): Eleven v4 at $0.08 per 1,000 characters (confirmed on multiple third-party pages; check the official page before budgeting).
- [OpenAI gpt-image-2 price, medium 1024×1536 $0.041](https://yingtu.ai/en/blog/gpt-image-2-cost-per-image) (secondary source reproducing OpenAI's table; check OpenAI's pricing page).
- [OpenAI whisper-1, $0.006 per minute](https://developers.openai.com/api/docs/models/whisper-1) (official model page).
- [Cloud Run pricing](https://cloud.google.com/run/pricing) (Jobs rates; London tier not confirmed by search).
