/****************************************************
 * Project Savannah v1.1
 * AI_Schemas.js
 *
 * Purpose:
 * Reusable structured-output schemas for AI responses.
 *
 * Responsibilities:
 * - Define provider-compatible JSON response contracts.
 * - Keep domain schemas separate from provider clients.
 *
 * Must not:
 * - Build prompts.
 * - Validate domain business rules.
 * - Access Google Sheets.
 ****************************************************/

const Schemas = {
  /**
   * Returns the structured-output schema used by idea generation.
   *
   * @return {Object} Video ideas response schema.
   */
  getVideoIdeasSchema: function () {
    return {
      type: "json_schema",
      name: "project_savannah_video_ideas",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ideas: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                videoIdea: {
                  type: "string"
                },
                hook: {
                  type: "string"
                },
                targetAudience: {
                  type: "string"
                }
              },
              required: [
                "videoIdea",
                "hook",
                "targetAudience"
              ]
            }
          }
        },
        required: [
          "ideas"
        ]
      }
    };
  },

  /**
   * Returns the structured-output schema used by script generation.
   *
   * Word count is intentionally excluded because Project Savannah
   * calculates the authoritative value from voiceoverScript.
   *
   * @return {Object} Script response schema.
   */
  getScriptSchema: function () {
    return {
      type: "json_schema",
      name: "project_savannah_script_v1",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string"
          },

          hook: {
            type: "string"
          },

          voiceoverScript: {
            type: "string"
          },

          scenes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sceneNumber: {
                  type: "integer"
                },

                narration: {
                  type: "string"
                },

                onScreenText: {
                  type: "string"
                },

                visualDirection: {
                  type: "string"
                },

                estimatedSeconds: {
                  type: "number"
                }
              },
              required: [
                "sceneNumber",
                "narration",
                "onScreenText",
                "visualDirection",
                "estimatedSeconds"
              ]
            }
          },

          callToAction: {
            type: "string"
          },

          estimatedDurationSeconds: {
            type: "number"
          },

          generationNotes: {
            type: "string"
          }
        },

        required: [
          "title",
          "hook",
          "voiceoverScript",
          "scenes",
          "callToAction",
          "estimatedDurationSeconds",
          "generationNotes"
        ]
      }
    };
  }
};

/**
 * Verifies that the script schema has the expected structure.
 *
 * This test does not call OpenAI and therefore has no API cost.
 *
 * @return {Object} Script schema.
 */
function testScriptSchemaDefinition() {
  const schemaDefinition = Schemas.getScriptSchema();

  if (!schemaDefinition) {
    throw new Error(
      "Script schema was not returned."
    );
  }

  if (schemaDefinition.type !== "json_schema") {
    throw new Error(
      "Script schema type must be json_schema."
    );
  }

  if (
    schemaDefinition.name !==
    "project_savannah_script_v1"
  ) {
    throw new Error(
      "Unexpected script schema name."
    );
  }

  if (schemaDefinition.strict !== true) {
    throw new Error(
      "Script schema must use strict mode."
    );
  }

  const rootSchema = schemaDefinition.schema;

  if (
    !rootSchema ||
    rootSchema.type !== "object"
  ) {
    throw new Error(
      "Script schema root must be an object."
    );
  }

  if (
    rootSchema.additionalProperties !== false
  ) {
    throw new Error(
      "Script schema must reject additional properties."
    );
  }

  const requiredFields = [
    "title",
    "hook",
    "voiceoverScript",
    "scenes",
    "callToAction",
    "estimatedDurationSeconds",
    "generationNotes"
  ];

  requiredFields.forEach(function (fieldName) {
    if (
      rootSchema.required.indexOf(fieldName) === -1
    ) {
      throw new Error(
        "Script schema is missing required field: " +
        fieldName
      );
    }

    if (!rootSchema.properties[fieldName]) {
      throw new Error(
        "Script schema has no property definition for: " +
        fieldName
      );
    }
  });

  const scenesSchema =
    rootSchema.properties.scenes;

  if (scenesSchema.type !== "array") {
    throw new Error(
      "Script scenes must be an array."
    );
  }

  const sceneSchema = scenesSchema.items;

  const requiredSceneFields = [
    "sceneNumber",
    "narration",
    "onScreenText",
    "visualDirection",
    "estimatedSeconds"
  ];

  requiredSceneFields.forEach(function (fieldName) {
    if (
      sceneSchema.required.indexOf(fieldName) === -1
    ) {
      throw new Error(
        "Scene schema is missing required field: " +
        fieldName
      );
    }
  });

  Logger.log(
    JSON.stringify(schemaDefinition, null, 2)
  );

  Logger.log(
    "Script schema definition test completed successfully."
  );

  return schemaDefinition;
}