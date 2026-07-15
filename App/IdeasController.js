/****************************************************
 * Project Savannah v1.3
 * IdeasController.js
 *
 * Purpose:
 * Expose Ideas workspace operations to the
 * Project Savannah frontend.
 *
 * Responsibilities:
 * - List stored ideas.
 * - Return Ideas workspace metrics.
 * - Trigger the production idea-generation workflow.
 * - Update idea workflow statuses.
 * - Return predictable frontend-safe responses.
 * - Log controller failures.
 *
 * Must not:
 * - Read Google Sheets directly.
 * - Call AI providers directly.
 * - Render frontend HTML.
 * - Reimplement repository business rules.
 ****************************************************/

/**
 * Returns ideas for the Ideas workspace.
 *
 * Called from the browser using:
 * google.script.run.ideasList(request)
 *
 * Supported request fields:
 * - limit
 * - status
 * - search
 * - newestFirst
 *
 * @param {Object=} request Query options.
 * @return {Object} Controller response.
 */
function ideasList(request) {
  try {
    const safeRequest =
      request &&
      typeof request === "object"
        ? request
        : {};

    const ideas =
      IdeasRepository.listIdeas({
        limit:
          safeRequest.limit,

        status:
          safeRequest.status,

        search:
          safeRequest.search,

        newestFirst:
          safeRequest.newestFirst !== false
      });

    return createIdeasControllerResponse_(
      true,
      {
        ideas: ideas,
        count: ideas.length
      },
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "LIST_IDEAS",
      error,
      "Ideas could not be loaded."
    );
  }
}

/**
 * Returns Ideas workspace metrics.
 *
 * Called from the browser using:
 * google.script.run.ideasGetMetrics()
 *
 * @return {Object} Controller response.
 */
function ideasGetMetrics() {
  try {
    const metrics =
      IdeasRepository.getMetrics();

    return createIdeasControllerResponse_(
      true,
      metrics,
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "GET_IDEA_METRICS",
      error,
      "Idea metrics could not be loaded."
    );
  }
}

/**
 * Generates and saves a new collection of ideas.
 *
 * This uses the existing production workflow:
 * generateIdeasWorkflow()
 *
 * Called from the browser using:
 * google.script.run.ideasGenerate()
 *
 * @return {Object} Controller response.
 */
function ideasGenerate() {
  try {
    const generationResult =
      generateIdeasWorkflow();

    if (
      !generationResult ||
      generationResult.success !== true
    ) {
      throw new Error(
        "The idea-generation workflow did not return a successful result."
      );
    }

    const ideas =
      IdeasRepository.listIdeas({
        limit:
          Number(
            generationResult.savedCount
          ) || 100,

        newestFirst: true
      });

    const metrics =
      IdeasRepository.getMetrics();

    return createIdeasControllerResponse_(
      true,
      {
        generation:
          generationResult,

        ideas: ideas,

        metrics: metrics
      },
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "GENERATE_IDEAS",
      error,
      "Ideas could not be generated."
    );
  }
}

/**
 * Updates one idea's workflow status.
 *
 * Called from the browser using:
 * google.script.run.ideasUpdateStatus(request)
 *
 * Required request fields:
 * - ideaId
 * - status
 *
 * @param {Object} request Status update request.
 * @return {Object} Controller response.
 */
function ideasUpdateStatus(request) {
  try {
    if (
      !request ||
      typeof request !== "object"
    ) {
      throw new Error(
        "An idea status request is required."
      );
    }

    const ideaId =
      normaliseIdeasControllerText_(
        request.ideaId
      );

    const status =
      normaliseIdeasControllerText_(
        request.status
      );

    if (!ideaId) {
      throw new Error(
        "An idea ID is required."
      );
    }

    if (!status) {
      throw new Error(
        "An idea status is required."
      );
    }

    const updatedIdea =
      IdeasRepository.updateIdeaStatus(
        ideaId,
        status
      );

    const metrics =
      IdeasRepository.getMetrics();

    return createIdeasControllerResponse_(
      true,
      {
        idea: updatedIdea,
        metrics: metrics
      },
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "UPDATE_IDEA_STATUS",
      error,
      "The idea status could not be updated."
    );
  }
}

/**
 * Retrieves one complete idea by ID.
 *
 * Called from the browser using:
 * google.script.run.ideasGet(request)
 *
 * Required request field:
 * - ideaId
 *
 * @param {Object} request Idea request.
 * @return {Object} Controller response.
 */
function ideasGet(request) {
  try {
    if (
      !request ||
      typeof request !== "object"
    ) {
      throw new Error(
        "An idea request is required."
      );
    }

    const ideaId =
      normaliseIdeasControllerText_(
        request.ideaId
      );

    if (!ideaId) {
      throw new Error(
        "An idea ID is required."
      );
    }

    const idea =
      IdeasRepository.getIdeaById(
        ideaId
      );

    if (!idea) {
      throw new Error(
        "The requested idea could not be found."
      );
    }

    return createIdeasControllerResponse_(
      true,
      {
        idea: idea
      },
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "GET_IDEA",
      error,
      "The requested idea could not be loaded."
    );
  }
}

/**
 * Approves one idea.
 *
 * Convenience wrapper for frontend use.
 *
 * @param {Object} request Request containing ideaId.
 * @return {Object} Controller response.
 */
function ideasApprove(request) {
  return ideasUpdateStatus({
    ideaId:
      request &&
      request.ideaId,

    status:
      IDEA_STATUS.APPROVED
  });
}

/**
 * Rejects one idea.
 *
 * Convenience wrapper for frontend use.
 *
 * @param {Object} request Request containing ideaId.
 * @return {Object} Controller response.
 */
function ideasReject(request) {
  return ideasUpdateStatus({
    ideaId:
      request &&
      request.ideaId,

    status:
      IDEA_STATUS.REJECTED
  });
}

/**
 * Returns one complete Ideas workspace payload.
 *
 * This reduces the number of initial browser requests
 * needed when the Ideas page loads.
 *
 * Called from the browser using:
 * google.script.run.ideasGetWorkspace(request)
 *
 * @param {Object=} request Query options.
 * @return {Object} Controller response.
 */
function ideasGetWorkspace(request) {
  try {
    const safeRequest =
      request &&
      typeof request === "object"
        ? request
        : {};

    const ideas =
      IdeasRepository.listIdeas({
        limit:
          safeRequest.limit || 500,

        status:
          safeRequest.status,

        search:
          safeRequest.search,

        newestFirst:
          safeRequest.newestFirst !== false
      });

    const metrics =
      IdeasRepository.getMetrics();

    return createIdeasControllerResponse_(
      true,
      {
        ideas: ideas,
        metrics: metrics,
        statuses: {
          newStatus:
            IDEA_STATUS.NEW,

          approvedStatus:
            IDEA_STATUS.APPROVED,

          rejectedStatus:
            IDEA_STATUS.REJECTED
        }
      },
      null
    );
  } catch (error) {
    return handleIdeasControllerError_(
      "GET_IDEAS_WORKSPACE",
      error,
      "The Ideas workspace could not be loaded."
    );
  }
}

/**
 * Creates a predictable controller response.
 *
 * @param {boolean} success Whether the operation succeeded.
 * @param {Object|null} data Response data.
 * @param {Object|null} error Error details.
 * @return {Object} Controller response.
 * @private
 */
function createIdeasControllerResponse_(
  success,
  data,
  error
) {
  return {
    success: Boolean(success),

    data:
      data || null,

    error:
      error || null,

    timestamp:
      new Date().toISOString()
  };
}

/**
 * Handles and logs one controller failure.
 *
 * @param {string} action Controller action.
 * @param {*} error Caught error.
 * @param {string} safeMessage Frontend-safe message.
 * @return {Object} Failed controller response.
 * @private
 */
function handleIdeasControllerError_(
  action,
  error,
  safeMessage
) {
  const technicalMessage =
    getIdeasControllerErrorMessage_(
      error
    );

  Logger.log(
    "Ideas controller error [" +
      action +
      "]: " +
      technicalMessage
  );

  try {
    if (
      typeof LoggingService !==
        "undefined" &&
      LoggingService &&
      typeof LoggingService.log ===
        "function"
    ) {
      LoggingService.log({
        runId:
          "",

        action:
          "IDEAS_CONTROLLER_" +
          action,

        status:
          LoggingService.STATUS &&
          LoggingService.STATUS.FAILURE
            ? LoggingService.STATUS.FAILURE
            : "Failure",

        message:
          safeMessage,

        errorDetails:
          technicalMessage
      });
    }
  } catch (loggingError) {
    Logger.log(
      "Unable to log Ideas controller failure: " +
        getIdeasControllerErrorMessage_(
          loggingError
        )
    );
  }

  return createIdeasControllerResponse_(
    false,
    null,
    {
      message:
        safeMessage,

      technicalMessage:
        technicalMessage,

      action:
        action
    }
  );
}

/**
 * Extracts a useful error message.
 *
 * @param {*} error Caught error.
 * @return {string} Error message.
 * @private
 */
function getIdeasControllerErrorMessage_(
  error
) {
  if (!error) {
    return "Unknown Ideas controller error.";
  }

  if (error.message) {
    return String(
      error.message
    );
  }

  return String(error);
}

/**
 * Normalises controller text input.
 *
 * @param {*} value Input value.
 * @return {string} Trimmed text.
 * @private
 */
function normaliseIdeasControllerText_(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

/**
 * Tests the complete Ideas controller stack.
 *
 * This test reads existing data but does not call AI
 * or update any idea statuses.
 *
 * @return {Object} Controller response.
 */
function testIdeasController() {
  const response =
    ideasGetWorkspace({
      limit: 100
    });

  if (
    !response ||
    response.success !== true
  ) {
    throw new Error(
      response &&
      response.error &&
      response.error.message
        ? response.error.message
        : "Ideas controller test failed."
    );
  }

  if (
    !response.data ||
    !Array.isArray(
      response.data.ideas
    ) ||
    !response.data.metrics
  ) {
    throw new Error(
      "Ideas controller returned an invalid workspace model."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Ideas controller test completed successfully."
  );

  return response;
}