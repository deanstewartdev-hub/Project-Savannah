/****************************************************
 * Project Savannah v1.2
 * Script_Engine.js
 *
 * Purpose:
 * Coordinate the complete YouTube Shorts script
 * generation workflow.
 *
 * Responsibilities:
 * - Validate script-generation input.
 * - Build the versioned script prompt.
 * - Call the provider-independent AI service.
 * - Validate and format generated content.
 * - Create the canonical ScriptModel.
 * - Persist the completed script.
 * - Record AI usage cost.
 * - Record workflow activity.
 * - Return a frontend-safe workflow result.
 *
 * Must not:
 * - Build provider-specific API payloads.
 * - Access spreadsheet ranges directly.
 * - Contain prompt templates.
 * - Duplicate validation or formatting logic.
 * - Display frontend UI.
 ****************************************************/

const ScriptEngine = (() => {
  const ENGINE_VERSION = "script-engine-v1.0";
  const ACTION = "SCRIPT_GENERATION";

    const DEFAULT_OPTIONS = Object.freeze({
        temperature: null,
        maxTokens: null,
        targetDurationSeconds: 50,
        minimumWordCount: 113,
        maximumWordCount: 125,
        status: "FORMATTED",
        maxValidationAttempts: 3
    });

  /**
   * Generates and saves one complete script from an idea.
   *
   * Supported idea properties:
   * - id / ideaId / "Idea ID"
   * - title / videoIdea / idea / topic / "Video Idea"
   * - hook
   * - targetAudience
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Completed workflow result.
   */
    /**
   * Generates, validates, formats and saves one script.
   *
   * Invalid AI output is automatically returned to the
   * provider for correction, up to the configured maximum
   * number of validation attempts.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Completed workflow result.
   */
  function generateScript(idea, options) {
    const runId = createScriptRunId_();
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);
    const startedAt = new Date();

    safeLogStarted_(
      runId,
      ACTION,
      "Script generation started for idea " +
        normalisedIdea.ideaId +
        "."
    );

    try {
      const promptResult = buildPrompt_(
        normalisedIdea,
        workflowOptions
      );

      const generationResult =
        generateValidatedContent_(
          promptResult.prompt,
          normalisedIdea,
          workflowOptions,
          runId
        );

      const formattingResult =
        ScriptFormatter.format(
          generationResult.validationResult
        );

      const scriptModel = createScriptModel_(
        normalisedIdea,
        promptResult,
        generationResult.aiResponse,
        generationResult.validationResult,
        formattingResult,
        workflowOptions,
        runId
      );

      const saveResult =
        ScriptsRepository.saveScript(
          scriptModel
        );

      const costResult = recordCostSafely_(
        runId,
        generationResult.aiResponse
      );

      const completedAt = new Date();

      safeLogSuccess_(
        runId,
        ACTION,
        "Script " +
          scriptModel.id +
          " generated and saved successfully after " +
          generationResult.validationAttempts +
          " validation attempt(s)."
      );

      return buildWorkflowResult_({
        runId: runId,
        scriptModel: scriptModel,
        saveResult: saveResult,
        aiResponse:
          generationResult.aiResponse,
        promptResult: promptResult,
        validationResult:
          generationResult.validationResult,
        formattingResult: formattingResult,
        costResult: costResult,
        startedAt: startedAt,
        completedAt: completedAt,
        validationAttempts:
          generationResult.validationAttempts
      });
    } catch (error) {
      safeLogFailure_(
        runId,
        ACTION,
        "Script generation failed for idea " +
          normalisedIdea.ideaId +
          ".",
        error
      );

      throw createEngineError_(
        error,
        runId,
        normalisedIdea.ideaId
      );
    }
  }

  /**
   * Creates a script but does not save it.
   *
   * Useful for previews and future regeneration flows.
   * This still performs a real AI request and records
   * neither repository data nor AI cost.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Generated canonical ScriptModel.
   */
  function generatePreview(idea, options) {
    const runId = createScriptRunId_();
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);

    const promptResult = buildPrompt_(
      normalisedIdea,
      workflowOptions
    );

    const aiResponse = requestScript_(
      promptResult.prompt,
      normalisedIdea,
      workflowOptions,
      runId
    );

    const validationResult =
      ScriptValidator.validate(
        aiResponse.data,
        {
          minimumWordCount:
            workflowOptions.minimumWordCount,

          maximumWordCount:
            workflowOptions.maximumWordCount,

          minimumDurationSeconds:
            workflowOptions.minimumDurationSeconds,

          maximumDurationSeconds:
            workflowOptions.maximumDurationSeconds,

          durationToleranceSeconds:
            workflowOptions.durationToleranceSeconds
        }
      );

    const formattingResult =
      ScriptFormatter.format(
        validationResult
      );

    return createScriptModel_(
      normalisedIdea,
      promptResult,
      aiResponse,
      validationResult,
      formattingResult,
      workflowOptions,
      runId
    );
  }  /**
   * Generates and validates a script without saving it.
   *
   * This performs a real AI request but does not write a
   * script record or cost record.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Generated ScriptModel preview.
   */
  function generatePreview(idea, options) {
    const runId = createScriptRunId_();
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);

    const promptResult = buildPrompt_(
      normalisedIdea,
      workflowOptions
    );

    const generationResult =
      generateValidatedContent_(
        promptResult.prompt,
        normalisedIdea,
        workflowOptions,
        runId
      );

    const formattingResult =
      ScriptFormatter.format(
        generationResult.validationResult
      );

    return createScriptModel_(
      normalisedIdea,
      promptResult,
      generationResult.aiResponse,
      generationResult.validationResult,
      formattingResult,
      workflowOptions,
      runId
    );
  }

  /**
   * Generates structured script content and validates it.
   *
   * When AI output fails validation, the rejected output
   * and exact validation errors are sent back to the AI
   * for correction.
   *
   * @param {string} originalPrompt Initial generation prompt.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {string} runId Workflow run ID.
   * @return {Object} Validated generation result.
   */
  function generateValidatedContent_(
    originalPrompt,
    idea,
    options,
    runId
  ) {
    let currentPrompt = originalPrompt;
    let lastValidationError = null;
    const aiResponses = [];

    for (
      let attempt = 1;
      attempt <= options.maxValidationAttempts;
      attempt++
    ) {
      const aiResponse = requestScript_(
        currentPrompt,
        idea,
        options,
        runId
      );

      aiResponses.push(aiResponse);

      try {
        const validationResult =
          validateGeneratedScript_(
            aiResponse.data,
            options
          );

        return {
          aiResponse:
            combineAIResponses_(
              aiResponses
            ),

          validationResult:
            validationResult,

          validationAttempts:
            attempt
        };
      } catch (error) {
        if (
          error.name !==
          "ScriptValidationError"
        ) {
          throw error;
        }

        lastValidationError = error;

        safeLogWarning_(
          runId,
          "SCRIPT_VALIDATION",
          "Generated script failed validation on attempt " +
            attempt +
            " of " +
            options.maxValidationAttempts +
            ".",
          error
        );

        if (
          attempt >=
          options.maxValidationAttempts
        ) {
          break;
        }

        currentPrompt =
          buildCorrectionPrompt_(
            originalPrompt,
            aiResponse.data,
            error,
            idea,
            options,
            attempt + 1
          );
      }
    }

    throw lastValidationError ||
      new Error(
        "Generated script could not be validated."
      );
  }

  /**
   * Runs ScriptValidator using the workflow rules.
   *
   * @param {Object} generatedScript AI-generated script.
   * @param {Object} options Workflow options.
   * @return {Object} Validation result.
   */
  function validateGeneratedScript_(
    generatedScript,
    options
  ) {
    return ScriptValidator.validate(
      generatedScript,
      {
        minimumWordCount:
          options.minimumWordCount,

        maximumWordCount:
          options.maximumWordCount,

        minimumDurationSeconds:
          options.minimumDurationSeconds,

        maximumDurationSeconds:
          options.maximumDurationSeconds,

        durationToleranceSeconds:
          options.durationToleranceSeconds
      }
    );
  }

  /**
   * Builds a focused correction prompt after validation
   * failure.
   *
   * @param {string} originalPrompt Original prompt.
   * @param {Object} rejectedScript Rejected AI output.
   * @param {Error} validationError Validation error.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {number} nextAttempt Next attempt number.
   * @return {string} Correction prompt.
   */
  function buildCorrectionPrompt_(
    originalPrompt,
    rejectedScript,
    validationError,
    idea,
    options,
    nextAttempt
  ) {
    const validationErrors =
      Array.isArray(
        validationError.validationErrors
      )
        ? validationError.validationErrors
        : [validationError.message];

    return [
      "Revise the rejected YouTube Shorts script below.",
      "",
      "This is correction attempt " +
        nextAttempt +
        ".",
      "",
      "MANDATORY CORRECTIONS:",
      validationErrors
        .map(function (message, index) {
          return (
            (index + 1) +
            ". " +
            message
          );
        })
        .join("\n"),
      "",
      "STRICT REQUIREMENTS:",
      "- The voiceover must contain between " +
        options.minimumWordCount +
        " and " +
        options.maximumWordCount +
        " words.",
      "- Aim for " + Math.round((options.minimumWordCount + options.maximumWordCount) / 2) + " voiceover words. Count them before returning JSON.",
      "- Write the final hook first, then copy that exact hook text to the beginning of voiceoverScript.",
      "- The hook field must be the exact opening words of voiceoverScript; do not paraphrase it in either location.",
      "- Rewrite weak source-hook wording into an 8 to 15 word curiosity gap.",
      "- Never begin with 'Did you know', 'Here are', 'Welcome', 'Today', or 'In this video'.",
      "- Keep most spoken sentences below 14 words.",
      "- Add a new reveal, consequence or pattern interrupt every one or two sentences.",
      "- Delay the clearest payoff until the final third, before the call to action.",
      "- Keep the call to action to 12 words or fewer.",
      "- Keep on-screen text between 2 and 7 words.",
      "- Scene narration joined in order must reproduce the complete voiceoverScript in the same order without omissions.",
      "- Keep estimated duration between " +
        options.minimumDurationSeconds +
        " and " +
        options.maximumDurationSeconds +
        " seconds.",
      "- Add every scene duration, then set estimatedDurationSeconds to that exact sum.",
      "- The exact scene-duration sum and estimatedDurationSeconds must both be between 30 and 60 seconds.",
      "- Preserve factual accuracy.",
      "- Do not include Markdown or explanatory text.",
      "- Return only data matching the supplied JSON schema.",
      "",
      "IDEA:",
      idea.title,
      "",
      "REQUIRED HOOK:",
      idea.hook ||
        "Create a powerful opening hook appropriate to the idea.",
      "",
      "REJECTED SCRIPT:",
      JSON.stringify(
        rejectedScript,
        null,
        2
      ),
      "",
      "ORIGINAL GENERATION INSTRUCTIONS:",
      originalPrompt
    ].join("\n");
  }

  /**
   * Combines usage from every AI attempt into one response.
   *
   * This ensures cost tracking includes correction calls,
   * rather than recording only the final attempt.
   *
   * @param {Object[]} responses AI responses.
   * @return {Object} Combined response.
   */
  function combineAIResponses_(responses) {
    if (
      !Array.isArray(responses) ||
      responses.length === 0
    ) {
      throw new Error(
        "No AI responses were available to combine."
      );
    }

    const finalResponse = clone_(
      responses[responses.length - 1]
    );

    const combinedUsage =
      responses.reduce(
        function (total, response) {
          const usage =
            response.usage || {};

          total.inputTokens += Number(
            usage.inputTokens || 0
          );

          total.outputTokens += Number(
            usage.outputTokens || 0
          );

          total.totalTokens += Number(
            usage.totalTokens || 0
          );

          return total;
        },
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        }
      );

    finalResponse.usage = {
      inputTokens:
        combinedUsage.inputTokens,

      outputTokens:
        combinedUsage.outputTokens,

      totalTokens:
        combinedUsage.totalTokens,

      attemptCount:
        responses.length,

      attempts: responses.map(
        function (response, index) {
          return {
            attemptNumber: index + 1,
            inputTokens: Number(
              response.usage &&
              response.usage.inputTokens ||
              0
            ),
            outputTokens: Number(
              response.usage &&
              response.usage.outputTokens ||
              0
            ),
            totalTokens: Number(
              response.usage &&
              response.usage.totalTokens ||
              0
            )
          };
        }
      )
    };

    finalResponse.execution =
      finalResponse.execution || {};

    finalResponse.execution
      .workflowAttemptCount =
      responses.length;

    return finalResponse;
  }

  /**
   * Builds a script-generation request without calling AI.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Prepared request information.
   */
  function prepareRequest(idea, options) {
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);

    const promptResult = buildPrompt_(
      normalisedIdea,
      workflowOptions
    );

    return {
      idea: normalisedIdea,
      prompt: promptResult.prompt,
      promptVersion:
        promptResult.promptVersion,
      options: clone_(workflowOptions),
      schema: Schemas.getScriptSchema(),
      engineVersion: ENGINE_VERSION
    };
  }

  /**
   * Calls the provider-independent AI service.
   *
   * @param {string} prompt Script prompt.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {string} runId Workflow run ID.
   * @return {Object} Canonical AI response.
   */
  function requestScript_(
    prompt,
    idea,
    options,
    runId
  ) {
    const requestOptions = {
      temperature:
        options.temperature,

      maxTokens:
        options.maxTokens,

      responseFormat:
        "json_schema",

      schema:
        Schemas.getScriptSchema(),

      systemMessage:
        "You are Project Savannah's professional " +
        "YouTube Shorts script writer. Produce a " +
        "complete, factual, engaging script and return " +
        "only data matching the supplied JSON schema.",

      metadata: {
        runId: runId,
        action: ACTION,
        ideaId: idea.ideaId,
        engineVersion: ENGINE_VERSION
      }
    };

    let response;

    if (
      typeof AIService !== "undefined" &&
      AIService &&
      typeof AIService
        .generateStructuredContent ===
        "function"
    ) {
      response =
        AIService.generateStructuredContent(
          prompt,
          Schemas.getScriptSchema(),
          requestOptions
        );
    } else if (
      typeof callAIService === "function"
    ) {
      response = callAIService(
        prompt,
        requestOptions
      );
    } else {
      throw new Error(
        "No compatible AI service is available."
      );
    }

    validateAIResponse_(response);

    return response;
  }

  /**
   * Builds the script prompt using ScriptPromptLibrary.
   *
   * The adapter supports the public method names used
   * during Savannah's prompt-library evolution.
   *
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @return {Object} Prompt and version.
   */
    /**
   * Builds the script prompt using ScriptPromptLibrary.
   *
   * Supports the public method names used throughout
   * Project Savannah's prompt-library development.
   *
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @return {Object} Prompt and version.
   */
  function buildPrompt_(idea, options) {
    if (
      typeof ScriptPromptLibrary === "undefined" ||
      !ScriptPromptLibrary
    ) {
      throw new Error(
        "ScriptPromptLibrary is not available."
      );
    }

    const promptInput = {
      ideaId: idea.ideaId,
      title: idea.title,
      videoIdea: idea.title,
      hook: idea.hook,
      targetAudience: idea.targetAudience,
      niche: idea.niche
    };

    const promptOptions = {
      targetDurationSeconds:
        options.targetDurationSeconds,

      minimumWordCount:
        options.minimumWordCount,

      maximumWordCount:
        options.maximumWordCount,

      tone: options.tone,

      language: options.language,

      callToActionStyle:
        options.callToActionStyle
    };

    let promptOutput = null;
    let builderName = "";

    if (
      typeof ScriptPromptLibrary
        .buildScriptPrompt === "function"
    ) {
      builderName = "buildScriptPrompt";

      promptOutput =
        ScriptPromptLibrary.buildScriptPrompt(
          promptInput,
          promptOptions
        );
    } else if (
      typeof ScriptPromptLibrary
        .createScriptPrompt === "function"
    ) {
      builderName = "createScriptPrompt";

      promptOutput =
        ScriptPromptLibrary.createScriptPrompt(
          promptInput,
          promptOptions
        );
    } else if (
      typeof ScriptPromptLibrary
        .generatePrompt === "function"
    ) {
      builderName = "generatePrompt";

      promptOutput =
        ScriptPromptLibrary.generatePrompt(
          promptInput,
          promptOptions
        );
    } else if (
      typeof ScriptPromptLibrary
        .buildPrompt === "function"
    ) {
      builderName = "buildPrompt";

      promptOutput =
        ScriptPromptLibrary.buildPrompt(
          promptInput,
          promptOptions
        );
    } else if (
      typeof ScriptPromptLibrary
        .createPrompt === "function"
    ) {
      builderName = "createPrompt";

      promptOutput =
        ScriptPromptLibrary.createPrompt(
          promptInput,
          promptOptions
        );
    } else if (
      typeof ScriptPromptLibrary
        .build === "function"
    ) {
      builderName = "build";

      promptOutput =
        ScriptPromptLibrary.build(
          promptInput,
          promptOptions
        );
    } else {
      throw new Error(
        "ScriptPromptLibrary does not expose a supported prompt builder. " +
        "Available properties: " +
        Object.keys(ScriptPromptLibrary).join(", ")
      );
    }

    const prompt =
      typeof promptOutput === "string"
        ? promptOutput
        : String(
            promptOutput &&
            (
              promptOutput.prompt ||
              promptOutput.userPrompt ||
              promptOutput.text ||
              promptOutput.content
            ) ||
            ""
          );

    if (!prompt.trim()) {
      throw new Error(
        "ScriptPromptLibrary." +
          builderName +
          "() returned an empty prompt."
      );
    }

    return {
      prompt: prompt.trim(),

      promptVersion:
        resolvePromptVersion_(
          promptOutput
        ),

      builderName: builderName
    };
  }

  /**
   * Resolves the script prompt version.
   *
   * @param {*} promptOutput Prompt-library result.
   * @return {string} Prompt version.
   */
  function resolvePromptVersion_(
    promptOutput
  ) {
    if (
      promptOutput &&
      typeof promptOutput === "object"
    ) {
      const suppliedVersion = String(
        promptOutput.promptVersion ||
        promptOutput.version ||
        ""
      ).trim();

      if (suppliedVersion) {
        return suppliedVersion;
      }
    }

    if (
      typeof ScriptPromptLibrary
        .getPromptVersion === "function"
    ) {
      return String(
        ScriptPromptLibrary
          .getPromptVersion() || ""
      ).trim();
    }

    if (
      typeof ScriptPromptLibrary
        .getVersion === "function"
    ) {
      return String(
        ScriptPromptLibrary
          .getVersion() || ""
      ).trim();
    }

    return "unknown-script-prompt";
  }

  /**
   * Creates the canonical ScriptModel.
   *
   * @param {Object} idea Normalised idea.
   * @param {Object} promptResult Prompt details.
   * @param {Object} aiResponse AI response.
   * @param {Object} validationResult Validation output.
   * @param {Object} formattingResult Formatter output.
   * @param {Object} options Workflow options.
   * @param {string} runId Workflow run ID.
   * @return {Object} Canonical ScriptModel.
   */
  function createScriptModel_(
    idea,
    promptResult,
    aiResponse,
    validationResult,
    formattingResult,
    options,
    runId
  ) {
    const metadata = mergeObjects_(
      formattingResult.metadata || {},
      {
        runId: runId,
        action: ACTION,
        provider: aiResponse.provider || "",
        aiModel:
          aiResponse.model ||
          Settings.getModel(),
        usage:
          clone_(
            aiResponse.usage || {}
          ),
        aiExecution:
          clone_(
            aiResponse.execution || {}
          ),
        sourceIdea: clone_(idea),
        engineVersion: ENGINE_VERSION
      }
    );

    return ScriptModel.fromFormattedResult(
      formattingResult,
      {
        ideaId: idea.ideaId,

        status: options.status,

        promptVersion:
          promptResult.promptVersion,

        aiModel:
          aiResponse.model ||
          Settings.getModel(),

        validation: {
          valid:
            validationResult.valid === true,

          metadata:
            clone_(
              validationResult.metadata ||
              {}
            )
        },

        metadata: metadata
      }
    );
  }

  /**
   * Records AI cost without losing a completed script
   * when the Costs sheet or pricing configuration fails.
   *
   * @param {string} runId Workflow run ID.
   * @param {Object} aiResponse AI response.
   * @return {?Object} Cost record or null.
   */
  function recordCostSafely_(
    runId,
    aiResponse
  ) {
    try {
      return CostService.recordAIUsage({
        runId: runId,

        model:
          aiResponse.model ||
          Settings.getModel(),

        usage:
          aiResponse.usage || {},

        action: ACTION
      });
    } catch (error) {
      safeLogWarning_(
        runId,
        "COST_RECORDING",
        "The script was saved, but AI cost tracking failed.",
        error
      );

      return null;
    }
  }

  /**
   * Builds the public workflow result.
   *
   * @param {Object} data Workflow data.
   * @return {Object} Frontend-safe result.
   */
  function buildWorkflowResult_(data) {
    const durationMilliseconds =
      data.completedAt.getTime() -
      data.startedAt.getTime();

    return {
      success: true,

      runId: data.runId,

      scriptId:
        data.scriptModel.id,

      ideaId:
        data.scriptModel.ideaId,

      title:
        data.scriptModel.title,

      status:
        data.scriptModel.status,

      script:
        ScriptModel.toObject(
          data.scriptModel
        ),

      persistence: {
        saved:
          data.saveResult.saved === true,

        created:
          data.saveResult.created === true,

        rowNumber:
          data.saveResult.rowNumber,

        version:
          data.saveResult.version
      },

      ai: {
        provider:
          data.aiResponse.provider || "",

        model:
          data.aiResponse.model || "",

        usage:
          clone_(
            data.aiResponse.usage || {}
          ),

        execution:
          clone_(
            data.aiResponse.execution || {}
          )
      },

      validation: {
        valid:
          data.validationResult.valid ===
          true,

        metadata:
          clone_(
            data.validationResult
              .metadata || {}
          )
      },

      formatting: {
        valid:
          data.formattingResult.valid ===
          true,

        formatVersion:
          data.formattingResult
            .formatVersion,

        metadata:
          clone_(
            data.formattingResult
              .metadata || {}
          )
      },

      promptVersion:
        data.promptResult.promptVersion,

      estimatedCost:
        data.costResult
          ? data.costResult.estimatedCost
          : 0,

      execution: {
        startedAt:
          data.startedAt.toISOString(),

        completedAt:
          data.completedAt.toISOString(),

        durationMilliseconds:
          durationMilliseconds
      },

        validationAttempts:
        Number(
          data.validationAttempts || 1
        ),

      engineVersion:
        ENGINE_VERSION
    };
  }

  /**
   * Validates the canonical AI response.
   *
   * @param {*} response AI response.
   */
  function validateAIResponse_(response) {
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response)
    ) {
      throw new Error(
        "AI service returned an invalid response."
      );
    }

    if (response.success !== true) {
      throw new Error(
        "AI service did not report success."
      );
    }

    if (
      !response.data ||
      typeof response.data !== "object" ||
      Array.isArray(response.data)
    ) {
      throw new Error(
        "AI service returned no structured script data."
      );
    }
  }

  /**
   * Normalises and validates an idea.
   *
   * @param {*} idea Source idea.
   * @return {Object} Normalised idea.
   */
  function normaliseIdea_(idea) {
    if (
      !idea ||
      typeof idea !== "object" ||
      Array.isArray(idea)
    ) {
      throw new Error(
        "A valid idea object is required."
      );
    }

    const ideaId = firstString_([
      idea.id,
      idea.ideaId,
      idea["Idea ID"],
      idea.ID
    ]);

    const title = firstString_([
      idea.title,
      idea.videoIdea,
      idea.idea,
      idea.topic,
      idea["Video Idea"],
      idea.Title
    ]);

    const hook = firstString_([
      idea.hook,
      idea.Hook
    ]);

    const targetAudience =
      firstString_([
        idea.targetAudience,
        idea["Target Audience"],
        idea.audience
      ]);

    const niche = firstString_([
      idea.niche,
      idea.Niche
    ]);

    if (!ideaId) {
      throw new Error(
        "Idea ID is required for script generation."
      );
    }

    if (!title) {
      throw new Error(
        "Idea title is required for script generation."
      );
    }

    return {
      ideaId: ideaId,
      title: title,
      hook: hook,
      targetAudience:
        targetAudience ||
        safeSetting_(
          "getTargetAudience",
          ""
        ),
      niche:
        niche ||
        safeSetting_(
          "getNiche",
          ""
        )
    };
  }

  /**
   * Resolves workflow options.
   *
   * @param {Object=} options Supplied options.
   * @return {Object} Normalised options.
   */
  function resolveOptions_(options) {
    const supplied = options || {};

    if (
      typeof supplied !== "object" ||
      Array.isArray(supplied)
    ) {
      throw new Error(
        "Script Engine options must be an object."
      );
    }

    const validatorDefaults = ScriptValidator.getDefaultRules();
    const targetDurationSeconds = resolvePositiveNumber_(
      supplied.targetDurationSeconds,
      DEFAULT_OPTIONS.targetDurationSeconds
    );
    const durationWordRange = wordRangeForDuration_(targetDurationSeconds);

    const resolved = {
      temperature:
        resolveOptionalNumber_(
          supplied.temperature,
          safeSetting_(
            "getTemperature",
            DEFAULT_OPTIONS.temperature
          )
        ),

      maxTokens:
        resolveOptionalNumber_(
          supplied.maxTokens,
          safeSetting_(
            "getMaxTokens",
            DEFAULT_OPTIONS.maxTokens
          )
        ),

      targetDurationSeconds: targetDurationSeconds,

      minimumWordCount:
        resolvePositiveNumber_(
          supplied.minimumWordCount,
          durationWordRange.minimumWordCount
        ),

      maximumWordCount:
        resolvePositiveNumber_(
          supplied.maximumWordCount,
          durationWordRange.maximumWordCount
        ),

      minimumDurationSeconds:
        resolvePositiveNumber_(
          supplied.minimumDurationSeconds,
          validatorDefaults
            .minimumDurationSeconds
        ),

      maximumDurationSeconds:
        resolvePositiveNumber_(
          supplied.maximumDurationSeconds,
          validatorDefaults
            .maximumDurationSeconds
        ),

      durationToleranceSeconds:
        resolveNonNegativeNumber_(
          supplied.durationToleranceSeconds,
          validatorDefaults
            .durationToleranceSeconds
        ),

      tone:
        normaliseString_(
          supplied.tone
        ),

      language:
        normaliseString_(
          supplied.language
        ),

      callToActionStyle:
        normaliseString_(
          supplied.callToActionStyle
        ),

      status:
        normaliseString_(
          supplied.status ||
          DEFAULT_OPTIONS.status
        ).toUpperCase()
    };

    if (
      resolved.maximumWordCount <
      resolved.minimumWordCount
    ) {
      throw new Error(
        "Maximum word count cannot be lower than minimum word count."
      );
    }

    if (
      resolved.maximumDurationSeconds <
      resolved.minimumDurationSeconds
    ) {
      throw new Error(
        "Maximum duration cannot be lower than minimum duration."
      );
    }

    const statuses =
      ScriptModel.getStatuses();

    const allowedStatuses =
      Object.keys(statuses).map(
        function (key) {
          return statuses[key];
        }
      );

    if (
      allowedStatuses.indexOf(
        resolved.status
      ) === -1
    ) {
      throw new Error(
        "Unsupported Script Engine status: " +
          resolved.status +
          "."
      );
    }

    return resolved;
  }  /**
   * Resolves and validates Script Engine options.
   *
   * @param {Object=} options Supplied options.
   * @return {Object} Normalised options.
   */
  function resolveOptions_(options) {
    const supplied = options || {};

    if (
      typeof supplied !== "object" ||
      Array.isArray(supplied)
    ) {
      throw new Error(
        "Script Engine options must be an object."
      );
    }

    const validatorDefaults = ScriptValidator.getDefaultRules();
    const targetDurationSeconds = resolvePositiveNumber_(
      supplied.targetDurationSeconds,
      DEFAULT_OPTIONS.targetDurationSeconds
    );
    const durationWordRange = wordRangeForDuration_(targetDurationSeconds);

    const resolved = {
      temperature:
        resolveOptionalNumber_(
          supplied.temperature,
          safeSetting_(
            "getTemperature",
            DEFAULT_OPTIONS.temperature
          )
        ),

      maxTokens:
        resolveOptionalNumber_(
          supplied.maxTokens,
          safeSetting_(
            "getMaxTokens",
            DEFAULT_OPTIONS.maxTokens
          )
        ),

      targetDurationSeconds: targetDurationSeconds,

      minimumWordCount:
        resolvePositiveNumber_(
          supplied.minimumWordCount,
          durationWordRange.minimumWordCount
        ),

      maximumWordCount:
        resolvePositiveNumber_(
          supplied.maximumWordCount,
          durationWordRange.maximumWordCount
        ),

      minimumDurationSeconds:
        resolvePositiveNumber_(
          supplied.minimumDurationSeconds,
          validatorDefaults
            .minimumDurationSeconds
        ),

      maximumDurationSeconds:
        resolvePositiveNumber_(
          supplied.maximumDurationSeconds,
          validatorDefaults
            .maximumDurationSeconds
        ),

      durationToleranceSeconds:
        resolveNonNegativeNumber_(
          supplied.durationToleranceSeconds,
          validatorDefaults
            .durationToleranceSeconds
        ),

      maxValidationAttempts:
        resolvePositiveIntegerOption_(
          supplied.maxValidationAttempts,
          DEFAULT_OPTIONS
            .maxValidationAttempts
        ),

      tone:
        normaliseString_(
          supplied.tone
        ),

      language:
        normaliseString_(
          supplied.language
        ),

      callToActionStyle:
        normaliseString_(
          supplied.callToActionStyle
        ),

      status:
        normaliseString_(
          supplied.status ||
          DEFAULT_OPTIONS.status
        ).toUpperCase()
    };

    if (
      resolved.maximumWordCount <
      resolved.minimumWordCount
    ) {
      throw new Error(
        "Maximum word count cannot be lower than minimum word count."
      );
    }

    if (
      resolved.maximumDurationSeconds <
      resolved.minimumDurationSeconds
    ) {
      throw new Error(
        "Maximum duration cannot be lower than minimum duration."
      );
    }

    if (
      resolved.maxValidationAttempts > 5
    ) {
      throw new Error(
        "Maximum validation attempts cannot exceed 5."
      );
    }

    const statuses =
      ScriptModel.getStatuses();

    const allowedStatuses =
      Object.keys(statuses).map(
        function (key) {
          return statuses[key];
        }
      );

    if (
      allowedStatuses.indexOf(
        resolved.status
      ) === -1
    ) {
      throw new Error(
        "Unsupported Script Engine status: " +
          resolved.status +
          "."
      );
    }

    return resolved;
  }

  function wordRangeForDuration_(targetDurationSeconds) {
    const seconds = Math.max(30, Math.min(60, Number(targetDurationSeconds) || 50));
    return {
      minimumWordCount: Math.round(seconds * 2.25),
      maximumWordCount: Math.round(seconds * 2.5)
    };
  }

  /**
   * Safely reads one Settings method.
   *
   * @param {string} methodName Settings method.
   * @param {*} fallback Fallback.
   * @return {*} Setting or fallback.
   */
  function safeSetting_(
    methodName,
    fallback
  ) {
    try {
      if (
        typeof Settings !== "undefined" &&
        Settings &&
        typeof Settings[methodName] ===
          "function"
      ) {
        const value =
          Settings[methodName]();

        if (
          value !== undefined &&
          value !== null &&
          value !== ""
        ) {
          return value;
        }
      }
    } catch (error) {
      Logger.log(
        "Script Engine setting warning: " +
          error.message
      );
    }

    return fallback;
  }

  /**
   * Logs workflow start without hiding the real workflow
   * if logging itself fails.
   */
  function safeLogStarted_(
    runId,
    action,
    message
  ) {
    try {
      LoggingService.started(
        runId,
        action,
        message
      );
    } catch (error) {
      Logger.log(
        "Unable to write start log: " +
          error.message
      );
    }
  }

  /**
   * Logs workflow success safely.
   */
  function safeLogSuccess_(
    runId,
    action,
    message
  ) {
    try {
      LoggingService.success(
        runId,
        action,
        message
      );
    } catch (error) {
      Logger.log(
        "Unable to write success log: " +
          error.message
      );
    }
  }

  /**
   * Logs workflow failure safely.
   */
  function safeLogFailure_(
    runId,
    action,
    message,
    error
  ) {
    try {
      LoggingService.failure(
        runId,
        action,
        message,
        error
      );
    } catch (loggingError) {
      Logger.log(
        "Unable to write failure log: " +
          loggingError.message
      );
    }
  }

  /**
   * Logs a non-fatal warning safely.
   */
  function safeLogWarning_(
    runId,
    action,
    message,
    error
  ) {
    try {
      LoggingService.log({
        runId: runId,
        action: action,
        status:
          LoggingService.STATUS.WARNING,
        message: message,
        errorDetails: error
      });
    } catch (loggingError) {
      Logger.log(
        "Unable to write warning log: " +
          loggingError.message
      );
    }
  }

  /**
   * Creates an engine-specific error.
   *
   * @param {*} originalError Original error.
   * @param {string} runId Workflow run ID.
   * @param {string} ideaId Idea ID.
   * @return {Error} Script Engine error.
   */
  function createEngineError_(
    originalError,
    runId,
    ideaId
  ) {
    if (
      originalError &&
      originalError.name ===
        "ScriptEngineError"
    ) {
      return originalError;
    }

    const detail = String(
      originalError &&
      originalError.message
        ? originalError.message
        : originalError ||
          "Unknown script-generation error."
    );

    const error = new Error(
      "Script generation failed: " +
        detail
    );

    error.name = "ScriptEngineError";
    error.runId = runId;
    error.ideaId = ideaId;
    error.originalError = detail;

    return error;
  }

  /**
   * Creates a workflow run ID.
   *
   * @return {string} Run ID.
   */
  function createScriptRunId_() {
    return (
      "RUN-SCRIPT-" +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase()
    );
  }

  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First value.
   */
  function firstString_(values) {
    for (
      let index = 0;
      index < values.length;
      index++
    ) {
      const value =
        normaliseString_(
          values[index]
        );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Normalises a string.
   *
   * @param {*} value Source value.
   * @return {string} String value.
   */
  function normaliseString_(value) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
  }

  /**
   * Resolves an optional number.
   *
   * @param {*} value Candidate.
   * @param {*} fallback Fallback.
   * @return {?number} Number or null.
   */
  function resolveOptionalNumber_(
    value,
    fallback
  ) {
    const selected =
      value !== undefined &&
      value !== null &&
      value !== ""
        ? value
        : fallback;

    if (
      selected === undefined ||
      selected === null ||
      selected === ""
    ) {
      return null;
    }

    const numericValue =
      Number(selected);

    if (!isFinite(numericValue)) {
      throw new Error(
        "Script Engine numeric options must contain valid numbers."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a positive integer option.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Fallback value.
   * @return {number} Positive integer.
   */
  function resolvePositiveIntegerOption_(
    value,
    fallback
  ) {
    const selected =
      value !== undefined &&
      value !== null &&
      value !== ""
        ? value
        : fallback;

    const numericValue = Number(selected);

    if (
      !Number.isInteger(numericValue) ||
      numericValue < 1
    ) {
      throw new Error(
        "Maximum validation attempts must be a positive integer."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a positive number.
   */
  function resolvePositiveNumber_(
    value,
    fallback
  ) {
    const numericValue =
      Number(
        value !== undefined &&
        value !== null &&
        value !== ""
          ? value
          : fallback
      );

    if (
      !isFinite(numericValue) ||
      numericValue <= 0
    ) {
      throw new Error(
        "Script Engine options must contain positive numbers."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a non-negative number.
   */
  function resolveNonNegativeNumber_(
    value,
    fallback
  ) {
    const numericValue =
      Number(
        value !== undefined &&
        value !== null &&
        value !== ""
          ? value
          : fallback
      );

    if (
      !isFinite(numericValue) ||
      numericValue < 0
    ) {
      throw new Error(
        "Duration tolerance must be a non-negative number."
      );
    }

    return numericValue;
  }

  /**
   * Shallow merges plain objects.
   */
  function mergeObjects_(
    base,
    overrides
  ) {
    const result = clone_(base || {});

    Object.keys(
      overrides || {}
    ).forEach(function (key) {
      result[key] =
        clone_(overrides[key]);
    });

    return result;
  }

  /**
   * Creates a JSON-compatible deep clone.
   */
  function clone_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value)
    );
  }

  return {
    generateScript: generateScript,
    generatePreview: generatePreview,
    prepareRequest: prepareRequest,

    getEngineVersion: function () {
      return ENGINE_VERSION;
    }
  };
})();

/**
 * Backwards-compatible workflow wrapper.
 *
 * @param {Object} idea Source idea.
 * @param {Object=} options Workflow options.
 * @return {Object} Workflow result.
 */
function generateScriptWorkflow(
  idea,
  options
) {
  return ScriptEngine.generateScript(
    idea,
    options || {}
  );
}

/**
 * Tests invalid idea protection.
 *
 * No AI request is made.
 *
 * @return {boolean} True when rejected.
 */
function testScriptEngineRejectsInvalidIdea() {
  try {
    ScriptEngine.prepareRequest(
      {
        title:
          "Idea without an identifier"
      },
      {}
    );
  } catch (error) {
    Logger.log(error.message);
    Logger.log(
      "Script Engine invalid-idea test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Script Engine accepted an idea without an ID."
  );
}

/**
 * Tests prompt and schema preparation.
 *
 * No AI request is made.
 *
 * @return {Object} Prepared request.
 */
function testScriptEnginePreparesRequest() {
  const request =
    ScriptEngine.prepareRequest(
      createScriptEngineIdeaFixture_(),
      {
        targetDurationSeconds: 50,
        minimumWordCount: 100,
        maximumWordCount: 145
      }
    );

  if (
    !request.prompt ||
    typeof request.prompt !== "string"
  ) {
    throw new Error(
      "Script Engine did not prepare a prompt."
    );
  }

  if (
    !request.schema ||
    request.schema.type !==
      "json_schema"
  ) {
    throw new Error(
      "Script Engine did not prepare the script schema."
    );
  }

  if (
    request.engineVersion !==
    ScriptEngine.getEngineVersion()
  ) {
    throw new Error(
      "Script Engine returned an incorrect version."
    );
  }

  Logger.log(
    JSON.stringify(request, null, 2)
  );

  Logger.log(
    "Script Engine request-preparation test completed successfully."
  );

  return request;
}

/**
 * Runs safe Script Engine unit tests.
 *
 * No AI request is made.
 *
 * @return {Object} Unit-test summary.
 */
function testScriptEngineUnitTests() {
  testScriptEngineRejectsInvalidIdea();
  testScriptEnginePreparesRequest();

  const result = {
    passed: true,
    testsRun: 2,
    liveProviderCalled: false,
    engineVersion:
      ScriptEngine.getEngineVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All Script Engine unit tests completed successfully."
  );

  return result;
}

/**
 * Runs the complete live Script Engine workflow.
 *
 * This function:
 * - Calls OpenAI.
 * - Creates a real Scripts record.
 * - Creates real Logs records.
 * - Creates a real Cost record.
 *
 * @return {Object} Complete workflow result.
 */
function testScriptEngineLiveWorkflow() {
  const result =
    ScriptEngine.generateScript(
      createScriptEngineIdeaFixture_(),
      {
        targetDurationSeconds: 50,
        minimumWordCount: 100,
        maximumWordCount: 145,
        status: "FORMATTED"
      }
    );

  if (
    !result ||
    result.success !== true
  ) {
    throw new Error(
      "Script Engine live workflow did not succeed."
    );
  }

  if (!result.scriptId) {
    throw new Error(
      "Script Engine did not create a Script ID."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      result.scriptId
    );

  if (!storedScript) {
    throw new Error(
      "Script Engine saved result could not be retrieved."
    );
  }

  if (
    storedScript.ideaId !==
    result.ideaId
  ) {
    throw new Error(
      "Stored script has the wrong Idea ID."
    );
  }

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "Script Engine live workflow test completed successfully."
  );

  return result;
}

/**
 * Creates the Script Engine test idea.
 *
 * @return {Object} Test idea.
 */
function createScriptEngineIdeaFixture_() {
  return {
    id:
      "IDEA-SCRIPT-ENGINE-TEST",

    videoIdea:
      "Five mistakes first-time visitors make in Rome",

    hook:
      "Visiting Rome soon? Avoid these five mistakes that can ruin your trip.",

    targetAudience:
      "First-time travellers planning a holiday to Rome",

    niche:
      "Travel advice"
  };
}
