// Cloud Storage implementation of the job-state store contract (see jobState.js). It takes the bucket as a parameter,
// so the same code is tested against a fake bucket that races, and storage.js passes the real one.
//
// Consistency rules:
//   - read: the generation is read first, then exactly that generation's content is downloaded. If the object was
//     replaced in between, the download of the old generation fails (404) and the read is repeated. A read therefore
//     returns a value and the generation that wrote it, never content from one write with the number of another.
//   - write: create only if absent (ifGenerationMatch 0); replace only if the generation the caller read is still
//     current (ifGenerationMatch <generation>). A stale caller gets { ok: false }, never an overwrite.
// Storage errors other than these expected outcomes are thrown, so the caller fails closed.

const MAX_READ_ATTEMPTS = 3;

export function createJobStateStore(bucket) {
  return {
    async read(path) {
      for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt++) {
        const file = bucket.file(path);
        const [exists] = await file.exists();
        if (!exists) return null;
        let generation;
        try {
          const [metadata] = await file.getMetadata();
          generation = Number(metadata.generation);
        } catch (error) {
          if (error && error.code === 404) continue; // deleted between the two calls: look again
          throw error;
        }
        try {
          const [contents] = await bucket.file(path, { generation: generation }).download();
          return { value: JSON.parse(contents.toString("utf8")), generation: String(generation) };
        } catch (error) {
          if (error && error.code === 404) continue; // replaced between the two calls: read the new generation
          throw error;
        }
      }
      throw new Error("The job state kept changing during the read, so nothing was read consistently. Nothing was written.");
    },

    async createIfAbsent(path, value) {
      try {
        await bucket.file(path).save(JSON.stringify(value), {
          contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: 0 }
        });
        return { ok: true };
      } catch (error) {
        if (error && error.code === 412) return { ok: false, reason: "exists" };
        throw error;
      }
    },

    async replaceIfGeneration(path, value, generation) {
      try {
        await bucket.file(path).save(JSON.stringify(value), {
          contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: Number(generation) }
        });
        return { ok: true };
      } catch (error) {
        if (error && error.code === 412) return { ok: false, reason: "changed" };
        throw error;
      }
    }
  };
}
