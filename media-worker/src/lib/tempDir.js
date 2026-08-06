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
