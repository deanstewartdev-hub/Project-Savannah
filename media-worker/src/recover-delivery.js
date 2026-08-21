import "dotenv/config";
import { downloadJson, getSignedReadUrl } from "./lib/storage.js";
import { postCallback } from "./lib/callback.js";
import { redactSecretParams } from "./lib/sanitize.js";

// One-time/reusable delivery-only recovery: for a job whose render (narration through
// FFmpeg assembly through probe) already succeeded and whose final.mp4/probe-report.json
// already exist in GCS, but whose delivery (signed URL) or callback failed - re-signs the
// existing artifacts and re-sends the callback. Never calls OpenAI, ElevenLabs, Pexels, or
// FFmpeg, and never uploads anything - only reads what's already in GCS from the original
// successful run and re-signs it.
//
// CALLBACK_URL must be the production /exec callback URL (with its embedded shared
// secret) - never logged here, since callback.js's own error messages embed it verbatim
// on failure and that would otherwise leak into Cloud Logging.

const jobId = process.argv[2];
const callbackUrl = process.env.CALLBACK_URL;

if (!jobId) {
  console.error("Usage: node src/recover-delivery.js <jobId> (with CALLBACK_URL env var set)");
  process.exit(1);
}
if (!callbackUrl) {
  console.error("CALLBACK_URL env var is required");
  process.exit(1);
}

const videoDestination = `renders/${jobId}/final.mp4`;
const reportDestination = `renders/${jobId}/probe-report.json`;

let payload;
try {
  const probeResult = await downloadJson(reportDestination);

  const gatesPassed = Boolean(
    probeResult.passesResolutionGate && probeResult.passesSilenceGate && probeResult.passesBlackFrameGate
  );
  console.log(`RECOVERY: probe gates passed=${gatesPassed}`);
  if (!gatesPassed) {
    console.error("RECOVERY_ABORTED: existing probe result did not pass all quality gates - refusing to deliver");
    process.exit(1);
  }

  const videoUrl = await getSignedReadUrl(videoDestination);
  const reportUrl = await getSignedReadUrl(reportDestination);
  console.log("RECOVERY: signed URLs generated for existing artifacts (not regenerated, not logged)");

  payload = {
    jobId,
    status: "completed",
    video: {
      url: videoUrl,
      gcsPath: videoDestination,
      durationSeconds: probeResult.durationSeconds,
      width: probeResult.width,
      height: probeResult.height
    },
    probe: {
      ...probeResult,
      reportUrl
    }
  };
} catch (error) {
  console.error(`RECOVERY_PREP_FAILED: ${redactSecretParams(error.message)}`);
  process.exit(1);
}

try {
  await postCallback(callbackUrl, payload);
  console.log(`RECOVERY_OK: callback delivered for ${jobId}`);
  process.exit(0);
} catch (error) {
  console.error(`RECOVERY_CALLBACK_FAILED: ${redactSecretParams(error.message)}`);
  process.exit(1);
}
