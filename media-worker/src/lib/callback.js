import { redactSecretParams } from "./sanitize.js";

// Apps Script web apps cannot read custom request headers in doPost — only the query
// string and the JSON body are visible server-side. Callback authentication is therefore
// carried entirely in callbackUrl's own query string (Apps Script embeds the shared
// secret there when it submits the job, and validates it again on the way back in).
// The worker treats callbackUrl as opaque and just POSTs the result to it.
//
// SAV-14: job-runner.js and routes/jobs.js both console.error() any error this throws,
// which reaches Cloud Run logs - so callbackUrl (and anything else that might contain
// the secret) must be redacted before it ever reaches a thrown Error's message, not
// just at the final logging call site.
// callbackSecret, when given, travels in the JSON body as `callbackSecret`. Apps Script
// doPost can read the body but not custom headers, and a body value is not written into the
// request URL that proxies and access logs record. Without it the payload is sent unchanged,
// so callbacks for renders submitted before this change still carry their URL secret.
export async function postCallback(callbackUrl, payload, callbackSecret) {
  const safeUrl = redactSecretParams(callbackUrl);
  const requestBody = callbackSecret ? { ...payload, callbackSecret } : payload;

  let response;
  try {
    response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
  } catch (networkError) {
    throw new Error(`Callback to ${safeUrl} could not be sent: ${redactSecretParams(networkError.message)}`);
  }

  const raw = await response.text().catch(() => "");

  // Apps Script's ContentService has no way to set a custom HTTP status code, so doPost
  // always answers 200 even when MediaWorkerCallbackService.handle() rejected the
  // callback (unauthorized, job not found, etc.) - response.ok alone can never catch
  // that. The body's own success field is the only real signal.
  if (!response.ok) {
    throw Object.assign(
      new Error(`Callback to ${safeUrl} failed (${response.status}): ${redactSecretParams(raw)}`),
      { httpStatus: response.status }
    );
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (parseError) {
    throw new Error(`Callback to ${safeUrl} returned a non-JSON response: ${redactSecretParams(raw)}`);
  }
  if (!body || body.success !== true) {
    const detail = (body && body.error) || raw;
    throw Object.assign(
      new Error(`Callback to ${safeUrl} was not accepted: ${redactSecretParams(String(detail))}`),
      { rejection: redactSecretParams(String(detail)) }
    );
  }
}

// Rejections that will never succeed on a resend (bad secret, malformed request).
// Everything else - network errors, 5xx/429/408, Apps Script HTML error pages,
// "busy; retry", a job not yet persisted, a transient Sheets failure - is retried.
// Resending is safe: Savannah ignores a callback for a render that is already
// terminal, so a duplicate delivery can never change a recorded result.
const PERMANENT_REJECTION = /unauthori[sz]ed|malformed|unknown or missing status|jobid is required/i;
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429]);

export function isRetryableCallbackError(error) {
  if (!error) return false;
  if (typeof error.httpStatus === "number") {
    return error.httpStatus >= 500 || RETRYABLE_HTTP_STATUS.has(error.httpStatus);
  }
  if (typeof error.rejection === "string") return !PERMANENT_REJECTION.test(error.rejection);
  return true; // network failure or non-JSON response
}

export const DEFAULT_CALLBACK_RETRY_DELAYS_MS = [2000, 10000, 30000];

// Bounded: at most 1 + delaysMs.length attempts (about 42s in total by default),
// well inside a Cloud Run Job's timeout. Throws the last error if all attempts fail.
export async function postCallbackWithRetry(callbackUrl, payload, options = {}) {
  const delays = options.delaysMs || DEFAULT_CALLBACK_RETRY_DELAYS_MS;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log || ((message) => console.warn(message));
  for (let attempt = 0; ; attempt++) {
    try {
      return await postCallback(callbackUrl, payload, options.callbackSecret);
    } catch (error) {
      if (attempt >= delays.length || !isRetryableCallbackError(error)) throw error;
      // error.message is already secret-redacted by postCallback.
      log(`Callback attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms: ${error.message}`);
      await sleep(delays[attempt]);
    }
  }
}
