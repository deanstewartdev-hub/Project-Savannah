/****************************************************
 * Project Savannah v1.4 - automated callback staging check (STAGING ONLY).
 *
 * Steps 1 and 3 of CALLBACK_INBOX_STAGING.md, run from the Apps Script editor
 * of a STAGING COPY of the spreadsheet:
 *   1. stagingSeedRenderJobs()  adds synthetic render jobs, prints the command
 *      for step 2 (node node-tests/staging/run-staging-callbacks.cjs ...).
 *   3. stagingVerifyRun()       drains the inbox and checks every expected end
 *      state, printing PASS / FAIL / SKIP per check.
 *
 * Both refuse to run unless the script property SAVANNAH_ENVIRONMENT is
 * "staging". Production never has that property. They never call a provider,
 * never upload, and only write synthetic RND-STG* render jobs.
 ****************************************************/
const StagingVerificationService = (() => {
  const RUN_PROPERTY = "SAVANNAH_STAGING_RUN";
  const SYNTHETIC_VIDEO_PREFIX = "https://example.invalid/savannah-staging/";

  // Two independent conditions, so one mistake cannot point these tools at production:
  // the script property AND a spreadsheet whose name says STAGING.
  function assertStaging_(env) {
    if (env.property("SAVANNAH_ENVIRONMENT") !== "staging") {
      throw new Error("Refused: this is not marked as a staging project. In the STAGING project only, add the script " +
        "property SAVANNAH_ENVIRONMENT = staging (see STAGING_SETUP_WINDOWS.md). Never add it to production.");
    }
    if (!/staging/i.test(String(env.spreadsheetName() || ""))) {
      throw new Error("Refused: the spreadsheet this project is attached to is named \"" + env.spreadsheetName() +
        "\". Staging tools only run in a spreadsheet whose name contains STAGING.");
    }
  }

  function seed(env) {
    assertStaging_(env);
    const runId = env.uuid().replace(/-/g, "").slice(0, 8).toLowerCase();
    const ids = [1, 2, 3, 4].map(function () { return "cr-" + env.uuid().toLowerCase(); });
    // A render ID guaranteed to match no render job (T6f).
    const unmatchedId = "cr-00000000-0000-4000-8000-0000" + runId;
    const jobIds = [1, 2, 3, 4].map(function (n) { return "RND-STG" + runId.slice(0, 4).toUpperCase() + "-" + n; });
    // A fresh, empty staging spreadsheet needs the base tabs the Production page reads.
    env.prepareSheets();
    // Job 3 is created later by stagingVerifyRun(), after its delivery has arrived (T7).
    [0, 1, 3].forEach(function (i) { env.createRenderJob(jobIds[i], ids[i]); });
    const run = { runId: runId, ids: ids, unmatchedId: unmatchedId, jobIds: jobIds, seededAt: new Date(env.now()).toISOString() };
    env.setProperty(RUN_PROPERTY, JSON.stringify(run));
    return {
      run: run,
      command: "node node-tests/staging/run-staging-callbacks.cjs --i-am-targeting-staging " +
        ids.join(" ") + " " + unmatchedId
    };
  }

  function verify(env) {
    assertStaging_(env);
    const raw = env.property(RUN_PROPERTY);
    if (!raw) throw new Error("No staging run found. Run stagingSeedRenderJobs() first.");
    const run = JSON.parse(raw);
    const [id1, id2, id3, id4] = run.ids;
    const checks = [];
    function check(id, label, run_) {
      try {
        const outcome = run_();
        if (outcome === "SKIP" || (outcome && outcome.skip)) {
          checks.push({ id: id, result: "SKIP", label: label, detail: outcome.skip || "" });
        } else {
          checks.push({ id: id, result: "PASS", label: label, detail: typeof outcome === "string" ? outcome : "" });
        }
      } catch (caught) {
        checks.push({ id: id, result: "FAIL", label: label, detail: String(caught && caught.message || caught) });
      }
    }
    function expect(condition, message) { if (!condition) throw new Error(message); }
    const receiptsFor = function (renderId) {
      return env.receipts().filter(function (r) { return r.renderId === renderId; });
    };

    check("C1", "Bridge writes to THIS spreadsheet (same-spreadsheet proof)", function () {
      expect(receiptsFor(id1).length > 0, "No receipts for " + id1 + " in this spreadsheet's Render Callback Inbox. " +
        "Either step 2 did not run, or the bridge's RENDER_JOBS_SPREADSHEET_ID points at another spreadsheet.");
      return receiptsFor(id1).length + " receipt(s) for the first render ID arrived here";
    });

    // T7 part 1: the early delivery must be waiting, not applied, before its job exists.
    const job3Existed = !!env.renderJob(run.jobIds[2]);
    let earlyDeferred = null;
    if (!job3Existed) {
      env.drain();
      earlyDeferred = receiptsFor(id3).some(function (r) { return !r.handled; });
      env.createRenderJob(run.jobIds[2], id3);
    }
    const stats = env.drain();

    check("C2", "T1-T4 completed delivery stored, processed and applied", function () {
      const job = env.renderJob(run.jobIds[0]);
      expect(job && job.status === "SUCCEEDED", "Render 1 is " + (job && job.status) + ", expected SUCCEEDED.");
      expect(String(job.videoUrl).indexOf(SYNTHETIC_VIDEO_PREFIX) === 0, "Render 1 has an unexpected video URL.");
      expect(receiptsFor(id1).filter(function (r) { return r.result === "APPLIED"; }).length === 1, "Expected exactly one APPLIED receipt for render 1.");
    });
    check("C3", "T5 duplicate and late-failure deliveries changed nothing", function () {
      const ignored = receiptsFor(id1).filter(function (r) { return r.result === "IGNORED_TERMINAL"; }).length;
      expect(ignored >= 2, "Expected 2 IGNORED_TERMINAL receipts for render 1, found " + ignored + ".");
      expect(env.renderJob(run.jobIds[0]).status === "SUCCEEDED", "A duplicate or late failure changed render 1.");
    });
    check("C4", "T9 delivery recovery renewed the link of the same video", function () {
      const job = env.renderJob(run.jobIds[0]);
      expect(receiptsFor(id1).some(function (r) { return r.result === "LINK_REFRESHED"; }), "No LINK_REFRESHED receipt for render 1.");
      expect(/refreshed=1/.test(job.videoUrl) && job.status === "SUCCEEDED", "Render 1's link was not renewed in place.");
    });
    check("C5", "T6 authentication and invalid callbacks could not change a render", function () {
      const r2 = receiptsFor(id2);
      expect(!env.receipts().some(function (r) { return r.status === "succeeded" || r.renderId === "RND-NOT-A-CLOUD-RUN-ID"; }),
        "A callback the bridge should have refused reached the inbox.");
      expect(r2.length === 2 && r2.every(function (r) { return r.result === "REJECTED_NO_VIDEO"; }),
        "Expected 2 REJECTED_NO_VIDEO receipts for render 2 (wrong-secret, malformed and unknown-status must not appear at all); found " +
          JSON.stringify(r2.map(function (r) { return r.result || "PENDING"; })) + ".");
      expect(env.renderJob(run.jobIds[1]).status === "RENDERING", "Render 2 changed state.");
    });
    check("C6", "T6f delivery for an unknown render is held, not applied", function () {
      const held = receiptsFor(run.unmatchedId);
      expect(held.length === 1 && !held[0].handled, "Expected one pending receipt for the unmatched render ID.");
    });
    check("C7", "T7 a delivery that arrives before its render job is applied once the job exists", function () {
      if (earlyDeferred === false) throw new Error("The early delivery was not waiting before its job existed.");
      const job = env.renderJob(run.jobIds[2]);
      expect(job && job.status === "SUCCEEDED", "Render 3 is " + (job && job.status) + ", expected SUCCEEDED.");
      expect(receiptsFor(id3).some(function (r) { return r.result === "APPLIED"; }), "Render 3's receipt was not applied.");
      return job3Existed ? "re-run: deferral was checked on the first run" : "deferred, then applied";
    });
    check("C8", "T8 failure delivery marks the render FAILED with the worker's message", function () {
      const job = env.renderJob(run.jobIds[3]);
      expect(job && job.status === "FAILED", "Render 4 is " + (job && job.status) + ", expected FAILED.");
      expect(/Synthetic staging failure callback/.test(job.errorMessage), "Render 4 lost the worker's error message.");
    });
    check("C9", "Production page data loads (listJobs and listReady succeed)", function () {
      const jobs = env.listJobs(), ready = env.listReady();
      expect(jobs && jobs.success, "listJobs failed: " + JSON.stringify(jobs && jobs.error));
      expect(ready && ready.success, "listReady failed: " + JSON.stringify(ready && ready.error));
      const health = jobs.data && jobs.data.health;
      return "health: " + (health ? health.status + " (" + health.counts.total + " finding(s))" : "not reported");
    });
    check("C10", "Background queue tick runs and drains callbacks without starting paid work", function () {
      const queue = env.queueStatus();
      if (queue.actionableTasks > 0) {
        return { skip: queue.actionableTasks + " scene-preparation task(s) are waiting in this copy; running the queue could call paid providers." };
      }
      const outcome = env.queueTick();
      expect(outcome && outcome.processed === false, "The queue tick unexpectedly processed a task.");
      expect(outcome.callbacks && !outcome.callbacks.error, "The queue tick could not drain callbacks: " + JSON.stringify(outcome.callbacks));
    });
    check("C11", "No synthetic render can be uploaded (render, failed and quality states are safe)", function () {
      [run.jobIds[1], run.jobIds[3]].forEach(function (jobId) {
        const job = env.renderJob(jobId);
        expect(!env.qualityPasses(job), jobId + " (" + job.status + ") passed the publishing quality gate.");
      });
      expect(!env.publishingJobs().some(function (p) { return run.jobIds.indexOf(p.renderJobId) !== -1; }),
        "A publishing job exists for a synthetic render.");
    });
    check("C12", "Release readiness (informational)", function () {
      const report = env.readiness();
      const notOk = report.checks.filter(function (c) { return c.level !== "ok"; })
        .map(function (c) { return c.level.toUpperCase() + " " + c.id; });
      return report.status + (notOk.length ? ": " + notOk.join(", ") : "");
    });

    const failed = checks.filter(function (c) { return c.result === "FAIL"; }).length;
    return { status: failed ? "FAILED" : "PASSED", runId: run.runId, drain: stats, checks: checks };
  }

  function defaultEnv_() {
    const properties = PropertiesService.getScriptProperties();
    return {
      property: function (name) { return properties.getProperty(name); },
      spreadsheetName: function () { return SpreadsheetApp.getActiveSpreadsheet().getName(); },
      prepareSheets: function () {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        // Only creates missing tabs: Settings/Ideas/Logs/Costs via their setup functions,
        // the rest through their repositories, which write the current headers.
        // (setupProjectSavannah() is not used: its closing getUi().alert fails in the editor.)
        [setupSettingsSheet, setupIdeasSheet, setupLogsSheet, setupCostsSheet].forEach(function (setup) { setup(ss); });
        ScriptsRepository.getScriptsByStatus("APPROVED");
        SeoRepository.getAll();
        RenderJobRepository.getAll();
        PublishingJobRepository.getAll();
        ProductionTaskRepository.getAll();
      },
      setProperty: function (name, value) { properties.setProperty(name, value); },
      uuid: function () { return Utilities.getUuid(); },
      now: function () { return Date.now(); },
      createRenderJob: function (jobId, renderId) {
        return RenderJobRepository.save(RenderJobModel.create({
          id: jobId, renderId: renderId, scriptId: "SCR-STAGING", templateId: "cloud-run-worker",
          status: "RENDERING", progress: 10, requestPayload: { synthetic: true }
        }));
      },
      renderJob: function (jobId) { return RenderJobRepository.getById(jobId); },
      receipts: function () { return MediaWorkerCallbackInbox.recentReceipts(500); },
      drain: function () { return MediaWorkerCallbackInbox.processPending(); },
      listJobs: function () { return ProductionController.listJobs(); },
      listReady: function () { return ProductionController.listReady(); },
      queueStatus: function () { return ProductionQueueService.status(); },
      queueTick: function () { return ProductionQueueService.processNext(); },
      qualityPasses: function (job) { return RenderQualityService.evaluate(job).passed === true; },
      publishingJobs: function () { return PublishingJobRepository.getAll(); },
      readiness: function () { return ReleaseReadinessService.run(); }
    };
  }

  return {
    seed: function (env) { return seed(env || defaultEnv_()); },
    verify: function (env) { return verify(env || defaultEnv_()); }
  };
})();

/** STAGING ONLY. Step 1 of CALLBACK_INBOX_STAGING.md. */
function stagingSeedRenderJobs() {
  const result = StagingVerificationService.seed();
  Logger.log("Synthetic render jobs created: " + result.run.jobIds.join(", ") +
    "\n\nNow run this on your computer (step 2):\n\n" + result.command);
  return result;
}

/** STAGING ONLY. Step 3 of CALLBACK_INBOX_STAGING.md. */
function stagingVerifyRun() {
  const report = StagingVerificationService.verify();
  Logger.log("Staging verification " + report.status + " (run " + report.runId + ")\n" + report.checks.map(function (c) {
    return c.result + "  " + c.id + "  " + c.label + (c.detail ? "\n        " + c.detail : "");
  }).join("\n"));
  return report;
}
