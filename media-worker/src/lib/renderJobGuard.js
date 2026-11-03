// Mixed-version protection. The dispatcher and the shared render job are deployed separately, so a
// dispatcher that understands verified music could start a render job image that does not (it would
// silently play the placeholder bed while the caller records a licensed track). Two checks prevent it:
//
// 1. MUSIC_PROTOCOL is reported on /health. The main app refuses to submit unless the dispatcher reports
//    this protocol, so an older dispatcher never receives a render request from a newer main app.
// 2. Before a job is created, the render job's container image must be on an explicit allowlist of
//    music-verified images. Anything else (including an unset allowlist) is refused with no execution.
//
// Both checks fail closed. The functions take their Cloud Run call as a parameter so the refusal paths
// can be tested without Google Cloud.

export const MUSIC_PROTOCOL = "verified-v1";

export function parseAllowedImages(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// getJob() resolves to the Cloud Run Job resource. Returns the image it would run.
export async function assertRenderJobAcceptsMusic({ getJob, allowedImages }) {
  const allowed = Array.isArray(allowedImages) ? allowedImages.filter(Boolean) : [];
  if (allowed.length === 0) {
    const error = new Error("No music-verified render image is configured (RENDER_JOB_ALLOWED_IMAGES is empty). No render was started.");
    error.code = "RENDER_IMAGE_NOT_ALLOWED";
    throw error;
  }
  const job = await getJob();
  const containers = job && job.template && job.template.template && Array.isArray(job.template.template.containers)
    ? job.template.template.containers : [];
  const image = containers.length === 1 ? String(containers[0].image || "") : "";
  if (!image || allowed.indexOf(image) === -1) {
    const error = new Error("The shared render job is not running a music-verified image, so no render was started. Update the render job first.");
    error.code = "RENDER_IMAGE_NOT_ALLOWED";
    throw error;
  }
  return image;
}
