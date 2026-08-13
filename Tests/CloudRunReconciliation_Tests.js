/****************************************************
 * Project Savannah - Cloud Run status reconciliation tests (Increment 2A).
 * Exercises CloudRunFFmpegProvider.reconcileStatus() only - a pure function, no
 * UrlFetchApp call, no paid provider, no Sheet row created.
 ****************************************************/
function runCloudRunReconciliationTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  const CR_ID = "cr-11111111-1111-1111-1111-111111111111";
  const EXECUTION_NAME = "projects/savannah-media-worker/locations/europe-west2/jobs/savannah-render-job/executions/savannah-render-job-abcde";
  const OPERATION_NAME = "projects/savannah-media-worker/locations/europe-west2/operations/op-12345";

  function job_(overrides) {
    const source = overrides || {};
    return RenderJobModel.create(Object.assign({
      scriptId: "SCR-TEST",
      templateId: "cloud-run-worker",
      status: "RENDERING",
      renderId: CR_ID,
      createdAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z"
    }, source));
  }

  function withIdentifiers_(job) {
    return Object.assign({}, job, { providerResponse: { cloudRun: { executionName: EXECUTION_NAME, operationName: OPERATION_NAME, lastObservedState: "", lastExternalProgressAt: "" } } });
  }

  function statusResponse_(overrides) {
    return Object.assign({
      jobId: CR_ID, state: "UNKNOWN", operationName: OPERATION_NAME, executionName: EXECUTION_NAME,
      artifactExists: false, probeExists: false, probePassed: false, failureDetail: null,
      checkedAt: "2026-08-13T11:00:00.000Z"
    }, overrides || {});
  }

  test("1. PENDING keeps an active job active", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })), statusResponse_({ state: "PENDING" }));
    if (result.status !== "rendering") throw new Error("PENDING must not change an active job's status.");
    if (result.reconciliation) throw new Error("PENDING must not set reconciliation metadata.");
  });

  test("2. RUNNING keeps an active job active", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })), statusResponse_({ state: "RUNNING" }));
    if (result.status !== "rendering") throw new Error("RUNNING must not change an active job's status.");
  });

  test("3. FAILED with no artifact maps to FAILED", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })),
      statusResponse_({ state: "FAILED", artifactExists: false, failureDetail: "exit code 1" }));
    if (result.status !== "failed") throw new Error("FAILED with no artifact must map to FAILED.");
    if (!result.reconciliation || result.reconciliation.reason !== "CLOUD_RUN_EXECUTION_FAILED") {
      throw new Error("FAILED with no artifact must record reason CLOUD_RUN_EXECUTION_FAILED.");
    }
  });

  test("4. FAILED with a valid artifact is recovery-required, not FAILED", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })),
      statusResponse_({ state: "FAILED", artifactExists: true, probeExists: true, probePassed: true, failureDetail: "signBlob missing" }));
    if (result.status === "failed") throw new Error("FAILED with an existing artifact must NOT become plain FAILED (would expose an automatic re-render).");
    if (result.status !== "rendering") throw new Error("FAILED with an existing artifact must leave the job's status untouched.");
    if (!result.reconciliation || result.reconciliation.reason !== "DELIVERY_RECOVERY_REQUIRED") {
      throw new Error("FAILED with an existing artifact must record reason DELIVERY_RECOVERY_REQUIRED.");
    }
  });

  test("5. SUCCEEDED with artifact but still-active row is recovery-required, not SUCCEEDED", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })),
      statusResponse_({ state: "SUCCEEDED", artifactExists: true, probeExists: true, probePassed: true }));
    if (result.status === "succeeded") throw new Error("An Execution success must not blindly become local SUCCEEDED without a delivered callback.");
    if (!result.reconciliation || result.reconciliation.reason !== "DELIVERY_RECOVERY_REQUIRED") {
      throw new Error("SUCCEEDED-while-still-active with an artifact must record reason DELIVERY_RECOVERY_REQUIRED.");
    }
  });

  test("6. UNKNOWN causes no terminal transition", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })), statusResponse_({ state: "UNKNOWN" }));
    if (result.status !== "rendering") throw new Error("UNKNOWN must never cause a terminal transition.");
    if (result.reconciliation) throw new Error("A plain UNKNOWN with identifiers present must not fabricate reconciliation metadata.");
  });

  test("7. A single NOT_FOUND causes no terminal transition, only an observation", function () {
    const result = CloudRunFFmpegProvider.reconcileStatus(withIdentifiers_(job_({ status: "RENDERING" })), statusResponse_({ state: "NOT_FOUND" }));
    if (result.status !== "rendering") throw new Error("A single NOT_FOUND must never terminally fail a job.");
    if (!result.reconciliation || result.reconciliation.reason !== "NOT_FOUND_OBSERVED" || result.reconciliation.evidence.notFoundCount !== 1) {
      throw new Error("NOT_FOUND must be persisted as an observation for later repeated-not-found logic.");
    }
  });

  test("8. Historical row, no identifiers, stale by createdAt, no artifact -> FAILED / STALE_NO_OPERATION", function () {
    const oldJob = job_({ status: "RENDERING", createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() });
    const result = CloudRunFFmpegProvider.reconcileStatus(oldJob, statusResponse_({ state: "UNKNOWN", artifactExists: false }));
    if (result.status !== "failed") throw new Error("A stale, identifier-less historical row with no artifact must become FAILED.");
    if (!result.reconciliation || result.reconciliation.reason !== "STALE_NO_OPERATION") {
      throw new Error("The stale historical fallback must record reason STALE_NO_OPERATION.");
    }
  });

  test("9. Historical row, no identifiers, stale, but an artifact exists -> NOT auto-failed", function () {
    const oldJob = job_({ status: "RENDERING", createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() });
    const result = CloudRunFFmpegProvider.reconcileStatus(oldJob, statusResponse_({ state: "UNKNOWN", artifactExists: true }));
    if (result.status === "failed") throw new Error("A stale historical row with an existing artifact must NOT be auto-failed.");
    if (!result.reconciliation || result.reconciliation.reason !== "DELIVERY_RECOVERY_REQUIRED") {
      throw new Error("A stale historical row with an artifact must record reason DELIVERY_RECOVERY_REQUIRED instead.");
    }
  });

  test("10. Staleness is judged from createdAt only, never updatedAt", function () {
    const recentlyPolled = job_({
      status: "RENDERING",
      createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString() // just polled a second ago
    });
    const staleResult = CloudRunFFmpegProvider.reconcileStatus(recentlyPolled, statusResponse_({ state: "UNKNOWN", artifactExists: false }));
    if (staleResult.status !== "failed") {
      throw new Error("A recently-polled updatedAt must not mask a genuinely stale createdAt.");
    }
    const freshJob = job_({
      status: "RENDERING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() // stale-looking updatedAt, fresh createdAt
    });
    const freshResult = CloudRunFFmpegProvider.reconcileStatus(freshJob, statusResponse_({ state: "UNKNOWN", artifactExists: false }));
    if (freshResult.status === "failed") {
      throw new Error("A stale-looking updatedAt on a genuinely fresh createdAt must not trigger STALE_NO_OPERATION.");
    }
  });

  test("11. executionName/operationName survive the providerResponse round-trip", function () {
    const job = withIdentifiers_(job_({ status: "RENDERING" }));
    const result = CloudRunFFmpegProvider.reconcileStatus(job, statusResponse_({ state: "RUNNING", executionName: EXECUTION_NAME, operationName: OPERATION_NAME }));
    if (result.cloudRun.executionName !== EXECUTION_NAME || result.cloudRun.operationName !== OPERATION_NAME) {
      throw new Error("Execution/operation identifiers must be preserved across a status refresh.");
    }
    // The dispatcher may echo an empty operationName back once executionName is known - the
    // previously-known identifier must still not be dropped from providerResponse.
    const echoedBack = CloudRunFFmpegProvider.reconcileStatus(
      Object.assign({}, job, { providerResponse: { cloudRun: result.cloudRun } }),
      statusResponse_({ state: "RUNNING", executionName: EXECUTION_NAME, operationName: null })
    );
    if (echoedBack.cloudRun.operationName !== OPERATION_NAME) {
      throw new Error("A previously-known operationName must not be lost when a later response omits it.");
    }
  });

  test("12. Creatomate routing and provider are untouched", function () {
    const creatomateJob = { renderId: "REND-NOT-CLOUD-RUN" };
    if (VideoProcessingProvider.forJob(creatomateJob) !== CreatomateProviderAdapter) {
      throw new Error("Non-cr- renderIds must still route to CreatomateProviderAdapter.");
    }
    if (typeof CreatomateProviderAdapter.getRender !== "function" || typeof CreatomateProviderAdapter.submitRender !== "function") {
      throw new Error("CreatomateProviderAdapter's interface must be unchanged.");
    }
  });

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Cloud Run reconciliation tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
