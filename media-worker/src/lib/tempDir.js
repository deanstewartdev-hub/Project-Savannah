import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createJobWorkDir(jobId) {
  const dir = await mkdtemp(path.join(tmpdir(), `savannah-${jobId}-`));
  return {
    dir,
    path: (...segments) => path.join(dir, ...segments),
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

// Runs `run(workDir)` and always removes the work directory afterwards, whether the step succeeded,
// failed in a later stage, or failed before any paid step (for example a music preflight).
export async function withJobWorkDir(jobId, run, create = createJobWorkDir) {
  const workDir = await create(jobId);
  try {
    return await run(workDir);
  } finally {
    await workDir.cleanup();
  }
}
