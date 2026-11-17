/****************************************************
 * Project Savannah
 * Script_Engine_Prompt.js
 *
 * Purpose:
 * Build the script-generation prompt through whichever builder the prompt
 * library exposes, and resolve the prompt version recorded with the script.
 *
 * Split out of Scripts/Script_Engine.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptEngine remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptEnginePrompt = (() => {
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

  return {
    buildPrompt: buildPrompt_
  };
})();
