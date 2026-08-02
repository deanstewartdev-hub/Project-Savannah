/****************************************************
 * Project Savannah v1.3 - rendered media gate.
 ****************************************************/
const RenderQualityService = (() => {
  const MINIMUM_DURATION_SECONDS = 30;
  const MAXIMUM_DURATION_SECONDS = 60;
  const DURATION_RATIO_MINIMUM = 0.9;
  const MINIMUM_WIDTH = 1080;
  const MINIMUM_HEIGHT = 1920;
  const MAXIMUM_SCENE_DURATION_SECONDS = 15;
  const MAXIMUM_CAPTION_WORDS = 5;
  const MINIMUM_NARRATION_WORDS_PER_SECOND = 1.1;
  const MAXIMUM_NARRATION_WORDS_PER_SECOND = 3.5;

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
    const plannedSlots = payload.scenePlan && Array.isArray(payload.scenePlan.slots)
      ? payload.scenePlan.slots
      : [];
    const visualSources = [];
    const checks = {
      renderSucceeded: job.status === "SUCCEEDED",
      videoUrlPresent: !!String(job.videoUrl || "").trim(),
      durationPresent: !!actual,
      expectedDurationPresent: !!expected,
      vertical: true,
      fullHdVertical: true,
      scenesComplete: true,
      narrationComplete: true,
      captionsComplete: true,
      captionsConcise: true,
      visualCadence: true,
      visualVariety: true,
      visualBriefsComplete: true,
      narrationDensity: true
    };
    const requiresVisualBriefs = /^scene-plan-v1\.(?:[5-9]|[1-9][0-9])/.test(
      String(payload.scenePlan && payload.scenePlan.modelVersion || "")
    );

    if (job.status !== "SUCCEEDED") issues.push("Render has not succeeded.");
    if (!job.videoUrl) issues.push("Rendered video URL is missing.");
    if (!expected) issues.push("Expected duration is missing.");
    if (!actual) issues.push("Creatomate did not report the finished duration.");
    for (let sceneNumber = 1; sceneNumber <= 4; sceneNumber++) {
      const visualSource = String(modifications["Image-" + sceneNumber + ".source"] || "").trim();
      const sceneDuration = Number(modifications["Scene-" + sceneNumber + ".duration"] || 0);
      const captionText = String(modifications["Subtitles-" + sceneNumber + ".text"] || "").trim();
      if (!visualSource) {
        checks.scenesComplete = false;
        issues.push("Scene-specific visual asset " + sceneNumber + " is missing.");
      } else {
        visualSources.push(visualSource);
      }
      if (!String(modifications["Voiceover-" + sceneNumber + ".source"] || "").trim()) {
        checks.narrationComplete = false;
        issues.push("Narration audio for scene " + sceneNumber + " is missing.");
      }
      if (!captionText) {
        checks.captionsComplete = false;
        issues.push("Caption text for scene " + sceneNumber + " is missing.");
      } else if (countWords_(captionText) > MAXIMUM_CAPTION_WORDS) {
        checks.captionsConcise = false;
        issues.push(
          "Caption text for scene " + sceneNumber + " exceeds " +
          MAXIMUM_CAPTION_WORDS + " words."
        );
      }
      if (sceneDuration <= 0) {
        checks.scenesComplete = false;
        issues.push("Scene " + sceneNumber + " has no valid duration.");
      } else if (sceneDuration > MAXIMUM_SCENE_DURATION_SECONDS) {
        checks.visualCadence = false;
        issues.push(
          "Scene " + sceneNumber + " holds one visual for " + sceneDuration +
          " seconds; maximum is " + MAXIMUM_SCENE_DURATION_SECONDS + " seconds."
        );
      }

      const plannedNarration = String(
        plannedSlots[sceneNumber - 1] && plannedSlots[sceneNumber - 1].narration || ""
      ).trim();
      const visualBrief = plannedSlots[sceneNumber - 1] && plannedSlots[sceneNumber - 1].visualBrief;
      if (requiresVisualBriefs && (
        !visualBrief ||
        !String(visualBrief.primaryAction || "").trim() ||
        !String(visualBrief.motionProfile || "").trim() ||
        !Array.isArray(visualBrief.evaluationCriteria) ||
        visualBrief.evaluationCriteria.length < 5
      )) {
        checks.visualBriefsComplete = false;
        issues.push("Scene " + sceneNumber + " is missing its model-ready visual brief.");
      }
      if (plannedNarration && sceneDuration > 0) {
        const narrationRate = countWords_(plannedNarration) / sceneDuration;
        if (
          narrationRate < MINIMUM_NARRATION_WORDS_PER_SECOND ||
          narrationRate > MAXIMUM_NARRATION_WORDS_PER_SECOND
        ) {
          checks.narrationDensity = false;
          issues.push(
            "Scene " + sceneNumber + " narration density is " +
            Math.round(narrationRate * 100) / 100 +
            " words per second; adjust the script or measured audio timing."
          );
        }
      }
    }
    if (visualSources.length === 4 && new Set(visualSources).size !== visualSources.length) {
      checks.visualVariety = false;
      issues.push("Every scene must use a different visual asset.");
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
      checks.vertical = false;
      issues.push("Finished video is not vertical.");
    }
    if (Number(response.width || 0) && Number(response.width) < MINIMUM_WIDTH) {
      checks.fullHdVertical = false;
      issues.push("Finished video width is below 1080 pixels.");
    }
    if (Number(response.height || 0) && Number(response.height) < MINIMUM_HEIGHT) {
      checks.fullHdVertical = false;
      issues.push("Finished video height is below 1920 pixels.");
    }

    return {
      passed: issues.length === 0,
      expectedDurationSeconds: expected,
      actualDurationSeconds: actual,
      width: Number(response.width || 0),
      height: Number(response.height || 0),
      durationRatio: expected && actual ? Math.round(actual / expected * 1000) / 1000 : 0,
      checks: checks,
      issues: issues,
      modelVersion: "render-quality-v1.4-model-ready"
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
  function countWords_(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }
  return { evaluate: evaluate, assertPublishable: assertPublishable };
})();
