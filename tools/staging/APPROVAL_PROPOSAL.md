# Isolated staging: consolidated approval proposal (v18 worker)

Status: **proposal only. Nothing below has been created, linked, deployed or run.** Approval is requested per item in
the last section. Production (main app v97, dispatcher revision `savannah-media-worker-dispatcher-00015-bay` at 100%,
render job image `media-worker@sha256:d010ddcf…`) is not touched by any step.

## 1. Goal

Run the real Cloud Run dispatcher, render job, Cloud Storage and job-state code (v18 candidate) against an isolated
staging copy, with **no paid AI calls, no production callbacks, and no YouTube access**. The staging job runs
`staging-job-runner.js`, which uses the stub pipeline: music preparation is real, every paid step is skipped.

## 2. Isolation: what makes staging unable to reach production

| Boundary | How it is enforced | Where it is tested |
|---|---|---|
| GCP project | New project `savannah-staging-worker`. No production service account is granted anything in it | Manual: IAM review before first run |
| Storage bucket | New bucket `savannah-staging-media`. The dispatcher refuses to start unless `GCS_BUCKET` contains "staging" | `environment.test.js` |
| Project name | The dispatcher refuses to start unless `CLOUD_RUN_PROJECT` contains "staging" | `environment.test.js` |
| Paid AI | Staging refuses to start if any of `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `PEXELS_API_KEY` is set. The staging job never imports `config.js`, so it cannot read those keys at all | `environment.test.js`; `staging-job-runner.js` |
| Callbacks | Staging posts only to endpoints in `CALLBACK_URL_ALLOWLIST` (the staging web app only). A callback to any other URL fails the attempt before a render, and the dispatcher refuses it with 400 at submit | `dispatcherIntegration.test.js` (staging allowlist), `renderRequest.test.js` |
| Music | Staging loads only `music/staging-manifest.json` (one synthetic tone, CC0, no real music). Production refuses `MUSIC_MANIFEST_PATH` | `environment.test.js`, `musicLicence` tests |
| YouTube | No YouTube credentials in staging. The staging Apps Script uses its existing environment guard, which refuses every upload. The publishing preview is read-only | `StagingIsolation_Tests.js` (5/5), `StagingProjectSimulation_Tests.js` (6/6) |
| Wrong target | The verifier refuses to send any job request unless `/health` reports `environment=staging`, the expected project and the expected service | `stagingVerifier.test.js` (6 tests) |

## 3. Resources to create (all in `savannah-staging-worker`, region `europe-west2`)

| Resource | Name (proposed) | Configuration |
|---|---|---|
| Project | `savannah-staging-worker` | Billing linked only to a budget with alerts (see §5) |
| Artifact Registry | repo `staging-images` | One image: the v18 candidate, rebuilt from the approved commit |
| Bucket | `savannah-staging-media` | Uniform bucket-level access, public access prevention enforced, no versioning, lifecycle rule deleting objects after 7 days |
| Secret | `staging-submit-secret`, `staging-callback-secret` | Staging-only random values. Not copied from production |
| Cloud Run service | `savannah-staging-dispatcher` | Min instances 0, max instances 1, CPU 1, 512 MiB. Env: `SAVANNAH_ENVIRONMENT=staging`, `CLOUD_RUN_PROJECT=savannah-staging-worker`, `GCS_BUCKET=savannah-staging-media`, `RENDER_JOB_NAME=staging-render-job`, `RENDER_JOB_ALLOWED_IMAGES=<staging image digest>`, `CALLBACK_URL_ALLOWLIST=<staging web app /exec URL>`, `MUSIC_MANIFEST_PATH=music/staging-manifest.json`. Secret: `JOB_SUBMIT_SECRET` from `staging-submit-secret`. Unauthenticated invocation allowed (the app-level secret gates `/jobs`, as in production) |
| Cloud Run job | `staging-render-job` | Image: the same v18 digest (runs `staging-job-runner.js` via the `CMD` override). Task timeout 300 s, max retries 0, parallelism 1, tasks 1, CPU 1, 1 GiB. Env as above, no paid keys. No secrets |
| Service account | `dispatcher-staging@` | Roles: `run.developer` on `staging-render-job` only; `storage.objectAdmin` on `savannah-staging-media` only |
| Service account | `render-staging@` | Roles: `storage.objectAdmin` on `savannah-staging-media` only |
| Staging spreadsheet + Apps Script | per `CALLBACK_INBOX_STAGING.md` (Parts 3 to 5) | Empty spreadsheet named with "STAGING". `SAVANNAH_ENVIRONMENT=staging` in the staging script properties only |

Not created: any production resource, any paid AI key, any YouTube credential, any load balancer, any scheduler.

## 4. Permissions summary

- The operator's own account: project owner of `savannah-staging-worker` only, for setup and cleanup.
- `dispatcher-staging@`: runs the staging job and reads and writes the staging bucket. Nothing else.
- `render-staging@`: reads and writes the staging bucket. No Cloud Run, Secret Manager or other project access.
- No account in production is granted any role in staging, and no staging account is granted any role in production.

## 5. Spending cap and cost estimate

- Budget: **£5 per month** on the staging billing account, with alerts at 50%, 90% and 100%. A budget alert does not
  stop spending by itself. The cap holds because the staging run has no paid AI service to spend on, and it is
  limited to the executions listed in §7.
- Estimates (list price, to be confirmed in the billing calculator before approval):

| Item | Estimate |
|---|---|
| Artifact Registry, one image of about 150 MB | about £0.02 per month |
| Cloud Build (if the image is built in staging), 2 to 3 minutes | about £0.02 per build |
| Dispatcher, idle (min instances 0) | about £0 |
| One dry-run execution (CPU 1, 1 GiB, about 20 s) | under £0.01 |
| One stub-pipeline execution (about 60 s) | under £0.01 |
| Bucket and secrets | under £0.01 per month |
| Whole staging run, §7 | under £0.20 |

## 6. Cleanup

1. Delete the staging job executions and the Cloud Run services (`savannah-staging-dispatcher`, `staging-render-job`).
2. Empty and delete `savannah-staging-media` (`gcloud storage rm -r gs://savannah-staging-media/**`, then delete the bucket).
3. Delete the Artifact Registry repository `staging-images`.
4. Delete the secrets and the two service accounts.
5. Archive the staging spreadsheet (no production references) and delete the staging Apps Script project.
6. Shut down the project `savannah-staging-worker` at the end. Shutdown keeps a 30-day recovery window; no production resource is in it.
7. Record each step and its verification in `RELEASE_READINESS.md` §18g.

## 7. Tests to execute, in order (each one is a non-paid check)

| Step | Test | Expected result | Approval needed |
|---|---|---|---|
| S1 | Verifier identity check and the five refusals (`tools/staging/verify-worker-staging.mjs`, no execution flag) | 6 of 6 pass; zero jobs started | Yes, A7 |
| S2 | One dry-run execution (`STAGING_ALLOW_EXECUTION=yes`) | 202 with an execution name; job reads its request and exits | Yes, A8 |
| S3 | Accepted request, stub render, callback to the staging web app, inbox persistence (checks C1 to C12 of `CALLBACK_INBOX_STAGING.md`) | Completed render recorded; C1 to C12 pass | Yes, A9 |
| S4 | Replay: the same callback sent twice | Applied once (C3) | Yes, A9 |
| S5 | Interrupted delivery: the callback endpoint fails once | Retried; one applied result | Yes, A9 |
| S6 | Duplicate submissions while queued, while running (from inside the stub render), and after success | 409 each time; exactly one execution | Yes, A9 |
| S7 | Forced failure after music preparation | Failed state and failed callback; a new render ID succeeds and the failed row is untouched | Yes, A9 |
| S8 | Non-allowlisted render image (second staging revision whose job image is not in `RENDER_JOB_ALLOWED_IMAGES`) | 409 from the dispatcher; nothing started | Yes, A10 |
| S9 | Read-only publishing preview in the staging app, then publish | Preview returns the exact details and the attempt ID; publish is refused by the staging guard; no YouTube contact | Yes, A9 |
| S10 | Rollback drill: move traffic to the previous staging revision and back; swap the job image and back | Spreadsheet row counts and bucket object list identical before and after | Yes, A11 |
| S11 | Measure the in-flight duplicate gap: a submission while the job is running, between payload deletion and completion | Recorded as evidence. Expected: refused by the job-state reservation (see §18g) | Covered by S6 |

Local suites that must stay green before and after staging: worker `node --test`, main-app `node node-tests/run-local.cjs`.

## 8. Approvals requested

| # | Approval | Covers |
|---|---|---|
| A1 | Create project `savannah-staging-worker` and link a budget-capped billing account | §3, §5 |
| A2 | Create the Artifact Registry repo and push the staging image (rebuilt from the approved commit) | §3 |
| A3 | Create bucket `savannah-staging-media` with the settings in §3 | §3 |
| A4 | Create the two staging secrets (random values, staging only) and the two service accounts with §4 roles | §3, §4 |
| A5 | Deploy `savannah-staging-dispatcher` (no traffic until S1) and `staging-render-job` | §3 |
| A6 | Create the staging spreadsheet and staging Apps Script per `CALLBACK_INBOX_STAGING.md` | §3 |
| A7 | Run S1 (non-paid verifier) | §7 |
| A8 | Run S2 (one dry-run execution) | §7 |
| A9 | Run S3 to S7 and S9 (stub-pipeline executions) | §7 |
| A10 | Create the second revision for S8 | §7 |
| A11 | Run the rollback drill S10 | §7 |
| A12 | Cleanup, §6 | §6 |

Not requested and not covered by any of A1 to A12: paid AI renders, production changes, music upload to production
storage, YouTube uploads, or any change to the production callback endpoint.

## 9. Known limits to accept before approving

- The duplicate protection depends on Cloud Storage generation preconditions. The local tests model that contract with an in-memory store; the real bucket behaviour is measured in S6.
- Recovery needs an operator to confirm that no execution is running. A job still running after its task timeout (300 s in staging, 1200 s in production) could be recovered by mistake. Check `/jobs/status` before using recovery.
- A job whose state write fails after a successful render stays `running` (blocked). Recovery needs the explicit operation, and it refuses if the video was delivered.
- The stub pipeline does not render. S3 proves the callback, inbox and persistence path, not video quality.
