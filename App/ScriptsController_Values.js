/****************************************************
 * Project Savannah
 * ScriptsController_Values.js
 *
 * Purpose:
 * Small value helpers shared by the Scripts controller modules:
 * string normalisation, JSON cloning and the controller error type.
 *
 * Split out of App/ScriptsController.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptsController remains the only public entry point; nothing
 * outside the controller should call this module directly.
 ****************************************************/

const ScriptsControllerValues = (() => {
  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First string.
   * @private
   */
  function firstNonEmptyString_(
    values
  ) {
    for (
      let index = 0;
      index < values.length;
      index += 1
    ) {
      const value =
        normaliseOptionalString_(
          values[index]
        );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Normalises an optional string.
   *
   * @param {*} value Source value.
   * @return {string} String value.
   * @private
   */
  function normaliseOptionalString_(
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
   * Creates a controller-specific error.
   *
   * @param {string} message Error message.
   * @return {Error} Controller error.
   * @private
   */
  function createControllerError_(
    message
  ) {
    const error =
      new Error(
        "Scripts controller error: " +
        message
      );

    error.name =
      "ScriptsControllerError";

    return error;
  }

  /**
   * Creates a JSON-compatible clone.
   *
   * @param {*} value Source value.
   * @return {*} Clone.
   * @private
   */
  function clone_(value) {
    if (
      value === undefined
    ) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value)
    );
  }

  return {
    firstNonEmptyString: firstNonEmptyString_,
    normaliseOptionalString: normaliseOptionalString_,
    createControllerError: createControllerError_,
    clone: clone_
  };
})();
