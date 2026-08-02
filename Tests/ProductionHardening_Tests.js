/****************************************************
 * Project Savannah v1.3 - production hardening tests.
 * These tests do not call paid providers or create sheet rows.
 ****************************************************/
function runProductionHardeningTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  test("Production task resumes at its next unprepared scene", function () {
    const task = ProductionTaskRepository.create({
      id: "PRD-TEST", scriptId: "SCR-TEST", preparedScenes: [1, 2], nextScene: 3,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
    });
    if (task.preparedScenes.length !== 2 || task.nextScene !== 3) throw new Error("Preparation progress was not retained.");
    if (task.priority !== 3) throw new Error("Default production priority is invalid.");
  });

  test("Interrupted render submissions can be marked failed without a provider ID", function () {
    const job = RenderJobModel.create({
      id: "RND-TEST", scriptId: "SCR-TEST", templateId: "TPL-TEST", status: "FAILED",
      errorMessage: "Submission interrupted", createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    if (job.status !== "FAILED" || job.renderId) throw new Error("Interrupted render state is invalid.");
  });

  test("Complete vertical render passes automated gate", function () {
    const result = RenderQualityService.evaluate(qualityFixture_());
    if (!result.passed) throw new Error(result.issues.join(" "));
  });

  test("Missing narration blocks publishing", function () {
    const job = qualityFixture_();
    delete job.requestPayload.modifications["Voiceover-3.source"];
    const result = RenderQualityService.evaluate(job);
    if (result.passed || result.checks.narrationComplete) throw new Error("Missing narration was not detected.");
  });

  test("Low-resolution output blocks publishing", function () {
    const job = qualityFixture_();
    job.providerResponse.width = 720;
    job.providerResponse.height = 1280;
    if (RenderQualityService.evaluate(job).passed) throw new Error("Low-resolution output was not detected.");
  });

  test("Repeated visual assets block publishing", function () {
    const job = qualityFixture_();
    job.requestPayload.modifications["Image-4.source"] =
      job.requestPayload.modifications["Image-3.source"];
    const result = RenderQualityService.evaluate(job);
    if (result.passed || result.checks.visualVariety) {
      throw new Error("Repeated scene imagery was not detected.");
    }
  });

  test("Overlong visual holds block publishing", function () {
    const job = qualityFixture_();
    job.requestPayload.modifications["Scene-1.duration"] = 16;
    const result = RenderQualityService.evaluate(job);
    if (result.passed || result.checks.visualCadence) {
      throw new Error("Slow visual cadence was not detected.");
    }
  });

  test("Render captions remain short enough to scan", function () {
    const job = qualityFixture_();
    job.requestPayload.modifications["Subtitles-2.text"] =
      "This caption contains far too many words";
    const result = RenderQualityService.evaluate(job);
    if (result.passed || result.checks.captionsConcise) {
      throw new Error("Overlong captions were not detected.");
    }
  });

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Production hardening tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}

function qualityFixture_() {
  const modifications = { duration: 40 };
  for (let scene = 1; scene <= 4; scene++) {
    modifications["Image-" + scene + ".source"] = "https://example.com/image-" + scene + ".png";
    modifications["Voiceover-" + scene + ".source"] = "https://example.com/audio-" + scene + ".mp3";
    modifications["Subtitles-" + scene + ".text"] = "Caption " + scene;
    modifications["Scene-" + scene + ".duration"] = 10;
  }
  return {
    status: "SUCCEEDED", videoUrl: "https://example.com/video.mp4",
    requestPayload: { expectedDurationSeconds: 40, modifications: modifications },
    providerResponse: { duration: 40, width: 1080, height: 1920 }
  };
}
