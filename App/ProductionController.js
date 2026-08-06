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
        items: items
      };
    });
  }

  function submit(request) {
    return run_("Short submitted for rendering.", function () {
      return submitCore_(request || {});
    });
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
      const active = existingJobs.filter(function (job) {
        return ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
      })[0];
      if (active) throw error_("This script already has an active render.");
      const completed = existingJobs.filter(function (job) {
        return job.status === "SUCCEEDED";
      })[0];
      if (completed && !(request && request.forceRerender === true)) {
        throw error_("This script already has a completed render. Use an explicit re-render action to replace it.");
      }
      const provider = VideoProcessingProvider.get();
      let job = RenderJobRepository.save(RenderJobModel.create({
        scriptId: script.id,
        seoPackId: seoPack.id,
        templateId: resolveTemplateId_(),
        status: "QUEUED",
        requestPayload: { preparationStatus: "assets-ready" }
      }));
      try {
        const result = provider.submitRender(script, seoPack);
        const render = result.render;
        job = RenderJobRepository.update(RenderJobModel.update(job, {
          renderId: render.id,
          status: mapStatus_(render.status),
          progress: render.progress || 0,
          videoUrl: render.url || "",
          snapshotUrl: render.snapshot_url || "",
          requestPayload: result.payload,
          providerResponse: sanitise_(render)
        }));
      } catch (caught) {
        RenderJobRepository.update(RenderJobModel.update(job, {
          status: "FAILED",
          errorMessage: friendlyError_(caught)
        }));
        throw caught;
      }
      return { job: job };
    });
  }

  function startPreparation(request) {
    return run_("Persistent production preparation started.", function () {
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
          status: status, errorMessage: action === "resume" ? "" : task.errorMessage
        })) };
      });
    });
  }

  function submitPrepared(request) {
    return run_("Prepared Short submitted for rendering.", function () {
      let task = ProductionTaskRepository.getById(String(request && request.taskId || "").trim());
      if (!task) throw error_("Production preparation task was not found.");
      if (task.status !== "READY" || task.preparedScenes.length !== 4) {
        throw error_("All four scenes must be prepared before rendering.");
      }
      task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, { status: "SUBMITTING" }));
      try {
        const result = submitCore_({ scriptId: task.scriptId, forceRerender: !!task.sourceRenderJobId });
        task = ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          status: "SUBMITTED", renderJobId: result.job.id, errorMessage: ""
        }));
        return { task: task, job: result.job };
      } catch (caught) {
        ProductionTaskRepository.persist(ProductionTaskRepository.update(task, {
          status: "FAILED", errorMessage: friendlyError_(caught)
        }));
        throw caught;
      }
    });
  }

  function refresh(request) {
    return run_("Render status refreshed.", function () {
      const jobId = String(request && request.jobId || "").trim();
      const job = RenderJobRepository.getById(jobId);
      if (!job) throw error_("Render job was not found.");
      const render = VideoProcessingProvider.forJob(job).getRender(job);
      const updated = RenderJobModel.update(job, {
        status: mapStatus_(render.status),
        progress: render.progress || (String(render.status).toLowerCase() === "succeeded" ? 100 : job.progress),
        videoUrl: render.url || job.videoUrl,
        snapshotUrl: render.snapshot_url || job.snapshotUrl,
        errorMessage: render.error_message || "",
        providerResponse: sanitise_(render)
      });
      return { job: RenderJobRepository.update(updated) };
    });
  }

  function refreshActive() {
    return run_("Active render statuses refreshed.", function () {
      recoverStaleJobs_();
      const active = RenderJobRepository.getAll().filter(function (job) {
        return ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
      });
      return {
        jobs: active.map(function (job) {
          if (!job.renderId) return job;
          try {
            const render = VideoProcessingProvider.forJob(job).getRender(job);
            return RenderJobRepository.update(RenderJobModel.update(job, {
            status: mapStatus_(render.status),
            progress: render.progress ||
              (String(render.status).toLowerCase() === "succeeded" ? 100 : job.progress),
            videoUrl: render.url || job.videoUrl,
            snapshotUrl: render.snapshot_url || job.snapshotUrl,
            errorMessage: render.error_message || "",
            providerResponse: sanitise_(render)
            }));
          } catch (caught) {
            return RenderJobRepository.update(RenderJobModel.update(job, {
              errorMessage: "Status refresh failed; Savannah will retry: " + friendlyError_(caught)
            }));
          }
        })
      };
    });
  }

  function retry(request) {
    const jobId = String(request && request.jobId || "").trim();
    const job = RenderJobRepository.getById(jobId);
    if (!job) return failure_("Render job was not found.");
    const published = PublishingJobRepository.getByRenderJobId(job.id);
    if (published && published.status === "PUBLISHED") {
      return failure_("Published videos cannot be re-rendered from the retry action.");
    }
    const quality = RenderQualityService.evaluate(job);
    const review = RenderReviewService.get(job.id);
    const retryable = job.status === "FAILED" || !quality.passed ||
      (job.status === "SUCCEEDED" && !review.approved);
    if (!retryable) {
      return failure_("Only failed, quality-blocked or unapproved completed renders can be retried.");
    }
    return submit({ scriptId: job.scriptId, forceRerender: true });
  }

  function prepareScene(request) {
    return run_("High-quality scene asset prepared.", function () {
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
      recoverStaleJobs_();
      recoverStalePublishingJobs_();
      const publishingJobs = PublishingJobRepository.getAll();
      return { jobs: RenderJobRepository.getAll().sort(function (a, b) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }).map(function (job) {
        const result = Object.assign({}, job);
        result.publishingJob = publishingJobs.filter(function (publishingJob) {
          return publishingJob.renderJobId === job.id;
        }).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })[0] || null;
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

  function publish(request) {
    return run_("Short uploaded to YouTube.", function () {
      return withScriptLock_(function () {
      const source = request || {};
      const renderJobId = String(source.renderJobId || "").trim();
      const renderJob = RenderJobRepository.getById(renderJobId);
      if (!renderJob) throw error_("Render job was not found.");
      if (renderJob.status !== "SUCCEEDED" || !renderJob.videoUrl) {
        throw error_("Only a completed render can be uploaded.");
      }
      RenderQualityService.assertPublishable(renderJob);
      RenderReviewService.assertApproved(renderJob.id);
      const existing = PublishingJobRepository.getByRenderJobId(renderJobId);
      if (existing && existing.status === "PUBLISHED") throw error_("This render is already published to YouTube.");
      if (existing && existing.status === "UPLOADING") {
        throw error_("This video already has an upload in progress. Refresh its YouTube status before retrying.");
      }
      if (existing && existing.status === "RECONCILE") {
        throw error_("This upload ended in an uncertain state. Check YouTube Studio, then use Confirm no upload before retrying.");
      }
      const scheduleCheck = PublishingScheduleService.assertAvailable(
        source.publishAt,
        PublishingJobRepository.getAll(),
        renderJobId,
        { timezoneOffsetMinutes: source.timezoneOffsetMinutes, maxPerDay: 2 }
      );
      if (scheduleCheck.scheduled) source.publishAt = scheduleCheck.publishAt;
      const seoPack = SeoRepository.getById(renderJob.seoPackId);
      if (!seoPack) throw error_("The SEO pack for this render was not found.");
      let job = PublishingJobRepository.save(PublishingJobModel.create({
        renderJobId: renderJob.id,
        scriptId: renderJob.scriptId,
        seoPackId: renderJob.seoPackId,
        title: source.title || seoPack.titleOptions[0],
        description: source.description || seoPack.description,
        tags: seoPack.tags,
        privacyStatus: source.privacyStatus || "private"
      }));
      try {
        const upload = YouTubeService.upload(renderJob, seoPack, source);
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
        PublishingJobRepository.update(PublishingJobModel.update(job, {
          status: "FAILED",
          errorMessage: String(caught && caught.message || "YouTube upload failed.").slice(0, 500)
        }));
        throw caught;
      }
      return { job: job };
      });
    });
  }

  function refreshPublication(request) {
    return run_("YouTube processing status refreshed.", function () {
      const renderJobId = String(request && request.renderJobId || "").trim();
      const job = PublishingJobRepository.getByRenderJobId(renderJobId);
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
    return run_("Uncertain YouTube upload cleared for retry.", function () {
      const source = request || {};
      if (source.confirmNoUpload !== true) throw error_("Confirmation that no YouTube upload exists is required.");
      const renderJobId = String(source.renderJobId || "").trim();
      const job = PublishingJobRepository.getByRenderJobId(renderJobId);
      if (!job || job.status !== "RECONCILE") throw error_("No uncertain upload was found for this render.");
      return { job: PublishingJobRepository.update(PublishingJobModel.update(job, {
        status: "FAILED",
        errorMessage: "YouTube Studio was checked and no upload was found. A controlled retry is now allowed."
      })) };
    });
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
  function recoverStaleJobs_() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    RenderJobRepository.getAll().filter(function (job) {
      return job.status === "QUEUED" && !job.renderId && new Date(job.updatedAt).getTime() < cutoff;
    }).forEach(function (job) {
      RenderJobRepository.update(RenderJobModel.update(job, {
        status: "FAILED",
        errorMessage: "Render submission was interrupted before Creatomate returned an ID. Resume with Re-render safely."
      }));
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
    });
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

  return { testConnection: testConnection, listReady: listReady, submit: submit,
    startPreparation: startPreparation, prepareNextScene: prepareNextScene,
    controlPreparation: controlPreparation, submitPrepared: submitPrepared, refresh: refresh,
    refreshActive: refreshActive, retry: retry, prepareScene: prepareScene, approveRender: approveRender, listJobs: listJobs,
    getYouTubeConnection: getYouTubeConnection, getAutomationStatus: getAutomationStatus,
    getPublishingSchedule: getPublishingSchedule, setAutomation: setAutomation, publish: publish,
    refreshPublication: refreshPublication, abandonPublication: abandonPublication };
})();

function productionTestConnection() { return ProductionController.testConnection(); }
function productionListReady() { return ProductionController.listReady(); }
function productionSubmit(request) { return ProductionController.submit(request); }
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
function productionRefreshPublication(request) { return ProductionController.refreshPublication(request); }
function productionAbandonPublication(request) { return ProductionController.abandonPublication(request); }
