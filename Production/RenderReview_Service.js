/****************************************************
 * Project Savannah v1.3 - final video review gate.
 ****************************************************/
const RenderReviewService = (() => {
  const PREFIX = "RENDER_REVIEW_";

  function get(jobId) {
    const id = required_(jobId);
    const raw = PropertiesService.getScriptProperties().getProperty(PREFIX + id);
    if (!raw) return { approved: false, reviewedAt: "", reviewer: "" };
    try {
      const value = JSON.parse(raw);
      return {
        approved: value.approved === true,
        reviewedAt: String(value.reviewedAt || ""),
        reviewer: String(value.reviewer || "")
      };
    } catch (error) {
      return { approved: false, reviewedAt: "", reviewer: "" };
    }
  }

  function approve(job) {
    if (!job || !job.id) throw error_("A render job is required.");
    RenderQualityService.assertPublishable(job);
    const review = {
      approved: true,
      reviewedAt: new Date().toISOString(),
      reviewer: Session.getActiveUser().getEmail() || "Project owner"
    };
    PropertiesService.getScriptProperties().setProperty(
      PREFIX + job.id,
      JSON.stringify(review)
    );
    return review;
  }

  function assertApproved(jobId) {
    const review = get(jobId);
    if (!review.approved) {
      throw error_("Final video approval is required before YouTube upload.");
    }
    return review;
  }

  function required_(value) {
    const result = String(value || "").trim();
    if (!result) throw error_("Render job ID is required.");
    return result;
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "RenderReviewError";
    return error;
  }
  return { get: get, approve: approve, assertApproved: assertApproved };
})();
