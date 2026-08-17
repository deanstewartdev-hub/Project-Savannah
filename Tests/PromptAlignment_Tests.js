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
      "Plan roughly 100 total narration words divided across however many scenes you use",
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

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Prompt alignment tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
