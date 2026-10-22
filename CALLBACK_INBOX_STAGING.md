# Staging Setup and Check: Step-by-Step Guide for Windows

**What this does:** builds a small, completely separate test copy of Savannah ("staging") from
**empty** files, sends it fake "video finished" messages, and checks automatically that they are
handled correctly. Nothing in it touches the real app, the real spreadsheet, YouTube, or any paid
service.

**Time:** about 60–75 minutes the first time. **Status:** prepared, not run yet.
Code: PR #15, branch `integration/v1.4-callback-inbox-and-duration-preflight`.

## Safety summary: why this cannot touch production

| Protection | What it stops |
|---|---|
| Staging starts from a **new, empty** spreadsheet | No production data is copied anywhere |
| The staging project's permissions are **"this spreadsheet only"**: no YouTube, no Drive, no internet | Staging physically cannot upload, read your channel or call a paid service |
| In staging, every paid or publishing action refuses in code (`Utils/EnvironmentGuard.js`) | A second, independent block on the same |
| Staging tools need **both** `SAVANNAH_ENVIRONMENT = staging` **and** a spreadsheet named with "STAGING" | They refuse to run in production even if one setting is wrong |
| The push tool refuses the production script ID | Your repository folder is wired to production; the tool never uses it |
| Test messages are marked "synthetic": the real bridge refuses them, and the real app never applies them | A test aimed at the wrong place changes nothing |
| The sending tool refuses the production web-app address | Same |

**The rules for you:**
- Never add `SAVANNAH_ENVIRONMENT` to the real project.
- Never run `clasp push` inside the repository folder.
- Never paste a production ID into a staging setting.

## Words used in this guide

| Word | Meaning |
|---|---|
| **Production** | The real Savannah app, spreadsheet and Apps Script project you use today. |
| **Staging** | The separate test copy you build below. |
| **Bridge** | A tiny separate Apps Script project that receives "video finished" messages and writes them into a tab called **Render Callback Inbox**. |
| **Script ID** | The ID of an Apps Script project: **Project Settings** (gear icon on the left) → **IDs** → **Script ID**. |
| **Spreadsheet ID** | The long part of a spreadsheet's web address between `/d/` and `/edit`. |
| **Script property** | A named setting: **Project Settings** (gear) → scroll to **Script Properties**. |
| **PowerShell** | Windows' command window: press the Windows key, type `PowerShell`, open **Windows PowerShell**. Paste with right-click or Ctrl+V. |
| **Run a function** | In the Apps Script **Editor** (`< >` icon on the left), open the file, choose the function in the dropdown next to **Debug** at the top, click **Run**, and read the **Execution log** that opens at the bottom. |

---

## Part 1: record production's "before" state (read-only, 10 minutes)

Write these down in Notepad. You'll compare them in Part 6. **Look, don't change anything.**

1. **Production spreadsheet → File → Version history → See version history.** Note the time of the newest
   entry.
2. In the production spreadsheet, note the **last row number** of the **Render Jobs** and **Publishing
   Jobs** tabs (click a tab, press Ctrl+Down Arrow on column A). Note whether a **Render Callback Inbox**
   tab exists (it should not yet).
3. Open the production Apps Script project
   (`https://script.google.com/home/projects/1wELckVWNUqCycAnv7TiRAfGD7kArgX5ACPnIfsIigjWIH1QmlcvfUfUf/edit`)
   → **Deploy → Manage deployments**. Note the active deployment's **version number** and date.
4. Same project → **Project Settings** (gear) → **Script Properties**. Note the property **names** (not
   values). Check that `SAVANNAH_ENVIRONMENT` is **not** there.
5. Same project → **Triggers** (alarm-clock icon). Note how many triggers there are.
6. **YouTube Studio → Content.** Note the newest video and its date.

## Part 2: prepare your computer (10 minutes, once)

1. **Node.js:** in PowerShell run:
   ```powershell
   node -v
   ```
   You need `v20` or higher. If you get an error or a lower version, install the **LTS** version from
   nodejs.org, then close and reopen PowerShell.
2. **Get the code** (this only downloads; it changes nothing online):
   ```powershell
   cd C:\Users\dean9\Documents\GitHub\Project-Savannah
   ```
   ```powershell
   git fetch
   ```
   ```powershell
   git checkout integration/v1.4-callback-inbox-and-duration-preflight
   ```
   ```powershell
   git pull
   ```
3. **Check the code is healthy:**
   ```powershell
   node node-tests\run-local.cjs
   ```
   ```powershell
   $LASTEXITCODE
   ```
   Success: no line starts with `FAIL`, and the second command prints `0`.
4. **Allow command-line access to Apps Script:** open `https://script.google.com/home/usersettings`
   and switch **Google Apps Script API** to **On**.
5. **Sign the command-line tool in:**
   ```powershell
   npx --yes @google/clasp@3.4.1 login
   ```
   A browser opens: choose your Google account and click
   **Allow**. This lets the tool push code to projects you choose. The steps below only ever point it
   at staging.

## Part 3: create the staging spreadsheet and its project (15 minutes)

1. Open `https://sheets.new`. Click **Untitled spreadsheet** (top-left) and rename it exactly
   **`Savannah STAGING`**. The word STAGING is required.
2. In that spreadsheet: **Extensions → Apps Script**. A new tab opens. Click **Untitled project**
   (top-left) and rename it **`Savannah STAGING`**.
3. In that Apps Script tab: **Project Settings** (gear) → under **IDs**, click **Copy** next to
   **Script ID**.
4. In PowerShell (still in the repository folder), type the command below, paste the Script ID in
   place of `PASTE_STAGING_SCRIPT_ID`, and press Enter:
   ```powershell
   node tools\staging\prepare-staging-push.cjs PASTE_STAGING_SCRIPT_ID
   ```
   **Success:** `Prepared … files for the STAGING project (script ID ending …)`, followed by two
   commands. **If it says `REFUSED: That is the PRODUCTION script ID`, stop:** you copied the wrong
   ID. Go back to step 3 *in the STAGING spreadsheet's* Apps Script tab.
5. Copy the **one line** it printed, which starts with `Set-Location`, and run it. It moves into the separate
   staging folder first and pushes only if that worked, so it can never push from your repository folder
   (which is wired to production). **Success:** a list of files, then a line saying the files were pushed.
   Then go back to the repository folder:
   ```powershell
   Set-Location C:\Users\dean9\Documents\GitHub\Project-Savannah
   ```
6. Go back to the Apps Script tab and press F5 to refresh. The file list on the left now shows folders
   such as `App`, `Production` and `Utils`.
7. **Project Settings** (gear) → scroll to **Script Properties** → **Add script property**, and add
   exactly these two:
   - `SAVANNAH_ENVIRONMENT` = `staging`
   - `MEDIA_WORKER_SHARED_SECRET` = a new staging-only secret. Make one in PowerShell; it is copied to
     your clipboard:
     ```powershell
     ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")) | Set-Clipboard
     ```
     Paste it as the value. **Also paste it into Notepad** (don't save the file): you need it twice more.

   Click **Save script properties**. Check there are **no other** properties: no API keys, no worker
   address.

## Part 4: create the staging bridge (15 minutes)

1. Open `https://script.google.com` → **New project**. Rename it (top-left) **`Savannah STAGING bridge`**.
2. Copy the bridge code to the clipboard:
   ```powershell
   cd C:\Users\dean9\Documents\GitHub\Project-Savannah
   ```
   ```powershell
   Get-Content CallbackBridge\CallbackBridge.js -Raw | Set-Clipboard
   ```
   In the editor, click **Code.gs**, press Ctrl+A, then Ctrl+V, then Ctrl+S.
3. **Project Settings** (gear) → tick **Show "appsscript.json" manifest file in editor**. Back in the
   **Editor**, click **appsscript.json**. Then:
   ```powershell
   Get-Content CallbackBridge\appsscript.json -Raw | Set-Clipboard
   ```
   Press Ctrl+A, then Ctrl+V, then Ctrl+S.
4. **Project Settings → Script Properties → Add script property**, and add these three:
   - `MEDIA_WORKER_SHARED_SECRET` = the staging secret from Notepad (the same value as Part 3)
   - `RENDER_JOBS_SPREADSHEET_ID` = the **staging** spreadsheet's ID (open the `Savannah STAGING` sheet
     and copy the part of its address between `/d/` and `/edit`)
   - `SAVANNAH_ENVIRONMENT` = `staging`

   **Check carefully:** `RENDER_JOBS_SPREADSHEET_ID` must **not** be the production spreadsheet's ID.
   Compare it with the production sheet's address: they must differ.
5. **Deploy → New deployment** → click the gear next to **Select type** → **Web app**. Then:
   - **Description:** `staging bridge`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`

   Click **Deploy**, then **Authorize access**, and choose your account. You'll see **"Google hasn't
   verified this app"**; that's normal for your own script. Click **Advanced → Go to Savannah STAGING
   bridge (unsafe) → Allow**. The bridge asks for spreadsheet access because it writes into the staging
   spreadsheet's inbox.
6. Copy the **Web app URL** (it ends in `/exec`) into Notepad.

## Part 5: run the automated check (10 minutes)

1. **Create the test renders.** Go to the **Savannah STAGING** Apps Script tab (not the bridge).
   Open the file `Production/StagingVerification_Service`, choose **`stagingSeedRenderJobs`** in the
   dropdown, and click **Run**.
   - **First time only:** click **Review permissions**, choose your account, then **Advanced → Go to
     Savannah STAGING (unsafe) → Allow**. The only permission asked for is access to *this
     spreadsheet*. **If it asks for YouTube or Drive, stop:** the push in Part 3 went wrong.
   - **Success:** the Execution log shows `Synthetic render jobs created: RND-STG…`, then a line starting
     `node node-tests/staging/run-staging-callbacks.cjs --i-am-targeting-staging` followed by five IDs.
     Copy that whole line.
2. **Send the test messages.** In PowerShell, in the repository folder:
   ```powershell
   cd C:\Users\dean9\Documents\GitHub\Project-Savannah
   ```
   ```powershell
   $env:SAVANNAH_STAGING_BRIDGE_URL = "PASTE_THE_BRIDGE_URL_ENDING_IN_/exec"
   ```
   The next two lines ask for the staging secret without showing it (paste it from Notepad and press Enter):
   ```powershell
   $secure = Read-Host "Paste the staging secret" -AsSecureString
   ```
   ```powershell
   $env:SAVANNAH_STAGING_CALLBACK_SECRET = [System.Net.NetworkCredential]::new("", $secure).Password
   ```
   Now paste the line you copied in step 1 and press Enter.

   **Success:** 12 lines starting `PASS`, then `All 12 bridge checks passed.` The tool never prints the
   secret or the address.
3. **Check the results.** Back in the Savannah STAGING Apps Script tab, choose **`stagingVerifyRun`** and
   click **Run**.

   **Success:** `Staging verification PASSED`, then C1–C12 each marked `PASS`. C10 may say `SKIP`; that's
   fine. **Do not open the staging web app or its Production page during Part 5.**

| Check | What it proves |
|---|---|
| C1 | The bridge writes into **this** staging spreadsheet (correct spreadsheet identity) |
| C2 | A "video finished" message is stored, processed and marks the render complete |
| C3 | Duplicate deliveries and a late "failed" message change nothing |
| C4 | An expired video link can be renewed without paying for a re-render |
| C5 | A wrong secret, malformed ID and unknown status are refused; "finished" without a proper video can't complete a render |
| C6 | A delivery for an unknown render is held, not applied anywhere |
| C7 | A delivery that arrives before its render is saved is applied once the render exists |
| C8 | A "failed" message marks the render failed with the worker's reason (failed-callback handling) |
| C9 | The Production page's data loads (page stability) |
| C10 | The background queue tick runs and processes messages without starting paid work |
| C11 | None of the test renders could be uploaded (safe render and publishing states) |
| C12 | Readiness summary (information only; "BLOCKED" here is expected, because staging has no worker) |

Running `stagingVerifyRun` again is safe. For a completely fresh run, run `stagingSeedRenderJobs` again
(it creates new IDs), then repeat steps 2 and 3.

## Part 6: confirm production is untouched (10 minutes)

Repeat every check from Part 1 and compare with your notes. **Everything must be identical**, apart from
anything you yourself did in the real app meanwhile (so ideally don't use it during staging):

- [ ] Production spreadsheet version history: no new entries from the staging period.
- [ ] Render Jobs and Publishing Jobs last rows unchanged; no new **Render Callback Inbox** tab.
- [ ] Production Apps Script: same deployment version and date; same script property names;
      `SAVANNAH_ENVIRONMENT` absent; same number of triggers.
- [ ] Production Apps Script → **Executions** (list icon): no runs of `stagingSeedRenderJobs` or
      `stagingVerifyRun` (they should only appear in the staging project).
- [ ] YouTube Studio: no new videos.
- [ ] Your repository folder: `git status` shows nothing changed, and `.clasp.json` still points at
      production as before.

## Part 7: if something fails

| What you see | Most likely cause | What to do |
|---|---|---|
| Part 3 step 4 says `REFUSED: … PRODUCTION script ID` | You copied the real project's ID | Copy the ID from the **Savannah STAGING** spreadsheet's Apps Script tab |
| `clasp push` says the Apps Script API is disabled | Part 2 step 4 not done, or not saved yet | Switch it on, wait one minute, try again |
| `clasp push` says "User has not enabled…" or asks to log in | Not signed in | Run `npx --yes @google/clasp@3.4.1 login` again |
| Seeding says `Refused: this is not marked as a staging project` | `SAVANNAH_ENVIRONMENT` is missing or misspelled in the **staging** project | Fix it (exactly `staging`, lower case) |
| Seeding says `…spreadsheet whose name contains STAGING` | The spreadsheet name lacks "STAGING" | Rename the spreadsheet |
| The permission screen mentions YouTube or Drive | The push in Part 3 did not use the tool's folder | Redo Part 3 steps 4–6 |
| Part 5 step 2 prints `REFUSED` | A setting is missing, the address has extra text after `/exec`, or it's the production address | Re-run the two `$env:` lines carefully |
| Many lines say `only accepted by a staging bridge` | The bridge lacks `SAVANNAH_ENVIRONMENT = staging` | Add it in the bridge's Script Properties (Part 4 step 4) |
| T6a fails (wrong secret accepted) | The bridge's secret is missing | Re-check the bridge's `MEDIA_WORKER_SHARED_SECRET` |
| Every line fails with `Callback processing failed.` | The bridge can't open the staging spreadsheet | Check `RENDER_JOBS_SPREADSHEET_ID`; make sure you completed **Authorize access** in Part 4 step 5 |
| C1 fails | The bridge writes to a different spreadsheet | Fix the bridge's `RENDER_JOBS_SPREADSHEET_ID`, then repeat Part 5 from step 1 |
| Anything else, or C9 fails | | Copy the whole Execution log and the PowerShell output into issue #6. Do not change production |

**Starting over is always safe:** delete the staging spreadsheet and the bridge project (Part 8) and
begin again at Part 3.

## Part 8: clean up / roll back (5 minutes)

None of this affects production.

1. Close PowerShell, which forgets the secret, or run:
   ```powershell
   Remove-Item Env:SAVANNAH_STAGING_CALLBACK_SECRET
   ```
2. Close Notepad **without saving**.
3. Bridge project → **Deploy → Manage deployments → Archive**.
4. Delete the push folder:
   ```powershell
   Remove-Item -Recurse -Force "$env:TEMP\savannah-staging-push"
   ```
5. Optional, if you won't re-run staging:
   - delete `Savannah STAGING` in Google Drive, and delete the bridge at `script.google.com` (⋮ → Remove)
   - remove both staging projects at `https://myaccount.google.com/permissions`
   - run `npx --yes @google/clasp@3.4.1 logout`

Keeping the staging spreadsheet and bridge for future checks is also fine. They're clearly labelled and
isolated.

## What needs you

Everything in this guide runs under your Google account, so it's yours to do. The developer side is
finished and tested offline: `node node-tests/StagingFlowEndToEnd_Tests.js` runs Parts 5.1–5.3 against
the real bridge and inbox code with Google faked.

After staging passes, the production steps are in `RELEASE_READINESS.md` §4. They also need you.

## For developers

- Editor helpers: `diagnoseCallbackInbox` (read-only), `drainCallbackInboxNow`,
  `diagnoseReleaseReadiness`, `diagnoseProductionFingerprint` (read-only; usable in production only
  after this branch is deployed).
- Single callbacks for manual testing: `node-tests/staging/send-synthetic-callback.cjs`.
- Isolation tests: `StagingIsolation_Tests.js`, `StagingPushTool_Tests.js`, `SetupSafety_Tests.js`,
  `ConfigCompatibility_Tests.js`.
