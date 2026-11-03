import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRenderJobAcceptsMusic, parseAllowedImages, MUSIC_PROTOCOL } from "../src/lib/renderJobGuard.js";

const GOOD_IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:aaaa";
const OLD_IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:bbbb";
const jobWith = (...images) => ({ template: { template: { containers: images.map((image) => ({ image })) } } });

test("the protocol marker is the one the main app checks for", () => {
  assert.equal(MUSIC_PROTOCOL, "verified-v1");
});

test("an empty allowlist refuses every render, so the default is fail-closed", async () => {
  await assert.rejects(
    assertRenderJobAcceptsMusic({ getJob: async () => jobWith(GOOD_IMAGE), allowedImages: [] }),
    (error) => error.code === "RENDER_IMAGE_NOT_ALLOWED" && /No render was started/.test(error.message)
  );
  await assert.rejects(assertRenderJobAcceptsMusic({ getJob: async () => jobWith(GOOD_IMAGE), allowedImages: undefined }), /RENDER_JOB_ALLOWED_IMAGES/);
});

test("a shared render job running an old image is refused, so no placeholder render is recorded as licensed", async () => {
  await assert.rejects(
    assertRenderJobAcceptsMusic({ getJob: async () => jobWith(OLD_IMAGE), allowedImages: [GOOD_IMAGE] }),
    (error) => error.code === "RENDER_IMAGE_NOT_ALLOWED" && /not running a music-verified image/.test(error.message)
  );
});

test("a job with more than one container is refused rather than guessed", async () => {
  await assert.rejects(
    assertRenderJobAcceptsMusic({ getJob: async () => jobWith(GOOD_IMAGE, OLD_IMAGE), allowedImages: [GOOD_IMAGE] }),
    /not running a music-verified image/
  );
});

test("a job with no containers or no image is refused", async () => {
  await assert.rejects(assertRenderJobAcceptsMusic({ getJob: async () => ({}), allowedImages: [GOOD_IMAGE] }), /not running/);
  await assert.rejects(assertRenderJobAcceptsMusic({ getJob: async () => jobWith(""), allowedImages: [GOOD_IMAGE] }), /not running/);
});

test("a job running an allowlisted image is accepted and its image is returned", async () => {
  const image = await assertRenderJobAcceptsMusic({ getJob: async () => jobWith(GOOD_IMAGE), allowedImages: [OLD_IMAGE, GOOD_IMAGE] });
  assert.equal(image, GOOD_IMAGE);
});

test("the allowlist setting is split on commas, trimmed and empty entries dropped", () => {
  assert.deepEqual(parseAllowedImages(" a , ,b ,"), ["a", "b"]);
  assert.deepEqual(parseAllowedImages(undefined), []);
});
