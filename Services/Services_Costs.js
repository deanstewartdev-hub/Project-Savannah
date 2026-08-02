/****************************************************
 * Project Savannah v1.2
 * Services_Costs.js
 *
 * Purpose:
 * Calculate and persist estimated AI usage costs.
 *
 * Responsibilities:
 * - Normalise provider token usage.
 * - Calculate estimated model cost.
 * - Write structured records to the Costs sheet.
 *
 * Must not:
 * - Call AI providers.
 * - Display UI messages.
 * - Control content workflows.
 ****************************************************/

const CostService = (() => {
  const PRICE_PER_MILLION_TOKENS =
    Object.freeze({
      "gpt-4o-mini": {
        input: 0.15,
        output: 0.60
      }
    });

  /**
   * Records one AI usage event.
   *
   * Expected Costs columns:
   * A Cost ID
   * B Timestamp
   * C Run ID
   * D Model
   * E Input Tokens
   * F Output Tokens
   * G Estimated Cost
   * H Action
   *
   * @param {Object} costEntry AI usage details.
   * @return {Object} Saved cost record.
   */
  function recordAIUsage(costEntry) {
    const entry = costEntry || {};
    const usage = normaliseUsage_(
      entry.usage
    );

    const model = String(
      entry.model || Settings.getModel()
    );

    const estimatedCost =
      calculateEstimatedCost_(
        model,
        usage.inputTokens,
        usage.outputTokens
      );

    const record = {
      costId: createCostId_(),
      timestamp: new Date(),
      runId: String(entry.runId || ""),
      model: model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: estimatedCost,
      action: String(
        entry.action || "AI_REQUEST"
      )
    };

    const sheet = getCostsSheet_();

    sheet.appendRow([
      record.costId,
      record.timestamp,
      record.runId,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.estimatedCost,
      record.action
    ]);

    return record;
  }

  /**
   * Normalises OpenAI and provider-independent usage shapes.
   *
   * Supports:
   * input_tokens / output_tokens
   * inputTokens / outputTokens
   * prompt_tokens / completion_tokens
   *
   * @param {Object=} usage Provider usage object.
   * @return {Object} Normalised usage.
   */
  function normaliseUsage_(usage) {
    const providerUsage = usage || {};

    const inputTokens = Number(
      providerUsage.inputTokens ??
      providerUsage.input_tokens ??
      providerUsage.prompt_tokens ??
      0
    ) || 0;

    const outputTokens = Number(
      providerUsage.outputTokens ??
      providerUsage.output_tokens ??
      providerUsage.completion_tokens ??
      0
    ) || 0;

    return {
      inputTokens: Math.max(
        Math.floor(inputTokens),
        0
      ),

      outputTokens: Math.max(
        Math.floor(outputTokens),
        0
      )
    };
  }

  /**
   * Calculates an estimated model cost.
   *
   * @param {string} model Model identifier.
   * @param {number} inputTokens Input token count.
   * @param {number} outputTokens Output token count.
   * @return {number} Estimated cost in USD.
   */
  function calculateEstimatedCost_(
    model,
    inputTokens,
    outputTokens
  ) {
    const pricing =
      PRICE_PER_MILLION_TOKENS[model];

    if (!pricing) {
      Logger.log(
        "No pricing configuration found for model: " +
        model
      );

      return 0;
    }

    const inputCost =
      (Number(inputTokens) / 1000000) *
      pricing.input;

    const outputCost =
      (Number(outputTokens) / 1000000) *
      pricing.output;

    return roundCost_(
      inputCost + outputCost
    );
  }

  /**
   * Returns the Costs sheet.
   *
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function getCostsSheet_() {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      throw new Error(
        "Project Savannah could not access its spreadsheet."
      );
    }

    const sheet =
      spreadsheet.getSheetByName(SHEETS.COSTS);

    if (!sheet) {
      throw new Error(
        "Costs sheet was not found."
      );
    }

    return sheet;
  }

  /**
   * Generates a cost identifier.
   *
   * @return {string}
   */
  function createCostId_() {
    return (
      "COST-" +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase()
    );
  }

  /**
   * Rounds cost values for spreadsheet storage.
   *
   * @param {number} value Cost value.
   * @return {number}
   */
  function roundCost_(value) {
    return (
      Math.round(
        (Number(value) || 0) * 1000000
      ) / 1000000
    );
  }

  return {
    recordAIUsage: recordAIUsage
  };
})();

/**
 * Tests the cost service.
 *
 * This creates one real test row in the Costs sheet.
 *
 * @return {Object} Saved cost record.
 */
function testCostService() {
  const record =
    CostService.recordAIUsage({
      runId:
        "TEST-RUN-" +
        Utilities.getUuid()
          .slice(0, 6)
          .toUpperCase(),

      model: "gpt-4o-mini",

      usage: {
        input_tokens: 1000,
        output_tokens: 500
      },

      action: "TEST_COST"
    });

  if (!record || !record.costId) {
    throw new Error(
      "Cost service did not return a saved record."
    );
  }

  Logger.log(
    JSON.stringify(record, null, 2)
  );

  Logger.log(
    "Cost service test completed successfully."
  );

  return record;
}