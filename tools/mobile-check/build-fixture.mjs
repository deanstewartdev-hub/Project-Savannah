// Builds a local, static copy of the Production workspace for a phone-width check. It uses the real view
// markup, the real styles and the real page script. Only google.script.run is replaced, with sample data
// for two versions of one script: a legacy pair with no music record, or (--music) a pair where the newer
// version has a verified music record. No Apps Script, Cloud Run, Sheets or YouTube call is made.
//
// Usage: node tools/mobile-check/build-fixture.mjs <out.html> [--music] [--review]
//   --music   the newer version carries a verified music record, so the review step succeeds
//   --review  the page clicks "Review exact YouTube details" on the newer version, then reports the layout
//
// The output is a page and a wrapper "<name>-frame.html" that shows the page in a 375px-wide frame.
// Open the wrapper (with --allow-file-access-from-files) so the report can be written back to it.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const [outPath, ...flags] = process.argv.slice(2);
if (!outPath) throw new Error("usage: node tools/mobile-check/build-fixture.mjs <out.html> [--music] [--review]");
const withMusic = flags.includes("--music");
const autoReview = flags.includes("--review");

const STYLE_FILES = ["Variables", "Themes", "Typography", "Layout", "Components", "Utilities"]
  .map((name) => read(`Frontend/Assets/Styles/${name}.html`));
const SCRIPT_FILE = read("Frontend/Assets/Scripts/Production.html");
const VIEW_FILE = read("Frontend/Views/Production.html");

const SCRIPT_ID = "SCR-CHEFCHAOUEN";
const MUSIC = {
  id: "scott-buckley-beyond-these-walls", title: "Beyond These Walls", licence: "CC-BY-4.0",
  attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/"
};
const SEO = {
  id: "SEO-1", titleOptions: ["Chefchaouen: The Blue City in the Mountains"],
  description: "A short walk through the blue streets of Chefchaouen.", hashtags: ["travel", "morocco"], tags: ["travel", "morocco"]
};
const quality = { passed: true, actualDurationSeconds: 45, expectedDurationSeconds: 45, width: 1080, height: 1920, issues: [] };
const job = (version, id, requestPayload) => ({
  id, scriptId: SCRIPT_ID, seoPackId: "SEO-1", renderId: "cr-" + id, status: "SUCCEEDED", progress: 100,
  videoUrl: "https://example.test/" + id + ".mp4", seoPack: SEO, quality, review: { approved: true },
  publishingJob: null, publishingHistory: {}, requestPayload: requestPayload,
  createdAt: "2026-11-0" + version + "T10:00:00Z", updatedAt: "2026-11-0" + version + "T10:20:00Z"
});
const jobs = [
  job(1, "RND-B5AA0789", { version: 1 }),
  job(2, "RND-6907AE80", withMusic ? { version: 2, music: MUSIC } : { version: 2 })
];

// The page's own data. The preview function is written as page code, so it reads only what is embedded here.
const pageData = `
window.SAMPLE = {
  jobs: ${JSON.stringify(jobs)},
  music: ${JSON.stringify(MUSIC)},
  seo: ${JSON.stringify(SEO)}
};
window.FALLBACK = { success: true, data: { health: {}, jobs: [], tasks: [], items: [], schedule: {}, slots: [], connected: false } };
window.RESPONSES = {
  productionListJobs: { success: true, data: { health: {}, jobs: window.SAMPLE.jobs } },
  productionPreviewPublish: function (args) {
    var record = window.SAMPLE.jobs.filter(function (entry) { return entry.id === args.renderJobId; })[0];
    if (!record || !record.requestPayload.music) {
      return { success: false, error: { message: "This render has no verified music record, so it cannot be uploaded. Render it again with a verified track." } };
    }
    var description = window.SAMPLE.seo.description + "\\n\\nNarration in this video was generated using an AI voice.\\n\\nMusic: " +
      window.SAMPLE.music.attribution + "\\n\\n#travel #morocco";
    return { success: true, data: {
      title: args.title, description: description, tags: window.SAMPLE.seo.tags, privacyStatus: args.privacyStatus || "private",
      publishAt: args.publishAt || "", music: { id: window.SAMPLE.music.id, title: window.SAMPLE.music.title,
        licence: window.SAMPLE.music.licence, sourceUrl: window.SAMPLE.music.sourceUrl, credit: window.SAMPLE.music.attribution },
      metadataHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    } };
  }
};`;

// Stands in for google.script.run: each call answers from window.RESPONSES, asynchronously, like the server.
const runStub = `
(function () {
  window.__fixtureErrors = [];
  window.addEventListener("error", function (event) { window.__fixtureErrors.push(String(event.message) + " @" + event.lineno); });
  function makeRun() {
    var onSuccess = null;
    var api = new Proxy({}, { get: function (_, name) {
      if (name === "withSuccessHandler") return function (handler) { onSuccess = handler; return api; };
      if (name === "withFailureHandler") return function () { return api; };
      return function (args) {
        var answer = window.RESPONSES[name];
        var response = typeof answer === "function" ? answer(args || {}) : (answer || window.FALLBACK);
        setTimeout(function () { if (onSuccess) onSuccess(response); }, 0);
        return api;
      };
    } });
    return api;
  }
  window.google = { script: { run: new Proxy({}, { get: function (_, name) { return makeRun()[name]; } }) } };
})();`;

// Runs after the page script. Clicks the newer version's review button (when asked), waits for the page
// to settle, then writes the layout measurements into the parent document's report.
const report = `
(function () {
  function measure() {
    var viewport = window.innerWidth;
    var past = Array.prototype.slice.call(document.querySelectorAll("body *")).filter(function (el) {
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > viewport + 1;
    }).slice(0, 5).map(function (el) { return el.tagName + " right=" + Math.round(el.getBoundingClientRect().right); });
    var result = {
      pageErrors: (window.__fixtureErrors || []).slice(0, 5),
      viewportWidth: viewport,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalPageScroll: document.documentElement.scrollWidth > viewport,
      elementsPastViewport: past,
      compareVisible: !!document.querySelector("#production-compare .production-compare-panel, #production-compare video"),
      jobCards: document.querySelectorAll("#production-job-list .list-card").length,
      reviewButtons: document.querySelectorAll(".production-review-publish").length,
      reviewBox: !!document.querySelector(".production-review-box"),
      reviewText: Array.prototype.map.call(document.querySelectorAll(".production-publish-review"), function (el) { return el.textContent.trim(); }).filter(Boolean)[0] || "",
      approvalEnabled: !!document.querySelector(".production-approve-details:not([disabled])"),
      uploadEnabled: !!document.querySelector(".production-publish:not([disabled])")
    };
    var target = window.parent !== window ? window.parent.document : document;
    var pre = target.getElementById("fixture-report");
    if (!pre) { pre = target.createElement("pre"); pre.id = "fixture-report"; target.body.appendChild(pre); }
    pre.textContent = JSON.stringify(result, null, 2);
  }
  window.addEventListener("load", function () {
    setTimeout(function () {
      ${autoReview ? `var buttons = document.querySelectorAll(".production-review-publish");
      if (buttons.length) buttons[buttons.length - 1].click();
      setTimeout(function () { var shown = document.querySelector(".production-publish-review:not(:empty)"); if (shown) shown.scrollIntoView({ block: "start" }); }, 900);` : ""}
      setTimeout(measure, 1200);
    }, 800);
  });
})();`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Production fixture (${withMusic ? "music" : "legacy"}${autoReview ? ", reviewed" : ""})</title>
${STYLE_FILES.join("\n")}
</head>
<body>
<main style="padding:16px">
${VIEW_FILE}
</main>
<script>${pageData}</script>
<script>${runStub}</script>
${SCRIPT_FILE}
<script>${report}</script>
</body>
</html>
`;

writeFileSync(outPath, html);
const frameName = path.basename(outPath).replace(/\.html$/, "-frame.html");
const framePath = path.join(path.dirname(outPath), frameName);
// Headless Chrome cannot make a window narrower than about 500px, so the frame sets the width the page sees.
writeFileSync(framePath, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>375px check</title></head>
<body style="margin:0;background:#fff">
<iframe src="${path.basename(outPath)}" width="375" height="812" style="border:0;display:block"></iframe>
<pre id="fixture-report"></pre>
</body></html>
`);
console.log("wrote " + outPath + " and " + framePath + " (" + (withMusic ? "music" : "legacy") + (autoReview ? ", reviewed" : "") + ")");
