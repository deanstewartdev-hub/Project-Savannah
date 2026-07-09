/****************************************************
 * Project Savannah v1.0.1
 * Schemas.gs
 * Purpose: Reusable JSON schemas for AI responses
 ****************************************************/

const Schemas = {

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
            minItems: 1,
            maxItems: 10,
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
              required: ["videoIdea", "hook", "targetAudience"]
            }
          }
        },
        required: ["ideas"]
      }
    };
  },

  getScriptSchema: function () {
    return {
      type: "json_schema",
      name: "project_savannah_script",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          script: {
            type: "object",
            additionalProperties: false,
            properties: {
              videoTitle: {
                type: "string"
              },
              hook: {
                type: "string"
              },
              voiceoverScript: {
                type: "string"
              },
              visualDirection: {
                type: "string"
              },
              onScreenText: {
                type: "string"
              },
              cta: {
                type: "string"
              },
              estimatedDuration: {
                type: "string"
              },
              wordCount: {
                type: "number"
              }
            },
            required: [
              "videoTitle",
              "hook",
              "voiceoverScript",
              "visualDirection",
              "onScreenText",
              "cta",
              "estimatedDuration",
              "wordCount"
            ]
          }
        },
        required: ["script"]
      }
    };
  }

};