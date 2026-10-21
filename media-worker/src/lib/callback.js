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
export async function postCallback(callbackUrl, payload) {
  const safeUrl = redactSecretParams(callbackUrl);

  let response;
  try {
    response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
    throw new Error(`Callback to ${safeUrl} failed (${response.status}): ${redactSecretParams(raw)}`);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (parseError) {
    throw new Error(`Callback to ${safeUrl} returned a non-JSON response: ${redactSecretParams(raw)}`);
  }
  if (!body || body.success !== true) {
    const detail = (body && body.error) || raw;
    throw new Error(`Callback to ${safeUrl} was not accepted: ${redactSecretParams(String(detail))}`);
  }
}
