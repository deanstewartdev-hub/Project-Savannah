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

  test("Production queue ranks urgent work before older normal work", function () {
    const ranked = ProductionQueueService.rankTasks([
      { id: "NORMAL", priority: 3, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "URGENT", priority: 5, createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "LOW", priority: 1, createdAt: "2025-12-01T00:00:00.000Z" }
    ]);
    if (ranked.map(function (task) { return task.id; }).join(",") !== "URGENT,NORMAL,LOW") {
      throw new Error("Production queue priority order is invalid.");
    }
  });

  test("Production task priority rejects values outside one to five", function () {
    let rejected = false;
    try {
      ProductionTaskRepository.create({
        id: "PRD-BAD", scriptId: "SCR-BAD", priority: 6,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
      });
    } catch (error) { rejected = true; }
    if (!rejected) throw new Error("Invalid production priority was accepted.");
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

  test("Model-ready scene briefs are required for new render plans", function () {
    const job = qualityFixture_();
    delete job.requestPayload.scenePlan.slots[2].visualBrief.motionProfile;
    const result = RenderQualityService.evaluate(job);
    if (result.passed || result.checks.visualBriefsComplete) {
      throw new Error("Incomplete model-ready visual brief was not detected.");
    }
  });

  test("Provider rate limits return retry guidance", function () {
    const result = ProductionErrorService.normalise(new Error("OpenAI returned HTTP 429 rate limit."), "Prepare scene");
    if (result.code !== "PROVIDER_RATE_LIMITED" || !result.retryable || result.retryAfterSeconds !== 60) {
      throw new Error("Rate-limit recovery contract is invalid.");
    }
  });

  test("Uncertain YouTube uploads cannot be blindly retried", function () {
    const result = ProductionErrorService.normalise(
      new Error("This upload ended in an uncertain state. Check YouTube Studio."), "Publish Short"
    );
    if (result.code !== "PRODUCTION_UPLOAD_UNCERTAIN" || result.retryable || result.provider !== "YouTube") {
      throw new Error("Uncertain-upload recovery contract is invalid.");
    }
  });

  test("Production errors redact credentials", function () {
    const result = ProductionErrorService.normalise(
      new Error("Request failed using sk-secret_value_123 and Bearer hidden-token"), "Provider request"
    );
    if (result.message.indexOf("secret_value") !== -1 || result.message.indexOf("hidden-token") !== -1) {
      throw new Error("Sensitive error detail was not redacted.");
    }
  });

  test("Publishing schedule blocks Shorts less than one hour apart", function () {
    const requested = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const existing = new Date(requested.getTime() + 30 * 60 * 1000).toISOString();
    let blocked = false;
    try {
      PublishingScheduleService.assertAvailable(requested.toISOString(), [{
        id: "PUB-ONE", renderJobId: "RND-ONE", title: "Existing Short",
        providerResponse: { publishAt: existing }
      }], "RND-TWO");
    } catch (error) { blocked = error.name === "PublishingScheduleError"; }
    if (!blocked) throw new Error("Conflicting publication time was accepted.");
  });

  test("Publishing schedule accepts a separated time slot", function () {
    const requested = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const existing = new Date(requested.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const result = PublishingScheduleService.assertAvailable(requested.toISOString(), [{
      id: "PUB-ONE", renderJobId: "RND-ONE", title: "Existing Short",
      providerResponse: { publishAt: existing }
    }], "RND-TWO");
    if (!result.scheduled || result.publishAt !== requested.toISOString()) {
      throw new Error("Valid publication time was rejected.");
    }
  });

  test("Publishing schedule enforces the daily Short limit", function () {
    const requested = new Date(Date.now() + 24 * 60 * 60 * 1000);
    requested.setUTCHours(18, 0, 0, 0);
    const first = new Date(requested); first.setUTCHours(12);
    const second = new Date(requested); second.setUTCHours(15);
    let blocked = false;
    try {
      PublishingScheduleService.assertAvailable(requested.toISOString(), [
        { id: "PUB-A", renderJobId: "RND-A", title: "First", providerResponse: { publishAt: first.toISOString() } },
        { id: "PUB-B", renderJobId: "RND-B", title: "Second", providerResponse: { publishAt: second.toISOString() } }
      ], "RND-C", { timezoneOffsetMinutes: 0, maxPerDay: 2 });
    } catch (error) { blocked = error.name === "PublishingScheduleError"; }
    if (!blocked) throw new Error("A third Short was accepted on the same local day.");
  });

  test("Publishing schedule suggestions skip a full local day", function () {
    const result = PublishingScheduleService.suggestSlots([
      { id: "PUB-A", renderJobId: "RND-A", title: "First", providerResponse: { publishAt: "2026-01-05T12:00:00.000Z" } },
      { id: "PUB-B", renderJobId: "RND-B", title: "Second", providerResponse: { publishAt: "2026-01-05T18:00:00.000Z" } }
    ], { now: "2026-01-05T10:00:00.000Z", timezoneOffsetMinutes: 0,
      dailyTimes: ["12:00", "18:00"], maxPerDay: 2, limit: 2, daysAhead: 3 });
    if (result.slots.length !== 2 || result.slots[0].localDate !== "2026-01-06" ||
        result.slots[0].localTime !== "12:00" || result.slots[1].localTime !== "18:00") {
      throw new Error("Publishing suggestions did not skip the full local day.");
    }
  });

  test("Publishing schedule rejects invalid daily time rules", function () {
    let rejected = false;
    try {
      PublishingScheduleService.suggestSlots([], { now: "2026-01-05T10:00:00.000Z", dailyTimes: ["25:00"] });
    } catch (error) { rejected = error.name === "PublishingScheduleError"; }
    if (!rejected) throw new Error("An invalid daily publishing time was accepted.");
  });

  test("Weekday cadence template skips the weekend", function () {
    const result = PublishingScheduleService.suggestSlots([], {
      now: "2026-01-09T19:00:00.000Z", timezoneOffsetMinutes: 0,
      template: "weekdays", limit: 1, daysAhead: 7
    });
    if (result.slots.length !== 1 || result.slots[0].localDate !== "2026-01-12" ||
        result.slots[0].localTime !== "18:00" || result.template.key !== "weekdays") {
      throw new Error("The weekday cadence template did not skip Saturday and Sunday.");
    }
  });

  test("Publishing schedule rejects an unknown cadence template", function () {
    let rejected = false;
    try {
      PublishingScheduleService.suggestSlots([], { template: "unknown-pattern" });
    } catch (error) { rejected = error.name === "PublishingScheduleError"; }
    if (!rejected) throw new Error("An unknown cadence template was accepted.");
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
  const slots = [];
  for (let scene = 1; scene <= 4; scene++) {
    slots.push({
      narration: "This scene uses enough spoken words to maintain a natural measured narration pace.",
      visualBrief: {
        primaryAction: "A traveller performs one clear action in the featured location.",
        motionProfile: "One physically plausible action with a controlled camera follow.",
        evaluationCriteria: ["topic", "physics", "continuity", "audio", "composition", "cost"]
      }
    });
  }
  return {
    status: "SUCCEEDED", videoUrl: "https://example.com/video.mp4",
    requestPayload: {
      expectedDurationSeconds: 40,
      modifications: modifications,
      scenePlan: { modelVersion: "scene-plan-v1.5-model-ready", slots: slots }
    },
    providerResponse: { duration: 40, width: 1080, height: 1920 }
  };
}
