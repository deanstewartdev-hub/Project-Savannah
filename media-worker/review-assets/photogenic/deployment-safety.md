# Deployment safety: submission gate, contract check, rollout and rollback

Status: development evidence and a procedure. Nothing here has been run against production. Every step that changes a live deployment, a live spreadsheet or a Script property needs the owner's approval (see the checklist in `release-readiness.md`).

## 1. Why a gate is needed

Two paths can start a paid render: the Apps Script (Create Short, retry, prepared tasks, Render New Version) and the dispatcher's `POST /jobs` and `POST /jobs/recover`. While the worker and the Apps Script are moved between versions, an older caller can still reach the dispatcher without the cross-submission guard. The gate closes both paths for the whole window.

## 2. The gate (built and tested, not deployed)

| Layer | Switch | Set to | Effect |
|---|---|---|---|
| Worker (environment `SUBMISSIONS_PAUSED`) | exact value `yes` | paused | `POST /jobs` and `POST /jobs/recover` answer HTTP 503 before any job state is read or written, and before any execution starts. |
| Apps Script (Script property `SUBMISSIONS_PAUSED`) | exact value `yes` | paused | Create Short, retry, Render New Version and prepared tasks refuse before any row is written or any worker call is made. A prepared task stays READY (it is not claimed), and the refusal is marked retryable, so the queue does not fail it. |

Both switches fail closed: an Apps Script property store that cannot be read counts as paused. Any value other than the exact word `yes` leaves the worker open, which is the current behaviour.

Other worker switches, for the same rollout:
- `REQUIRE_SUBMIT_INTENT=yes` refuses a submission that lacks `submitIntentId`, `scriptId` and `renderVersion`. It is read from the environment now (before this change it was never wired, so it could not be turned on).
- `/health` reports `submissionsPaused` and `requireSubmitIntent`, so a check can confirm both.

Evidence: `media-worker/test/submissionGate.test.js` (5/5: refusal with no state and no execution on both routes; health reports; unpaused still accepts; each environment value maps exactly, and only `yes` pauses). `node-tests/InitialRenderWorkflow_Tests.js` (17/17, including the Apps Script gate: paused Create Short and retry refused with no worker call, a paused prepared task left READY, resume after the property is cleared, and an unreadable property failing closed).

## 3. Rollout sequence with the gate

Each step is a separate owner approval. Nothing starts until the previous step is confirmed.

1. **Close the gate.** Set `SUBMISSIONS_PAUSED=yes` on the worker (a new revision with no traffic change needed for the setting itself) and set the Apps Script property `SUBMISSIONS_PAUSED` to `yes`. Confirm `/health` reports `submissionsPaused: true`, and run the contract check (section 4) with `EXPECT_SUBMISSIONS_PAUSED=yes`.
2. **Confirm nothing is running.** In the render rows, no row for the script is QUEUED, PLANNED, SUBMITTING or RENDERING, and no upload is in progress. Confirm no Apps Script trigger will start a render while paused (the gate refuses, but confirm the triggers too).
3. **Deploy the worker revision** (code with the gate). Keep the gate closed. Confirm `/health` on the new revision reports `submissionsPaused: true` and `requireSubmitIntent: false`.
4. **Deploy the Apps Script version** that sends request IDs and checks the gate. Record the previous version number first. Keep the property `yes`.
5. **Confirm the contract** (section 4) with `EXPECT_SUBMISSIONS_PAUSED=yes`, and confirm the Apps Script property is still `yes`.
6. **Open the gate** (clear the Apps Script property first, then the worker's `SUBMISSIONS_PAUSED`). Requests are accepted again, with the flag still off.
7. **Enable the intent switch** (`REQUIRE_SUBMIT_INTENT=yes`) only after a separate approval. Re-run the contract check with `EXPECT_REQUIRE_SUBMIT_INTENT=yes`.
8. Any later rollout that changes these settings repeats steps 1 and 5 first.

Do not flip `REQUIRE_SUBMIT_INTENT` off in production as an ad-hoc recovery. Use section 5 instead, with the gate closed.

## 4. The non-executing contract check

`tools/production/verify-worker-contract.mjs` checks what a deployment is and what it is doing. It sends only requests that the dispatcher must refuse:

- `GET /health`: 200, environment production, the expected project and service, the verified music protocol, and the two switches as expected.
- `POST /jobs` without a secret, and with a wrong secret: 401.
- `POST /jobs` with the correct secret and an empty beat list: 400 or 503.
- `POST /jobs/recover` with the correct secret and the same empty body: 400 or 503.

Before each POST, the script checks that its body is invalid by construction, so a later edit cannot make it send a body that could start a render. It refuses to run if the expected identity or URL names staging, and it never prints the secret.

Run it (owner-approved, against the production URL, with the production secret held only in the shell environment):

    PRODUCTION_DISPATCHER_URL=... PRODUCTION_PROJECT_ID=... PRODUCTION_SERVICE_NAME=... \
    PRODUCTION_SUBMIT_SECRET=... EXPECT_SUBMISSIONS_PAUSED=yes EXPECT_REQUIRE_SUBMIT_INTENT=no \
    node tools/production/verify-worker-contract.mjs

Evidence: `media-worker/test/productionContractCheck.test.js` (6/6). It runs the script against the real dispatcher app, with a fake Cloud Run client: the expected state passes, a paused worker passes when paused is expected, a mismatched switch fails, a staging identity is refused before any request, and no execution or job state is created in any case.

Limit: the check proves the refusals and the reported state. It does not prove that the deployed Apps Script or its triggers are the reviewed version. That is checked by the owner in the Apps Script editor (step 2 of section 3).

## 5. Rollback sequence (gate closed throughout)

Rollback never reopens submissions until the gate has been closed and the contract has been checked.

1. Close the gate: set the Apps Script property `SUBMISSIONS_PAUSED=yes`, then the worker's `SUBMISSIONS_PAUSED=yes`. Confirm no active renders (section 3, step 2).
2. If the Apps Script must go back: redeploy the recorded previous Apps Script version. Confirm the active version in the editor.
3. If the worker must go back: move traffic to the previous revision. The previous revision has no gate, so it must not receive traffic while the Apps Script property is `yes`, or the worker must be paused by the traffic move itself. Confirm the revision serving traffic before going on.
4. Run the contract check with the expectations that match the rolled-back state (`EXPECT_SUBMISSIONS_PAUSED=yes` until step 5).
5. Reopen only after steps 1–4 are confirmed and an owner has approved reopening: clear the Apps Script property, then the worker's `SUBMISSIONS_PAUSED`.

Known gap: an old Apps Script version and a time-driven trigger may run different code. Before any rollback, the owner lists the project's triggers in the editor and confirms which code each runs. This is an engineering blocker, not solved by this document.

## 6. What this does not cover

- The contract check does not start a render, so it cannot prove a render will succeed.
- The gate does not release a stranded version claim. Claims are never released automatically, and no operator tool exists yet.
- The live spreadsheet, the Apps Script and Cloud Run are untested together. The browser and workflow tests use a mocked server and a fake job client.
