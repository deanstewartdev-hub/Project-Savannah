# Deployment safety: corrected sequence, independent block, rollback rules

Status: development procedure. Nothing here has been run against production. Each step that changes a live deployment, a Secret Manager version, a Script property or a switch is a separate owner approval.

## 1. Corrections to the previous version

- The previous sequence reopened submissions before REQUIRE_SUBMIT_INTENT=yes was active. Removed. Submissions reopen only at the last step, after intents are required and verified.
- The previous version assumed the pause switches could close submissions before any deployment. The currently deployed worker and Apps Script read neither SUBMISSIONS_PAUSED nor the pause property, so they cannot be the first closure.
- The previous rollback could move worker traffic to an older revision that still accepted the legacy secret. That reopens submissions with no intent guard. Forbidden now (section 5).
- Script properties belong to the Apps Script project, not to a deployment version. Rolling a version back does not change them.

## 2. The independent block: the worker's secret (needs no new code)

The worker accepts only the value of JOB_SUBMIT_SECRET it is configured with. Rotating that secret to a new value that only the owner holds closes every caller holding the old value, whatever code the caller runs.

- The check runs before any handler (`media-worker/src/lib/auth.js`). A refused request writes no job state and starts no execution. Tested with the real dispatcher app: `media-worker/test/secretBlock.test.js`, 4 tests.
- A refusal is HTTP 401. The Apps Script treats a 401 as a definite refusal, so rows are marked FAILED with no render ID. It is not an unknown outcome, so nothing is left active.
- Use the existing rotation procedure in `RELEASE_READINESS.md` section 11.3, with Secret Manager versions. Do **not** set JOB_SUBMIT_SECRET_PREVIOUS. Setting it keeps the old value accepted, which the test shows.
- The Apps Script keeps the old value in its Script property MEDIA_WORKER_JOB_SUBMIT_SECRET until the new Apps Script version is deployed with the new value. Legacy callers therefore fail from the moment the worker rotates.
- Verify with the non-executing contract check (section 6) and `PRODUCTION_LEGACY_SECRET` set to the old value: both routes must answer 401.

Weaker alternative, only if the secret cannot be rotated: move Cloud Run traffic to zero. It also blocks callers, but the answers are server-side failures, which the Apps Script treats as unknown outcomes, so rows stay active and need reconciling. It also blocks /health.

**Status: a deployment blocker.** The rotation is a production change and has not been made. Until the owner approves it and the contract check confirms the 401s on production, nothing here shows that legacy callers are blocked.

## 3. Corrected rollout order

Submissions stay closed from step 1 until step 7. Each step is one approval.

1. **Rotate the worker's secret** (section 2). Verify the legacy value gets 401 on both routes.
2. **Deploy the gated worker revision** holding the new secret, with SUBMISSIONS_PAUSED=yes and REQUIRE_SUBMIT_INTENT unset. Verify /health reports submissionsPaused true and requireSubmitIntent false. Verify the legacy value still gets 401.
3. **Set the Apps Script project's properties**: MEDIA_WORKER_JOB_SUBMIT_SECRET to the new value, and SUBMISSIONS_PAUSED to yes. The worker is paused, so the still-legacy Apps Script stays closed.
4. **Deploy the new Apps Script version** (reads the pause property, sends intents). The owner confirms in the editor which code each trigger runs; they must run the new version.
5. **Enable REQUIRE_SUBMIT_INTENT=yes** on the worker, still paused. Contract check with EXPECT_REQUIRE_SUBMIT_INTENT=yes and EXPECT_SUBMISSIONS_PAUSED=yes.
6. **Confirm the intent path offline** (the Apps Script and browser tests). Do not test it by clicking Create Short on a live page.
7. **Open**: clear the Apps Script SUBMISSIONS_PAUSED property, then the worker's SUBMISSIONS_PAUSED. Contract check with EXPECT_SUBMISSIONS_PAUSED=no. Only now are submissions open, and every submission carries an intent.

The order is encoded in `tools/production/rollout-guard.mjs` (`CONTROLLED_PLAN`). `runPlan` returns ok only if every state between the first step and the open step is closed.

## 4. What the rollout rules guarantee (tested: `media-worker/test/rolloutGuard.test.js`, 15 tests)

- Opening is refused until REQUIRE_SUBMIT_INTENT is yes and both ends are the new versions.
- Worker deploys, Apps Script deploys, rollbacks and the intent switch are all refused while submissions are open.
- A legacy Apps Script version cannot be given the accepted secret while the worker has no pause gate.
- An old worker revision without the intent guard can be rolled back to while closed, but can never be reopened.

## 5. Rollback rules: never reopen through an unprotected older worker

- **R1. Close first.** Pause the worker and set the Apps Script pause property, or rotate the secret. Rollbacks are refused while submissions are open.
- **R2. Never move worker traffic to a revision that accepts the legacy value, or that lacks the intent guard, while submissions could open.** An older revision may be rolled back to only while closed, and it can never be reopened. Each Cloud Run revision also references a secret version. Before any traffic move, check that the target revision's JOB_SUBMIT_SECRET reference is the current version. A revision that resolves to the legacy value would accept legacy callers.
- **R3. Rolling the Apps Script back to legacy code does not change the project's properties.** A legacy version holding the current secret is safe only while the worker is paused, because the pause gate applies to every caller. Never clear the worker's pause while a legacy Apps Script version holds the current secret.
- **R4. Reopening after any rollback repeats section 3 from step 1.** A rollback does not shortcut the sequence.

Rollback procedure, with each step approved:

1. Close: pause the live worker revision (SUBMISSIONS_PAUSED=yes) and set the Apps Script pause property to yes. Confirm the legacy value still gets 401 if the secret was rotated.
2. Confirm no active render rows for the script (the procedure in `next-version-check.md`, step 4).
3. If the Apps Script must go back, roll it back to the recorded version. Keep the worker paused.
4. If the worker must go back, roll back only to a revision whose secret reference is the current version and which is itself paused or closed by its own gate. Otherwise keep the live revision.
5. Run the contract check with the expectations that match the closed state.
6. Reopen only by section 3, from step 1.

## 6. The non-executing contract check (`tools/production/verify-worker-contract.mjs`)

It sends only requests the dispatcher must refuse. It checks identity, the two switches (or reports that a legacy revision does not report them), and, when `PRODUCTION_LEGACY_SECRET` is set, that the legacy value gets 401 on both routes. A body that could start a render is checked to be invalid before it is sent. It refuses staging identities and never prints a secret. Tests: `media-worker/test/productionContractCheck.test.js`, 9 tests, including a stub legacy revision that passes and one that accepts the legacy value and fails.

## 7. What this does not establish

- The production rotation has not been made, so the block is not shown on production.
- Which code each Apps Script trigger runs is not verified offline. Rollback depends on it.
- Stranded version claims and the live sheet are untested together with Cloud Run.
- The browser and workflow tests use a mocked server and a fake job client.
