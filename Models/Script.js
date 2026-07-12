/****************************************************
 * Project Savannah v1.2
 * Models/Script.js
 *
 * Purpose:
 * Define the canonical Script domain model used
 * throughout Project Savannah.
 *
 * Responsibilities:
 * - Create consistently structured script records.
 * - Create scripts from ideas and formatted results.
 * - Validate the model's required domain fields.
 * - Normalise metadata, timestamps and status values.
 * - Produce safe plain objects for repositories.
 * - Prevent accidental mutation of source objects.
 *
 * Must not:
 * - Call AI providers.
 * - Access Google Sheets.
 * - Validate creative quality.
 * - Format script presentation text.
 * - Perform repository operations.
 ****************************************************/

const ScriptModel = (() => {
  const MODEL_VERSION = "script-model-v1.0";

  const STATUS = Object.freeze({
    DRAFT: "DRAFT",
    GENERATED: "GENERATED",
    VALIDATED: "VALIDATED",
    FORMATTED: "FORMATTED",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    ARCHIVED: "ARCHIVED"
  });

  const ALLOWED_STATUSES = Object.freeze(
    Object.keys(STATUS).map(function (key) {
      return STATUS[key];
    })
  );

  /**
   * Creates a canonical Script model.
   *
   * @param {Object=} data Script source data.
   * @return {Object} Canonical script model.
   */
  function create(data) {
    const source = clone_(data || {});
    const now = new Date().toISOString();

    const script = {
      id: normaliseOptionalString_(source.id) || createId_(),
      ideaId: normaliseOptionalString_(source.ideaId),

      title: normaliseOptionalString_(source.title),
      hook: normaliseOptionalString_(source.hook),
      voiceoverScript: normaliseOptionalString_(
        source.voiceoverScript
      ),

      scenes: normaliseScenes_(source.scenes),

      callToAction: normaliseOptionalString_(
        source.callToAction
      ),

      estimatedDurationSeconds: normaliseOptionalNumber_(
        source.estimatedDurationSeconds
      ),

      generationNotes: normaliseOptionalString_(
        source.generationNotes
      ),

      status: normaliseStatus_(
        source.status || STATUS.DRAFT
      ),

      validation: normaliseObject_(source.validation),
      formatting: normaliseObject_(source.formatting),
      metadata: normaliseObject_(source.metadata),

      displayText: normaliseOptionalString_(
        source.displayText
      ),

      promptVersion: normaliseOptionalString_(
        source.promptVersion
      ),

      aiModel: normaliseOptionalString_(
        source.aiModel || source.model
      ),

      createdAt:
        normaliseDateString_(source.createdAt) || now,

      updatedAt:
        normaliseDateString_(source.updatedAt) || now,

      version: normalisePositiveInteger_(
        source.version,
        1
      ),

      modelVersion: MODEL_VERSION
    };

    validate(script);

    return script;
  }

  /**
   * Creates a Script model from an idea.
   *
   * Supported idea identifiers include:
   * - id
   * - ideaId
   * - Idea ID
   *
   * Supported idea titles include:
   * - title
   * - idea
   * - topic
   * - Title
   *
   * @param {Object} idea Source idea.
   * @param {Object=} overrides Optional script overrides.
   * @return {Object} New draft Script model.
   */
  function fromIdea(idea, overrides) {
    if (!idea || typeof idea !== "object" || Array.isArray(idea)) {
      throw createModelError_(
        "A valid idea object is required."
      );
    }

    const ideaId = firstNonEmptyString_([
      idea.id,
      idea.ideaId,
      idea["Idea ID"],
      idea.ID
    ]);

    const title = firstNonEmptyString_([
      idea.title,
      idea.idea,
      idea.topic,
      idea["Video Idea"],
      idea.Title
    ]);

    const baseData = {
      ideaId: ideaId,
      title: title,
      status: STATUS.DRAFT,
      metadata: {
        sourceType: "IDEA",
        sourceIdea: clone_(idea)
      }
    };

    return create(
      mergeObjects_(baseData, overrides || {})
    );
  }

  /**
   * Creates a Script model from a formatter result.
   *
   * Expected formatter result:
   * {
   *   valid: true,
   *   formatVersion: string,
   *   script: Object,
   *   metadata: Object,
   *   displayText: string
   * }
   *
   * @param {Object} formatterResult Formatter output.
   * @param {Object=} context Additional model context.
   * @return {Object} Formatted Script model.
   */
  function fromFormattedResult(formatterResult, context) {
    if (
      !formatterResult ||
      typeof formatterResult !== "object" ||
      Array.isArray(formatterResult)
    ) {
      throw createModelError_(
        "A valid formatter result is required."
      );
    }

    if (
      !formatterResult.script ||
      typeof formatterResult.script !== "object" ||
      Array.isArray(formatterResult.script)
    ) {
      throw createModelError_(
        "Formatter result must contain a script object."
      );
    }

    const additionalContext = clone_(context || {});
    const formatterScript = clone_(
      formatterResult.script
    );

    const modelData = mergeObjects_(
      formatterScript,
      additionalContext
    );

    modelData.status =
      additionalContext.status || STATUS.FORMATTED;

    modelData.formatting = mergeObjects_(
      {
        valid: formatterResult.valid === true,
        formatVersion:
          formatterResult.formatVersion || "",
        metadata: clone_(
          formatterResult.metadata || {}
        )
      },
      additionalContext.formatting || {}
    );

    modelData.metadata = mergeObjects_(
      formatterResult.metadata || {},
      additionalContext.metadata || {}
    );

    modelData.displayText =
      formatterResult.displayText ||
      additionalContext.displayText ||
      "";

    return create(modelData);
  }

  /**
   * Creates a Script model from a validator result.
   *
   * @param {Object} validatorResult Validator output.
   * @param {Object=} context Additional model context.
   * @return {Object} Validated Script model.
   */
  function fromValidatedResult(validatorResult, context) {
    if (
      !validatorResult ||
      typeof validatorResult !== "object" ||
      Array.isArray(validatorResult)
    ) {
      throw createModelError_(
        "A valid validator result is required."
      );
    }

    if (
      !validatorResult.script ||
      typeof validatorResult.script !== "object" ||
      Array.isArray(validatorResult.script)
    ) {
      throw createModelError_(
        "Validator result must contain a script object."
      );
    }

    const additionalContext = clone_(context || {});

    const modelData = mergeObjects_(
      validatorResult.script,
      additionalContext
    );

    modelData.status =
      additionalContext.status || STATUS.VALIDATED;

    modelData.validation = mergeObjects_(
      {
        valid: validatorResult.valid === true,
        metadata: clone_(
          validatorResult.metadata || {}
        )
      },
      additionalContext.validation || {}
    );

    modelData.metadata = mergeObjects_(
      validatorResult.metadata || {},
      additionalContext.metadata || {}
    );

    return create(modelData);
  }

  /**
   * Validates the domain-level Script model structure.
   *
   * Draft records may contain incomplete creative content.
   * Generated and later statuses require complete content.
   *
   * @param {Object} script Script candidate.
   * @return {Object} Validation result.
   */
  function validate(script) {
    const errors = [];

    if (
      !script ||
      typeof script !== "object" ||
      Array.isArray(script)
    ) {
      throw createModelError_(
        "Script must be a valid object."
      );
    }

    validateRequiredString_(
      script.id,
      "Script ID",
      errors
    );

    validateStatus_(script.status, errors);
    validateScenesType_(script.scenes, errors);
    validateTimestamp_(
      script.createdAt,
      "Created timestamp",
      errors
    );
    validateTimestamp_(
      script.updatedAt,
      "Updated timestamp",
      errors
    );

    if (
      !Number.isInteger(script.version) ||
      script.version < 1
    ) {
      errors.push(
        "Version must be a positive integer."
      );
    }

    if (requiresCompleteContent_(script.status)) {
      validateRequiredString_(
        script.title,
        "Title",
        errors
      );

      validateRequiredString_(
        script.hook,
        "Hook",
        errors
      );

      validateRequiredString_(
        script.voiceoverScript,
        "Voiceover script",
        errors
      );

      validateRequiredString_(
        script.callToAction,
        "Call to action",
        errors
      );

      if (script.scenes.length === 0) {
        errors.push(
          "At least one scene is required."
        );
      }

      if (
        typeof script.estimatedDurationSeconds !==
          "number" ||
        !isFinite(script.estimatedDurationSeconds) ||
        script.estimatedDurationSeconds <= 0
      ) {
        errors.push(
          "Estimated duration must be a positive number."
        );
      }
    }

    script.scenes.forEach(function (scene, index) {
      validateScene_(
        scene,
        index + 1,
        errors,
        requiresCompleteContent_(script.status)
      );
    });

    if (errors.length > 0) {
      throw createModelValidationError_(errors);
    }

    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Returns a safe deep clone of a Script model.
   *
   * @param {Object} script Script model.
   * @return {Object} Cloned Script model.
   */
  function clone(script) {
    return create(clone_(script));
  }

  /**
   * Returns a plain serialisable object.
   *
   * @param {Object} script Script model.
   * @return {Object} Plain Script object.
   */
  function toObject(script) {
    validate(script);
    return clone_(script);
  }

  /**
   * Returns a copy with selected fields updated.
   *
   * The script ID and creation timestamp are preserved.
   * The update timestamp and version are advanced.
   *
   * @param {Object} script Existing Script model.
   * @param {Object} changes Fields to update.
   * @return {Object} Updated Script model.
   */
  function update(script, changes) {
    validate(script);

    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes)
    ) {
      throw createModelError_(
        "Script changes must be a valid object."
      );
    }

    const merged = mergeObjects_(
      toObject(script),
      changes
    );

    merged.id = script.id;
    merged.createdAt = script.createdAt;
    merged.updatedAt = new Date().toISOString();
    merged.version = script.version + 1;
    merged.modelVersion = MODEL_VERSION;

    return create(merged);
  }

  /**
   * Returns a copy with a new workflow status.
   *
   * @param {Object} script Existing Script model.
   * @param {string} status New workflow status.
   * @return {Object} Updated Script model.
   */
  function withStatus(script, status) {
    return update(script, {
      status: normaliseStatus_(status)
    });
  }

  /**
   * Determines whether creative content is required.
   *
   * @param {string} status Script status.
   * @return {boolean} True when complete content is required.
   */
  function requiresCompleteContent_(status) {
    return status !== STATUS.DRAFT;
  }

  /**
   * Normalises scene records.
   *
   * @param {*} scenes Source scenes.
   * @return {Object[]} Normalised scenes.
   */
  function normaliseScenes_(scenes) {
    if (scenes === undefined || scenes === null) {
      return [];
    }

    if (!Array.isArray(scenes)) {
      throw createModelError_(
        "Scenes must be an array."
      );
    }

    return scenes.map(function (scene, index) {
      if (
        !scene ||
        typeof scene !== "object" ||
        Array.isArray(scene)
      ) {
        throw createModelError_(
          "Scene " +
            (index + 1) +
            " must be a valid object."
        );
      }

      return {
        sceneNumber: normalisePositiveInteger_(
          scene.sceneNumber,
          index + 1
        ),

        narration: normaliseOptionalString_(
          scene.narration
        ),

        onScreenText: normaliseOptionalString_(
          scene.onScreenText
        ),

        visualDirection: normaliseOptionalString_(
          scene.visualDirection
        ),

        estimatedSeconds: normaliseOptionalNumber_(
          scene.estimatedSeconds
        )
      };
    });
  }

  /**
   * Validates an individual scene.
   *
   * @param {Object} scene Scene candidate.
   * @param {number} expectedNumber Expected scene number.
   * @param {string[]} errors Error collection.
   * @param {boolean} requireContent Content requirement.
   */
  function validateScene_(
    scene,
    expectedNumber,
    errors,
    requireContent
  ) {
    if (
      !scene ||
      typeof scene !== "object" ||
      Array.isArray(scene)
    ) {
      errors.push(
        "Scene " +
          expectedNumber +
          " must be a valid object."
      );
      return;
    }

    if (scene.sceneNumber !== expectedNumber) {
      errors.push(
        "Scene " +
          expectedNumber +
          " has an invalid scene number."
      );
    }

    if (!requireContent) {
      return;
    }

    validateRequiredString_(
      scene.narration,
      "Narration for scene " + expectedNumber,
      errors
    );

    validateRequiredString_(
      scene.onScreenText,
      "On-screen text for scene " +
        expectedNumber,
      errors
    );

    validateRequiredString_(
      scene.visualDirection,
      "Visual direction for scene " +
        expectedNumber,
      errors
    );

    if (
      typeof scene.estimatedSeconds !== "number" ||
      !isFinite(scene.estimatedSeconds) ||
      scene.estimatedSeconds <= 0
    ) {
      errors.push(
        "Estimated duration for scene " +
          expectedNumber +
          " must be a positive number."
      );
    }
  }

  /**
   * Validates scene collection type.
   *
   * @param {*} scenes Scene collection.
   * @param {string[]} errors Error collection.
   */
  function validateScenesType_(scenes, errors) {
    if (!Array.isArray(scenes)) {
      errors.push("Scenes must be an array.");
    }
  }

  /**
   * Validates a required string.
   *
   * @param {*} value Candidate value.
   * @param {string} fieldName Human-readable field.
   * @param {string[]} errors Error collection.
   */
  function validateRequiredString_(
    value,
    fieldName,
    errors
  ) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      errors.push(fieldName + " is required.");
    }
  }

  /**
   * Validates a workflow status.
   *
   * @param {*} status Candidate status.
   * @param {string[]} errors Error collection.
   */
  function validateStatus_(status, errors) {
    if (ALLOWED_STATUSES.indexOf(status) === -1) {
      errors.push(
        "Status must be one of: " +
          ALLOWED_STATUSES.join(", ") +
          "."
      );
    }
  }

  /**
   * Validates an ISO-compatible timestamp.
   *
   * @param {*} value Timestamp value.
   * @param {string} fieldName Field description.
   * @param {string[]} errors Error collection.
   */
  function validateTimestamp_(
    value,
    fieldName,
    errors
  ) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      isNaN(new Date(value).getTime())
    ) {
      errors.push(
        fieldName + " must be a valid date."
      );
    }
  }

  /**
   * Normalises a workflow status.
   *
   * @param {*} status Source status.
   * @return {string} Normalised status.
   */
  function normaliseStatus_(status) {
    const normalised = String(status || "")
      .trim()
      .toUpperCase();

    if (
      ALLOWED_STATUSES.indexOf(normalised) === -1
    ) {
      throw createModelError_(
        "Unsupported script status: " +
          normalised +
          "."
      );
    }

    return normalised;
  }

  /**
   * Normalises an optional string.
   *
   * @param {*} value Source value.
   * @return {string} Normalised string.
   */
  function normaliseOptionalString_(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  /**
   * Normalises an optional number.
   *
   * Empty values become null.
   *
   * @param {*} value Source value.
   * @return {?number} Normalised number.
   */
  function normaliseOptionalNumber_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return null;
    }

    const numericValue = Number(value);

    if (!isFinite(numericValue)) {
      throw createModelError_(
        "Numeric model values must contain valid numbers."
      );
    }

    return numericValue;
  }

  /**
   * Normalises a positive integer.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Fallback value.
   * @return {number} Positive integer.
   */
  function normalisePositiveInteger_(
    value,
    fallback
  ) {
    const numericValue = Number(value);

    if (
      !Number.isInteger(numericValue) ||
      numericValue < 1
    ) {
      return fallback;
    }

    return numericValue;
  }

  /**
   * Normalises a date string.
   *
   * @param {*} value Candidate date.
   * @return {string} ISO timestamp or empty string.
   */
  function normaliseDateString_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "";
    }

    const parsedDate = new Date(value);

    if (isNaN(parsedDate.getTime())) {
      throw createModelError_(
        "Model timestamps must contain valid dates."
      );
    }

    return parsedDate.toISOString();
  }

  /**
   * Normalises a plain metadata object.
   *
   * @param {*} value Source object.
   * @return {Object} Cloned object.
   */
  function normaliseObject_(value) {
    if (value === undefined || value === null) {
      return {};
    }

    if (
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw createModelError_(
        "Model metadata values must be objects."
      );
    }

    return clone_(value);
  }

  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First resolved string.
   */
  function firstNonEmptyString_(values) {
    for (let index = 0; index < values.length; index++) {
      const value = normaliseOptionalString_(
        values[index]
      );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Shallow-merges plain objects.
   *
   * @param {Object} base Base values.
   * @param {Object} overrides Override values.
   * @return {Object} Merged clone.
   */
  function mergeObjects_(base, overrides) {
    const result = clone_(base || {});
    const suppliedOverrides = overrides || {};

    Object.keys(suppliedOverrides).forEach(
      function (key) {
        result[key] = clone_(
          suppliedOverrides[key]
        );
      }
    );

    return result;
  }

  /**
   * Creates a unique script identifier.
   *
   * @return {string} Script ID.
   */
  function createId_() {
    return "SCR-" + Utilities.getUuid();
  }

  /**
   * Creates a safe JSON-compatible deep clone.
   *
   * @param {*} value Source value.
   * @return {*} Cloned value.
   */
  function clone_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Creates a general model error.
   *
   * @param {string} message Error detail.
   * @return {Error} Model error.
   */
  function createModelError_(message) {
    const error = new Error(
      "Script model error: " + message
    );

    error.name = "ScriptModelError";

    return error;
  }

  /**
   * Creates a model validation error.
   *
   * @param {string[]} errors Validation failures.
   * @return {Error} Validation error.
   */
  function createModelValidationError_(errors) {
    const error = new Error(
      "Script model failed validation:\n- " +
        errors.join("\n- ")
    );

    error.name = "ScriptModelValidationError";
    error.validationErrors = errors.slice();

    return error;
  }

  return {
    create: create,
    fromIdea: fromIdea,
    fromFormattedResult: fromFormattedResult,
    fromValidatedResult: fromValidatedResult,
    validate: validate,
    clone: clone,
    toObject: toObject,
    update: update,
    withStatus: withStatus,

    getStatuses: function () {
      return clone_(STATUS);
    },

    getModelVersion: function () {
      return MODEL_VERSION;
    }
  };
})();

/**
 * Tests creation of an empty draft Script model.
 *
 * @return {Object} Created draft.
 */
function testScriptModelCreatesDraft() {
  const script = ScriptModel.create({
    ideaId: "IDEA-TEST-001",
    title: "Five Mistakes Tourists Make in Rome"
  });

  if (!script.id || script.status !== "DRAFT") {
    throw new Error(
      "Script Model did not create a valid draft."
    );
  }

  if (script.version !== 1) {
    throw new Error(
      "New Script Model must begin at version 1."
    );
  }

  if (
    script.modelVersion !==
    ScriptModel.getModelVersion()
  ) {
    throw new Error(
      "Script Model version was not assigned."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model draft test completed successfully."
  );

  return script;
}

/**
 * Tests creation from an idea record.
 *
 * @return {Object} Created Script model.
 */
function testScriptModelCreatesFromIdea() {
  const idea = {
    id: "IDEA-TEST-002",
    title: "Five Rome Mistakes Tourists Always Make",
    category: "Travel",
    status: "NEW"
  };

  const script = ScriptModel.fromIdea(idea);

  if (script.ideaId !== idea.id) {
    throw new Error(
      "Script Model did not preserve the idea ID."
    );
  }

  if (script.title !== idea.title) {
    throw new Error(
      "Script Model did not preserve the idea title."
    );
  }

  if (
    !script.metadata.sourceIdea ||
    script.metadata.sourceIdea.category !==
      "Travel"
  ) {
    throw new Error(
      "Script Model did not preserve source idea metadata."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model from-idea test completed successfully."
  );

  return script;
}

/**
 * Tests creation from a formatter result.
 *
 * @return {Object} Created Script model.
 */
function testScriptModelCreatesFromFormatter() {
  const sourceScript =
    createScriptModelTestFixture_();

  const formattedResult = {
    valid: true,
    formatVersion: "scripts-format-v1.0",
    script: sourceScript,
    metadata: {
      wordCount: 120,
      sceneCount: 3,
      estimatedDurationSeconds: 45
    },
    displayText:
      "TITLE\n" +
      sourceScript.title +
      "\n\nHOOK\n" +
      sourceScript.hook
  };

  const script = ScriptModel.fromFormattedResult(
    formattedResult,
    {
      ideaId: "IDEA-TEST-003",
      promptVersion: "script-prompt-v1.0",
      aiModel: "test-model"
    }
  );

  if (script.status !== "FORMATTED") {
    throw new Error(
      "Formatted Script Model has an incorrect status."
    );
  }

  if (
    script.formatting.formatVersion !==
    "scripts-format-v1.0"
  ) {
    throw new Error(
      "Formatter version was not preserved."
    );
  }

  if (!script.displayText) {
    throw new Error(
      "Formatted display text was not preserved."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model formatter test completed successfully."
  );

  return script;
}

/**
 * Tests Script model updates and version increments.
 *
 * @return {Object} Updated Script model.
 */
function testScriptModelUpdatesVersion() {
  const original = ScriptModel.create({
    ideaId: "IDEA-TEST-004",
    title: "Draft Travel Script"
  });

  const updated = ScriptModel.update(original, {
    title: "Updated Travel Script"
  });

  if (updated.id !== original.id) {
    throw new Error(
      "Script update changed the script ID."
    );
  }

  if (updated.createdAt !== original.createdAt) {
    throw new Error(
      "Script update changed the creation timestamp."
    );
  }

  if (updated.version !== original.version + 1) {
    throw new Error(
      "Script update did not increment the version."
    );
  }

  if (updated.title !== "Updated Travel Script") {
    throw new Error(
      "Script update did not apply changes."
    );
  }

  Logger.log(JSON.stringify(updated, null, 2));
  Logger.log(
    "Script Model update test completed successfully."
  );

  return updated;
}

/**
 * Tests rejection of incomplete generated content.
 *
 * @return {boolean} True when invalid content is rejected.
 */
function testScriptModelRejectsIncompleteGeneratedScript() {
  try {
    ScriptModel.create({
      title: "Incomplete Generated Script",
      status: "GENERATED"
    });
  } catch (error) {
    if (
      error.name !==
      "ScriptModelValidationError"
    ) {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "Incomplete generated Script Model test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Script Model accepted incomplete generated content."
  );
}

/**
 * Tests that cloning does not retain shared references.
 *
 * @return {boolean} True when clone is independent.
 */
function testScriptModelCloneIsIndependent() {
  const original = ScriptModel.create({
    title: "Independent Draft"
  });

  const cloned = ScriptModel.clone(original);
  cloned.metadata.changed = true;

  if (original.metadata.changed === true) {
    throw new Error(
      "Script Model clone retained a shared reference."
    );
  }

  Logger.log(
    "Script Model clone test completed successfully."
  );

  return true;
}

/**
 * Runs all Script Model tests.
 *
 * @return {Object} Test summary.
 */
function testScriptModelAll() {
  testScriptModelCreatesDraft();
  testScriptModelCreatesFromIdea();
  testScriptModelCreatesFromFormatter();
  testScriptModelUpdatesVersion();
  testScriptModelRejectsIncompleteGeneratedScript();
  testScriptModelCloneIsIndependent();

  const result = {
    passed: true,
    testsRun: 6,
    modelVersion: ScriptModel.getModelVersion()
  };

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(
    "All Script Model tests completed successfully."
  );

  return result;
}

/**
 * Creates a complete Script Model test fixture.
 *
 * @return {Object} Complete script fixture.
 */
function createScriptModelTestFixture_() {
  return {
    title: "Five Rome Mistakes Tourists Always Make",

    hook:
      "Visiting Rome? Avoid these five mistakes that ruin thousands of trips.",

    voiceoverScript:
      "Visiting Rome? Avoid these five mistakes that ruin thousands of trips. " +
      "Avoid restaurants beside major landmarks because prices are often higher. " +
      "Walk several streets away and choose somewhere busy with local customers. " +
      "Explore central Rome on foot rather than relying entirely on taxis. " +
      "Remember that churches may require covered shoulders and knees. " +
      "Do not attempt every landmark in a single rushed day. " +
      "Slow travel gives you more time for local cafés and quieter streets. " +
      "Keep valuables secure around crowded stations and attractions. " +
      "Plan carefully and your first Roman holiday will be much more enjoyable. " +
      "Follow for more practical travel advice before your next adventure.",

    scenes: [
      {
        sceneNumber: 1,
        narration:
          "Visiting Rome? Avoid these common tourist mistakes.",
        onScreenText: "Going to Rome?",
        visualDirection:
          "Fast aerial view of central Rome.",
        estimatedSeconds: 8
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid tourist restaurants and explore central Rome on foot.",
        onScreenText:
          "Skip tourist traps · Walk more",
        visualDirection:
          "Restaurant menu followed by a walking scene.",
        estimatedSeconds: 18
      },
      {
        sceneNumber: 3,
        narration:
          "Dress respectfully, slow down and protect your valuables.",
        onScreenText:
          "Dress respectfully · Stay aware",
        visualDirection:
          "Church entrance followed by a crowded station.",
        estimatedSeconds: 19
      }
    ],

    callToAction:
      "Follow for more practical travel advice before your next adventure.",

    estimatedDurationSeconds: 45,
    generationNotes: ""
  };
}