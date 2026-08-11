import "dotenv/config";
import { getSignedReadUrl } from "./lib/storage.js";

// One-off/reusable diagnostic: proves the deployed identity (run via
// `gcloud run jobs execute savannah-render-job --args=src/test-sign-url.js,<gcsPath>`,
// so it uses the real render Job service account, not owner credentials) can generate
// and use a V4 signed read URL, without regenerating any render or calling a paid API.
// Never logs the query string - that's where the signature lives.

const gcsPath = process.argv[2];
if (!gcsPath) {
  console.error("Usage: node src/test-sign-url.js <gcsObjectPath>");
  process.exit(1);
}

try {
  const url = await getSignedReadUrl(gcsPath, 10 * 60 * 1000);
  const base = url.split("?")[0];
  console.log(`SIGN_TEST_OK base=${base}`);
  const response = await fetch(url, { method: "HEAD" });
  console.log(`SIGN_TEST_FETCH_STATUS=${response.status}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`SIGN_TEST_FAILED: ${error.message}`);
  process.exit(1);
}
