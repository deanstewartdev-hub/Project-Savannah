import { writeFile } from "node:fs/promises";
import { uploadFile, getSignedReadUrl } from "../lib/storage.js";

export async function deliverResult(jobId, { videoPath, probeResult, workDir }) {
  const videoDestination = `renders/${jobId}/final.mp4`;
  await uploadFile(videoPath, videoDestination, "video/mp4");

  const reportPath = workDir.path("probe-report.json");
  await writeFile(reportPath, JSON.stringify(probeResult, null, 2), "utf8");
  const reportDestination = `renders/${jobId}/probe-report.json`;
  await uploadFile(reportPath, reportDestination, "application/json");

  const videoUrl = await getSignedReadUrl(videoDestination);
  const reportUrl = await getSignedReadUrl(reportDestination);

  return {
    gcsPath: videoDestination,
    videoUrl,
    reportUrl
  };
}
