# Controlled paid render: The Most Photogenic Places on Earth

Status: PROPOSAL ONLY. Not authorised. Nothing here has been deployed, rendered, narrated, generated or uploaded.
Planned maximum: £5 for one test render. This is a planning figure, not a provider-enforced cap (see section 8).

## 1. Checks (GitHub, branch `fix/photogenic-scene-metadata`, PR #32 draft on top of PR #31 draft)

- Code head checked: `706f6aa` (the commit that added this document changes review files only; the PR shows the final head).
- Validate Savannah: `app-checks` and `media-worker` must both pass on the head of the PR (CI is re-run for each push; see the PR for the final head).
- Local at the time of writing: worker 385 of 385 (including new submission-idempotency, AI-still disclosure, motion and aligned-timing rehearsal tests); Apps Script montage 8 of 8; full Apps Script offline suite exits 0.
- CI fixes made on the branch: FFmpeg and DejaVu fonts installed in both jobs, media-worker dependencies for the Apps Script runner, and curl portability in the chain test. One Apps Script staging-safety test was updated for the new call shape of the render submission; its guard still sits directly before the call.

## 2. Exact script and scene metadata for the test

Script: `The Most Photogenic Places on Earth`, `SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef`, APPROVED (record version 3 observed). Narration, on-screen text, visual direction and estimated seconds are unchanged. The metadata is in `review-assets/photogenic/scene-metadata-proposal.json`.

| Scene | Planned source | Reviewed by |
|---|---|---|
| 1 Antelope Canyon, establishing | Labelled AI still (no verified footage) | — |
| 2 Antelope Canyon, sandstone close-ups | Labelled AI still (no verified footage) | — |
| 3 Burano, colourful houses | Pexels 29918560 and 29918559 (portrait, 11 s and 16 s; the second covers slow speech) | contact sheets |
| 4 Santorini, aerial terraces | Pexels 38087413 (portrait) | contact sheet |
| 5 recap: Antelope → Burano → Santorini | Pexels 29510336 (4K landscape, 0.89x crop) / 29918561 / 32500600 | contact sheets |

Rejected after review: 16524527, 16524525, 16524530 (Horseshoe Bend labelled as Antelope Canyon); 31573932 (not clearly Santorini).

Decision needed before any render: whether scenes 1 and 2 may be labelled AI stills, given that no verified Antelope Canyon establishing or close-up footage exists in what I could find.

## 3. Footage coverage (final timing)

Measured with the worker's planner and preflight, free Pexels metadata only (18 search requests):

- Preflight lower bound: 2 stills. Planner: 2 stills. Limit: 2.
- Every footage segment covers its share: scene 3 (11 s for 10.87 s), scene 4 (14 s for 10 s), and each montage part (at least 7 s for 2.17 s).
- Timing rehearsal (offline, `test/alignedTimingRehearsal.test.js`): the same plan was timed with synthetic word timings at 2.0, 2.3 and 2.6 words per second, using the saved estimates. At every rate: exactly two stills, scene 3 covered (both Burano clips at the slowest rate), scene 4 covered, the recap split evenly in the order Antelope, Burano, Santorini, no clip reused, and no rejected clip chosen. If scene 3 were pinned to its 11 s clip alone, the slowest rate needs a third still, which the still limit refuses before any image request.
- Caveat: the rehearsal uses synthetic words, because the approved narration text for every scene is not available in this session. The real alignment must be rechecked (the worker stops rather than looping footage if coverage is short).

## 4. AI stills

Two, at OpenAI medium quality, 1024×1536. The two-still maximum is enforced before any image request. Image requests have automatic retries off.

Disclosure on the picture (implemented and tested with real FFmpeg): every AI still carries a dark box with white text, "AI-GENERATED ILLUSTRATION", in the bottom third for its whole length. The font must exist on the render host (the CI installs DejaVu); without it the still is not rendered. Metadata alone is not treated as disclosure.

Motion: the Ken Burns zoom now reaches its end exactly at the end of the beat. The old rate stopped after about 4 seconds, which left a 9-second still frozen for its last 5 seconds. A test checks the picture still changes between 5 s and 8.5 s of a 9 s still.

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

Implemented on the worker (dispatcher, `src/lib/submitIntent.js`, tested in `test/submitIdempotency.test.js`, 10 tests):
- A submit intent (`submitIntentId`) is claimed with a create-only write. A replay of the same intent (double click, lost reply, refresh) returns the job it created and starts nothing.
- A script and render version (`scriptId` + `renderVersion`) is claimed once. A fresh tab, second session or new intent for that version is refused (409), whatever the earlier job's state. A failed or uncertain job does not permit another paid run.
- Two simultaneous requests with the same intent start exactly one execution.
- A storage error on either claim refuses the submission (fail closed). A malformed field is refused before any claim.
- With `requireSubmitIntent` on, submissions without the fields are refused. It is off by default so the current Apps Script keeps working until its change is deployed.

Not yet in place (needs an Apps Script change and a deployment, not authorised):
- The Apps Script provider now sends `scriptId`, `submitIntentId` and `renderVersion` when its caller supplies them. The caller (the Production page) must generate one intent per owner action and keep it across retries, and must pass the render version. Until then the render-version claim does not apply.
- Turn on `requireSubmitIntent` only after that change is live.
- Limitation: a claim is never released automatically. A version that was claimed but never started needs an operator release (no tool exists yet). This is the intended fail-closed behaviour.

What failed on 10 November (before these changes): two separate clicks created two `cr-` IDs and only the same `jobId` was refused. The two submissions 15 minutes apart were not blocked. The render-version claim would refuse the second, once the fields are sent.

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
3. Record the approval against one script, one render version (for example 2) and one submit intent (a UUID v4 generated for this owner action). Write all three in the approval note before submitting.
4. Submit once from the production page, with AI stills allowed and automation paused. Do not click again. A repeated request with the same intent returns the job it created; a request for the same version under a new intent is refused.
5. Monitor the single execution. If it fails, stop: do not resubmit. Record the render ID, the execution ID and the error.
6. Review the finished video (narration, coverage, labels, music credit) before any upload. Upload is a separate approval.

## 10. Remaining risks

- Antelope Canyon coverage is weak: one verified interior clip (29510336, title-based identity, human check of the frames done) for the recap; scenes 1 and 2 are labelled AI stills.
- Estimated versus aligned timing: the rehearsal passes at 2.0–2.6 words per second, but the real alignment is still unmeasured. The recap shares are about 2.2 s and need a pacing check.
- Visual quality: the 4K Antelope clip crop keeps about 30% of the width; scene 3 and the Burano recap part are different clips of the same street.
- Long stills: the motion now lasts the whole beat, but the two AI stills are still illustrations, not footage. Their look needs owner approval.
- Duplicate-submission protection is implemented on the worker but not yet live: the Apps Script must send the fields and be deployed (section 6).
- Provider charges are estimates from public list prices; they are not measured from invoices.
- The sheet's error text for `RND-B375A60D` disagrees with its backend job, so sheet error columns should not be used to judge a render.
- The Request JSON client-request-ID and version values for the two earlier failed renders are still not read.

## Sources (prices, checked 12 November 2026)

- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api): Eleven v4 at $0.08 per 1,000 characters (confirmed on multiple third-party pages; check the official page before budgeting).
- [OpenAI gpt-image-2 price, medium 1024×1536 $0.041](https://yingtu.ai/en/blog/gpt-image-2-cost-per-image) (secondary source reproducing OpenAI's table; check OpenAI's pricing page).
- [OpenAI whisper-1, $0.006 per minute](https://developers.openai.com/api/docs/models/whisper-1) (official model page).
- [Cloud Run pricing](https://cloud.google.com/run/pricing) (Jobs rates; London tier not confirmed by search).
