# Deployment safety: corrected sequence, verified prerequisites, rollback rules

Status: development procedure. Nothing here has been run against production. Each step that changes a live deployment, a Secret Manager version, a Script property, traffic or a switch is a separate owner approval. The read-only evidence below was gathered on 17 November 2026; re-run it before any approval.

## 1. Corrections over time

- The first sequence reopened submissions before REQUIRE_SUBMIT_INTENT=yes was active. Removed. Submissions reopen only at the last step.
- The first sequence assumed the pause switches could close submissions before any deployment. The deployed worker and Apps Script read neither switch, so they cannot be the first closure. The secret is.
- The first rollback could move worker traffic to an older revision that still accepted the legacy secret. Forbidden (section 5).
- Script properties belong to the Apps Script project, not to a deployment version.
- Review of 17 November: rotating the secret is not an atomic switch. Cloud Run resolves secret references when an instance starts, and tagged revisions are reachable even at 0% traffic. Both are now checked against the live configuration (section 2a).

## 2. The independent block: the worker's secret

The worker accepts only the value of JOB_SUBMIT_SECRET it is configured with, checked before any handler (`media-worker/src/lib/auth.js`). A refused request writes no job state and starts no execution. Tested on the real dispatcher app: `media-worker/test/secretBlock.test.js`, 4 tests.

Whether the block holds in production depends on more than the secret value. Section 2a lists the facts that must hold.

A refusal is HTTP 401. The Apps Script treats a 401 as a definite refusal: rows are marked FAILED with no render ID, not left active as unknown outcomes.

Do **not** set JOB_SUBMIT_SECRET_PREVIOUS. Setting it keeps the old value accepted (tested).

## 2a. Verified prerequisites: live configuration (read-only, 17 November 2026)

Evidence file: `media-worker/test/fixtures/dispatcher-revisions-2026-11-17.json` (names, tags, traffic, secret references and version states; no secret values). The model that uses it is `tools/production/revision-inventory.mjs`, tested in `media-worker/test/revisionInventory.test.js` (10 tests).

Read-only commands used (gcloud needs the Cloud SDK's bundled Python on this machine, set through CLOUDSDK_PYTHON):

    gcloud config get-value project
    gcloud run services list --region europe-west2
    gcloud run services describe savannah-media-worker-dispatcher --region europe-west2 --format=json
    gcloud run revisions list --service savannah-media-worker-dispatcher --region europe-west2 --format=json
    gcloud secrets list
    gcloud secrets versions list job-submit-secret --format=json
    gcloud run services get-iam-policy savannah-media-worker-dispatcher --region europe-west2
    gcloud run jobs get-iam-policy savannah-render-job --region europe-west2
    Cloud Monitoring timeSeries.list: run.googleapis.com/container/instance_count and request_count, per revision

Findings:

| Fact | Evidence | Consequence |
|---|---|---|
| The service is publicly invokable | Ingress `all`; invoker binding `allUsers` | The bearer secret is the only application-level gate |
| Live traffic: 100% to `00030-wam` | Service traffic | The live code is the legacy code: no intent guard, no pause gate (image digest prefix `576bb6de`) |
| The live revision references JOB_SUBMIT_SECRET version 2; no PREVIOUS | Revision environment | Live already refuses the legacy value on new instances (assuming the Apps Script was moved to version 2; see P1) |
| Secret versions: 2 enabled (created 27 Oct 2026); 1 disabled (created 4 Aug 2026); none destroyed | `secrets versions list` | Version 1 can be re-enabled. That is the undo step in the release runbook |
| Nine candidate revisions are tagged at 0% traffic, so each has a public URL | Service traffic tags | Reachable, although receiving no traffic |
| **`00009-man` is tagged `candidate` and references version 1** | Revision environment | **A reachable legacy revision. It blocks deployment approval.** Re-enabling version 1 would make it accept the legacy value on its public tag URL |
| `00010-ndp` references version 1 through JOB_SUBMIT_SECRET_PREVIOUS; untagged, no traffic | Revision environment | Unreachable today; becomes reachable if a tag or traffic is added |
| Revisions `00001-qqp`…`00008-btl` reference `latest` | Revision environment | `latest` means the newest **enabled** version: version 2 today. If version 2 were disabled, these would accept the legacy value |
| Only `00030-wam` has ever run in the last seven days; at most one instance; the last instance was observed 10 Nov 2026 18:29 UTC; five requests in seven days | Cloud Monitoring | No instance is running now. Instances that could hold an old value in memory are not evident. This is evidence over seven days, not proof of absence |
| The render job can be run only by the dispatcher's service account (`run.invoker`, `run.jobsExecutorWithOverrides`) | Job IAM | An automated direct run is not possible; a human with project rights could still run it. That is an owner-controlled path |
| The Apps Script's held value (MEDIA_WORKER_JOB_SUBMIT_SECRET) | Not readable from here; Script properties are secret | Unverified. The release record marks the owner's comparison as MATCHES, but its execution is not confirmed by this review |

### What Cloud Run does with a secret reference (official documentation)

- Environment-variable secrets are resolved **at instance startup**. If the fetch fails, the instance does not start. Source: Cloud Run, "Configure secrets for services" (https://docs.cloud.google.com/run/docs/configuring/services/secrets).
- Pinning a version is recommended over `latest`. A `latest` reference can stop new instances from starting when a new version is a problem. Source: the same page and Secret Manager best practices (https://docs.cloud.google.com/secret-manager/docs/best-practices).
- Disabling a version is reversible. Source: Secret Manager documentation, as cited in the same search.
- Whether `latest` resolves to a disabled version is an inference, not stated in those sources. The model treats it as the newest enabled version, and the owner should confirm it.

What this means for "old instances retaining credentials": an instance keeps its environment for its lifetime, so an instance started before the rotation could still hold the legacy value. None is evident now (section 2a, Monitoring). A new instance of `00009-man` or `00010-ndp` cannot start while version 1 is disabled. Re-enabling version 1 would allow it, which is why a reachable revision that references version 1 must be removed from reach, not merely left at 0%.

### Prerequisites before any rotation or deployment approval (each one an owner step)

- **P1. Confirm the Apps Script holds the version 2 value** (the owner compares it with the rotation file using the release-record tooling; no value is printed). If it holds version 1, production submissions are already being refused with 401 and the release record must say so.
- **P2. Make `00009-man` unreachable**: remove its `candidate` tag (and, to keep the set minimal, the other candidate tags) with a traffic change the owner approves. Then `assessRevisions` must report safe. Deleting the revision is irreversible and is a separate choice.
- **P3. Decide `00010-ndp`**: leave it untagged (it stays unreachable), or delete it. Never add a tag or traffic to it without re-running the assessment.
- **P4. Keep version 1 disabled.** Re-enabling it is the release runbook's undo step, so this rule must be a decision: no re-enable without re-running section 2a. This is a policy against a documented undo step and needs the owner's agreement.
- **P5. Review the `latest` references** (`00001`–`00008`). Pinning or removing them is a later decision; until then, disabling version 2 must not happen.
- **P6. Re-run the read-only inventory immediately before approval**, and feed it through `assessRevisions`. The committed snapshot is evidence, not approval.
- **P7. If reachability cannot be closed**, a separate ingress control (for example a load balancer with IAM in front of the service) is the alternative. It is not built, and until it exists the deployment is blocked.

Until P1, P2 and P6 are complete, the rotation is not approved. The gate is "NOT SAFE" by the rule, not by a judgement about the procedure.

## 3. Corrected rollout order (logical model: `tools/production/rollout-guard.mjs`, `CONTROLLED_PLAN`)

Submissions stay closed from step 1 until step 7. Each step is a separate owner approval. Before approving any step, the owner also requires `approvalReady` to pass: the plan passes AND the live inventory has no reachable legacy revision.

1. **Rotate the worker's secret** (section 2). Verify with the contract check that the legacy value gets 401 on both routes. Prerequisites P1, P2, P6 first.
2. **Deploy the gated worker revision** holding the new secret, with SUBMISSIONS_PAUSED=yes and REQUIRE_SUBMIT_INTENT unset. Verify /health reports submissionsPaused true and requireSubmitIntent false. Verify the legacy value still gets 401. Confirm the new revision's secret reference is the current version.
3. **Set the Apps Script project's properties**: MEDIA_WORKER_JOB_SUBMIT_SECRET to the new value, and SUBMISSIONS_PAUSED to yes.
4. **Deploy the new Apps Script version** (reads the pause property, sends intents). The owner confirms in the editor which code each trigger runs; they must run the new version.
5. **Enable REQUIRE_SUBMIT_INTENT=yes** on the worker, still paused. Contract check with EXPECT_REQUIRE_SUBMIT_INTENT=yes and EXPECT_SUBMISSIONS_PAUSED=yes.
6. **Confirm the intent path offline** (the Apps Script and browser tests). Do not test it by clicking Create Short on a live page.
7. **Open**: clear the Apps Script SUBMISSIONS_PAUSED property, then the worker's SUBMISSIONS_PAUSED. Contract check with EXPECT_SUBMISSIONS_PAUSED=no.

## 4. What the rollout rules guarantee (`media-worker/test/rolloutGuard.test.js`, 15 tests; logical model)

- Opening is refused until REQUIRE_SUBMIT_INTENT is yes and both ends are the new versions.
- Worker deploys, Apps Script deploys, rollbacks and the intent switch are refused while submissions are open.
- A legacy Apps Script version cannot be given the accepted secret while the worker has no pause gate.
- An old worker revision without the intent guard can be rolled back to while closed, but never reopened.
- These rules assume the state values are correct. Section 2a is what checks them.

## 5. Rollback rules: never reopen through an unprotected older worker

- **R1. Close first.** Pause the worker, set the Apps Script pause property, or rotate the secret. Rollbacks are refused while open.
- **R2. Never move worker traffic to a revision that accepts the legacy value, or lacks the intent guard, while submissions could open.** Check the target's secret reference is the current version, and run `assessRevisions` on the live inventory after the move. An older revision may be rolled back to only while closed, and it can never be reopened.
- **R3. Rolling the Apps Script back to legacy code does not change the project's properties.** A legacy version holding the current secret is safe only while the worker is paused.
- **R4. Reopening after any rollback repeats section 3 from step 1.**

Rollback procedure, each step approved:

1. Close: pause the live worker revision and set the Apps Script pause property to yes. Confirm the legacy value still gets 401.
2. Confirm no active render rows (`next-version-check.md`, step 4).
3. If the Apps Script must go back, roll it back to the recorded version. Keep the worker paused.
4. If the worker must go back, roll back only to a revision whose secret reference is the current version, paused or closed by its own gate, and re-run `assessRevisions` on the resulting inventory. Otherwise keep the live revision.
5. Run the contract check with the closed expectations.
6. Reopen only by section 3, from step 1.

## 6. The non-executing contract check (`tools/production/verify-worker-contract.mjs`)

It sends only requests the dispatcher must refuse, so nothing starts. It checks identity and the switches (or reports that a legacy revision does not report them), and, when `PRODUCTION_LEGACY_SECRET` is set, that the legacy value gets 401 on both routes. A body that could start a render is checked to be invalid before it is sent. It refuses staging identities and never prints a secret. Tests: `media-worker/test/productionContractCheck.test.js`, 9 tests.

Its probes go to the **service** URL. It does not probe tag URLs, because that would be a production request to a revision that is not yet reconciled. A probe of tag URLs needs the owner's approval.

## 7. What this does not establish

- The production rotation, traffic and tag changes have not been made. Each is an owner step.
- The Apps Script's held value and the trigger code versions are not verified from here.
- The instance evidence is seven days of metrics, not an instance list.
- Stranded version claims and the live sheet are untested together with Cloud Run.
- The browser and workflow tests use a mocked server and a fake job client.
