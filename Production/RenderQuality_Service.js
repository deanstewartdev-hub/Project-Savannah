/****************************************************
 * Project Savannah v1.4 - rendered media gate.
 *
 * Two evaluation paths. Cloud Run jobs carry a `providerResponse.probe` written by
 * MediaWorkerCallback_Service.js from savannah-media-worker's ffprobe/silencedetect/
 * blackdetect/loudnorm results on the *finished file* — see section 2.4 of
 * SAVANNAH_AUDIT_AND_PLAN.md for why that distinction matters. Creatomate jobs (kept
 * only until Cloud Run is verified, see APPROVALS_REQUIRED.md) still evaluate the
 * request payload, exactly as before.
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
  const TARGET_LUFS = -14;
  const LOUDNESS_TOLERANCE_LU = 1.5;

  function evaluate(job) {
    if (!job) throw error_("A render job is required.");
    const probe = job.providerResponse && job.providerResponse.probe;
    return probe ? evaluateProbe_(job, probe) : evaluateCreatomatePayload_(job);
  }

  function evaluateProbe_(job, probe) {
    const issues = [];
    const duration = Number(probe.durationSeconds || 0);
    const width = Number(probe.width || 0);
    const height = Number(probe.height || 0);
    const loudness = probe.loudness || {};
    const checks = {
      renderSucceeded: job.status === "SUCCEEDED",
      videoUrlPresent: !!String(job.videoUrl || "").trim(),
      durationInRange: true,
      vertical: true,
      fullHdVertical: true,
      silenceClean: true,
      blackFrameClean: true,
      loudnessOnTarget: true,
      noClipping: true
    };

    if (job.status !== "SUCCEEDED") issues.push("Render has not succeeded.");
    if (!job.videoUrl) issues.push("Rendered video URL is missing.");
    if (!duration || duration < MINIMUM_DURATION_SECONDS || duration > MAXIMUM_DURATION_SECONDS) {
      checks.durationInRange = false;
      issues.push(
        "Finished duration is " + duration + " seconds; Shorts must be between " +
        MINIMUM_DURATION_SECONDS + " and " + MAXIMUM_DURATION_SECONDS + " seconds."
      );
    }
    if (width && height && height <= width) {
      checks.vertical = false;
      issues.push("Finished video is not vertical.");
    }
    if (!probe.passesResolutionGate) {
      checks.fullHdVertical = false;
      issues.push(
        "Finished video does not meet the " + MINIMUM_WIDTH + "x" + MINIMUM_HEIGHT + " resolution gate."
      );
    }
    if (!probe.passesSilenceGate) {
      checks.silenceClean = false;
      issues.push("Silence longer than 1.5 seconds was detected in the narration.");
    }
    if (!probe.passesBlackFrameGate) {
      checks.blackFrameClean = false;
      issues.push("Black or frozen frames were detected in the finished video.");
    }
    if (
      typeof loudness.integratedLufs === "number" &&
      Math.abs(loudness.integratedLufs - TARGET_LUFS) > LOUDNESS_TOLERANCE_LU
    ) {
      checks.loudnessOnTarget = false;
      issues.push(
        "Integrated loudness is " + loudness.integratedLufs + " LUFS; target is " +
        TARGET_LUFS + " ± " + LOUDNESS_TOLERANCE_LU + " LU."
      );
    }
    if (probe.clippingDetected) {
      checks.noClipping = false;
      issues.push("Audio clipping risk detected (true peak above -0.5 dBTP).");
    }

    return {
      passed: issues.length === 0,
      expectedDurationSeconds: duration,
      actualDurationSeconds: duration,
      width: width,
      height: height,
      durationRatio: 1,
      checks: checks,
      issues: issues,
      modelVersion: "render-quality-v1.4-probed-media"
    };
  }

  function evaluateCreatomatePayload_(job) {
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
