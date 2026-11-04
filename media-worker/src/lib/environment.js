// Environment identity for the worker. Production is the default and needs no new settings. A staging deployment
// must prove it is staging before it starts: its project and bucket must say so, it must name the only callback
// endpoints it may post to, and it must hold no paid AI keys. Each check fails closed, so a staging deployment
// with any of them missing refuses to start, and a production deployment cannot quietly use staging settings.

export const ENVIRONMENTS = Object.freeze(["production", "staging"]);

// Keys that would let a staging process call a paid AI service. Staging must not have them at all.
export const PAID_KEY_NAMES = Object.freeze(["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "PEXELS_API_KEY"]);

export function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function environmentOf(env) {
  const value = env.SAVANNAH_ENVIRONMENT || "production";
  if (ENVIRONMENTS.indexOf(value) === -1) {
    throw new Error("SAVANNAH_ENVIRONMENT must be production or staging.");
  }
  return value;
}

// Throws unless the environment is production, or it is staging and every staging check passes.
// Returns the callback allowlist (empty for production, which keeps its existing behaviour).
export function assertEnvironment(env) {
  const environment = environmentOf(env);
  const callbackAllowlist = parseList(env.CALLBACK_URL_ALLOWLIST);
  if (environment === "production") {
    if (env.MUSIC_MANIFEST_PATH) {
      throw new Error("Production must use the verified manifest, not MUSIC_MANIFEST_PATH.");
    }
    return { environment: environment, callbackAllowlist: callbackAllowlist };
  }
  if (!/staging/i.test(env.CLOUD_RUN_PROJECT || "")) {
    throw new Error("Staging requires a CLOUD_RUN_PROJECT whose name contains \"staging\".");
  }
  if (!/staging/i.test(env.GCS_BUCKET || "")) {
    throw new Error("Staging requires a GCS_BUCKET whose name contains \"staging\".");
  }
  if (callbackAllowlist.length === 0) {
    throw new Error("Staging requires CALLBACK_URL_ALLOWLIST: the only callback endpoints it may post to.");
  }
  const paid = PAID_KEY_NAMES.filter((name) => env[name]);
  if (paid.length > 0) {
    throw new Error("Staging must not hold paid AI keys; remove: " + paid.join(", "));
  }
  return { environment: environment, callbackAllowlist: callbackAllowlist };
}

// A callback is posted only if it starts with an allowed endpoint. An empty allowlist allows everything, which is
// only ever the production behaviour (assertEnvironment refuses staging without an allowlist).
export function callbackAllowed(callbackUrl, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some((prefix) => String(callbackUrl || "").indexOf(prefix) === 0);
}
