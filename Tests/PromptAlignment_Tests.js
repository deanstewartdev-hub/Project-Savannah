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

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length) throw new Error("Prompt alignment tests failed: " + JSON.stringify(failures));
  return { passed: true, total: results.length, results: results };
}
