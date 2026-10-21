# Callback Inbox — Spreadsheet Identity Check and Staging Verification

Status: **prepared, not run.** Every step below needs the owner. It involves creating Apps
Script projects, OAuth consent, deployments and script properties, and none of it has been
done. Branch: `integration/v1.4-callback-inbox-and-duration-preflight` (PR #15).

**Rule:** run this against a **staging copy** only. Do not point a synthetic callback at the
production bridge, and do not add synthetic rows to the production spreadsheet. The sender
script refuses the known production deployment ID.

---

## 1. Verifying `RENDER_JOBS_SPREADSHEET_ID` against the main app's spreadsheet

The standalone callback bridge writes receipts to the spreadsheet named in its own
`RENDER_JOBS_SPREADSHEET_ID` script property (`SpreadsheetApp.openById`). The main app reads
receipts from its **bound** spreadsheet (`SpreadsheetApp.getActiveSpreadsheet()`), which is
the same spreadsheet every main-project repository uses. If the two differ, callbacks are
accepted (`success: true`) but land in a sheet the main app never reads. Renders then only
finish through status polling. Nothing errors, so this is easy to miss.

Neither value is a secret. Compare them in three steps; the third is the definitive one.

**A. Main app ID (read-only).** Open the main spreadsheet, then **Extensions → Apps Script**.
That this opens the Savannah project proves the binding. In the editor, run
`diagnoseCallbackInbox` (in `Production/MediaWorkerCallbackInbox_Service.js`) and read the
log: `spreadsheetId`, `spreadsheetName`, whether the inbox tab exists, whether its headers
match, and the pending backlog. The function never writes anything. The same ID also appears
in the spreadsheet URL: `docs.google.com/spreadsheets/d/<ID>/edit`.

**B. Bridge ID.** Open the bridge project → **Project Settings → Script properties** → read
`RENDER_JOBS_SPREADSHEET_ID`. Do not copy `MEDIA_WORKER_SHARED_SECRET` anywhere while you are
on that screen. The bridge deliberately has only one global function (`doPost`), so there is
no diagnostic function in it. Reading the property is the check.

**C. End-to-end proof.** A and B must match character for character. Then send one synthetic
callback (section 3, test T1) and run `diagnoseCallbackInbox` again: `receipts` must go up by
one. That proves the bridge writes to the spreadsheet the main app reads, rather than just
that two strings look alike.

## 2. Setting up staging (owner)

1. **Staging spreadsheet + main project.** In the production spreadsheet, use **File → Make
   a copy**. That copies the bound script, but not its triggers or deployments. In the copy's
   script project:
   - Check **Script properties**. Set `MEDIA_WORKER_SHARED_SECRET` to a **new staging-only
     value**. Clear `MEDIA_WORKER_URL`, `MEDIA_WORKER_JOB_SUBMIT_SECRET`, `OPENAI_API_KEY`,
     `CREATOMATE_API_KEY` and any YouTube settings, so an accidental poll, render or upload
     fails locally instead of reaching a paid or public service.
   - Push the integration branch code to the **staging** script ID only. Use a temporary,
     uncommitted `.clasp.json`, then put it back, and never `clasp push` to the production
     script ID from this branch.
   - Do not enable Background automation in staging.
2. **Staging bridge.** `clasp create` a new standalone project from `CallbackBridge/`. Set
   `MEDIA_WORKER_SHARED_SECRET` (the staging value from step 1) and
   `RENDER_JOBS_SPREADSHEET_ID` (the **staging copy's** ID). Deploy it as a web app
   (`ANYONE_ANONYMOUS`, as its manifest says) and note its `/exec` URL.
3. Run the section 1 check against the staging pair.

## 3. Staging test run

Add synthetic jobs by appending rows to the staging **Render Jobs** sheet. Generate fresh
UUIDs, for example with `node -e "console.log('cr-' + crypto.randomUUID())"`:

| Job ID | Render ID | Script ID | Template ID | Status | Progress | Created At / Updated At | Version | Model Version |
|---|---|---|---|---|---|---|---|---|
| RND-STAGE01 | cr-&lt;uuid-1&gt; | SCR-STAGING | cloud-run-worker | RENDERING | 10 | now | 1 | render-job-model-v1.0 |
| RND-STAGE02 | cr-&lt;uuid-2&gt; | SCR-STAGING | cloud-run-worker | RENDERING | 10 | now | 1 | render-job-model-v1.0 |

Leave the other columns blank, except `Request JSON` / `Response JSON`, which should be `{}`.

Sending a callback: set the environment variables in your own terminal (not in a shared log),
then run the sender. It prints the response but never the URL or the secret:

```bash
export SAVANNAH_STAGING_BRIDGE_URL="https://script.google.com/macros/s/<staging-bridge-id>/exec"
read -rs SAVANNAH_STAGING_CALLBACK_SECRET && export SAVANNAH_STAGING_CALLBACK_SECRET
node node-tests/staging/send-synthetic-callback.cjs --i-am-targeting-staging completed cr-<uuid-1>
```

After each send, process receipts by running **`drainCallbackInboxNow`** in the staging
editor. It does exactly what a Production page load does, but without polling any provider.
**Do not open the staging Production page during this run:** `refreshActive` would poll the
dispatcher for the synthetic IDs.

| # | Action | Expected |
|---|---|---|
| T1 Bridge receives | `completed cr-<uuid-1>` | Response `{"success":true,"queued":true}` |
| T2 Receipt persisted | Look at the staging **Render Callback Inbox** tab (created on first receipt); run `diagnoseCallbackInbox` | One row: Render ID `cr-<uuid-1>`, Status `completed`, Payload JSON present with no secret, Handled At empty. `pending: 1` |
| T3 Consumed | `drainCallbackInboxNow` | `processed: 1`; row Result `APPLIED`, Handled At set |
| T4 Status correct | Look at RND-STAGE01 | `SUCCEEDED`, Progress 100, Video URL `https://example.invalid/...synthetic-callback.mp4`, Version 2 |
| T5 Duplicate delivery | Send `completed` again and `failed` for `cr-<uuid-1>`, then drain | Both queued; both `IGNORED_TERMINAL`; RND-STAGE01 unchanged (still SUCCEEDED, **Version still 2**) |
| T6a Wrong secret | `bad-secret cr-<uuid-2>` | `{"success":false,"error":"Unauthorized."}`; **no** inbox row |
| T6b Malformed ID | `malformed-id cr-<uuid-2>` | `Malformed render ID.`; no row |
| T6c Unknown status | `unknown-status cr-<uuid-2>` | `Unknown or missing status.`; no row |
| T6d Completed, no video | `no-video cr-<uuid-2>`, drain | Queued; Result `REJECTED_NO_VIDEO`; RND-STAGE02 **still RENDERING** |
| T6e Insecure video URL | `http-video cr-<uuid-2>`, drain | Same as T6d |
| T6f Unknown render | `mismatched-job cr-<uuid-2>`, drain | Queued; stays **pending** (deferred), RND-STAGE02 untouched |
| T7 Fast callback | Send `completed` for a fresh `cr-<uuid-3>` **before** adding its row; drain (stays pending); add row RND-STAGE03 (RENDERING); drain | First drain: deferred. Second drain: `APPLIED`, RND-STAGE03 SUCCEEDED |
| T8 Failure path | Add RND-STAGE04 (RENDERING); `failed cr-<uuid-4>`; drain | RND-STAGE04 `FAILED`, Error Message `Synthetic staging failure callback.` |

**Pass criteria:** every row matches. In particular, no synthetic job ever changes after it
reaches a terminal state, and no rejected callback ever changes a job.

**Record in issue #6:** the date, the commit SHA pushed to staging, the T1–T8 results, the
`diagnoseCallbackInbox` output (spreadsheet ID last 6 characters only), and anything that
did not match.

**Cleanup:** archive the staging bridge deployment and delete the staging copy, or keep both,
clearly labelled, for later regression runs.

## 4. What this does not cover

- The real worker → bridge path, including the new bounded callback retry in
  `media-worker/src/lib/callback.js`. That needs a new worker image and one real render.
- Status polling or reconciliation for synthetic jobs (it is deliberately avoided above).
- The production cutover order, which is still the one in `CallbackBridge/CallbackBridge.js`
  (deploy the main app and bridge, switch `MEDIA_WORKER_CALLBACK_URL`, then set the main app to
  `access: MYSELF`), followed by one real render and one private upload. All of that stays
  owner-approved.
