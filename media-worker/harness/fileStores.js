import fs from "node:fs";
import path from "node:path";

// File-backed stand-ins for the job-state store and the job-request storage. They keep the same contract as the Cloud
// Storage code (src/lib/jobStateStore.js and storage.js), and they survive between processes, so a request served by a
// fresh process still sees what earlier requests wrote. createIfAbsent publishes the file with a hard link, which fails
// when the name already exists, so two processes cannot both create the same object.
// Limit: replaceIfGeneration is not atomic across processes. The tests only replace an object from one process at a time.

function fileName(dir, objectPath, suffix) {
  return path.join(dir, encodeURIComponent(objectPath) + suffix);
}

export function createFileJobStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const load = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  return {
    async read(objectPath) {
      const entry = load(fileName(dir, objectPath, ".json"));
      return entry ? { value: entry.value, generation: String(entry.generation) } : null;
    },
    async createIfAbsent(objectPath, value) {
      const target = fileName(dir, objectPath, ".json");
      const temp = target + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
      fs.writeFileSync(temp, JSON.stringify({ generation: 1, value }));
      try {
        fs.linkSync(temp, target);
        return { ok: true };
      } catch (error) {
        if (error && error.code === "EEXIST") return { ok: false, reason: "exists" };
        throw error;
      } finally {
        fs.unlinkSync(temp);
      }
    },
    async replaceIfGeneration(objectPath, value, expectedGeneration) {
      const target = fileName(dir, objectPath, ".json");
      const entry = load(target);
      if (!entry || String(entry.generation) !== String(expectedGeneration)) return { ok: false, reason: "changed" };
      fs.writeFileSync(target, JSON.stringify({ generation: entry.generation + 1, value }));
      return { ok: true };
    }
  };
}

export function createFileStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (objectPath) => fileName(dir, objectPath, ".obj");
  return {
    uploadJson: async (objectPath, body) => { fs.writeFileSync(file(objectPath), JSON.stringify(body)); },
    downloadJson: async (objectPath) => JSON.parse(fs.readFileSync(file(objectPath), "utf8")),
    objectExists: async (objectPath) => fs.existsSync(file(objectPath)),
    deleteObject: async (objectPath) => { if (fs.existsSync(file(objectPath))) fs.unlinkSync(file(objectPath)); }
  };
}
