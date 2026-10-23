/****************************************************
 * Project Savannah v1.4 - rendered video link lifetime.
 *
 * The media worker delivers GCS V4 signed URLs, which expire (7 days at most).
 * An expired link makes the YouTube upload fail with an opaque HTTP 400 and
 * breaks "View video". This service reads the expiry from the URL itself
 * (X-Goog-Date + X-Goog-Expires) and recognises a safe link refresh: the
 * worker's delivery recovery re-signing the SAME artifact for the same render.
 ****************************************************/
const VideoLinkService = (() => {
  // Leave time for the download and the YouTube upload to complete.
  const MIN_REMAINING_MS = 30 * 60 * 1000;

  // Milliseconds since epoch, or null when the URL is not a parseable V4 signed URL
  // (unsigned or public URLs have no expiry we can know about).
  function expiresAt(url) {
    const text = String(url || "");
    const date = /[?&]X-Goog-Date=(\d{8}T\d{6}Z)/i.exec(text);
    const seconds = /[?&]X-Goog-Expires=(\d+)/i.exec(text);
    if (!date || !seconds) return null;
    const d = date[1];
    const signedAt = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
      Number(d.slice(9, 11)), Number(d.slice(11, 13)), Number(d.slice(13, 15)));
    return isFinite(signedAt) ? signedAt + Number(seconds[1]) * 1000 : null;
  }

  function assertUsable(url, now) {
    const expiry = expiresAt(url);
    if (expiry === null) return;
    const current = typeof now === "number" ? now : Date.now();
    if (expiry - current < MIN_REMAINING_MS) {
      const error = new Error("The rendered video's download link " +
        (expiry <= current ? "expired on " : "expires too soon, on ") + new Date(expiry).toISOString() +
        ". No re-render is needed: re-sign the existing video with the media worker's delivery recovery " +
        "(media-worker/README.md, \"Delivery-only recovery\"), then upload again.");
      error.name = "VideoLinkExpired";
      throw error;
    }
  }

  // True when a "completed" callback only re-signs the artifact this render already
  // has: same render, same GCS object (renders/<renderId>/final.mp4), new https URL.
  function isSameArtifactRefresh(current, body) {
    if (!current || !body || current.status !== "SUCCEEDED" || body.status !== "completed") return false;
    const video = body.video && typeof body.video === "object" ? body.video : {};
    const stored = current.providerResponse && current.providerResponse.video || {};
    const expectedPath = "renders/" + current.renderId + "/final.mp4";
    const url = String(video.url || "").trim();
    return !!current.renderId && video.gcsPath === expectedPath && stored.gcsPath === expectedPath &&
      /^https:\/\/\S+$/i.test(url) && url !== current.videoUrl;
  }

  // Only the link fields change; status, probe evidence and review stay untouched.
  function refreshChanges(current, body) {
    const url = String(body.video.url).trim();
    const response = JSON.parse(JSON.stringify(current.providerResponse || {}));
    response.url = url;
    response.video = Object.assign({}, response.video || {}, { url: url });
    if (body.probe && body.probe.reportUrl && response.probe) response.probe.reportUrl = String(body.probe.reportUrl);
    response.linkRefreshedAt = new Date().toISOString();
    return { videoUrl: url, providerResponse: response };
  }

  return { expiresAt: expiresAt, assertUsable: assertUsable,
    isSameArtifactRefresh: isSameArtifactRefresh, refreshChanges: refreshChanges };
})();
