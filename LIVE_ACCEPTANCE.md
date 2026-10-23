# Live Acceptance Checklist (v1.4)

Status: **prepared, not run.** Every step below needs the owner. Nothing here has been executed:
no Apps Script authorisation, no real callback, no upload.

Purpose: prove, on the real system and in order, that one Short can go from approved script to a
private YouTube upload without losing a callback and without ever being rendered or uploaded twice.
Issue #6 lists this as the "P0 live acceptance" gate. CI is not a substitute for it.

**Ground rules**

- One script, one render, one **private** upload. Stop at the first step that fails.
- Never paste a secret into this document, a chat, a commit or a log. The shared secret and the
  job-submit secret are read from Script Properties and Secret Manager only.
- Do not re-render and do not upload again to "see if it works". Both cost money or create a second
  public artefact. Use the recovery steps in section 9.
- No public publishing. Every upload in this checklist is `private`.

---

## Who does what

| Claude can do (safe, no approval needed) | Only you can do (needs your approval and your Google sign-in) |
|---|---|
| Read the code and the GitHub PRs, run the automated tests, prepare branches, draft PRs and documents | Sign in to Google, open the Apps Script editor, press Run, Deploy or Authorise |
| Check that a change merges cleanly and that every test suite still passes | Merge a PR, publish a new version of the app, change which URL the worker calls back to |
| Read a log, error message or screenshot you paste and explain what it means | Start the one paid render, and press publish for the one private upload |
| Update this checklist and the release notes after you tell me the result | Look at YouTube Studio and decide whether the video is good enough |

Claude never needs, and you should never paste, a secret value (the shared secret, the job-submit secret,
an API key). If a screen shows one, hide it before you share the screen or a screenshot. Writing the
name of a setting (for example `MEDIA_WORKER_CALLBACK_URL`) is fine; writing its secret value is not.

**Two things you will do a lot:**

- *Open the Apps Script editor:* open the Savannah spreadsheet, then **Extensions → Apps Script**.
- *Run a function:* in the editor, pick the function name in the drop-down next to **Run**, press **Run**,
  then read the result under **Execution log** at the bottom. Read-only functions are marked as such
  below; they change nothing.

## 0. Before you start (read-only)

- [ ] Note which branch and Apps Script version you are about to accept, and that it is the one the
      stacked PRs were merged into, in order. Do not accept an older branch.
- [ ] Production page shows no **Needs attention** items (see section 9). If it does, resolve them
      first. They may be real earlier problems.
- [ ] Pick the script to use. Prefer one with no earlier render, so there is nothing to confuse the
      result.
- [ ] Staging check done and passed (`CALLBACK_INBOX_STAGING.md`). If it has not been run, do not start here.
- [ ] No render is in progress anywhere (Production shows no active renders).
- [ ] **Stop rule:** if any box in sections 1 to 8 cannot be ticked, stop and tell Claude exactly what you
      saw (without secrets). Do not work around it.

## 1. Apps Script authorisation

- [ ] Open the Savannah Apps Script project as the owner. Run `authorizeYouTubePublishing` once from the
      editor (or press **Connect YouTube** on the Production page) and approve the consent screen. It
      needs the YouTube upload and read-only scopes.
- [ ] The Production page YouTube card shows the expected channel name, not an error.
- [ ] If background automation is wanted, authorise the trigger scope once, then confirm the queue card
      shows the worker as enabled. Leave it **off** for this acceptance run so only your actions run.

## 2. Same spreadsheet: application and callback bridge

The standalone callback bridge writes to the spreadsheet named in its own `RENDER_JOBS_SPREADSHEET_ID`
script property. The main app reads the spreadsheet it is bound to. If they differ, callbacks are
accepted but land where the app never looks, and nothing errors. This is the easiest failure to miss.

- [ ] Confirm the production bridge's `RENDER_JOBS_SPREADSHEET_ID` matches the production spreadsheet ID
      character for character (`RELEASE_READINESS.md` §4 steps 2 and 4). The end-to-end proof is the
      separate staging check in `CALLBACK_INBOX_STAGING.md`, built from empty files; never send a synthetic
      callback to the production bridge (it refuses them anyway).

## 3. One authoritative callback writer

Separate Apps Script projects do not share a script lock, so two projects writing Render Jobs can race.

- [ ] Confirm the live callback URL (`MEDIA_WORKER_CALLBACK_URL`) points at exactly one receiver, and that
      the other receiver is not also being sent callbacks.
- [ ] Per PR #15, the bridge only appends receipts and the main project is the single consumer. Do not
      switch the live callback URL while an older writer is still active.

## 4. Worker health

- [ ] Run `productionTestConnection` from the Apps Script editor (there is no button for it), or open the
      worker's `/health` URL. It must return OK. Note it is `/health`, not `/healthz`: Cloud Run
      intercepts `/healthz`.
- [ ] You have decided, in writing, that this one render is allowed to cost money.

### 4a. Check the Cloud Run configuration (read-only)

Nothing here changes anything. You only look.

1. Open <https://console.cloud.google.com> and choose the Savannah project in the project picker at the
   top.
2. **Cloud Run → Services → `savannah-media-worker-dispatcher`.** The name has a green tick. Copy its
   **URL** (it ends in `.run.app`).
3. In the Apps Script editor open **Project Settings → Script properties**. The value of
   `MEDIA_WORKER_URL` must be exactly that URL. Look at this one property only; other rows are secrets.
   Also check `VIDEO_PROVIDER` reads `cloud-run` (or is absent, which means the same).
4. **Cloud Run → Jobs → `savannah-render-job`.** Note the **Container image** tag. It must be the one you
   deployed in cut-over step 1 (`RELEASE_READINESS.md` §4), not an older one. Open **Executions** and
   confirm the list is empty or shows only runs you recognise: nothing should be running now.
5. **Security → Secret Manager.** Confirm the secrets the worker uses exist (names only; do not open
   their values).
6. Then, in the app, **Settings → Release readiness → Run readiness check**. There must be no **BLOCK**.
   This checks, among other things, that the callback URL points at the bridge and not at the main app.

If you are comfortable with a terminal, the same facts without clicking (replace the placeholders;
these commands only read):

```bash
gcloud run services describe savannah-media-worker-dispatcher --region=<REGION> --project=<PROJECT_ID> --format="value(status.url)"
gcloud run jobs describe savannah-render-job --region=<REGION> --project=<PROJECT_ID> --format="value(spec.template.template.containers[0].image)"
```

## 5. Genuine callback test (the one paid render)

- [ ] Submit the chosen script once. Record the render job ID and the Cloud Run execution name.
- [ ] Do not press **Re-render safely** while it is active. Use **Refresh status** only.
- [ ] A normal render finishes within minutes. If the page shows **Render is taking longer than
      expected**, follow section 9, do not re-render.
- [ ] The job moves to SUCCEEDED **because the callback arrived**: the video link appears without you
      pressing anything beyond Refresh. If it only completes after polling, the callback path is not
      working. Record that and stop. It is a finding, not a pass.
- [ ] Exactly one Render Jobs row exists for the script. Once PR #15 is in, the callback inbox also shows
      the receipt as applied exactly once (`diagnoseCallbackInbox`, read-only).

## 6. Video quality review (1080x1920)

The system checks these automatically before it allows approval. You are confirming the checks match
what you see.

- [ ] Quality line reads **Passed**: 1080x1920 or larger, portrait, duration 30 to 60 seconds, no long
      silence, no black frames, loudness near -14 LUFS.
- [ ] Open the MP4 and watch it fully: narration is clear and matches the script, captions are readable
      and on-screen text is at most five words, visuals match what is being said, nothing is cut off at the edges.
- [ ] Subjective sign-off is yours. Keep the original render until a replacement is approved.
- [ ] Press **Approve finished video** only if you would publish it.

## 7. One controlled private upload

- [ ] Privacy is **private**. Do not choose public or unlisted. Do not set a schedule for this run.
- [ ] Press publish **once** and wait. Do not press it again, even if the page seems slow. The upload
      holds a lock and a second press is refused.
- [ ] The card shows **Open on YouTube**. In YouTube Studio the video exists exactly once, is private,
      and has the Savannah AI-voice disclosure in its description.
- [ ] If the page shows an error instead, **do not retry**. Go to section 9 and check Studio first.

## 8. Duplicate-upload prevention (verify it holds)

Do these only after section 7 succeeded. They must all be **refused**, and none should create a second
video or a second paid render.

- [ ] Press publish again for the same render: refused, "already published".
- [ ] Try to render the same script again: refused, "already has a YouTube upload" (this is the
      script-level guard from PR #16).
- [ ] The Production page shows no **Needs attention** item about duplicate uploads.
- [ ] YouTube Studio still shows exactly one video for this script.

## 9. Safe recovery after failures

The **Needs attention** panel on the Production page lists stuck or uncertain states. Each item says
what to check and what not to do. In short:

| You see | Meaning | Do | Do not |
|---|---|---|---|
| Render is taking longer than expected | Active more than 45 minutes | Refresh status; check the Cloud Run execution | Re-render. It may still finish |
| Render has been active for hours | Active more than 3 hours | Same, then ask the owner to inspect the execution | Re-render before status says FAILED |
| Render finished but was not delivered | Video exists, callback never arrived | Owner runs the delivery-recovery tool (`media-worker/src/recover-delivery.js`, see `media-worker/README.md`), then Refresh status | Re-render (pays again for an existing video) |
| Render marked complete but has no video | SUCCEEDED with no URL | Refresh status; check the artefact | Upload or re-render |
| YouTube upload is uncertain | Savannah cannot tell if it reached YouTube | Check Studio; use **Find existing YouTube upload**; only if Studio shows nothing, **Confirm no upload** | Upload again, or re-render |
| Upload appears to have stopped | In progress longer than one execution can run | Check Studio. Savannah marks it uncertain by itself | Upload again |
| Failed upload still points at a video | A video ID was recorded | Verify in Studio, then reconcile | Upload again |
| Same script on YouTube more than once | A duplicate already exists | Remove the unwanted copy in Studio. Savannah deletes nothing | Upload again |
| Task "Stopped by the queue: ..." | A queued step failed and was stopped so it could not block the others | Read the message, fix the cause, then **Resume** | Re-render or re-prepare repeatedly |
| Task "interrupted 3 times" | A scene kept timing out or crashing; the queue stopped retrying | Check the Logs sheet (`PRODUCTION_RECOVERY`), then **Resume** once | Resume in a loop. Each attempt can cost money |
| Log: "stuck submitting ... linked to render" | A submission died after the render started; Savannah linked the task to that render | Watch that render; use Refresh status | Submit or re-render again |
| Log: "stuck submitting ... returned to READY" | A submission died before any render started | Nothing. The queue submits it once | Submit it by hand as well |
| The media worker never confirmed this render | A render was submitted but the worker's confirmation never arrived; it may be running and billing | Press Refresh status and wait. It resolves by the callback or by reconciliation | Re-render. Ask the owner to check the Cloud Run execution only if it is still unconfirmed after several hours |
| A queued submission never finished | A task began submitting and did not finish; a render may or may not have started | Wait for the queue's next run (it links or resets the task). If the queue is off, check Render jobs for this script | Submit it again |
| A queued task failed | The queue stopped a step; the message says why | Fix the cause, then **Resume** | Re-render by hand while it is unexplained |
| A queued task stopped after repeated interruptions | A step kept timing out or crashing | Read Logs (`PRODUCTION_RECOVERY`), then **Resume** once | Resume in a loop. Each attempt can cost money |
| A queued task points at a render that cannot be found | Task and render records disagree | Look for a render of this script in Render jobs; if none, ask the owner to review the Production Tasks and Render Jobs tabs | Submit it again |
| Video link has expired / expires soon | The signed download link (7 days at most) has run out | Owner runs the delivery-recovery tool for that render ID; Savannah accepts the renewed link for the same video and keeps its approval | Re-render (the video still exists) |
| A finished video arrived for an unknown render | A submission was interrupted after the worker accepted it | Follow **Unmatched delivery** below | Press Re-render safely on the interrupted render |

### Unmatched delivery

Savannah received a finished video for a render ID (`cr-…`) that no row in **Render Jobs** has. A render
submission was interrupted (the Production page shows a FAILED render saying "interrupted before the
provider returned an ID") after the worker had already started. The video exists and was paid for.

1. Open the spreadsheet's **Render Callback Inbox** tab and find the row with that render ID. Note its
   **Received At** time.
2. In **Render Jobs**, find the FAILED render with the "interrupted" message whose **Created At** is a
   few minutes earlier, for the script you expect. If more than one could match, stop and check the Cloud
   Run execution for the render ID first.
3. On that Render Jobs row, set **Render ID** to the `cr-…` value, set **Status** to `RENDERING`, and
   clear **Error Message**.
4. If the inbox row's **Result** says `ORPHANED`, clear its **Handled At** and **Result** cells.
5. In the Apps Script editor, run `drainCallbackInboxNow`. The inbox row should change to `APPLIED`,
   and the render to SUCCEEDED with its video. Then review and approve it as normal.

Recovery actions cannot bypass the script-level upload guard: while any render of a script has a
published, in-progress, uncertain or evidence-bearing upload, re-rendering and uploading that script
are refused.

After an Apps Script execution failure (timeout, quota, deployment problem): reopen the Production page.
Stale in-progress uploads are moved to uncertain automatically and a **PRODUCTION_RECOVERY** warning is
written to the Logs sheet naming the upload and render IDs. Read that before touching anything.

## 9a. Stop spending right now

If anything looks wrong and a render is running, do these three things first. None of them deletes data.

1. On the Production page turn **Background automation** off, so nothing new is submitted.
2. Do not press Re-render, Resume or publish.
3. Open **Cloud Run → Jobs → `savannah-render-job` → Executions** and, if one is running and you do not
   want it, press **Cancel** on that execution. A cancelled render is final: do not retry it until you
   know why you stopped it.

## 9b. Roll back

Use this if live acceptance fails in a way section 9 does not cover. The order matters: stop spending
(9a), then undo, then write down what happened.

| Undo | How (you do this) | Safe because |
|---|---|---|
| The new app version | **Deploy → Manage deployments → edit (pencil) → Version → choose the previous version (the one before this release; `RELEASE_READINESS.md` calls it v89) → Deploy** | Same deployment, same address, so nothing else changes |
| The callback address | Set the `MEDIA_WORKER_CALLBACK_URL` script property back to its previous value (write the old value down **before** you change it) | Deliveries already received stay in the inbox sheet and are applied once the new version returns |
| A bad worker image | **Cloud Run → Services → `savannah-media-worker-dispatcher` → Revisions**, choose the previous revision, **Manage traffic → 100%** | Revisions are kept; this is a switch, not a rebuild |
| The render job | The job uses its latest image. Redeploy the previous image tag to `savannah-render-job` | Same |

What not to do while rolling back: do not delete the Render Jobs, Publishing Jobs, Production Tasks or
Render Callback Inbox tabs, do not delete a YouTube video, and do not re-render to "see if it is fixed".
Everything the system learned is in those tabs, and the recovery rules rely on them.

## 10. Record the outcome

- [ ] Write down: Apps Script version, render job ID, execution name, publishing job ID, YouTube video ID,
      date, and pass or fail for each section above.
- [ ] Anything that failed becomes an issue before the next attempt. Do not retry blindly.
