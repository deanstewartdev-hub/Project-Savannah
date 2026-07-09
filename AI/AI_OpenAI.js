/****************************************************
 * Project Savannah v1.0.1
 * OpenAI.gs
 * Purpose: OpenAI Responses API client
 ****************************************************/

function callOpenAI(options) {
  const apiKey = Secrets.getOpenAIApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key is missing. Use Project Savannah → Configure OpenAI API Key.");
  }

  const payload = buildOpenAIResponsesPayload(options);

  const response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("OpenAI API error " + statusCode + ": " + bodyText);
  }

  const body = JSON.parse(bodyText);
  const outputText = extractOpenAIOutputText(body);

  if (!outputText) {
    throw new Error("OpenAI returned no usable output text.");
  }

  let parsedJson;

  try {
    parsedJson = JSON.parse(outputText);
  } catch (err) {
    throw new Error("OpenAI response was not valid JSON: " + outputText);
  }

  return {
    success: true,
    provider: "OpenAI",
    model: options.model,
    data: parsedJson,
    usage: body.usage || {},
    raw: body
  };
}

function buildOpenAIResponsesPayload(options) {
  return {
    model: options.model || DEFAULT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: options.systemMessage || "You are Project Savannah. Return only structured JSON."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: options.prompt
          }
        ]
      }
    ],
    temperature: options.temperature || 0.8,
    max_output_tokens: options.maxTokens || 1200,
    text: {
      format: options.schema || Schemas.getVideoIdeasSchema()
    }
  };
}

function extractOpenAIOutputText(body) {
  if (body.output_text) {
    return body.output_text;
  }

  if (!body.output || !Array.isArray(body.output)) {
    return "";
  }

  for (let i = 0; i < body.output.length; i++) {
    const item = body.output[i];

    if (!item.content || !Array.isArray(item.content)) {
      continue;
    }

    for (let j = 0; j < item.content.length; j++) {
      const content = item.content[j];

      if (content.text) {
        return content.text;
      }
    }
  }

  return "";
}

function testOpenAIConnection() {
  const prompt = buildVideoIdeasPrompt(
    "Travel facts",
    "People who enjoy short educational videos",
    3
  );

  const response = callOpenAI({
    model: Settings.getModel(),
    prompt: prompt,
    temperature: Settings.getTemperature(),
    maxTokens: Settings.getMaxTokens(),
    responseFormat: "json",
    schema: Schemas.getVideoIdeasSchema()
  });

  Logger.log(JSON.stringify(response.data, null, 2));

  SpreadsheetApp.getUi().alert("OpenAI test complete. Check the execution log.");
}