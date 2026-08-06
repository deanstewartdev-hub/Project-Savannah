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

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Callback to ${callbackUrl} failed (${response.status}): ${detail}`);
  }
}
