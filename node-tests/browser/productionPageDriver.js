// Runs in the top window of the built page. Each scenario opens the real Production page (markup and script) in its own
// iframe, with google.script.run mocked. Iframes share this origin's localStorage, so they stand in for two tabs, and a
// newly opened iframe stands in for a refresh. Results are written into #results. No server, no paid service.
(function () {
  const SCRIPT_ID = "SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef";
  const NARRATION = Array.from({ length: 110 }, function (_, i) { return "word" + i; }).join(" ") + ".";
  const out = document.getElementById("results");
  const frames = [];

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function until(check, timeoutMs) {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the page");
      await sleep(15);
    }
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
  }

  function clearStoredRequests() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { if (localStorage.key(i).indexOf("savannah.") === 0) keys.push(localStorage.key(i)); }
    keys.forEach(function (key) { localStorage.removeItem(key); });
  }

  function pageHtml(cfg) {
    return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>" + PAGE_MARKUP +
      "<script>window.__cfg = " + JSON.stringify(cfg) + ";<\/script>" +
      "<script>" + MOCK_SCRIPT + "<\/script>" +
      "<script>" + PAGE_SCRIPT + "<\/script></body></html>";
  }

  // One copy of the page. Resolves once its first lists have loaded.
  async function openPage(cfg) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:900px;height:600px;border:0;";
    frames.push(frame);
    frame.srcdoc = pageHtml(cfg);
    document.body.appendChild(frame);
    await new Promise(function (resolve) { frame.addEventListener("load", resolve, { once: true }); });
    await until(function () {
      const doc = frame.contentDocument;
      return doc && (doc.querySelector(".production-submit, .production-ready-retry, .production-new-version") || doc.querySelector(".empty-state"));
    }, 4000);
    await sleep(30);
    return frame;
  }

  function closeAll() { frames.splice(0).forEach(function (frame) { frame.remove(); }); }
  function clickFirst(frame, selector) {
    const element = frame.contentDocument.querySelector(selector);
    if (!element) throw new Error("no element matches " + selector);
    element.click();
  }
  function callsTo(frame, rpc) { return frame.contentWindow.__calls.filter(function (call) { return call.rpc === rpc; }); }
  async function settle() { await sleep(60); }
  function storedId(key) { return localStorage.getItem(key); }
  function isRequestId(value) { return typeof value === "string" && /^rq-[a-z0-9-]{8,}$/.test(value); }

  function readyItem(extra) {
    return Object.assign({
      script: { id: SCRIPT_ID, title: "The Most Photogenic Places on Earth", hook: "Test hook", scenes: [{ narration: NARRATION }] },
      existingJobs: [],
      seoPack: { id: "SEO-1" }
    }, extra || {});
  }
  function job(overrides) {
    return Object.assign({ id: "RND-FAILED-1", scriptId: SCRIPT_ID, renderId: "cr-11111111-2222-3333-4444-555555555555",
      status: "FAILED", errorMessage: "earlier attempt", videoUrl: "", requestPayload: { version: 1 } }, overrides || {});
  }
  const SUCCEEDED = job({ id: "RND-OK-1", status: "SUCCEEDED", videoUrl: "https://video.example/one.mp4", renderId: "cr-99999999-2222-3333-4444-555555555555", errorMessage: "" });

  const scenarios = [
    ["Create Short sends a request ID and clears it once the server accepts", async function () {
      clearStoredRequests();
      const frame = await openPage({ items: [readyItem()] });
      clickFirst(frame, ".production-submit");
      await settle();
      const calls = callsTo(frame, "productionSubmit");
      assertEqual(calls.length, 1, "one server call");
      assert(isRequestId(calls[0].args[0].clientRequestId), "a request ID is sent: " + JSON.stringify(calls[0].args[0]));
      assertEqual(calls[0].args[0].scriptId, SCRIPT_ID, "the script is named");
      assertEqual(storedId("savannah.submit." + SCRIPT_ID), null, "the ID is cleared after the server accepted");
    }],
    ["a double click sends one request (the button is disabled while it is in flight)", async function () {
      clearStoredRequests();
      const frame = await openPage({ items: [readyItem()] });
      clickFirst(frame, ".production-submit");
      clickFirst(frame, ".production-submit");
      await settle();
      assertEqual(callsTo(frame, "productionSubmit").length, 1, "one server call for two clicks");
    }],
    ["an unknown outcome keeps the request ID: a refresh and a second tab send the same ID, and nothing starts twice", async function () {
      clearStoredRequests();
      const first = await openPage({ items: [readyItem()], replies: { productionSubmit: [{ success: false, outcomeUnknown: true, error: { message: "Do not re-render" } }] } });
      clickFirst(first, ".production-submit");
      await settle();
      const firstId = callsTo(first, "productionSubmit")[0].args[0].clientRequestId;
      assert(isRequestId(firstId), "the first request has an ID");
      assertEqual(storedId("savannah.submit." + SCRIPT_ID), firstId, "the ID is kept after an unknown outcome");
      // A refresh is a new document: nothing in memory survives, only localStorage.
      first.remove();
      const refreshed = await openPage({ items: [readyItem()], replies: { productionSubmit: [{ success: true, data: { job: { id: "RND-OLD" }, duplicate: true } }] } });
      clickFirst(refreshed, ".production-submit");
      await settle();
      assertEqual(callsTo(refreshed, "productionSubmit")[0].args[0].clientRequestId, firstId, "the refreshed page resends the same ID");
      assertEqual(storedId("savannah.submit." + SCRIPT_ID), null, "the duplicate answer ends the request");
    }],
    ["a second tab with the same script shares the pending request ID", async function () {
      clearStoredRequests();
      const tabA = await openPage({ items: [readyItem()], replies: { productionSubmit: [{ success: false, outcomeUnknown: true, error: { message: "Do not re-render" } }] } });
      clickFirst(tabA, ".production-submit");
      await settle();
      const idA = callsTo(tabA, "productionSubmit")[0].args[0].clientRequestId;
      const tabB = await openPage({ items: [readyItem()] });
      clickFirst(tabB, ".production-submit");
      await settle();
      assertEqual(callsTo(tabB, "productionSubmit")[0].args[0].clientRequestId, idA, "tab B sends tab A's pending ID");
    }],
    ["a definite refusal clears the request ID, so the next click is a new request", async function () {
      clearStoredRequests();
      const frame = await openPage({ items: [readyItem()], replies: { productionSubmit: [{ success: false, error: { message: "This render request already failed" } }] } });
      clickFirst(frame, ".production-submit");
      await settle();
      const refused = callsTo(frame, "productionSubmit")[0].args[0].clientRequestId;
      assertEqual(storedId("savannah.submit." + SCRIPT_ID), null, "a refusal clears the ID");
      clickFirst(frame, ".production-submit");
      await settle();
      const next = callsTo(frame, "productionSubmit")[1].args[0].clientRequestId;
      assert(isRequestId(next) && next !== refused, "the next click has a new ID");
    }],
    ["a network failure (no answer at all) keeps the request ID for the replay", async function () {
      clearStoredRequests();
      const frame = await openPage({ items: [readyItem({ existingJobs: [SUCCEEDED] })],
        replies: { productionRenderNewVersion: [{ __failure: "Timeout" }] } });
      clickFirst(frame, ".production-new-version");
      await settle();
      const sent = callsTo(frame, "productionRenderNewVersion")[0].args[0];
      assertEqual(storedId("savannah.newVersion." + SCRIPT_ID), sent.clientRequestId, "a network failure keeps the ID");
    }],
    ["Render New Version: a duplicate answer says nothing new started, and the ID is cleared", async function () {
      clearStoredRequests();
      const frame = await openPage({ items: [readyItem({ existingJobs: [SUCCEEDED] })],
        replies: { productionRenderNewVersion: [{ success: true, data: { job: SUCCEEDED, duplicate: true } }] } });
      clickFirst(frame, ".production-new-version");
      await settle();
      const sent = callsTo(frame, "productionRenderNewVersion")[0].args[0];
      assert(isRequestId(sent.clientRequestId), "a request ID is sent");
      assertEqual(sent.confirmedMaxCostGbp, 1, "the cost confirmation is sent");
      assert(frame.contentWindow.__alerts.some(function (text) { return text.indexOf("No new render was started") === 0; }), "the owner is told nothing new started");
      assertEqual(storedId("savannah.newVersion." + SCRIPT_ID), null, "the ID is cleared");
    }],
    ["a failed render can be retried from the ready list with a request ID kept per job", async function () {
      clearStoredRequests();
      const failed = job({ id: "RND-FAILED-9" });
      const frame = await openPage({ items: [readyItem({ existingJobs: [failed] })], replies: { productionRetry: [{ success: false, outcomeUnknown: true, error: { message: "Do not re-render" } }] } });
      clickFirst(frame, ".production-ready-retry");
      await settle();
      const sent = callsTo(frame, "productionRetry")[0].args[0];
      assertEqual(sent.jobId, "RND-FAILED-9", "the failed job is named");
      assert(isRequestId(sent.clientRequestId), "a request ID is sent with the retry");
      assertEqual(storedId("savannah.retry.RND-FAILED-9"), sent.clientRequestId, "the retry keeps its ID for the job");
    }]
  ];

  async function runAll() {
    let passed = 0;
    const lines = [];
    for (const [name, run] of scenarios) {
      try {
        await run();
        passed++;
        lines.push("PASS " + name);
      } catch (error) {
        lines.push("FAIL " + name + ": " + error.message);
      } finally {
        closeAll();
      }
    }
    lines.push("");
    lines.push("Production page (browser, mocked server): " + passed + "/" + scenarios.length + " passed.");
    out.textContent = lines.join("\n");
    document.body.setAttribute("data-result", passed === scenarios.length ? "pass" : "fail");
  }

  window.addEventListener("load", function () { runAll(); });
})();
