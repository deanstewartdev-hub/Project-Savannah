/****************************************************
 * Project Savannah v1.3 - production error contract.
 ****************************************************/
const ProductionErrorService = (() => {
  const VERSION = "production-errors-v1.0";
  const OCCURRENCE_TTL_SECONDS = 60 * 60;

  const RULES = [
    {
      code: "PRODUCTION_UPLOAD_UNCERTAIN", category: "reconciliation", statusCode: 409,
      retryable: false, retryAfterSeconds: 0,
      pattern: /uncertain state|completion is unknown|check youtube studio/i,
      recoveryAction: "Check YouTube Studio for the video. Only confirm no upload after you have verified it is absent."
    },
    {
      code: "PRODUCTION_BUSY", category: "concurrency", statusCode: 409,
      retryable: true, retryAfterSeconds: 10,
      pattern: /another production action|already has an active render|already has an upload in progress|duplicate submission/i,
      recoveryAction: "Wait ten seconds, refresh Production, then retry the same action once."
    },
    {
      code: "PROVIDER_QUOTA_EXHAUSTED", category: "quota", statusCode: 402,
      retryable: false, retryAfterSeconds: 0,
      pattern: /trial credit|credits? (?:used|remaining|exhausted)|quota exceeded|insufficient quota|billing|payment required/i,
      recoveryAction: "Review the provider plan or quota before retrying. Savannah will not spend money automatically."
    },
    {
      code: "PROVIDER_RATE_LIMITED", category: "temporary", statusCode: 429,
      retryable: true, retryAfterSeconds: 60,
      pattern: /\b429\b|rate limit|too many requests/i,
      recoveryAction: "Wait one minute, then retry. Repeated retries immediately may extend the provider limit."
    },
    {
      code: "PROVIDER_AUTH_REQUIRED", category: "authorization", statusCode: 401,
      retryable: false, retryAfterSeconds: 0,
      pattern: /not connected|authorization|required scope|permission|oauth|unauthori[sz]ed|\b401\b|\b403\b/i,
      recoveryAction: "Reconnect the affected service in Settings or complete its one-time Google authorisation."
    },
    {
      code: "PROVIDER_TEMPORARILY_UNAVAILABLE", category: "temporary", statusCode: 503,
      retryable: true, retryAfterSeconds: 30,
      pattern: /timed? out|timeout|temporarily unavailable|network|fetch failed|\b502\b|\b503\b|\b504\b/i,
      recoveryAction: "Wait thirty seconds and retry. Prepared assets and saved job progress will be reused."
    },
    {
      code: "PRODUCTION_QUALITY_BLOCKED", category: "quality", statusCode: 422,
      retryable: false, retryAfterSeconds: 0,
      pattern: /quality check failed|below 1080|below 1920|not vertical|missing its model-ready visual brief|narration density|caption text.*exceeds/i,
      recoveryAction: "Review the listed quality issues, correct the affected scene or provider setting, then create a replacement render."
    },
    {
      code: "PRODUCTION_NOT_FOUND", category: "resource", statusCode: 404,
      retryable: false, retryAfterSeconds: 0,
      pattern: /was not found|no .* was found/i,
      recoveryAction: "Refresh the workspace. If the item is still missing, return to the previous workflow stage and recreate it."
    },
    {
      code: "PRODUCTION_DUPLICATE_PROTECTED", category: "duplicate", statusCode: 409,
      retryable: false, retryAfterSeconds: 0,
      pattern: /already (?:has|is|published)|completed render|cannot be re-rendered|preventing a duplicate/i,
      recoveryAction: "Use the existing render or upload. Choose the explicit replacement action only when a new version is intended."
    },
    {
      code: "PRODUCTION_INPUT_INVALID", category: "validation", statusCode: 422,
      retryable: false, retryAfterSeconds: 0,
      pattern: /required|invalid|only an approved|must be|all four scenes|can no longer|not valid for the current status/i,
      recoveryAction: "Correct the highlighted workflow requirement, refresh the page, and try again."
    }
  ];

  function normalise(caught, context) {
    const safeDetail = safeMessage_(caught);
    const rule = RULES.filter(function (candidate) {
      return candidate.pattern.test(safeDetail);
    })[0] || {
      code: "PRODUCTION_UNEXPECTED_ERROR",
      category: "internal",
      statusCode: 500,
      retryable: false,
      retryAfterSeconds: 0,
      recoveryAction: "Refresh Production and use the request ID when reviewing Logs. Do not repeat a publish action until its state is known."
    };
    return {
      code: rule.code,
      category: rule.category,
      message: safeDetail,
      recoveryAction: rule.recoveryAction,
      retryable: rule.retryable,
      retryAfterSeconds: rule.retryAfterSeconds,
      statusCode: rule.statusCode,
      provider: provider_(caught, safeDetail),
      context: String(context || "Production action").slice(0, 120),
      occurrenceCount: 1,
      repeated: false,
      contractVersion: VERSION
    };
  }

  function recordOccurrence(errorResult) {
    const result = Object.assign({}, errorResult || {});
    try {
      if (typeof CacheService === "undefined") return result;
      const cache = CacheService.getScriptCache();
      const key = "PROD_ERR_" + String(result.code || "UNKNOWN") + "_" +
        String(result.provider || "Savannah").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
      const count = Math.max(0, Number(cache.get(key) || 0)) + 1;
      cache.put(key, String(count), OCCURRENCE_TTL_SECONDS);
      result.occurrenceCount = count;
      result.repeated = count >= 3;
    } catch (ignored) {}
    return result;
  }

  function safeMessage_(caught) {
    return String(caught && caught.message || caught || "Unknown production error")
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/ig, "Bearer [REDACTED]")
      .replace(/[a-f0-9]{80,}/ig, "[REDACTED]")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  function provider_(caught, message) {
    const source = [caught && caught.name, message].join(" ");
    if (/creatomate/i.test(source)) return "Creatomate";
    if (/youtube/i.test(source)) return "YouTube";
    if (/openai|speech generation|image generation/i.test(source)) return "OpenAI";
    if (/drive|google/i.test(source)) return "Google";
    return "Savannah";
  }

  return { normalise: normalise, recordOccurrence: recordOccurrence };
})();
