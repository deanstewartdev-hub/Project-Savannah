import { readFileSync } from "node:fs";

// The verified music manifest ships inside the image (Dockerfile copies music/). The worker never
// trusts a track description sent in a job request, and the dispatcher checks requests against the
// same file before it starts any render job.
export const MUSIC_MANIFEST = JSON.parse(readFileSync(new URL("../../music/manifest.json", import.meta.url), "utf8"));
