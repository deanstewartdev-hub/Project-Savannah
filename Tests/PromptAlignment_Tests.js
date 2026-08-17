/****************************************************
 * Project Savannah - prompt/repair alignment tests (2026-08-16 fix).
 *
 * Covers the alignment fix that followed the 2026-08-14/15 narration-source fix
 * (e9e417b): the initial generation prompt and the correction/repair prompt must
 * both explicitly treat scenes[].narration as the canonical, measured, rendered
 * narration, and must not leave the model free to "fix" a validation failure by
 * only touching voiceoverScript. Pure string-building logic only - no AI/provider
 * calls, no Sheet writes.
 ****************************************************/
function runPromptAlignmentTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name: name, passed: true });
    } catch (error) {
      results.push({ name: name, passed: false, error: String(error && error.message || error) });
    }
  }

  function assertIncludes(haystack, needle, message) {
    if (haystack.indexOf(needle) === -1) {
      throw new Error(message + " (looked for: " + JSON.stringify(needle) + ")");
    }
  }

  function fixtureIdea() {
    return {
      ideaId: "IDEA-PROMPT-ALIGNMENT-TEST",
      niche: "Travel facts",
      videoIdea: "Five mistakes tourists make in Rome",
      hook: "Most tourists make at least one of these mistakes in Rome.",
      targetAudience: "People planning their first trip to Rome"
    };
  }

  // --- Initial generation prompt (Script_PromptLibrary.js) ---

  test("A. Initial prompt explicitly says scenes[].narration is rendered/canonical", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "Scene narration is the exact spoken and rendered narration",
      "Initial prompt must explicitly name scene narration as the rendered narration."
    );
  });

  test("B. Initial prompt requires the requested TOTAL word count across scene narration", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea(), {
      minimumWordCount: 99,
      maximumWordCount: 125
    });
    assertIncludes(
      prompt,
      "combined words across every scene's narration field, added together, must total between 99 and 125 words",
      "Initial prompt must require the combined per-scene narration to total the requested range."
    );
  });

  test("C. Initial prompt requires voiceoverScript to equal the joined scene narration", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "voiceoverScript must exactly reproduce every scene's narration joined in order, word for word",
      "Initial prompt must require voiceoverScript to be the exact joined scene narration."
    );
    assertIncludes(
      prompt,
      "Never make voiceoverScript longer than the combined scene narration",
      "Initial prompt must forbid a voiceoverScript longer than the combined scene narration."
    );
  });

  // --- Correction/repair prompt (Script_Engine.js buildCorrectionPrompt_) ---

  function rejectedScriptFixture() {
    // Shape mirrors the real Render B forensic case: a much longer independent
    // voiceoverScript alongside a too-short combined scenes[].narration.
    return {
      title: "Wild Travel Laws You Won't Believe",
      hook: "Some travel laws sound completely made up.",
      voiceoverScript:
        "Some travel laws sound completely made up but are very real and can surprise even " +
        "experienced travellers who think they already know every strange rule out there today.",
      scenes: [6, 15, 11, 10, 7, 10].map(function (n, index) {
        return {
          sceneNumber: index + 1,
          narration: Array.from({ length: n }, function (_, i) { return "w" + i; }).join(" "),
          onScreenText: "Fact " + (index + 1),
          visualDirection: "Concrete visual detail for scene " + (index + 1),
          estimatedSeconds: Math.round((n / 2.3) * 100) / 100
        };
      }),
      callToAction: "Follow for more travel facts.",
      estimatedDurationSeconds: 25.65,
      generationNotes: ""
    };
  }

  function shortNarrationValidationError() {
    const error = new Error(
      "Generated script failed validation:\n- Voiceover contains 59 words; minimum is 99."
    );
    error.name = "ScriptValidationError";
    error.validationErrors = ["Voiceover contains 59 words; minimum is 99."];
    return error;
  }

  function buildTestCorrectionPrompt() {
    return ScriptEngine.__test_buildCorrectionPrompt(
      "ORIGINAL PROMPT TEXT",
      rejectedScriptFixture(),
      shortNarrationValidationError(),
      fixtureIdea(),
      {
        minimumWordCount: 99,
        maximumWordCount: 125,
        minimumDurationSeconds: 30,
        maximumDurationSeconds: 60
      },
      2
    );
  }

  test("D. A 59-word validation failure produces a correction prompt that explicitly instructs repairing scenes[].narration", function () {
    const prompt = buildTestCorrectionPrompt();
    assertIncludes(
      prompt,
      "scenes[].narration is the canonical field being measured and rendered, not voiceoverScript",
      "Correction prompt must explicitly name scenes[].narration as canonical."
    );
    assertIncludes(
      prompt,
      "Expand or reduce the scenes[].narration text itself into that range; do not just edit voiceoverScript",
      "Correction prompt must instruct the model to edit scene narration, not just voiceoverScript."
    );
  });

  test("E. Correction prompt contains the actual 59-word failure evidence", function () {
    const prompt = buildTestCorrectionPrompt();
    assertIncludes(
      prompt,
      "Voiceover contains 59 words; minimum is 99.",
      "Correction prompt must surface the real validation-error text, including the measured count."
    );
  });

  test("F. Correction prompt contains the active 99-125 bounds, not hard-coded 90/130", function () {
    const prompt = buildTestCorrectionPrompt();
    assertIncludes(
      prompt,
      "must total between 99 and 125 words",
      "Correction prompt must use the active run's options.minimumWordCount/maximumWordCount (99/125), not the hard render envelope."
    );
  });

  test("G. Correction prompt says changing voiceoverScript alone is insufficient", function () {
    const prompt = buildTestCorrectionPrompt();
    assertIncludes(
      prompt,
      "Changing voiceoverScript alone will NOT fix this validation failure",
      "Correction prompt must explicitly rule out a voiceoverScript-only fix."
    );
  });

  test("H. Correction prompt requires voiceoverScript to be regenerated from the corrected scenes", function () {
    const prompt = buildTestCorrectionPrompt();
    assertIncludes(
      prompt,
      "regenerate voiceoverScript as that exact scene narration joined in order, word for word",
      "Correction prompt must require voiceoverScript to be rebuilt from corrected scene narration."
    );
  });

  // --- Initial prompt: hook ceiling, exact scene-1 placement, per-scene word budget ---
  // (2026-08-17 convergence fix - covers the real live proof-render failure: 81 canonical
  // words against a 99 floor, plus a 20-word hook against an 18-word ceiling that also
  // didn't open scene 1's narration verbatim.)

  test("I. Initial prompt states the hook must never exceed 18 words", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "the hook must never exceed 18 words",
      "Initial prompt must state the hard hook-length ceiling explicitly."
    );
  });

  test("J. Initial prompt targets the hook comfortably below the maximum", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "8 to 15 word hook",
      "Initial prompt must keep the 8-15 word soft target, well under the 18-word ceiling."
    );
  });

  test("K. Initial prompt requires scene 1 narration to begin with the exact hook", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "Write scene 1's narration to begin with that exact hook text, word for word",
      "Initial prompt must require scene 1's narration to open with the verbatim hook, not voiceoverScript."
    );
  });

  test("L. Initial prompt includes the dynamic active total narration range", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea(), {
      minimumWordCount: 90,
      maximumWordCount: 130
    });
    assertIncludes(
      prompt,
      "must total between 90 and 130 words",
      "Initial prompt must reflect whatever active min/max was actually passed in, not a fixed 99/125."
    );
  });

  test("M. Initial prompt provides a dynamic per-scene narration budget", function () {
    // min=80, max=120 -> midpoint=100 -> 25/scene at 4, 20/scene at 5, 17/scene at 6.
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea(), {
      minimumWordCount: 80,
      maximumWordCount: 120
    });
    assertIncludes(
      prompt,
      "Plan roughly 100 total narration words divided across whichever valid scene count (4, 5 or 6) you chose",
      "Initial prompt must state a planning-target total derived from the active min/max midpoint."
    );
    assertIncludes(prompt, "25 words per scene across 4 scenes", "Per-scene budget must be computed for 4 scenes.");
    assertIncludes(prompt, "20 across 5 scenes", "Per-scene budget must be computed for 5 scenes.");
    assertIncludes(prompt, "17 across 6 scenes", "Per-scene budget must be computed for 6 scenes.");
  });

  // --- Correction prompt: the exact real live-proof failure (81/99/125/20/18) ---

  function realWorldRejectedScriptFixture() {
    // Mirrors the actual 2026-08-17 live proof-render failure shape: 6 scenes totaling
    // 81 canonical words (short of a 99 floor) and a 20-word hook (over an 18-word cap).
    const hook = Array.from({ length: 20 }, function (_, i) { return "hookword" + i; }).join(" ") + ".";
    return {
      title: "Traveling the World with just $10!",
      hook: hook,
      voiceoverScript: hook + " A different, independently-written continuation that nothing enforces staying in sync.",
      scenes: [14, 14, 13, 13, 14, 13].map(function (n, index) {
        return {
          sceneNumber: index + 1,
          narration: Array.from({ length: n }, function (_, i) { return "s" + index + "w" + i; }).join(" ") + ".",
          onScreenText: "Fact " + (index + 1),
          visualDirection: "Concrete visual detail for scene " + (index + 1),
          estimatedSeconds: Math.round((n / 2.3) * 100) / 100
        };
      }),
      callToAction: "Follow for more travel facts.",
      estimatedDurationSeconds: 35.22,
      generationNotes: ""
    };
  }

  function realWorldValidationError() {
    const messages = [
      "Voiceover contains 81 words; minimum is 99.",
      "The script hook does not appear near the beginning of the voiceover.",
      "The hook contains 20 words; maximum is 18."
    ];
    const error = new Error("Generated script failed validation:\n- " + messages.join("\n- "));
    error.name = "ScriptValidationError";
    error.validationErrors = messages;
    return error;
  }

  function buildRealWorldCorrectionPrompt() {
    return ScriptEngine.__test_buildCorrectionPrompt(
      "ORIGINAL PROMPT TEXT",
      realWorldRejectedScriptFixture(),
      realWorldValidationError(),
      fixtureIdea(),
      {
        minimumWordCount: 99,
        maximumWordCount: 125,
        minimumDurationSeconds: 30,
        maximumDurationSeconds: 60
      },
      2
    );
  }

  test("N. Correction prompt for the real 81/99/125/20/18 failure explicitly prioritizes all three corrections in order", function () {
    const prompt = buildRealWorldCorrectionPrompt();
    assertIncludes(prompt, "FIX THESE IN PRIORITY ORDER", "Correction prompt must present a clear priority order.");
    assertIncludes(
      prompt,
      "1. Combined scenes[].narration currently totals 81 words; it must total between 99 and 125 words",
      "Priority 1 must state the real measured canonical count against the real active range."
    );
    assertIncludes(
      prompt,
      "2. script.hook is currently 20 words; it must be at most 18 words",
      "Priority 2 must state the real measured hook count against the real hook ceiling."
    );
    assertIncludes(
      prompt,
      "3. Scene 1's narration must begin with that corrected hook text, word for word",
      "Priority 3 must require the corrected hook to open scene 1 verbatim."
    );
  });

  test("O. Correction prompt for the real failure still tells the model to expand scenes[].narration, not voiceoverScript", function () {
    const prompt = buildRealWorldCorrectionPrompt();
    assertIncludes(
      prompt,
      "scenes[].narration is the canonical field being measured and rendered, not voiceoverScript",
      "Correction prompt must name scenes[].narration as canonical even in the real hook+length failure case."
    );
  });

  test("P. Correction prompt requires the corrected hook to appear exactly at the start of scene 1", function () {
    const prompt = buildRealWorldCorrectionPrompt();
    assertIncludes(
      prompt,
      "with no paraphrase and no separate spoken hook",
      "Correction prompt must forbid a paraphrased or separately-written spoken hook."
    );
  });

  test("Q. Correction prompt preserves scene count and structure", function () {
    const prompt = buildRealWorldCorrectionPrompt();
    assertIncludes(
      prompt,
      "Preserve the same number of scenes and the same scene structure while adjusting narration length",
      "Correction prompt must require the same scene count/structure to be preserved during repair."
    );
  });

  // --- Scene-count convergence (2026-08-17 v88->v89 fix) ---
  // Covers the real live v88 proof failure: 95 canonical words (short of a 99 floor) AND
  // 7 scenes (over a 6-scene maximum), with no hook errors at all - proof the prior hook fix
  // worked, and that the model was adding a 7th scene to chase the narration target instead
  // of expanding narration inside a valid (<=6) scene count.

  test("R. Initial prompt states the active minimum and maximum scene count", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(prompt, "4 to 6 sequential scenes", "Initial prompt must state the scene-count range.");
    assertIncludes(
      prompt,
      "the script MUST contain between 4 and 6 scenes, never 7 or more",
      "Initial prompt must make the scene-count ceiling an explicit MUST, not just a soft range."
    );
  });

  test("S. Initial prompt forbids adding an extra scene to meet the narration target", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "never add a 7th scene just to fit more narration in",
      "Initial prompt must explicitly forbid adding a scene to hit the word target."
    );
  });

  test("T. Initial prompt tells the model to expand narration inside existing valid scenes", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "If more narration is needed to reach the target, add words to your existing scenes' narration - never by adding another scene",
      "Initial prompt must redirect a narration shortfall to existing scenes, not a new scene."
    );
  });

  test("U. Initial prompt prefers a central scene count without invalidating 4 or 6", function () {
    const prompt = ScriptPromptLibrary.buildScriptPrompt(fixtureIdea());
    assertIncludes(
      prompt,
      "Prefer 5 scenes as a solid default; 4 or 6 remain valid when the content genuinely benefits",
      "Initial prompt must prefer 5 scenes as a default while keeping 4 and 6 explicitly valid."
    );
  });

  function realWorldSceneOverflowFixture() {
    // Mirrors the actual 2026-08-17 v88 live proof failure: 7 scenes totaling 95 canonical
    // words (short of a 99 floor), valid hook (no hook error occurred in that real failure).
    const hook = "Can you really explore a city on ten dollars a day?";
    const wordCounts = [14, 14, 13, 13, 14, 14, 13]; // sums to 95 across 7 scenes
    return {
      title: "Traveling the World with just $10!",
      hook: hook,
      voiceoverScript: hook + " A different, independently-written continuation that nothing enforces staying in sync.",
      scenes: wordCounts.map(function (n, index) {
        const words = index === 0
          ? hook.split(" ").concat(Array.from({ length: Math.max(0, n - hook.split(" ").length) }, function (_, i) { return "s0w" + i; }))
          : Array.from({ length: n }, function (_, i) { return "s" + index + "w" + i; });
        return {
          sceneNumber: index + 1,
          narration: words.join(" ") + ".",
          onScreenText: "Fact " + (index + 1),
          visualDirection: "Concrete visual detail for scene " + (index + 1),
          estimatedSeconds: Math.round((n / 2.3) * 100) / 100
        };
      }),
      callToAction: "Follow for more travel facts.",
      estimatedDurationSeconds: 41.3,
      generationNotes: ""
    };
  }

  function realWorldSceneOverflowValidationError() {
    const messages = [
      "Voiceover contains 95 words; minimum is 99.",
      "Script contains 7 scenes; maximum is 6."
    ];
    const error = new Error("Generated script failed validation:\n- " + messages.join("\n- "));
    error.name = "ScriptValidationError";
    error.validationErrors = messages;
    return error;
  }

  function buildSceneOverflowCorrectionPrompt() {
    return ScriptEngine.__test_buildCorrectionPrompt(
      "ORIGINAL PROMPT TEXT",
      realWorldSceneOverflowFixture(),
      realWorldSceneOverflowValidationError(),
      fixtureIdea(),
      {
        minimumWordCount: 99,
        maximumWordCount: 125,
        minimumDurationSeconds: 30,
        maximumDurationSeconds: 60
      },
      2
    );
  }

  test("V. Correction prompt for the real 95-word/7-scene failure reflects the actual current scene count", function () {
    const prompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(
      prompt,
      "Reduce the scene count from 7 to at most 6 scenes",
      "Correction prompt must state the real rejected scene count (7) against the real maximum (6)."
    );
  });

  test("W. 7 scenes against a maximum of 6 produces explicit reduction instructions", function () {
    const prompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(prompt, "FIX THESE IN PRIORITY ORDER", "Correction prompt must present a priority-ordered fix list.");
    assertIncludes(
      prompt,
      "1. Reduce the scene count from 7 to at most 6 scenes.",
      "Reducing scene count must be the first priority when the rejected script already exceeds the maximum."
    );
  });

  test("X. Repair tells the model to merge excess scene content rather than discard it", function () {
    const prompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(
      prompt,
      "Merge the excess scene(s)' narration and visual content into the remaining scenes rather than deleting information",
      "Correction prompt must instruct merging excess scene content, not deleting it."
    );
  });

  test("Y. Repair explicitly forbids solving the 95->99 word shortage by adding scenes", function () {
    const prompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(
      prompt,
      "Do NOT add scenes to solve a narration-length shortage; add words to existing scene narration instead",
      "Correction prompt must explicitly rule out adding a scene to fix the narration shortfall."
    );
  });

  test("Z. Repair tells the model to increase narration within the repaired valid scene set", function () {
    const prompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(
      prompt,
      "Bring the combined scenes[].narration into 99 to 125 words (currently 95) by adding narration within your repaired, valid scene set",
      "Correction prompt must tie the narration fix to the repaired (<=6) scene set, using the real 95/99/125 figures."
    );
  });

  test("AA. \"Preserve scene count\" applies only when the current count is already valid", function () {
    const invalidCountPrompt = buildSceneOverflowCorrectionPrompt();
    assertIncludes(
      invalidCountPrompt,
      "The rejected script's scene count (7) is itself invalid - do not preserve it",
      "When the rejected scene count is invalid, the prompt must say so instead of asking to preserve it."
    );
    if (invalidCountPrompt.indexOf("Preserve the same number of scenes and the same scene structure while adjusting narration length") !== -1) {
      throw new Error("The old unconditional 'preserve scene count' instruction must not appear when the rejected count is invalid.");
    }

    const validCountPrompt = buildRealWorldCorrectionPrompt(); // 6 scenes, a valid count
    assertIncludes(
      validCountPrompt,
      "Preserve the same number of scenes and the same scene structure while adjusting narration length",
      "When the rejected scene count is already valid, the prompt must still tell the model to preserve it."
    );
  });

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Prompt alignment tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
