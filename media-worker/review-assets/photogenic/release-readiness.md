# Photogenic release readiness (development evidence only)

Status: development evidence. Nothing here is deployed, rendered, narrated, uploaded, published or merged. Work is on `fix/photogenic-scene-metadata` (PR #32, draft).

## 1. What is verified, and how

| Check | Result | Where |
|---|---|---|
| Worker suite (`node --test` in media-worker) | 398/398, including real-FFmpeg caption and disclosure layout | `media-worker/test` |
| Apps Script offline suite (`node node-tests/run-local.cjs`) | exit 0 | `node-tests` |
| Initial-render workflow, browser to worker (controller and provider in a vm, dispatcher HTTP app in a fresh process per request, state on disk) | 13/13 | `node-tests/InitialRenderWorkflow_Tests.js` |
| Simultaneous submissions across separate processes | 3/3; a non-atomic create fails all three (negative control) | `media-worker/test/submitConcurrentProcesses.test.js` |
| Production page in a real browser, with `google.script.run` mocked | 8/8 scenarios; a mutant without the unknown-outcome rule fails 3 | `node-tests/browser/` (run by hand, see section 5) |
| Browser harness builds and its inline scripts parse | pass | `node-tests/ProductionPageBuild_Tests.js` |

Browser scenarios (the real page markup and script, in iframes that share localStorage): Create Short sends a request ID and clears it on acceptance; a double click sends one request; an unknown outcome keeps the ID, and a refresh resends it; a second tab shares the pending ID; a definite refusal clears the ID; a network failure keeps the ID; a duplicate answer for Render New Version says nothing new started; a failed render's retry keeps an ID per job.

What these do not cover: a live Apps Script deployment, the real Google Sheet, Cloud Run, or paid services.

## 2. Final vertical layout: captions and the AI-still label

Measured with real FFmpeg on a 1080 x 1920 frame (captions as burned in by the worker, the label as drawn on AI stills):

- Caption line: y 1385 to 1447.
- AI-still label box: y 1636 to 1715.
- Gap between them: 188 px. They do not overlap.

The label sits lower than the captions, in the bottom quarter of the frame. The caption band is set by the worker's bottom safe margin (24% of height).

Open judgement (owner): the label is in the lower part of the frame, where a video platform often draws its own controls. This has not been checked against any platform's overlay layout. If that matters, the label can move up without touching the captions. Measuring again after any move is a single test run.

## 3. Pricing evidence

- The planning estimate in `controlled-render-proposal.md` used a Cloud Run rate of about 1.2 times the published US Jobs rate ($0.000018 per vCPU-second, $0.000002 per GiB-second). The London region is a higher price tier, and the published London figure was not found in this check. The planning figure is therefore a guess, not a confirmed rate.
- Worst case checked here: a 5-minute job on 2 vCPU and 2 GiB, at 3 times the US rate, is about $0.04 for compute. Narration and image costs in the proposal are unchanged.
- Still to confirm by the owner before any paid run: ElevenLabs and OpenAI official pages (the proposal's figures came from secondary sources). Nothing was called or charged to check them.
- Budget: the £5 figure remains a planning ceiling. No technical cap enforces it (section 8 of the proposal).

## 4. Narration timing

Not measured. The only evidence is the offline rehearsal with synthetic word timings at 2.0, 2.3 and 2.6 words per second, which passes. The real alignment needs a paid narration and alignment run, which was not made. The render must be checked against real timings before the recap is accepted.

## 5. Browser-level page tests: how to run them

    node node-tests/browser/build-production-page-browser.js <output.html>

Serve the output file from a local web server (a file opened directly may not run its scripts in some browsers), then open it. The results panel lists each scenario as PASS or FAIL. The offline run only checks that the harness builds.

## 5a. Rollout and requireSubmitIntent activation (rehearsed offline, not run in production)

Superseded by `deployment-safety.md`, section 3: that sequence closes the submission gate before any deployment, so no old caller can start a paid render during the move. The steps below are kept as the rehearsed order of the switches only.

Order that keeps legitimate renders working:

1. Deploy the worker dispatcher with `requireSubmitIntent` off (the current default). Older Apps Script clients keep working. Rehearsed: a request without intent fields is accepted with the flag off.
2. Record the currently deployed Apps Script version number. Deploy the Apps Script version that sends request IDs (`clasp push`, `clasp version`, `clasp redeploy` to the existing web app). Rollback target: the recorded version.
3. Confirm, on the live page, that Create Short and a retry send a request ID (a check the owner runs by hand; no render is needed, just the request). The browser tests above cover the page logic.
4. Only then turn on `requireSubmitIntent`. Rehearsed: with the flag on, an older client is refused with HTTP 400, and the new client renders once.
5. Rollback: turn `requireSubmitIntent` off (rehearsed: older clients are accepted again, and a new request still renders once). Redeploy the recorded Apps Script version if the page itself must go back.

Failure modes checked: a lost reply after the worker accepted keeps the request ID and replays it (no second render); a lost local row is recovered by the worker's duplicate reply (the job is adopted, nothing starts); a definite refusal clears the ID, so the next click is a new request; a failed first attempt does not block the owner (the next request is version 2).

Known limit: a claim is never released automatically. A version that was claimed but never started needs an operator release, which does not exist yet.

## 6. Previous failed render records (Photogenic)

The two 10 November renders (`cr-9b3bed34…` and `cr-8556be9c…`) have no stored version and no intent, and both failed. Rows without a version count as version 1, so the next Photogenic render is version 2. Tested: the first render with those two records present starts as version 2, and neither record blocks it. The live Request JSON for those rows has not been read in this work.

## 7. Owner approvals required before the controlled render

1. Accept the two labelled AI stills for scenes 1 and 2, and how they look.
2. Confirm the reviewed Pexels clips and the 9:16 crop (contact sheets in `footage/`), including the Antelope Canyon clip whose place rests on its title and frames.
3. Decide whether the AI-still label stays in the lower frame or moves up (section 2).
4. Authorise the Apps Script deployment (step 2 of section 5a), and separately the worker revision.
5. Authorise turning on `requireSubmitIntent` (step 4 of section 5a).
6. Authorise the production metadata change (after a dry run that confirms the narration matches byte for byte).
7. Authorise one paid render, with a planned ceiling of £5 that is not technically enforced. Setting an OpenAI project limit is the strongest practical cap.
8. Publishing is a separate approval.

## 8. Remaining blockers (genuine)

- The real narration alignment is unmeasured (section 4).
- London Cloud Run rate and the ElevenLabs and OpenAI official prices are unconfirmed (section 3).
- The label position against platform overlays is unjudged (section 2).
- No operator tool releases a stranded version claim.
- The prepared-task path refuses unless exactly four scenes are prepared, and the Photogenic script has five scenes. Photogenic goes through Create Short, so this does not block it, but the prepared path cannot render it. Not changed here.
- Triggers: the owner must confirm which Apps Script code each trigger runs before any rollback (see `deployment-safety.md`, section 5). Not verifiable offline.

## 9. Deployment safety (14 November 2026, development only)

Added on `fix/photogenic-scene-metadata`. Built and tested; nothing deployed.

- **Engineering blocker found and fixed:** `dispatcherConfig.js` never read `REQUIRE_SUBMIT_INTENT`, so the intent guard could not be enabled in production by configuration. It is now read from the environment (exact value `yes`).
- **Submission maintenance gate:** worker `SUBMISSIONS_PAUSED=yes` refuses `POST /jobs` and `POST /jobs/recover` with HTTP 503 before any state is touched. The Apps Script Script property `SUBMISSIONS_PAUSED=yes` refuses every render start before any write or worker call. A paused prepared task stays READY and is marked retryable. Fails closed when the property cannot be read. Tests: `submissionGate.test.js` 5/5; `InitialRenderWorkflow_Tests.js` 17/17.
- **Non-executing production contract check:** `tools/production/verify-worker-contract.mjs` sends only requests the dispatcher must refuse, checks identity and both switches, refuses staging identities, and never prints the secret. Tests: `productionContractCheck.test.js` 6/6.
- **Rollout, rollback and version check:** see `deployment-safety.md` (gate, rollout order, rollback) and `next-version-check.md` (confirming the exact next version from production records before any paid click). The version rule reads `requestPayload.version`, not the row's optimistic-lock Version column.
- **Visual comparison of the AI disclosure position:** `disclosure-comparison.png`, built by `build-disclosure-comparison.mjs`. Panel A is the current position (bottom third), which sits in the simulated bottom title block over the channel line. Panel B is raised to y 1000, clear of the captions and of the simulated right-hand column. The Shorts overlay is simulated with rough boxes, not measured from YouTube's interface. This is evidence for a human decision, not platform approval.

Full Apps Script offline suite exits 0; worker suite passes (see the PR for the final counts).

## 10. Final approval checklist (owner)

Creative approach (approved in PR #32, 14 November, for development review):
- [x] Two clearly labelled AI-generated Antelope Canyon illustrations for scenes 1 and 2, each with a visible "AI-GENERATED ILLUSTRATION" label for its whole appearance (maximum two stills).

Not yet approved (each is a separate gate):
- [ ] Generating the two images, or any other chargeable API call.
- [ ] The visual appearance of the generated images.
- [ ] Final footage choice and the 9:16 crop, including Antelope Canyon clip 29510336 (place identified by title and frames only).
- [ ] Disclosure position: current bottom-third (A) or raised (B).
- [ ] Rotating the worker's JOB_SUBMIT_SECRET in production, without setting JOB_SUBMIT_SECRET_PREVIOUS, to close every legacy caller (`deployment-safety.md`, section 2).
- [ ] The contract check showing 401 for the legacy value on both routes, on production (section 6 of `deployment-safety.md`).
- [ ] Deploying the gated worker revision and the new Apps Script version, in the order of `deployment-safety.md` section 3, steps 2–4.
- [ ] Enabling `REQUIRE_SUBMIT_INTENT=yes` on the worker, while still closed (section 3, step 5).
- [ ] Opening submissions: clearing the Apps Script pause property and then the worker's pause (section 3, step 7). Only after the intent switch is verified.
- [ ] The production script metadata change (after a dry run that confirms the narration matches byte for byte).
- [ ] Confirming the next render version from production records (`next-version-check.md`) and recording the approval note.
- [ ] One paid render (planned £5 ceiling, not technically enforced; an OpenAI project limit is the strongest practical cap).
- [ ] Publishing to YouTube (a separate approval).
- [ ] Merging PR #31 or PR #32.

Engineering blockers that remain (none is a reason to run anything):
- Real narration alignment is unmeasured (needs a paid run).
- London Cloud Run rate and the ElevenLabs and OpenAI official prices are unconfirmed.
- **Deployment blocker:** the independent block (rotating the worker's secret) is not yet shown on production. Until it is, nothing shows that legacy callers are closed. It needs owner approval and the contract check on production.
- **Deployment blocker:** the currently deployed Apps Script and worker revision do not read the pause switches, so those switches cannot be the first closure. The secret must be.
- The Apps Script trigger code versions are unverified (rollback depends on it).
- Old revisions can carry a secret reference that resolves to the legacy value. Each one must be checked before any traffic move (`deployment-safety.md`, R2).
- No operator tool releases a stranded version claim.
- The prepared-task path needs exactly four scenes; Photogenic has five and goes through Create Short.
- The two 10 November Request JSON values are unread.

## 11. Correction (15 November): closed first, the independent block, rollback that never reopens unprotected

Two blocking review findings are addressed in `deployment-safety.md`:

- **Order.** Submissions no longer reopen before REQUIRE_SUBMIT_INTENT=yes is enabled and verified. The open step is last (`tools/production/rollout-guard.mjs`, `CONTROLLED_PLAN`), and it is refused unless the intent guard is on in both ends.
- **The deployed code.** The currently deployed worker and Apps Script do not read the pause switches, so they cannot be the first closure. The first closure is the worker's secret: rotating JOB_SUBMIT_SECRET to a value only the owner holds makes every legacy caller fail with 401, with no new code. The refusal runs before any handler, so no state is written and no execution starts (`secretBlock.test.js`). This is a production change that needs approval. It has not been made.
- **Rollback.** A rollback never moves worker traffic to a revision that accepts the legacy value or lacks the intent guard while submissions could open. Script properties belong to the project, so an Apps Script rollback does not change them. Reopening always repeats the forward sequence.

Tests added: `rolloutGuard.test.js` (15, the state machine: every rule above), `secretBlock.test.js` (4, the independent block on the real dispatcher), `productionContractCheck.test.js` (9, now including the legacy-value 401 check and a legacy revision that reports no switches), and `submissionGate.test.js` (5). The rollout tests run offline; they touch no deployment.
