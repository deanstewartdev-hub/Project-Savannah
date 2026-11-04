// Environment identity for the worker. Production is the default and needs no new settings. A staging deployment
// must prove it is staging before it starts: its project and bucket must say so, it must name the only callback
// endpoints it may post to, and it must hold no paid AI keys. Each check fails closed, so a staging deployment
// with any of them missing refuses to start, and a production deployment cannot quietly use staging settings.

export const ENVIRONMENTS = Object.freeze(["production", "staging"]);

// Keys that would let a staging process call a paid AI service. Staging must not have them at all.
export const PAID_KEY_NAMES = Object.freeze(["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "PEXELS_API_KEY"]);

const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost"]);
const MAX_ENDPOINT_LENGTH = 2048;

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

// Turns one endpoint into its canonical form, or throws. Accepted: an https URL with a host, no credentials and no
// fragment, and no whitespace, control characters or backslashes. Plain http is accepted only for loopback, which
// is for local tests. The canonical form is WHATWG's href, so ports, dot segments and case are normalised before
// any comparison, and two URLs are the same endpoint only if their canonical forms are identical.
export function normalizeEndpoint(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ENDPOINT_LENGTH) {
    throw new Error("The endpoint must be a non-empty string of at most " + MAX_ENDPOINT_LENGTH + " characters.");
  }
  if (/[\s\\\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("The endpoint contains whitespace, a backslash or a control character.");
  }
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error("The endpoint is not a valid URL.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("The endpoint must not contain credentials.");
  }
  if (url.hash !== "") {
    throw new Error("The endpoint must not contain a fragment.");
  }
  if (url.hostname === "") {
    throw new Error("The endpoint must have a host.");
  }
  const loopback = LOOPBACK_HOSTS.indexOf(url.hostname) !== -1;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The endpoint must use https (http is allowed only for loopback tests).");
  }
  return url.href;
}

// Throws unless the environment is production, or it is staging and every staging check passes.
// Returns the callback allowlist as canonical endpoints (empty for production, which keeps its existing behaviour).
// An invalid allowlist entry is an error at startup, never silently ignored.
export function assertEnvironment(env) {
  const environment = environmentOf(env);
  const callbackAllowlist = parseList(env.CALLBACK_URL_ALLOWLIST).map(normalizeEndpoint);
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

// Exact endpoint matching. A callback is allowed only if its canonical form equals the canonical form of an allowlist
// entry. Prefix matching is never used: a prefix could be extended by a longer hostname, path or query. An empty
// allowlist allows everything, which is only the production behaviour (staging always has one, see assertEnvironment).
// A callback that cannot be normalised is refused, and an allowlist entry that cannot be normalised matches nothing.
export function callbackAllowed(callbackUrl, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  let canonical;
  try {
    canonical = normalizeEndpoint(callbackUrl);
  } catch (error) {
    return false;
  }
  return allowlist.some((entry) => {
    try {
      return normalizeEndpoint(entry) === canonical;
    } catch (error) {
      return false;
    }
  });
}
