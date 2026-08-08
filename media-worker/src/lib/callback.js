// Apps Script web apps cannot read custom request headers in doPost — only the query
// string and the JSON body are visible server-side. Callback authentication is therefore
// carried entirely in callbackUrl's own query string (Apps Script embeds the shared
// secret there when it submits the job, and validates it again on the way back in).
// The worker treats callbackUrl as opaque and just POSTs the result to it.
export async function postCallback(callbackUrl, payload) {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const raw = await response.text().catch(() => "");

  // Apps Script's ContentService has no way to set a custom HTTP status code, so doPost
  // always answers 200 even when MediaWorkerCallbackService.handle() rejected the
  // callback (unauthorized, job not found, etc.) - response.ok alone can never catch
  // that. The body's own success field is the only real signal.
  if (!response.ok) {
    throw new Error(`Callback to ${callbackUrl} failed (${response.status}): ${raw}`);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (parseError) {
    throw new Error(`Callback to ${callbackUrl} returned a non-JSON response: ${raw}`);
  }
  if (!body || body.success !== true) {
    const detail = (body && body.error) || raw;
    throw new Error(`Callback to ${callbackUrl} was not accepted: ${detail}`);
  }
}
