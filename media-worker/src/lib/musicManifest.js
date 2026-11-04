import { readFileSync } from "node:fs";

// The verified music manifest ships inside the image (Dockerfile copies music/). The worker never trusts a track
// description sent in a job request, and the dispatcher checks requests against the same file before it starts
// any render job.
//
// Staging alone may point at a separate manifest (MUSIC_MANIFEST_PATH, validated by environment.js). It holds only
// a synthetic test track, so staging tests never depend on, or claim, the real licensed track.
const path = process.env.MUSIC_MANIFEST_PATH || "music/manifest.json";
export const MUSIC_MANIFEST = JSON.parse(readFileSync(new URL("../../" + path, import.meta.url), "utf8"));
