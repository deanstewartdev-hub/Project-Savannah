/****************************************************
 * Project Savannah - Cloud Run narration-length validation tests (2026-08-14 fix).
 *
 * Covers the fix for the 2026-08-14 forensic finding: Script_Validator previously
 * validated script.voiceoverScript (an AI-written field CloudRunFFmpegProvider never
 * reads) instead of scenes[].narration (the exact text sent to ElevenLabs), and
 * Script_Engine fabricated estimatedDurationSeconds to always fit 30-60s regardless of
 * actual content. Pure logic tests only - no AI/provider calls, no Sheet writes.
 ****************************************************/
function runScriptDurationValidationTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  function sceneWithWords(sceneNumber, wordCount) {
    const words = [];
    for (let i = 0; i < wordCount; i++) words.push("word" + i);
    // Break into short sentences (well under the 22-word sentence cap) so this synthetic
    // fixture doesn't trip the unrelated narration-cadence check - periods attach to the
    // preceding token so they don't change the whitespace-based word count.
    const sentences = [];
    for (let i = 0; i < words.length; i += 8) {
      sentences.push(words.slice(i, i + 8).join(" ") + ".");
    }
    return {
      sceneNumber: sceneNumber,
      narration: sentences.join(" "),
      onScreenText: "Fact " + sceneNumber,
      visualDirection: "Concrete visual detail for scene " + sceneNumber,
      // Same formula normaliseGeneratedTiming_ now uses - keeps this fixture internally
      // consistent so validateDurationConsistency_ doesn't reject it for an unrelated reason.
      estimatedSeconds: Math.round((wordCount / 2.3) * 100) / 100
    };
  }

  function scriptWithSceneWordCounts(wordCountsPerScene) {
    const scenes = wordCountsPerScene.map(function (count, index) { return sceneWithWords(index + 1, count); });
    const totalWords = wordCountsPerScene.reduce(function (sum, count) { return sum + count; }, 0);
    return {
      title: "Test Script",
      hook: scenes[0].narration.split(" ").slice(0, 6).join(" ").replace(/\.$/, ""),
      // Deliberately a different body of text from the scene narration above - this is
      // exactly the AI-written field CloudRunFFmpegProvider never reads, and exactly what
      // must never be trusted for word-count validation any more.
      voiceoverScript: "A completely independently-written voiceover field with a different " +
        "word count than the scene narration, which is precisely the mismatch this fix removes.",
      scenes: scenes,
      callToAction: "Follow for more facts.",
      estimatedDurationSeconds: Math.round((totalWords / 2.3) * 100) / 100,
      generationNotes: ""
    };
  }

  // --- Script_Validator: canonical narration source + bounds ---

  test("1. 37 scene words (real Render A shape) -> REJECT", function () {
    let rejected = false;
    try { ScriptValidator.validate(scriptWithSceneWordCounts([7, 5, 14, 3, 3, 5])); }
    catch (error) { rejected = error.name === "ScriptValidationError"; }
    if (!rejected) throw new Error("A 37-word scene narration must be rejected.");
  });

  test("2. 59 scene words (real Render B shape) -> REJECT", function () {
    let rejected = false;
    try { ScriptValidator.validate(scriptWithSceneWordCounts([6, 15, 11, 10, 7, 10])); }
    catch (error) { rejected = error.name === "ScriptValidationError"; }
    if (!rejected) throw new Error("A 59-word scene narration must be rejected.");
  });

  test("3. 89 scene words -> REJECT", function () {
    let rejected = false;
    try { ScriptValidator.validate(scriptWithSceneWordCounts([22, 22, 22, 23])); }
    catch (error) { rejected = error.name === "ScriptValidationError"; }
    if (!rejected) throw new Error("89 words must be rejected (one below the 90-word floor).");
  });

  test("4. exactly 90 scene words -> ACCEPT", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([23, 23, 22, 22]));
    if (!result.valid || result.metadata.wordCount !== 90) {
      throw new Error("Exactly 90 words must be accepted with wordCount === 90.");
    }
  });

  test("5. 100 words -> ACCEPT / preferred", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([25, 25, 25, 25]));
    if (!result.valid || !result.metadata.withinPreferredWordRange) {
      throw new Error("100 words must be accepted and flagged as within the preferred range.");
    }
  });

  test("6. 120 words -> ACCEPT / preferred", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([30, 30, 30, 30]));
    if (!result.valid || !result.metadata.withinPreferredWordRange) {
      throw new Error("120 words must be accepted and flagged as within the preferred range.");
    }
  });

  test("7. exactly 130 scene words -> ACCEPT", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([33, 33, 32, 32]));
    if (!result.valid || result.metadata.wordCount !== 130 || result.metadata.withinPreferredWordRange) {
      throw new Error("Exactly 130 words must be accepted, outside the advisory preferred range.");
    }
  });

  test("8. 131 scene words -> REJECT", function () {
    let rejected = false;
    try { ScriptValidator.validate(scriptWithSceneWordCounts([33, 33, 33, 32])); }
    catch (error) { rejected = error.name === "ScriptValidationError"; }
    if (!rejected) throw new Error("131 words must be rejected (one above the 130-word ceiling).");
  });

  test("9. 4 scenes totaling 100 words -> ACCEPT", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([25, 25, 25, 25]));
    if (!result.valid || result.script.scenes.length !== 4) {
      throw new Error("4 scenes totaling 100 words must be accepted.");
    }
  });

  test("10. 6 scenes totaling 100 words -> ACCEPT", function () {
    const result = ScriptValidator.validate(scriptWithSceneWordCounts([17, 17, 17, 17, 16, 16]));
    if (!result.valid || result.script.scenes.length !== 6) {
      throw new Error("6 scenes totaling 100 words must be accepted regardless of scene count.");
    }
  });

  test("15. voiceoverScript is derived from scenes, never independently trusted", function () {
    const script = scriptWithSceneWordCounts([25, 25, 25, 25]);
    const originalVoiceover = script.voiceoverScript;
    const result = ScriptValidator.validate(script);
    if (result.script.voiceoverScript === originalVoiceover) {
      throw new Error("voiceoverScript must be replaced with scenes-derived canonical narration, not the AI's own copy.");
    }
    const rebuilt = script.scenes.map(function (s) { return s.narration; }).join(" ");
    if (result.script.voiceoverScript !== rebuilt) {
      throw new Error("Returned voiceoverScript must exactly equal the joined scene narration.");
    }
  });

  // --- Script_Engine: honest duration estimate (no fabrication) ---

  test("11. estimatedDurationSeconds for 37 words -> roughly 16s, not 50", function () {
    const generated = {
      scenes: [7, 5, 14, 3, 3, 5].map(function (n) { return { narration: sceneWithWords(1, n).narration }; })
    };
    ScriptEngine.__test_normaliseGeneratedTiming(generated);
    if (generated.estimatedDurationSeconds === 50) {
      throw new Error("estimatedDurationSeconds must no longer be the fabricated 50s default.");
    }
    if (generated.estimatedDurationSeconds < 14 || generated.estimatedDurationSeconds > 18) {
      throw new Error("estimatedDurationSeconds for 37 words should land close to 16s (got " +
        generated.estimatedDurationSeconds + ").");
    }
  });

  test("12. estimatedDurationSeconds for 59 words -> roughly 26s, not 50", function () {
    const generated = {
      scenes: [6, 15, 11, 10, 7, 10].map(function (n) { return { narration: sceneWithWords(1, n).narration }; })
    };
    ScriptEngine.__test_normaliseGeneratedTiming(generated);
    if (generated.estimatedDurationSeconds === 50) {
      throw new Error("estimatedDurationSeconds must no longer be the fabricated 50s default.");
    }
    if (generated.estimatedDurationSeconds < 24 || generated.estimatedDurationSeconds > 28) {
      throw new Error("estimatedDurationSeconds for 59 words should land close to 26s (got " +
        generated.estimatedDurationSeconds + ").");
    }
  });

  // --- VideoProcessingProvider: pre-submission guard ---

  test("13. submitRender with invalid narration length never calls request_()/UrlFetchApp", function () {
    const originalFetch = UrlFetchApp.fetch;
    let fetchCalls = 0;
    UrlFetchApp.fetch = function () { fetchCalls++; throw new Error("UrlFetchApp.fetch should never be reached."); };
    try {
      let rejected = false;
      try {
        CloudRunFFmpegProvider.submitRender({
          id: "SCR-TEST", title: "Too short",
          scenes: [{ narration: "Only a few words here.", visualDirection: "A clear scene." }]
        }, null);
      } catch (error) {
        rejected = error.name === "CloudRunFFmpegProviderError";
      }
      if (!rejected) throw new Error("submitRender must reject an undersized script before ever calling the dispatcher.");
      if (fetchCalls !== 0) throw new Error("UrlFetchApp.fetch must never be called for an invalid-length script.");
    } finally {
      UrlFetchApp.fetch = originalFetch;
    }
  });

  // --- Creatomate path unaffected ---

  test("14. Creatomate path is untouched by this fix", function () {
    if (typeof CreatomateProviderAdapter.submitRender !== "function" ||
        typeof CreatomateProviderAdapter.getRender !== "function") {
      throw new Error("CreatomateProviderAdapter's interface must be unchanged.");
    }
    if (typeof ScenePlanService.create !== "function") {
      throw new Error("ScenePlanService must be unchanged (Creatomate-only path).");
    }
  });

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Script duration validation tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
