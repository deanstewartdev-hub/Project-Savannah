/****************************************************
 * Project Savannah v1.3 - YouTube schedule safety.
 ****************************************************/
const PublishingScheduleService = (() => {
  const MINIMUM_GAP_MINUTES = 60;
  const MINIMUM_GAP_MS = MINIMUM_GAP_MINUTES * 60 * 1000;

  function assertAvailable(publishAt, jobs, excludeRenderJobId) {
    const requested = normalise_(publishAt);
    if (!requested) return { scheduled: false, publishAt: "", conflicts: [] };
    const conflicts = upcoming(jobs).filter(function (slot) {
      return slot.renderJobId !== String(excludeRenderJobId || "").trim() &&
        Math.abs(new Date(slot.publishAt).getTime() - new Date(requested).getTime()) < MINIMUM_GAP_MS;
    });
    if (conflicts.length) {
      throw error_(
        "Scheduled publication conflicts with '" + conflicts[0].title + "' at " +
        conflicts[0].publishAt + ". Keep at least " + MINIMUM_GAP_MINUTES + " minutes between Shorts."
      );
    }
    return { scheduled: true, publishAt: requested, conflicts: [] };
  }

  function upcoming(jobs) {
    const now = Date.now();
    return (Array.isArray(jobs) ? jobs : []).map(function (job) {
      const publishAt = normalise_(job && job.providerResponse && job.providerResponse.publishAt, true);
      return publishAt ? {
        publishingJobId: String(job.id || ""),
        renderJobId: String(job.renderJobId || ""),
        title: String(job.title || "Untitled Short"),
        publishAt: publishAt,
        youtubeUrl: String(job.youtubeUrl || ""),
        privacyStatus: String(job.privacyStatus || "private")
      } : null;
    }).filter(function (slot) {
      return slot && new Date(slot.publishAt).getTime() > now;
    }).sort(function (a, b) {
      return new Date(a.publishAt) - new Date(b.publishAt);
    });
  }

  function normalise_(value, allowPast) {
    const text = String(value || "").trim();
    if (!text) return "";
    const date = new Date(text);
    if (isNaN(date.getTime())) throw error_("Scheduled publication time is invalid.");
    if (!allowPast && date.getTime() <= Date.now() + 60000) {
      throw error_("Scheduled publication time must be at least one minute in the future.");
    }
    return date.toISOString();
  }

  function error_(message) {
    const error = new Error(message);
    error.name = "PublishingScheduleError";
    return error;
  }

  return { assertAvailable: assertAvailable, upcoming: upcoming };
})();
