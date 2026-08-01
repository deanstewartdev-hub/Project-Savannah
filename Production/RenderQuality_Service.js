/****************************************************
 * Project Savannah v1.3 - rendered media gate.
 ****************************************************/
const RenderQualityService = (() => {
  const MINIMUM_DURATION_SECONDS = 30;
  const MAXIMUM_DURATION_SECONDS = 60;
  const DURATION_RATIO_MINIMUM = 0.9;

  function evaluate(job) {
    if (!job) throw error_("A render job is required.");
    const response = job.providerResponse || {};
    const payload = job.requestPayload || {};
    const expected = Number(
      payload.expectedDurationSeconds ||
      payload.modifications && payload.modifications.duration ||
      0
    );
    const actual = Number(response.duration || 0);
    const issues = [];
    const modifications = payload.modifications || {};

    if (job.status !== "SUCCEEDED") issues.push("Render has not succeeded.");
    if (!job.videoUrl) issues.push("Rendered video URL is missing.");
    if (!expected) issues.push("Expected duration is missing.");
    if (!actual) issues.push("Creatomate did not report the finished duration.");
    for (let sceneNumber = 1; sceneNumber <= 4; sceneNumber++) {
      if (!String(modifications["Image-" + sceneNumber + ".source"] || "").trim()) {
        issues.push("Scene-specific visual asset " + sceneNumber + " is missing.");
      }
    }
    if (actual && (actual < MINIMUM_DURATION_SECONDS || actual > MAXIMUM_DURATION_SECONDS)) {
      issues.push(
        "Finished duration is " + actual +
        " seconds; Shorts must be between 30 and 60 seconds."
      );
    }
    if (actual && expected && actual / expected < DURATION_RATIO_MINIMUM) {
      issues.push(
        "Finished video contains less than 90% of the planned duration (" +
        actual + "s of " + expected + "s)."
      );
    }
    if (Number(response.width || 0) && Number(response.height || 0) &&
        Number(response.height) <= Number(response.width)) {
      issues.push("Finished video is not vertical.");
    }

    return {
      passed: issues.length === 0,
      expectedDurationSeconds: expected,
      actualDurationSeconds: actual,
      durationRatio: expected && actual ? Math.round(actual / expected * 1000) / 1000 : 0,
      issues: issues,
      modelVersion: "render-quality-v1.1"
    };
  }

  function assertPublishable(job) {
    const result = evaluate(job);
    if (!result.passed) {
      throw error_(
        "Render quality check failed: " + result.issues.join(" ")
      );
    }
    return result;
  }

  function error_(message) {
    const error = new Error(message);
    error.name = "RenderQualityError";
    return error;
  }
  return { evaluate: evaluate, assertPublishable: assertPublishable };
})();
