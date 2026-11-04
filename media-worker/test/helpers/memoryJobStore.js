// In-memory job state store with the same contract as storage.js's jobStateStore: create only if absent, replace
// only if the generation read is still current, and other errors thrown. failOn lets a test make a call throw,
// to model a Cloud Storage error.
export function createMemoryJobStore({ failOn = {} } = {}) {
  const objects = new Map();
  let generation = 0;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    objects,
    async read(path) {
      if (failOn.read) throw failOn.read;
      const entry = objects.get(path);
      return entry ? { value: copy(entry.value), generation: String(entry.generation) } : null;
    },
    async createIfAbsent(path, value) {
      if (failOn.create) throw failOn.create;
      if (objects.has(path)) return { ok: false, reason: "exists" };
      generation += 1;
      objects.set(path, { value: copy(value), generation: generation });
      return { ok: true };
    },
    async replaceIfGeneration(path, value, expectedGeneration) {
      if (failOn.replace) throw failOn.replace;
      const entry = objects.get(path);
      if (!entry || String(entry.generation) !== String(expectedGeneration)) return { ok: false, reason: "changed" };
      generation += 1;
      objects.set(path, { value: copy(value), generation: generation });
      return { ok: true };
    }
  };
}

export function storageError(code) {
  const error = new Error("simulated Cloud Storage error " + code);
  error.code = code;
  return error;
}
