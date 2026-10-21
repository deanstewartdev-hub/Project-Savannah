# Callback Staging Check: Step-by-Step Guide

**What this is for:** proving, on a safe copy of Savannah, that finished videos reported by the
media worker reach the app correctly, that duplicate or fake reports can't damage anything, and
that the Production page keeps working. It should take about 45 minutes the first time.

**Status:** prepared, **not run yet**. Code: PR #15 (`integration/v1.4-callback-inbox-and-duration-preflight`).

> **The one rule:** everything below happens on a **copy**. Never add the `SAVANNAH_ENVIRONMENT`
> property to the real project, and never use the real callback bridge. The tools refuse to run
> without that property, and the sending tool refuses the real production address.

## Words used in this guide

| Word | Meaning |
|---|---|
| **Main app** | The Savannah web app you normally use, with its spreadsheet. |
| **Bridge** | A small separate Apps Script project that receives the media worker's "video finished" messages and writes them into a tab called **Render Callback Inbox**. |
| **Callback** | One of those "video finished" or "video failed" messages. |
| **Script property** | A named setting in an Apps Script project: **Project Settings** (gear icon) → **Script properties**. |
| **Run a function** | In the Apps Script editor, pick the function name in the toolbar dropdown, press **Run**, then open **Execution log** to read the result. |

## Part A: set up the staging copy (once, about 20 minutes)

1. **Copy the spreadsheet.** Open the real Savannah spreadsheet → **File → Make a copy**. Name it
   `Savannah STAGING`. The copy brings its own copy of the main app's code. Triggers and
   deployments are not copied, which is what we want.
2. **Mark the copy as staging.** In the copy: **Extensions → Apps Script** → gear icon → **Script
   properties** → **Add script property**: `SAVANNAH_ENVIRONMENT` = `staging`.
3. **Make the copy unable to spend money or publish.** In the same Script properties list, delete
   (or blank) any of these that exist: `MEDIA_WORKER_URL`, `MEDIA_WORKER_JOB_SUBMIT_SECRET`,
   `OPENAI_API_KEY`, `CREATOMATE_API_KEY`. Then set `MEDIA_WORKER_SHARED_SECRET` to a **new,
   made-up value used only for staging**. A long random string is fine, and you'll need it again in
   Part B.
4. **Put this branch's code into the copy.** A developer pushes the branch to the **staging copy's**
   script ID only (temporary `.clasp.json`, never committed, never the production script ID).
5. **Create the staging bridge.** From the repository's `CallbackBridge/` folder, create a new
   standalone Apps Script project (`clasp create`). In its Script properties set
   `MEDIA_WORKER_SHARED_SECRET` (the same staging value as step 3) and `RENDER_JOBS_SPREADSHEET_ID`
   (the ID of the **staging copy**: the long part of its URL between `/d/` and `/edit`). Deploy it
   as a web app (**Deploy → New deployment → Web app**, access: Anyone) and copy its `/exec` URL.
6. **Check the spreadsheet identity.** In the staging copy's editor, run `diagnoseCallbackInbox`.
   The `spreadsheetId` in the log must be exactly the value you put in the bridge's
   `RENDER_JOBS_SPREADSHEET_ID`. The automated check in Part B proves this for certain (check C1).

## Part B: run the automated check (about 10 minutes)

**Step 1, in the staging copy's Apps Script editor:** run `stagingSeedRenderJobs`. The log shows
the synthetic render jobs it created (`RND-STG…`) and a command starting with
`node node-tests/staging/run-staging-callbacks.cjs`. Copy that whole command.

**Step 2, on your computer, in the repository folder:** set the two staging values. The second
command waits for you to paste the staging secret, and hides it as you type:

```bash
export SAVANNAH_STAGING_BRIDGE_URL="https://script.google.com/macros/s/<staging-bridge-id>/exec"
```

```bash
read -rs SAVANNAH_STAGING_CALLBACK_SECRET && export SAVANNAH_STAGING_CALLBACK_SECRET
```

Then paste and run the command from step 1. It sends 12 callbacks and prints PASS or FAIL for each
bridge reply. It never prints the secret or the URL. All 12 must pass.

**Step 3, back in the staging editor:** run `stagingVerifyRun`. **Do not open the staging
Production page between steps 1 and 3**, because it would ask the (blanked) worker about these fake
renders. The log ends with `Staging verification PASSED` or `FAILED`, plus one line per check:

| Check | What it proves |
|---|---|
| C1 | The bridge writes into **this** spreadsheet (correct spreadsheet identity) |
| C2 | A finished-video callback is stored, processed and marks the render SUCCEEDED |
| C3 | A duplicate delivery and a late "failed" message change nothing |
| C4 | Delivery recovery can renew an expired video link without a re-render |
| C5 | Wrong secret, malformed ID and unknown status are refused at the bridge; "finished" without a proper video can't mark a render done |
| C6 | A delivery for an unknown render is held, not applied anywhere |
| C7 | A delivery that arrives before its render job is saved is applied once the job exists |
| C8 | A failure callback marks the render FAILED with the worker's message |
| C9 | The Production page's data loads (Production page stability) |
| C10 | The background queue tick runs and processes callbacks (SKIPPED if scene preparation is waiting, so nothing paid can start) |
| C11 | None of the synthetic renders can be uploaded to YouTube |
| C12 | Release readiness summary (information only) |

Running `stagingVerifyRun` again is safe.

## If something fails

| Symptom | Most likely cause | Fix |
|---|---|---|
| Step 2 prints `REFUSED` | A missing `export`, a URL with extra text after `/exec`, or the production URL | Re-check the two `export` lines |
| T6a fails: wrong secret was accepted | The bridge has no `MEDIA_WORKER_SHARED_SECRET`, or the wrong one | Re-check the bridge's Script properties |
| Every step-2 line fails with "Callback processing failed." | The bridge can't open the spreadsheet | Re-check `RENDER_JOBS_SPREADSHEET_ID`, and authorise the bridge (run any function once in its editor) |
| C1 fails | The bridge writes to a different spreadsheet | Fix `RENDER_JOBS_SPREADSHEET_ID` to the staging copy's ID, then repeat Part B |
| C9 fails | The Production page would break | Report the error text to the developer; do not go further |
| Anything else | | Copy the whole Execution log into issue #6 |

## Part C: the same identity check on the real app (before cut-over)

Run this before the real worker's callback address is switched to the real bridge. It only reads:

1. Open the real app → **Settings → Release readiness → Run readiness check**. It must not say
   **Blocked**. In particular, the callback address must **not** point at the main app itself.
2. In the real main app's editor, run `diagnoseCallbackInbox`, and compare `spreadsheetId` with the
   real bridge's `RENDER_JOBS_SPREADSHEET_ID`. They must match exactly.
3. The order of the real cut-over is in `RELEASE_READINESS.md` §4. Do not change it.

## Clean-up

Archive the staging bridge deployment and delete the staging copy, or keep both, clearly
labelled, for future regression runs.

## What this check does not cover

- The real media worker sending to the bridge, including the worker's new automatic retry. That needs
  a new worker image and one real render (`LIVE_ACCEPTANCE.md`).
- Real YouTube uploads (`LIVE_ACCEPTANCE.md`, step 7).
- Status polling for real renders. It is deliberately avoided here.

## For developers

- Local proof that this whole procedure is correct: `node node-tests/StagingFlowEndToEnd_Tests.js`
  runs steps 1–3 against the real bridge and inbox code with Google services faked.
- Single callbacks for manual poking: `node-tests/staging/send-synthetic-callback.cjs`.
- Editor helpers: `diagnoseCallbackInbox` (read-only), `drainCallbackInboxNow`, `diagnoseReleaseReadiness`.
