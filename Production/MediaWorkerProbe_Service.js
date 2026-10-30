/****************************************************
 * Project Savannah - bridge secret self-test (read-only).
 *
 * Sends a signed probe to the callback bridge's verify route and reports whether the bridge
 * accepts the main project's MEDIA_WORKER_SHARED_SECRET. The secret travels in the JSON body, never
 * the URL, and it is never returned or logged. The bridge writes nothing for this route.
 *
 * Deliberately a service object, not a top-level function: google.script.run cannot reach it, so the
 * web app has no route to it. Run it from the editor (owner only).
 ****************************************************/
const MediaWorkerProbeService = (() => {
  const EXEC_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

  function probeBridge(bridgeUrl) {
    const url = String(bridgeUrl || "").trim();
    if (!EXEC_URL_PATTERN.test(url)) {
      return { verified: false, reason: "The bridge URL must be its https /exec address with no query string." };
    }
    const secret = Secrets.getMediaWorkerSharedSecret();
    if (!secret) return { verified: false, reason: "The main project's shared secret is not configured." };

    const response = UrlFetchApp.fetch(url + "?route=verify", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ callbackSecret: String(secret) }),
      muteHttpExceptions: true,
      followRedirects: true
    });
    const status = response.getResponseCode();
    let body = null;
    try { body = JSON.parse(response.getContentText()); } catch (parseError) { body = null; }
    const verified = status === 200 && !!body && body.success === true && body.verified === true;
    // Report the outcome only: never the response text, which could echo a request.
    return { verified: verified, httpStatus: status, reason: verified ? "The bridge accepted the shared secret." : "The bridge did not accept the shared secret (HTTP " + status + ")." };
  }

  return { probeBridge: probeBridge };
})();
