/****************************************************
 * Project Savannah
 * Script_Validator_Scenes.js
 *
 * Purpose:
 * The scene rules of script validation: scene count and numbering, required
 * scene text, on-screen and visual-direction limits, scene durations, montage
 * places, approved clips and labelled stills. Also derives the canonical
 * narration from the scenes and normalises an accepted scene.
 * Each rule appends its messages to the errors list it is given.
 *
 * Split out of Scripts/Script_Validator.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptValidator remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptValidatorScenes = (() => {
  // Helpers owned by sibling modules are looked up when called, so file load order never matters.
  function countWords_(text) { return ScriptValidatorText.countWords(text); }
  function normaliseComparableText_(value) { return ScriptValidatorText.normaliseComparableText(value); }
  function roundNumber_(value, decimalPlaces) { return ScriptValidatorText.roundNumber(value, decimalPlaces); }

  /**
   * Validates the complete scene array.
   *
   * @param {*} scenes Scene collection.
   * @param {Object} rules Validation rules.
   * @param {string[]} errors Validation errors.
   * @return {Object} Scene validation metadata.
   */
  function validateScenes_(
    scenes,
    rules,
    errors
  ) {
    if (!Array.isArray(scenes)) {
      errors.push(
        "Scenes must be an array."
      );

      return {
        totalDurationSeconds: 0
      };
    }

    scenes.forEach(function (scene, index) {
      validateSceneMontage_(scene, index + 1, errors);
      validateSceneControls_(scene, index + 1, errors);
    });

    if (
      scenes.length <
      rules.minimumSceneCount
    ) {
      errors.push(
        "Script contains " +
        scenes.length +
        " scenes; minimum is " +
        rules.minimumSceneCount +
        "."
      );
    }

    if (
      scenes.length >
      rules.maximumSceneCount
    ) {
      errors.push(
        "Script contains " +
        scenes.length +
        " scenes; maximum is " +
        rules.maximumSceneCount +
        "."
      );
    }

    let totalDurationSeconds = 0;
    const visualDirections = [];

    scenes.forEach(function (scene, index) {
      const expectedSceneNumber =
        index + 1;

      if (
        !scene ||
        typeof scene !== "object"
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " must be a valid object."
        );

        return;
      }

      if (
        Number(scene.sceneNumber) !==
        expectedSceneNumber
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " has an invalid scene number."
        );
      }

      validateSceneString_(
        scene,
        "narration",
        "Narration",
        expectedSceneNumber,
        errors
      );

      validateSceneString_(
        scene,
        "onScreenText",
        "On-screen text",
        expectedSceneNumber,
        errors
      );

      if (
        typeof scene.onScreenText === "string" &&
        countWords_(scene.onScreenText) >
          rules.maximumOnScreenTextWordCount
      ) {
        errors.push(
          "On-screen text for scene " +
          expectedSceneNumber +
          " must contain no more than " +
          rules.maximumOnScreenTextWordCount +
          " words."
        );
      }

      validateSceneString_(
        scene,
        "visualDirection",
        "Visual direction",
        expectedSceneNumber,
        errors
      );

      if (
        typeof scene.visualDirection === "string" &&
        countWords_(scene.visualDirection) < rules.minimumVisualDirectionWordCount
      ) {
        errors.push(
          "Visual direction for scene " + expectedSceneNumber +
          " must name enough concrete detail for an original scene."
        );
      }

      if (typeof scene.visualDirection === "string" && scene.visualDirection.trim()) {
        visualDirections.push(normaliseComparableText_(scene.visualDirection));
      }

      const duration =
        Number(scene.estimatedSeconds);

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " must have a positive estimated duration."
        );
      } else {
        totalDurationSeconds += duration;

        if (duration > rules.maximumSceneDurationSeconds) {
          errors.push(
            "Scene " + expectedSceneNumber + " lasts " + duration +
            " seconds; maximum visual hold is " +
            rules.maximumSceneDurationSeconds + " seconds."
          );
        }
      }
    });

    if (visualDirections.length && new Set(visualDirections).size !== visualDirections.length) {
      errors.push(
        "Every scene must use a distinct visual direction to create visible pattern interrupts."
      );
    }

    return {
      totalDurationSeconds:
        roundNumber_(
          totalDurationSeconds,
          2
        )
    };
  }

  /**
   * Checks an optional recap montage: two or three places, each with a location. A montage is refused here rather
   * than later, so a malformed montage never reaches a render.
   *
   * @param {*} scene Scene candidate.
   * @param {number} sceneNumber Scene number for messages.
   * @param {string[]} errors Validation errors.
   */
  function validateSceneMontage_(scene, sceneNumber, errors) {
    if (!scene || typeof scene !== "object" || scene.montage === undefined) return;
    const montage = scene.montage;
    if (!Array.isArray(montage)) {
      errors.push("Scene " + sceneNumber + " montage must be a list of places.");
      return;
    }
    if (montage.length < 2 || montage.length > 3) {
      errors.push("Scene " + sceneNumber + " montage needs 2 to 3 places.");
      return;
    }
    montage.forEach(function (part, index) {
      const label = "Scene " + sceneNumber + " montage place " + (index + 1);
      if (!part || typeof part !== "object" || typeof part.location !== "string" || !part.location.trim()) {
        errors.push(label + " needs a location.");
        return;
      }
      if (part.location.trim().length > 60) {
        errors.push(label + " location is longer than 60 characters.");
      }
      if (part.searchKeywords !== undefined && (typeof part.searchKeywords !== "string" || part.searchKeywords.trim().length > 80)) {
        errors.push(label + " searchKeywords must be text of at most 80 characters.");
      }
      if (!approvedClipsValid_(part.approvedClips)) {
        errors.push(label + " approvedClips must be a list of at most 5 positive whole Pexels clip IDs.");
      }
    });
  }

  function approvedClipsValid_(list) {
    if (list === undefined) return true;
    return Array.isArray(list) && list.length <= 5 && list.every(function (id) { return Number.isInteger(id) && id > 0; });
  }

  /**
   * Checks the scene-level footage controls: reviewed clip IDs and a labelled still. A labelled still uses no footage,
   * so it cannot also name clips or carry a montage.
   *
   * @param {*} scene Scene candidate.
   * @param {number} sceneNumber Scene number for messages.
   * @param {string[]} errors Validation errors.
   */
  function validateSceneControls_(scene, sceneNumber, errors) {
    if (!scene || typeof scene !== "object") return;
    if (!approvedClipsValid_(scene.approvedClips)) {
      errors.push("Scene " + sceneNumber + " approvedClips must be a list of at most 5 positive whole Pexels clip IDs.");
    }
    if (scene.labelledStill !== undefined && typeof scene.labelledStill !== "boolean") {
      errors.push("Scene " + sceneNumber + " labelledStill must be true or false.");
    }
    if (scene.labelledStill === true && Array.isArray(scene.approvedClips) && scene.approvedClips.length > 0) {
      errors.push("Scene " + sceneNumber + " is a labelled still, so it cannot also name approved clips.");
    }
    if (scene.labelledStill === true && scene.montage !== undefined) {
      errors.push("Scene " + sceneNumber + " montage cannot be a labelled still.");
    }
  }

  function validateSceneString_(
    scene,
    propertyName,
    displayName,
    sceneNumber,
    errors
  ) {
    if (
      typeof scene[propertyName] !== "string" ||
      !scene[propertyName].trim()
    ) {
      errors.push(
        displayName +
        " is required for scene " +
        sceneNumber +
        "."
      );
    }
  }

  /**
   * Joins scenes[].narration in order into the single canonical narration - the same
   * text Cloud Run's CloudRunFFmpegProvider.submitRender() sends to ElevenLabs as one
   * concatenated beats[].text string. Deliberately not the AI's separate voiceoverScript
   * field, which nothing enforces staying in sync with the actual scene narration.
   *
   * @param {*} scenes Scene collection.
   * @return {string} Canonical narration text.
   */
  function canonicalNarrationFromScenes_(scenes) {
    if (!Array.isArray(scenes)) return "";

    return scenes
      .map(function (scene) {
        return scene && typeof scene.narration === "string" ? scene.narration.trim() : "";
      })
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Normalises one scene after successful validation.
   *
   * @param {Object} scene Validated scene.
   * @return {Object} Normalised scene.
   */
  function normaliseScene_(scene) {
    const normalised = {
      sceneNumber:
        Number(scene.sceneNumber),

      narration:
        scene.narration.trim(),

      onScreenText:
        scene.onScreenText.trim(),

      visualDirection:
        scene.visualDirection.trim(),

      estimatedSeconds:
        Number(scene.estimatedSeconds)
    };

    // Optional visual-search fields are carried through, only when present.
    if (typeof scene.location === "string" && scene.location.trim()) {
      normalised.location = scene.location.trim();
    }
    if (typeof scene.searchKeywords === "string" && scene.searchKeywords.trim()) {
      normalised.searchKeywords = scene.searchKeywords.trim();
    }
    // Reviewed clip IDs and a labelled still, only when present (the controls are checked by validateSceneControls_).
    if (Array.isArray(scene.approvedClips)) normalised.approvedClips = scene.approvedClips.slice(0, 5);
    if (typeof scene.labelledStill === "boolean") normalised.labelledStill = scene.labelledStill;
    // The optional recap montage: its places, in order, with trimmed text. Only well-formed parts are copied.
    if (Array.isArray(scene.montage)) {
      normalised.montage = scene.montage
        .filter(function (part) { return part && typeof part === "object"; })
        .map(function (part) {
          const place = { location: typeof part.location === "string" ? part.location.trim() : "" };
          if (typeof part.searchKeywords === "string" && part.searchKeywords.trim()) {
            place.searchKeywords = part.searchKeywords.trim();
          }
          if (Array.isArray(part.approvedClips)) place.approvedClips = part.approvedClips.slice(0, 5);
          return place;
        });
    }
    return normalised;
  }

  return {
    validateScenes: validateScenes_,
    canonicalNarrationFromScenes: canonicalNarrationFromScenes_,
    normaliseScene: normaliseScene_
  };
})();
