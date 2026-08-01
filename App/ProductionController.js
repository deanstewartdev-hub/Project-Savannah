/****************************************************
 * Project Savannah v1.3 - production controller.
 ****************************************************/
const ProductionController = (() => {
  const VERSION = "production-controller-v1.0";

  function testConnection() {
    return run_("Creatomate connection verified.", function () {
      return CreatomateService.testConnection();
    });
  }

  function listReady() {
    return run_("Production-ready Shorts loaded.", function () {
      return {
        items: SeoRepository.getAll().filter(function (pack) {
          return pack.status === "GENERATED" || pack.status === "READY_FOR_PRODUCTION";
        }).map(function (pack) {
          const script = ScriptsRepository.getScriptById(pack.scriptId);
          return {
            seoPack: pack,
            script: script,
            existingJobs: RenderJobRepository.getAll().filter(function (job) {
              return job.scriptId === pack.scriptId;
            })
          };
        }).filter(function (item) { return !!item.script; })
      };
    });
  }

  function submit(request) {
    return run_("Short submitted to Creatomate.", function () {
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
      const result = CreatomateService.createRender(script, seoPack);
      const render = result.render;
      return {
        job: RenderJobRepository.save(RenderJobModel.create({
          renderId: render.id,
          scriptId: script.id,
          seoPackId: seoPack.id,
          templateId: Secrets.getCreatomateTemplateId(),
          status: mapStatus_(render.status),
          progress: render.progress || 0,
          videoUrl: render.url || "",
          snapshotUrl: render.snapshot_url || "",
          requestPayload: result.payload,
          providerResponse: sanitise_(render)
        }))
      };
    });
  }

  function refresh(request) {
    return run_("Render status refreshed.", function () {
      const jobId = String(request && request.jobId || "").trim();
      const job = RenderJobRepository.getById(jobId);
      if (!job) throw error_("Render job was not found.");
      const render = CreatomateService.getRender(job.renderId);
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
      const active = RenderJobRepository.getAll().filter(function (job) {
        return ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
      });
      return {
        jobs: active.map(function (job) {
          const render = CreatomateService.getRender(job.renderId);
          return RenderJobRepository.update(RenderJobModel.update(job, {
            status: mapStatus_(render.status),
            progress: render.progress ||
              (String(render.status).toLowerCase() === "succeeded" ? 100 : job.progress),
            videoUrl: render.url || job.videoUrl,
            snapshotUrl: render.snapshot_url || job.snapshotUrl,
            errorMessage: render.error_message || "",
            providerResponse: sanitise_(render)
          }));
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

  function publish(request) {
    return run_("Short uploaded to YouTube.", function () {
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
  function run_(message, callback) {
    const requestId = "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    try {
      return { success: true, statusCode: 200, requestId: requestId, message: message,
        data: JSON.parse(JSON.stringify(callback() || {})), controllerVersion: VERSION };
    } catch (caught) {
      const safe = String(caught && caught.message || "Unknown error")
        .replace(/[a-f0-9]{80,}/ig, "[REDACTED]").slice(0, 500);
      Logger.log(JSON.stringify({ requestId: requestId, controller: "ProductionController", error: safe }));
      return { success: false, statusCode: 400, requestId: requestId, message: "Production request failed.",
        data: null, error: { code: caught && caught.name || "PRODUCTION_REQUEST_FAILED", message: safe },
        controllerVersion: VERSION };
    }
  }
  function failure_(message) {
    return {
      success: false,
      statusCode: 400,
      requestId: "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      message: "Production request failed.",
      data: null,
      error: { code: "PRODUCTION_REQUEST_FAILED", message: message },
      controllerVersion: VERSION
    };
  }
  function error_(message) { const error = new Error(message); error.name = "ProductionControllerError"; return error; }

  return { testConnection: testConnection, listReady: listReady, submit: submit, refresh: refresh,
    refreshActive: refreshActive, retry: retry, approveRender: approveRender, listJobs: listJobs,
    getYouTubeConnection: getYouTubeConnection, publish: publish,
    refreshPublication: refreshPublication };
})();

function productionTestConnection() { return ProductionController.testConnection(); }
function productionListReady() { return ProductionController.listReady(); }
function productionSubmit(request) { return ProductionController.submit(request); }
function productionRefresh(request) { return ProductionController.refresh(request); }
function productionRefreshActive() { return ProductionController.refreshActive(); }
function productionRetry(request) { return ProductionController.retry(request); }
function productionApproveRender(request) { return ProductionController.approveRender(request); }
function productionListJobs() { return ProductionController.listJobs(); }
function productionGetYouTubeConnection() { return ProductionController.getYouTubeConnection(); }
function productionPublish(request) { return ProductionController.publish(request); }
function productionRefreshPublication(request) { return ProductionController.refreshPublication(request); }
