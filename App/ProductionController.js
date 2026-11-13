/****************************************************
 * Project Savannah v1.3 - production controller.
 ****************************************************/
const ProductionController = (() => {
  const VERSION = "production-controller-v1.1-recovery-errors";

  function testConnection() {
    return run_("Render provider connection verified.", function () {
      return VideoProcessingProvider.get().testConnection();
    });
  }

  function listReady() {
    return run_("Production-ready Shorts loaded.", function () {
      drainCallbacks_(false);
      recoverStaleJobs_();
      const items = SeoRepository.getAll().filter(function (pack) {
          return pack.status === "GENERATED" || pack.status === "READY_FOR_PRODUCTION";
        }).map(function (pack) {
          const script = ScriptsRepository.getScriptById(pack.scriptId);
          return {
            seoPack: pack,
            script: script,
            preparationTask: ProductionTaskRepository.getActiveByScriptId(pack.scriptId),
            existingJobs: RenderJobRepository.getAll().filter(function (job) {
              return job.scriptId === pack.scriptId;
            })
          };
        }).filter(function (item) { return !!item.script; }).sort(function (a, b) {
          const aPriority = Number(a.preparationTask && a.preparationTask.priority || 3);
          const bPriority = Number(b.preparationTask && b.preparationTask.priority || 3);
          return bPriority - aPriority || String(a.script.title || "").localeCompare(String(b.script.title || ""));
        });
      return {
        items: items,
        provider: Secrets.getVideoProvider()
      };
    });
  }

  // A client may only start the first render of a script here. A new version goes through
  // renderNewVersion, and a retry goes through submitInternal_. No client request may skip the
  // "already completed" guard, so the old forceRerender flag is never read from a request.
  function submit(request) {
    return run_("Short submitted for rendering.", function () {
      return submitCore_({ scriptId: request && request.scriptId });
    });
  }

  function submitInternal_(request) {
    return run_("Short submitted for rendering.", function () {
      return submitCore_(request || {});
    });
  }

  // Starts a new version of an approved script that already has a completed render. Repeated
  // clicks, refreshes and retries with the same clientRequestId return the row that was created
  // first, so they never start a second paid render. The check and the save happen under the
  // script lock, so concurrent requests see each other's rows.
  const NEW_VERSION_MAX_COST_GBP = 1;
  function renderNewVersion(request) {
    return run_("New version submitted for rendering.", function () {
      return renderNewVersion_(request || {});
    });
  }

  function renderNewVersion_(request) {
    const clientRequestId = String(request.clientRequestId || "").trim();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(clientRequestId)) throw error_("A request ID is required.");
    if (Number(request.confirmedMaxCostGbp) !== NEW_VERSION_MAX_COST_GBP) {
      throw error_("Confirm the maximum cost of £" + NEW_VERSION_MAX_COST_GBP.toFixed(2) + " before rendering a new version.");
    }
    return withScriptLock_(function () {
      const scriptId = String(request.scriptId || "").trim();
      if (!scriptId) throw error_("Script ID is required.");
      const existingJobs = RenderJobRepository.getAll().filter(function (job) {
        return job.scriptId === scriptId;
      });
      const repeat = existingJobs.filter(function (job) {
        return job.requestPayload && job.requestPayload.clientRequestId === clientRequestId;
      })[0];
      if (repeat) return { job: repeat, duplicate: true };
      const script = ScriptsRepository.getScriptById(scriptId);
      if (!script || script.status !== "APPROVED") throw error_("Only an approved script can be rendered.");
      const seoPack = SeoRepository.getByScriptId(scriptId);
      if (!seoPack) throw error_("Generate an SEO pack before rendering.");
      assertNoActiveRender_(existingJobs);
      assertNoProtectedUpload_(scriptId, existingJobs);
      if (!existingJobs.some(function (job) { return job.status === "SUCCEEDED" && job.videoUrl; })) {
        throw error_("A new version needs a completed render first. Use Create Short for the first render.");
      }
      const started = startRender_(script, seoPack, existingJobs, { clientRequestId: clientRequestId });
      return { job: started.job, duplicate: started.duplicate === true };
    });
  }

  function assertNoActiveRender_(existingJobs) {
    const active = existingJobs.filter(function (job) {
      return ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
    })[0];
    if (active) throw error_("This script already has an active render.");
  }

  // A render that was already uploaded must be checked by script: a new version has a new
  // render ID, so the same content could otherwise be rendered, approved and uploaded again.
  function assertNoProtectedUpload_(scriptId, existingJobs) {
    if (existingJobs.length && PublishingJobRepository.getAll().some(function (upload) {
      return upload.scriptId === scriptId && isProtectedUpload_(upload);
    })) {
      throw error_("This script already has a YouTube upload that is published, in progress or uncertain. Resolve it in YouTube Studio before rendering again.");
    }
  }

  // Version numbers are per script. The first render is version 1; a row without a stored version
  // (created before versions existed) counts as version 1.
  function versionOf_(job) {
    const stored = job.requestPayload && Number(job.requestPayload.version);
    return stored > 0 ? stored : 1;
  }

  function nextVersion_(existingJobs) {
    return existingJobs.length ? existingJobs.reduce(function (max, job) {
      return Math.max(max, versionOf_(job));
    }, 0) + 1 : 1;
  }

  function submitCore_(request) {
    return withScriptLock_(function () {
      const scriptId = String(request && request.scriptId || "").trim();
      if (!scriptId) throw error_("Script ID is required.");
      const script = ScriptsRepository.getScriptById(scriptId);
      if (!script || script.status !== "APPROVED") throw error_("Only an approved script can be rendered.");
      const seoPack = SeoRepository.getByScriptId(scriptId);
      if (!seoPack) throw error_("Generate an SEO pack before rendering.");
      const existingJobs = RenderJobRepository.getAll().filter(function (job) {
        return job.scriptId === scriptId;
      });
      assertNoActiveRender_(existingJobs);
      assertNoProtectedUpload_(scriptId, existingJobs);
      const completed = existingJobs.filter(function (job) {
        return job.status === "SUCCEEDED";
      })[0];
      if (completed && !(request && request.forceRerender === true)) {
        throw error_("This script already has a completed render. Use Render New Version to add another version.");
      }
      const started = startRender_(script, seoPack, existingJobs, { version: request && request.version });
      return { job: started.job, duplicate: started.duplicate === true };
    });
  }

  // The worker already holds this submission under originalJobId (a replay of an earlier intent). Nothing new starts here.
  // - The row already carries that ID: keep it for reconciliation.
  // - A row for that ID exists: this row is unused, so it is marked FAILED with no ID (it must not share the ID).
  // - No row for it: adopt the ID and keep this row active, so status checks reconcile it and no second render can start.
  function settleDuplicate_(job, originalJobId) {
    const note = "The media worker already holds this submission as render " + originalJobId + ". Savannah did not start a second render.";
    if (job.renderId === originalJobId) {
      return { job: RenderJobRepository.update(RenderJobModel.update(job, { errorMessage: "The media worker already holds this render. Savannah is reconciling it. Do not re-render." })), duplicate: true };
    }
    if (RenderJobRepository.getByRenderId(originalJobId)) {
      return { job: RenderJobRepository.update(RenderJobModel.update(job, { status: "FAILED", renderId: "", errorMessage: note })), duplicate: true };
    }
    return { job: RenderJobRepository.update(RenderJobModel.update(job, { renderId: originalJobId, status: "QUEUED", errorMessage: note + " Do not re-render; Savannah will reconcile it." })), duplicate: true };
  }

  // The one place a render row is created and submitted to the worker. Callers hold the script lock.
  // `meta` is stored in requestPayload (no header change): version and clientRequestId.
  function startRender_(script, seoPack, existingJobs, options) {
    const meta = {
      version: Number(options && options.version) > 0 ? Number(options.version) : nextVersion_(existingJobs)
    };
    if (options && options.clientRequestId) meta.clientRequestId = options.clientRequestId;
    const provider = VideoProcessingProvider.get();
    // Save the render ID before asking the worker to start. If this execution dies after the
    // worker accepts the job, the row already carries the ID that status checks and the
    // callback use, so it can be reconciled instead of looking like a failed submit.
    const reservedRenderId = typeof provider.reserveRenderId === "function" ? provider.reserveRenderId() : "";
    let job = RenderJobRepository.save(RenderJobModel.create({
      scriptId: script.id,
      seoPackId: seoPack.id,
      templateId: resolveTemplateId_(),
      status: "QUEUED",
      renderId: reservedRenderId,
      requestPayload: Object.assign({ preparationStatus: "assets-ready" }, meta)
    }));
    {
      try {
        const result = provider.submitRender(script, seoPack, {
          renderId: reservedRenderId,
          submitIntentId: meta.clientRequestId,
          renderVersion: meta.version
        });
        if (result.duplicate === true) return settleDuplicate_(job, result.originalJobId);
        const render = result.render;
        job = RenderJobRepository.update(RenderJobModel.update(job, {
          renderId: render.id,
          status: mapStatus_(render.status),
          progress: render.progress || 0,
          videoUrl: render.url || "",
          snapshotUrl: render.snapshot_url || "",
          // Merge, so the version and client request ID survive the worker's own payload.
          requestPayload: Object.assign({}, result.payload, meta),
          providerResponse: sanitise_(render)
        }));
      } catch (caught) {
        // No confirmation either way (timeout, 5xx): the worker may be rendering this job and
        // billing for it. Keep the job active under its saved ID so the callback or status
        // reconciliation decides. Marking it FAILED would invite a second paid render.
        if (reservedRenderId && caught && caught.outcomeUnknown === true) {
          RenderJobRepository.update(RenderJobModel.update(job, {
            errorMessage: "The media worker did not confirm this render, so it may still be running. Savannah is keeping the job and will reconcile it. Do not re-render."
          }));
          throw error_("The media worker did not confirm this render. It may still be running, so Savannah is keeping the job and will reconcile it. Do not re-render.");
        }
        // A definite failure means nothing started, so the reserved ID is unused: drop it, as a
        // failed submission has always had no render ID.
        RenderJobRepository.update(RenderJobModel.update(job, Object.assign({
          status: "FAILED",
          errorMessage: friendlyError_(caught)
        }, reservedRenderId ? { renderId: "" } : {})));
        throw caught;
      }
      return { job: job };
    }
  }

  function startPreparation(request) {
    return run_("Persistent production preparation started.", function () {
      assertScenePreparationUsed_();
      const source = request || {};
      return withScriptLock_(function () {
        let scriptId = String(source.scriptId || "").trim();
        let sourceRenderJobId = String(source.jobId || "").trim();
        if (!scriptId && sourceRenderJobId) {
          const sourceJob = RenderJobRepository.getById(sourceRenderJobId);
          if (!sourceJob) throw error_("Render job was not found.");
          scriptId = sourceJob.scriptId;
        }
        const script = ScriptsRepository.getScriptById(scriptId);
        if (!script || script.status !== "APPROVED") throw error_("Only an approved script can be prepared.");
        const existing = ProductionTaskRepository.getActiveByScriptId(scriptId);
        if (existing) return { task: existing, resumed: true };
        return { task: ProductionTaskRepository.save(ProductionTaskRepository.create({
          scriptId: scriptId, sourceRenderJobId: sourceRenderJobId, priority: source.priority
        })), resumed: false };
      });
    });
  }

  function prepareNextScene(request) {
    return run_("Next scene asset prepared.", function () {
      assertScenePreparationUsed_();
      return withScriptLock_(function () {
      const taskId = String(request && request.taskId || "").trim();
      let task = ProductionTaskRepository.getById(taskId);
      if (!task) throw error_("Production preparation task was not found.");
      if (task.status === "PAUSED") throw error_("This preparation is paused. Resume it before continuing.");
      if (["CANCELLED", "SUBMITTED"].indexOf(task.status) !== -1) {
        throw error_("This preparation can no longer create scenes.");
      }
      if (task.status === "READY") return { task: task, complete: true };
      const script = ScriptsRepository.getScriptById(task.scriptId);
      if (!script || script.status !== "APPROVED") throw error_("The approved script was not found.");
      const sceneNumber = Number(task.nextScene || 1);
      if (sceneNumber > 4) {
        task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, { status: "READY" }));
        return { task: task, complete: true };
      }
      task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
        status: "PREPARING", attempts: task.attempts + 1, errorMessage: ""
      }));
      try {
        const visual = VisualAssetService.prepareSceneVisual(script, ScenePlanService.create(script), sceneNumber);
        const scenes = task.preparedScenes.concat([sceneNumber]).filter(function (value, index, values) {
          return values.indexOf(value) === index;
        });
        const complete = scenes.length >= 4;
        task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          preparedScenes: scenes, nextScene: complete ? 5 : sceneNumber + 1,
          status: complete ? "READY" : "PREPARING", errorMessage: ""
        }));
        return { task: task, visual: visual, complete: complete };
      } catch (caught) {
        ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          status: "FAILED", errorMessage: friendlyError_(caught)
        }));
        throw caught;
      }
      });
    });
  }

  function controlPreparation(request) {
    return run_("Production preparation updated.", function () {
      return withScriptLock_(function () {
        const source = request || {}, action = String(source.action || "").trim().toLowerCase();
        const task = ProductionTaskRepository.getById(String(source.taskId || "").trim());
        if (!task) throw error_("Production preparation task was not found.");
        if (action === "priority") {
          const priority = Number(source.priority);
          if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
            throw error_("Queue priority must be an integer from 1 to 5.");
          }
          if (["SUBMITTED", "CANCELLED"].indexOf(task.status) !== -1) {
            throw error_("Completed or cancelled preparation cannot be reordered.");
          }
          return { task: ProductionTaskRepository.persist(
            ProductionTaskRepository.update(task, { priority: priority })
          ) };
        }
        let status = task.status;
        if (action === "pause" && task.status === "PREPARING") status = "PAUSED";
        else if (action === "resume" && ["PAUSED", "FAILED"].indexOf(task.status) !== -1) status = "PREPARING";
        else if (action === "cancel" && ["SUBMITTED", "CANCELLED"].indexOf(task.status) === -1) status = "CANCELLED";
        else throw error_("That preparation action is not valid for the current status.");
        return { task: ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          status: status, errorMessage: action === "resume" ? "" : task.errorMessage,
          attempts: action === "resume" ? task.preparedScenes.length : task.attempts
        })) };
      });
    });
  }

  function submitPrepared(request) {
    return run_("Prepared Short submitted for rendering.", function () {
      const taskId = String(request && request.taskId || "").trim();
      // Claim the task under the script lock: re-read it and move READY -> SUBMITTING in one
      // step, so two overlapping callers (queue tick and a click, or two ticks) cannot both
      // submit it, and a loser can never overwrite the winner's state. The lock is released
      // before submitCore_, which takes the lock itself.
      let task = withScriptLock_(function () {
        const current = ProductionTaskRepository.getById(taskId);
        if (!current) throw error_("Production preparation task was not found.");
        if (current.status === "SUBMITTING") {
          throw error_("This Short is already being submitted. The duplicate submission was prevented.");
        }
        if (current.status !== "READY" || current.preparedScenes.length !== 4) {
          throw error_("All four scenes must be prepared before rendering.");
        }
        return ProductionTaskRepository.persist(ProductionTaskRepository.update(current, { status: "SUBMITTING" }));
      });
      try {
        const result = submitCore_({ scriptId: task.scriptId, forceRerender: !!task.sourceRenderJobId });
        task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          status: "SUBMITTED", renderJobId: result.job.id, errorMessage: ""
        }));
        return { task: task, job: result.job };
      } catch (caught) {
        // If a render row was created and is still alive, the render may be running. Keep the
        // task linked to it instead of failing it: a failed task invites another submission.
        const started = renderStartedBy_(task);
        ProductionTaskRepository.persist(ProductionTaskRepository.update(task, started ? {
          status: "SUBMITTED", renderJobId: started.id, errorMessage: friendlyError_(caught)
        } : {
          status: "FAILED", errorMessage: friendlyError_(caught)
        }));
        throw caught;
      }
    });
  }

  // The render row (not failed or cancelled) that a submission started at or after the task
  // entered SUBMITTING, or null. One second of tolerance absorbs clock and Sheets rounding.
  function renderStartedBy_(task) {
    const since = new Date(task.updatedAt).getTime() - 1000;
    return RenderJobRepository.getAll().filter(function (job) {
      return job.scriptId === task.scriptId && job.id !== task.sourceRenderJobId &&
        ["FAILED", "CANCELLED"].indexOf(job.status) === -1 && new Date(job.createdAt).getTime() >= since;
    }).sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); })[0] || null;
  }

  // An execution lasts at most 6 minutes, so a task still SUBMITTING after this has lost its worker.
  const SUBMITTING_STALE_MS = 10 * 60 * 1000;
  // Interrupted attempts at one scene (a timeout or crash records no failure) before the task stops.
  const MAX_INTERRUPTED_ATTEMPTS = 3;
  function interruptedAttempts_(task) {
    return Math.max(0, Number(task.attempts || 0) - (task.preparedScenes || []).length);
  }

  // Called by the queue tick. Settles tasks whose worker disappeared, so nothing waits forever and
  // nothing is retried forever. Never starts a render and never prepares a scene.
  function reviewStalledTasks(nowMs) {
    const now = Number(nowMs) || Date.now();
    const outcome = { resumedSubmission: [], adoptedRender: [], stoppedPreparation: [] };
    return withScriptLock_(function () {
      ProductionTaskRepository.getAll().forEach(function (task) {
        const age = now - new Date(task.updatedAt).getTime();
        if (task.status === "SUBMITTING" && age >= SUBMITTING_STALE_MS) {
          const started = renderStartedBy_(task);
          if (started) {
            ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
              status: "SUBMITTED", renderJobId: started.id, errorMessage: ""
            }));
            outcome.adoptedRender.push(task.id);
            logRecovery_("Task " + task.id + " was stuck submitting. It is now linked to render " + started.id + ", which was already started; nothing was submitted again.");
          } else {
            ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
              status: "READY",
              errorMessage: "A submission was interrupted before any render started. It will be submitted again."
            }));
            outcome.resumedSubmission.push(task.id);
            logRecovery_("Task " + task.id + " was stuck submitting and no render had started, so it was returned to READY for another attempt.");
          }
        } else if (task.status === "PREPARING" && interruptedAttempts_(task) >= MAX_INTERRUPTED_ATTEMPTS) {
          ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
            status: "FAILED",
            errorMessage: "Scene " + task.nextScene + " was interrupted " + MAX_INTERRUPTED_ATTEMPTS +
              " times, which usually means it exceeds the Apps Script time limit. Check the Logs sheet, then use Resume to try again."
          }));
          outcome.stoppedPreparation.push(task.id);
          logRecovery_("Task " + task.id + " was stopped after " + MAX_INTERRUPTED_ATTEMPTS + " interrupted attempts at scene " + task.nextScene + ".");
        }
      });
      return outcome;
    });
  }

  function refresh(request) {
    return run_("Render status refreshed.", function () {
      drainCallbacks_(false);
      const jobId = String(request && request.jobId || "").trim();
      const job = RenderJobRepository.getById(jobId);
      if (!job) throw error_("Render job was not found.");
      // Terminal callback results are authoritative; polling must not revise them.
      if (renderIsTerminal_(job)) return { job: job };
      const render = VideoProcessingProvider.forJob(job).getRender(job);
      return { job: persistRenderRefresh_(job, render, null) };
    });
  }

  function refreshActive() {
    return run_("Active render statuses refreshed.", function () {
      drainCallbacks_(false);
      recoverStaleJobs_();
      const active = RenderJobRepository.getAll().filter(function (job) {
        return ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
      });
      return {
        jobs: active.map(function (job) {
          if (!job.renderId) return job;
          try {
            const render = VideoProcessingProvider.forJob(job).getRender(job);
            return persistRenderRefresh_(job, render, null);
          } catch (caught) {
            // A provider error must not overwrite a callback that arrived mid-poll.
            return persistRenderRefresh_(job, null, caught);
          }
        })
      };
    });
  }

  function renderIsTerminal_(job) {
    return ["SUCCEEDED", "FAILED", "CANCELLED"].indexOf(job.status) !== -1 ||
      !!job.videoUrl;
  }

  // Do not hold the script lock during the remote provider request. Instead,
  // re-read the authoritative row inside the lock before every Sheet write.
  // Callback receivers in this Apps Script project use the same script lock.
  function persistRenderRefresh_(observed, render, providerError) {
    return withScriptLock_(function () {
      // An inbox event may have arrived while the remote status request ran.
      drainCallbacks_(true);
      const current = RenderJobRepository.getById(observed.id);
      if (!current) throw error_("Render job was not found.");
      // A callback may have finished the render while the network request ran.
      // Version also protects newer nonterminal updates and recovery metadata.
      if (renderIsTerminal_(current) ||
          current.renderId !== observed.renderId ||
          Number(current.version) !== Number(observed.version)) {
        return current;
      }
      const changes = providerError ? {
        errorMessage: "Status refresh failed; Savannah will retry: " + friendlyError_(providerError)
      } : {
        status: mapStatus_(render.status),
        progress: render.progress ||
          (String(render.status).toLowerCase() === "succeeded" ? 100 : current.progress),
        videoUrl: render.url || current.videoUrl,
        snapshotUrl: render.snapshot_url || current.snapshotUrl,
        errorMessage: render.error_message || "",
        providerResponse: sanitise_(render)
      };
      return RenderJobRepository.update(RenderJobModel.update(current, changes));
    });
  }

  function retry(request) {
    drainCallbacks_(false);
    const jobId = String(request && request.jobId || "").trim();
    const job = RenderJobRepository.getById(jobId);
    if (!job) return failure_("Render job was not found.");
    // Retry must respect older upload attempts, not only the latest sheet row, and uploads of
    // any other render of the same script (a re-render has a different render job ID).
    const uploadHistory = PublishingJobRepository.getAll().filter(function (upload) {
      return upload.renderJobId === job.id || upload.scriptId === job.scriptId;
    });
    if (uploadHistory.some(function (upload) { return upload.status === "PUBLISHED"; })) {
      return failure_("Published videos cannot be re-rendered from the retry action.");
    }
    if (uploadHistory.some(function (upload) {
      return upload.status === "RECONCILE" || upload.status === "UPLOADING" ||
        needsUploadEvidenceReview_(upload);
    })) {
      return failure_("Resolve the existing YouTube upload attempt before re-rendering.");
    }
    const quality = RenderQualityService.evaluate(job);
    const review = RenderReviewService.get(job.id);
    const retryable = job.status === "FAILED" || !quality.passed ||
      (job.status === "SUCCEEDED" && !review.approved);
    if (!retryable) {
      return failure_("Only failed, quality-blocked or unapproved completed renders can be retried.");
    }
    // A failed attempt is retried under the same version number, so numbering stays sequential.
    // A quality-blocked or unapproved completed render is replaced by a new version.
    return submitInternal_({
      scriptId: job.scriptId,
      forceRerender: true,
      version: job.status === "FAILED" ? versionOf_(job) : undefined
    });
  }

  function prepareScene(request) {
    return run_("High-quality scene asset prepared.", function () {
      assertScenePreparationUsed_();
      const source = request || {};
      let scriptId = String(source.scriptId || "").trim();
      if (!scriptId && source.jobId) {
        const job = RenderJobRepository.getById(String(source.jobId || "").trim());
        if (!job) throw error_("Render job was not found.");
        scriptId = job.scriptId;
      }
      const sceneNumber = Number(source.sceneNumber || 0);
      if (!scriptId) throw error_("Script ID is required.");
      if (sceneNumber < 1 || sceneNumber > 4 || sceneNumber % 1 !== 0) {
        throw error_("A scene number from 1 to 4 is required.");
      }
      const script = ScriptsRepository.getScriptById(scriptId);
      if (!script || script.status !== "APPROVED") throw error_("Only an approved script can be rendered.");
      const plan = ScenePlanService.create(script);
      return { sceneNumber: sceneNumber, visual: VisualAssetService.prepareSceneVisual(script, plan, sceneNumber) };
    });
  }

  function approveRender(request) {
    return run_("Finished video approved for publishing.", function () {
      const jobId = String(request && request.jobId || "").trim();
      const job = RenderJobRepository.getById(jobId);
      if (!job) throw error_("Render job was not found.");
      return { review: RenderReviewService.approve(job) };
    });
  }

  function listJobs() {
    return run_("Render jobs loaded.", function () {
      drainCallbacks_(false);
      recoverStaleJobs_();
      recoverStalePublishingJobs_();
      const publishingJobs = PublishingJobRepository.getAll();
      const renderJobs = RenderJobRepository.getAll();
      return { health: productionHealth_(renderJobs, publishingJobs), jobs: renderJobs.slice().sort(function (a, b) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }).map(function (job) {
        const result = Object.assign({}, job);
        const attempts = publishingJobs.filter(function (publishingJob) {
          return publishingJob.renderJobId === job.id;
        }).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
        // A later FAILED attempt cannot conceal an earlier published or uncertain one.
        // Use the same precedence as publish()'s history-wide safety guard.
        const visible = attempts.filter(function (item) { return item.status === "PUBLISHED"; })[0] ||
          attempts.filter(function (item) { return item.status === "UPLOADING"; })[0] ||
          attempts.filter(function (item) { return item.status === "RECONCILE"; })[0] ||
          attempts.filter(needsUploadEvidenceReview_)[0] || attempts[0] || null;
        result.publishingJob = visible;
        result.publishingHistory = {
          attemptCount: attempts.length,
          latestStatus: attempts.length ? attempts[0].status : "",
          showingEarlierAttempt: !!(visible && attempts[0].id !== visible.id),
          unresolvedCount: attempts.filter(function (item) {
            return item.status === "UPLOADING" || item.status === "RECONCILE" ||
              needsUploadEvidenceReview_(item);
          }).length
        };
        result.seoPack = job.seoPackId ? SeoRepository.getById(job.seoPackId) : null;
        result.quality = RenderQualityService.evaluate(job);
        result.review = RenderReviewService.get(job.id);
        return result;
      }) };
    });
  }

  function getYouTubeConnection() {
    return run_("YouTube connection loaded.", function () {
      return { channel: YouTubeService.getChannel() };
    });
  }

  function getAutomationStatus() {
    return run_("Production automation status loaded.", function () {
      return { automation: ProductionQueueService.status() };
    });
  }

  function getPublishingSchedule(request) {
    return run_("Publishing schedule loaded.", function () {
      const jobs = PublishingJobRepository.getAll(), source = request || {};
      return {
        schedule: PublishingScheduleService.upcoming(jobs),
        suggestions: PublishingScheduleService.suggestSlots(jobs, {
          timezoneOffsetMinutes: source.timezoneOffsetMinutes,
          template: source.template, limit: 6, daysAhead: 21
        })
      };
    });
  }

  function setAutomation(request) {
    return run_("Production automation updated.", function () {
      return { automation: request && request.enabled === true ?
        ProductionQueueService.install() : ProductionQueueService.uninstall() };
    });
  }

  // Read-only: the exact YouTube details for owner review, including the music credit and the digest the
  // owner approves. Applies the same schedule rule as publish(), so the previewed time is the one uploaded.
  function previewPublish(request) {
    return run_("Publishing details ready for review.", function () {
      const source = request || {};
      const renderJobId = String(source.renderJobId || "").trim();
      const renderJob = RenderJobRepository.getById(renderJobId);
      if (!renderJob) throw error_("Render job was not found.");
      if (renderJob.status !== "SUCCEEDED" || !renderJob.videoUrl) {
        throw error_("Only a completed render can be uploaded.");
      }
      RenderQualityService.assertPublishable(renderJob);
      RenderReviewService.assertApproved(renderJob.id);
      const seoPack = SeoRepository.getById(renderJob.seoPackId);
      if (!seoPack) throw error_("The SEO pack for this render was not found.");
      const scheduleCheck = PublishingScheduleService.assertAvailable(
        source.publishAt,
        PublishingJobRepository.getAll(),
        renderJobId,
        { timezoneOffsetMinutes: source.timezoneOffsetMinutes, maxPerDay: 2 }
      );
      const reviewSource = Object.assign({}, source, {
        publishAt: scheduleCheck.scheduled ? scheduleCheck.publishAt : source.publishAt,
        // Allocated for this review only. Nothing is saved until the owner approves and publish() runs.
        uploadAttemptId: newUploadAttemptId_()
      });
      return YouTubeService.previewUpload(renderJob, seoPack, reviewSource);
    });
  }

  // Same format as PublishingJobModel's default ID, so the record can use the reviewed ID unchanged.
  function newUploadAttemptId_() {
    return "PUB-" + Utilities.getUuid().slice(0, 8).toUpperCase();
  }

  function publish(request) {
    return run_("Short uploaded to YouTube.", function () {
      return withScriptLock_(function () {
      drainCallbacks_(true);
      const source = request || {};
      const renderJobId = String(source.renderJobId || "").trim();
      const renderJob = RenderJobRepository.getById(renderJobId);
      if (!renderJob) throw error_("Render job was not found.");
      if (renderJob.status !== "SUCCEEDED" || !renderJob.videoUrl) {
        throw error_("Only a completed render can be uploaded.");
      }
      RenderQualityService.assertPublishable(renderJob);
      RenderReviewService.assertApproved(renderJob.id);
      // Refuse before recording an attempt: an expired signed link can only fail,
      // and the fix is cheap delivery recovery, not a re-render.
      VideoLinkService.assertUsable(renderJob.videoUrl);
      // A newer FAILED attempt must never hide an older published, in-progress, or
      // uncertain upload. Inspect every attempt for this render before inserting.
      const publishingJobs = PublishingJobRepository.getAll();
      const history = publishingJobs.filter(function (job) {
        return job.renderJobId === renderJobId;
      });
      if (history.some(function (job) { return job.status === "PUBLISHED"; })) {
        throw error_("This render is already published to YouTube.");
      }
      if (history.some(function (job) { return job.status === "UPLOADING"; })) {
        throw error_("This video already has an upload in progress. Refresh its YouTube status before retrying.");
      }
      if (history.some(function (job) { return job.status === "RECONCILE"; })) {
        throw error_("This upload ended in an uncertain state. Check YouTube Studio, then reconcile each uncertain attempt before retrying.");
      }
      if (history.some(needsUploadEvidenceReview_)) {
        throw error_("A failed upload attempt still contains YouTube video evidence. Reconcile it or verify in YouTube Studio before retrying.");
      }
      // Another render of the same script may already be on YouTube (or be uploading, or be
      // uncertain). Uploading this render too would publish the same content twice.
      if (publishingJobs.some(function (job) {
        return job.scriptId === renderJob.scriptId && isProtectedUpload_(job);
      })) {
        throw error_("Another render of this script already has a YouTube upload that is published, in progress or uncertain. Resolve it in YouTube Studio before uploading this render.");
      }
      const scheduleCheck = PublishingScheduleService.assertAvailable(
        source.publishAt,
        publishingJobs,
        renderJobId,
        { timezoneOffsetMinutes: source.timezoneOffsetMinutes, maxPerDay: 2 }
      );
      if (scheduleCheck.scheduled) source.publishAt = scheduleCheck.publishAt;
      const seoPack = SeoRepository.getById(renderJob.seoPackId);
      if (!seoPack) throw error_("The SEO pack for this render was not found.");
      // The owner must approve the exact details shown by previewPublish. If anything changed since (title,
      // description, music credit, tags, visibility or schedule), the approval no longer matches: refuse
      // before any publishing record is written, so the owner reviews the new details first.
      // The upload attempt ID is the reviewed publishing record ID, and its tracking tag is part of the reviewed
      // tags. It must be well-formed and unused: a reused ID would merge two attempts' evidence.
      const attemptId = String(source.uploadAttemptId || "");
      if (!/^PUB-[0-9A-F]{8}$/.test(attemptId)) {
        throw error_("Review the exact YouTube details again before uploading.");
      }
      if (publishingJobs.some(function (existing) { return existing.id === attemptId; })) {
        throw error_("This review has already been used for an upload. Review the exact details again before uploading.");
      }
      // The owner must approve the exact details shown by previewPublish. Anything that changed since (title,
      // description, music credit, tags including the tracking tag, visibility, schedule, render or attempt)
      // makes the approval no longer match, and nothing is written.
      const reviewed = YouTubeService.previewUpload(renderJob, seoPack, source);
      if (!source.approvedMetadataHash || source.approvedMetadataHash !== reviewed.metadataHash) {
        throw error_("The YouTube details changed after review, or were never approved. Review the exact details again before uploading.");
      }
      // A staging project must refuse BEFORE the publishing record is written, so a refused staging attempt
      // leaves no record behind. (upload() keeps its own identical guard as a second layer.)
      assertNotStaging_("YouTube upload");
      let job = PublishingJobRepository.save(PublishingJobModel.create({
        id: attemptId,
        renderJobId: renderJob.id,
        scriptId: renderJob.scriptId,
        seoPackId: renderJob.seoPackId,
        title: source.title || seoPack.titleOptions[0],
        description: source.description || seoPack.description,
        tags: seoPack.tags,
        privacyStatus: source.publishAt ? "private" : source.privacyStatus || "private",
        providerResponse: { publishAt: source.publishAt || "" }
      }));
      let upload;
      try {
        upload = YouTubeService.upload(renderJob, seoPack, Object.assign({}, source, { publishingJobId: job.id }));
        job = PublishingJobRepository.update(PublishingJobModel.update(job, {
          youtubeVideoId: upload.videoId,
          youtubeUrl: upload.videoUrl,
          title: upload.title,
          description: upload.description,
          tags: upload.tags,
          privacyStatus: upload.privacyStatus,
          status: "PUBLISHED",
          providerResponse: {
            video: upload.response,
            publishAt: upload.publishAt || "",
            processingStatus: "processing"
          }
        }));
      } catch (caught) {
        // If YouTube already returned a video ID, keep it on the record even though saving the
        // PUBLISHED state failed, so the evidence survives for reconciliation and audit.
        const returned = upload && upload.videoId ?
          { youtubeVideoId: upload.videoId, youtubeUrl: upload.videoUrl || "" } : {};
        PublishingJobRepository.update(PublishingJobModel.update(job, Object.assign({
          status: caught.uploadUncertain || upload ? "RECONCILE" : "FAILED",
          errorMessage: caught.uploadUncertain || upload ?
            "YouTube upload completion is unknown. Reconcile the upload or check YouTube Studio before retrying." :
            friendlyError_(caught)
        }, returned)));
        if (upload) throw error_("YouTube upload completion is unknown. Reconcile the upload before retrying.");
        throw caught;
      }
      return { job: job };
      });
    });
  }

  function refreshPublication(request) {
    return run_("YouTube processing status refreshed.", function () {
      const renderJobId = String(request && request.renderJobId || "").trim();
      const job = publishingJobForAction_(request);
      if (!job || !job.youtubeVideoId) throw error_("Published YouTube video was not found.");
      const status = YouTubeService.getVideo(job.youtubeVideoId);
      return {
        job: PublishingJobRepository.update(PublishingJobModel.update(job, {
          privacyStatus: status.privacyStatus || job.privacyStatus,
          providerResponse: {
            video: status.response,
            publishAt: status.publishAt,
            uploadStatus: status.uploadStatus,
            processingStatus: status.processingStatus,
            processingProgress: status.processingProgress
          }
        }))
      };
    });
  }

  function abandonPublication(request) {
    return run_("Uncertain YouTube upload attempt reviewed.", function () {
      return withScriptLock_(function () {
      const source = request || {};
      if (source.confirmNoUpload !== true) throw error_("Confirmation that no YouTube upload exists is required.");
      const renderJobId = String(source.renderJobId || "").trim();
      const job = publishingJobForAction_(source);
      if (!job || (job.status !== "RECONCILE" && !needsUploadEvidenceReview_(job))) {
        throw error_("No unresolved upload attempt was found for this render.");
      }
      // Explicit operator confirmation is the only way to clear contradictory
      // remote evidence. Preserve an audit copy before releasing the reservation.
      return { job: PublishingJobRepository.update(PublishingJobModel.update(job, {
        status: "FAILED",
        youtubeVideoId: "",
        youtubeUrl: "",
        providerResponse: Object.assign({}, job.providerResponse || {}, {
          manualReconciliation: {
            confirmedAt: new Date().toISOString(),
            previousStatus: job.status,
            previousYoutubeVideoId: job.youtubeVideoId || "",
            previousYoutubeUrl: job.youtubeUrl || ""
          }
        }),
        errorMessage: "No upload was confirmed in YouTube Studio for this attempt. Other attempts may still block retry."
      })) };
      });
    });
  }

  function reconcilePublication(request) {
    return run_("YouTube upload reconciliation completed.", function () {
      return withScriptLock_(function () {
        const job = publishingJobForAction_(request);
        if (!job || (job.status !== "RECONCILE" && !needsUploadEvidenceReview_(job))) {
          throw error_("No unresolved upload attempt was found for this render.");
        }
        const found = YouTubeService.findUpload(job);
        if (!found) throw error_("No matching upload was found among the latest 250 channel uploads. Completion is unknown; check YouTube Studio. Older uploads may not contain a Savannah identifier.");
        return { job: PublishingJobRepository.update(PublishingJobModel.update(job, {
          status: "PUBLISHED", youtubeVideoId: found.videoId, youtubeUrl: found.videoUrl,
          privacyStatus: found.privacyStatus || job.privacyStatus, errorMessage: "",
          providerResponse: { video: found.response, publishAt: found.publishAt,
            uploadStatus: found.uploadStatus, processingStatus: found.processingStatus }
        })) };
      });
    });
  }

  // An upload that must stop any further upload of the same content.
  function isProtectedUpload_(job) {
    return !!job && (job.status === "PUBLISHED" || job.status === "UPLOADING" ||
      job.status === "RECONCILE" || needsUploadEvidenceReview_(job));
  }

  function needsUploadEvidenceReview_(job) {
    return !!job && job.status === "FAILED" &&
      !!(String(job.youtubeVideoId || "").trim() || String(job.youtubeUrl || "").trim());
  }

  // UI actions may target a historical upload attempt by its persisted ID.
  // Verify both identifiers so another render's publishing job cannot be changed.
  // Keep the render-only fallback for older web app clients.
  function publishingJobForAction_(request) {
    const source = request || {};
    const renderJobId = String(source.renderJobId || "").trim();
    const publishingJobId = String(source.publishingJobId || "").trim();
    if (!renderJobId) throw error_("Render job ID is required.");
    if (!publishingJobId) return PublishingJobRepository.getByRenderJobId(renderJobId);
    const job = PublishingJobRepository.getAll().filter(function (item) {
      return item.id === publishingJobId && item.renderJobId === renderJobId;
    })[0];
    if (!job) throw error_("The selected YouTube upload attempt was not found for this render.");
    return job;
  }

  function resolveTemplateId_() {
    // RenderJobModel requires a non-empty templateId regardless of provider. Cloud Run
    // has no template concept, so it gets a constant label instead of touching that
    // model's validation rules for a field that only ever mattered for Creatomate.
    return VideoProcessingProvider.get() === CreatomateProviderAdapter
      ? Secrets.getCreatomateTemplateId()
      : "cloud-run-worker";
  }
  function mapStatus_(status) {
    const value = String(status || "").toLowerCase();
    if (value === "succeeded") return "SUCCEEDED";
    if (value === "failed") return "FAILED";
    if (value === "rendering") return "RENDERING";
    if (value === "planned") return "PLANNED";
    return "QUEUED";
  }
  function sanitise_(value) {
    const clone = JSON.parse(JSON.stringify(value || {}));
    delete clone.metadata;
    return clone;
  }
  // Operator-visible diagnostics for state changes that otherwise leave no trace. A logging
  // failure must never undo or block the recovery it describes.
  function logRecovery_(message) {
    try { LoggingService.log({ runId: "", action: "PRODUCTION_RECOVERY", status: "Warning", message: message }); } catch (ignored) {}
  }
  // Health findings are advisory. If they cannot be computed the page must still load.
  function productionHealth_(renderJobs, publishingJobs) {
    try {
      let callbackReceipts = [];
      try { callbackReceipts = MediaWorkerCallbackInbox.recentReceipts(100); } catch (ignored) {}
      // Queue tasks are advisory input too: an unreadable Production Tasks sheet must not hide
      // the render and upload findings.
      let productionTasks = [];
      try { productionTasks = ProductionTaskRepository.getAll(); } catch (ignored) {}
      return ProductionHealthService.evaluate({ renderJobs: renderJobs, publishingJobs: publishingJobs,
        callbackReceipts: callbackReceipts, productionTasks: productionTasks });
    } catch (caught) {
      return { status: "unavailable", generatedAt: new Date().toISOString(),
        counts: { critical: 0, warning: 0, total: 0 }, truncated: 0, findings: [] };
    }
  }
  function recoverStaleJobs_() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    RenderJobRepository.getAll().filter(function (job) {
      return job.status === "QUEUED" && !job.renderId && new Date(job.updatedAt).getTime() < cutoff;
    }).forEach(function (job) {
      RenderJobRepository.update(RenderJobModel.update(job, {
        status: "FAILED",
        errorMessage: "Render submission was interrupted before the provider returned an ID. The worker may still have made this video: check Production > Needs attention for an unmatched delivery before using Re-render safely."
      }));
      logRecovery_("Render " + job.id + " was marked FAILED: submission was interrupted before the provider returned an ID.");
    });
  }
  function recoverStalePublishingJobs_() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    PublishingJobRepository.getAll().filter(function (job) {
      return job.status === "UPLOADING" && !job.youtubeVideoId && new Date(job.updatedAt).getTime() < cutoff;
    }).forEach(function (job) {
      PublishingJobRepository.update(PublishingJobModel.update(job, {
        status: "RECONCILE",
        errorMessage: "Upload completion is unknown. Check YouTube Studio before allowing another upload."
      }));
      logRecovery_("Upload attempt " + job.id + " for render " + job.renderJobId +
        " was set to uncertain (RECONCILE) after 30 minutes with no result. Check YouTube Studio before uploading again.");
    });
  }
  // Scene-by-scene preparation exists for the legacy Creatomate renderer, whose
  // createRender() needs pre-made visuals. The Cloud Run worker builds its own visuals
  // from the script text, so preparing scenes there only pays for images nothing uses.
  function assertScenePreparationUsed_() {
    if (String(Secrets.getVideoProvider() || "cloud-run").toLowerCase() === "cloud-run") {
      throw error_("Scene preparation is not used with the Cloud Run renderer: it builds its own visuals, so this " +
        "would pay for images the render ignores. Use Create Short instead.");
    }
  }

  // Apply queued Cloud Run callbacks before acting. A broken inbox (schema
  // mismatch, unreadable sheet) must not take the Production page or its
  // actions down with it: receipts stay pending, and an unapplied receipt can
  // only move an active render to a terminal state, so no action here becomes
  // unsafe by running without it. Pass locked=true when the script lock is held.
  function drainCallbacks_(locked) {
    try {
      return locked ? MediaWorkerCallbackInbox.processPendingLocked() : MediaWorkerCallbackInbox.processPending();
    } catch (caught) {
      try {
        // The page polls every ~12s while renders are active; log a persistent
        // inbox failure at most once per 10 minutes instead of on every drain.
        if (typeof CacheService !== "undefined") {
          const cache = CacheService.getScriptCache();
          if (cache.get("CALLBACK_INBOX_WARNED")) return { error: String(caught && caught.message || caught) };
          cache.put("CALLBACK_INBOX_WARNED", "1", 600);
        }
        LoggingService.log({
          action: "PRODUCTION_CALLBACK_INBOX", status: LoggingService.STATUS.WARNING,
          message: "Render callback inbox could not be processed; receipts remain pending.",
          errorDetails: String(caught && caught.message || caught)
        });
      } catch (ignored) {}
      return { error: String(caught && caught.message || caught) };
    }
  }

  function withScriptLock_(callback) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw error_("Another production action is running. Wait a few seconds and try again.");
    try { return callback(); } finally { lock.releaseLock(); }
  }
  function friendlyError_(caught) {
    return ProductionErrorService.normalise(caught).message;
  }
  function run_(message, callback) {
    const requestId = "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    try {
      try { LoggingService.started(requestId, "PRODUCTION", message); } catch (ignored) {}
      const data = JSON.parse(JSON.stringify(callback() || {}));
      try { LoggingService.success(requestId, "PRODUCTION", message); } catch (ignored) {}
      return { success: true, statusCode: 200, requestId: requestId, message: message,
        data: data, controllerVersion: VERSION };
    } catch (caught) {
      const normalised = ProductionErrorService.recordOccurrence(
        ProductionErrorService.normalise(caught, message)
      );
      const safe = normalised.message;
      try { LoggingService.failure(requestId, "PRODUCTION", "Failed while running: " + message, caught); } catch (ignored) {}
      Logger.log(JSON.stringify({ requestId: requestId, controller: "ProductionController", error: safe }));
      return { success: false, statusCode: normalised.statusCode, requestId: requestId, message: "Production request failed.",
        data: null, error: normalised,
        controllerVersion: VERSION };
    }
  }
  function failure_(message) {
    const normalised = ProductionErrorService.recordOccurrence(
      ProductionErrorService.normalise(error_(message), "Production request")
    );
    return {
      success: false,
      statusCode: normalised.statusCode,
      requestId: "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      message: "Production request failed.",
      data: null,
      error: normalised,
      controllerVersion: VERSION
    };
  }
  function error_(message) { const error = new Error(message); error.name = "ProductionControllerError"; return error; }

  return { testConnection: testConnection, listReady: listReady, submit: submit, renderNewVersion: renderNewVersion,
    startPreparation: startPreparation, prepareNextScene: prepareNextScene, reviewStalledTasks: reviewStalledTasks,
    controlPreparation: controlPreparation, submitPrepared: submitPrepared, refresh: refresh,
    refreshActive: refreshActive, retry: retry, prepareScene: prepareScene, approveRender: approveRender, listJobs: listJobs,
    getYouTubeConnection: getYouTubeConnection, getAutomationStatus: getAutomationStatus,
    getPublishingSchedule: getPublishingSchedule, setAutomation: setAutomation, publish: publish, previewPublish: previewPublish,
    refreshPublication: refreshPublication, abandonPublication: abandonPublication,
    reconcilePublication: reconcilePublication };
})();

function productionTestConnection() { return ProductionController.testConnection(); }
function productionListReady() { return ProductionController.listReady(); }
function productionSubmit(request) { return ProductionController.submit(request); }
function productionRenderNewVersion(request) { return ProductionController.renderNewVersion(request); }
function productionStartPreparation(request) { return ProductionController.startPreparation(request); }
function productionPrepareNextScene(request) { return ProductionController.prepareNextScene(request); }
function productionControlPreparation(request) { return ProductionController.controlPreparation(request); }
function productionSubmitPrepared(request) { return ProductionController.submitPrepared(request); }
function productionRefresh(request) { return ProductionController.refresh(request); }
function productionRefreshActive() { return ProductionController.refreshActive(); }
function productionRetry(request) { return ProductionController.retry(request); }
function productionPrepareScene(request) { return ProductionController.prepareScene(request); }
function productionApproveRender(request) { return ProductionController.approveRender(request); }
function productionListJobs() { return ProductionController.listJobs(); }
function productionGetYouTubeConnection() { return ProductionController.getYouTubeConnection(); }
function productionGetAutomationStatus() { return ProductionController.getAutomationStatus(); }
function productionGetPublishingSchedule(request) { return ProductionController.getPublishingSchedule(request); }
function productionSetAutomation(request) { return ProductionController.setAutomation(request); }
function productionPublish(request) { return ProductionController.publish(request); }
function productionPreviewPublish(request) { return ProductionController.previewPublish(request); }
function productionRefreshPublication(request) { return ProductionController.refreshPublication(request); }
function productionAbandonPublication(request) { return ProductionController.abandonPublication(request); }
function productionReconcilePublication(request) { return ProductionController.reconcilePublication(request); }
