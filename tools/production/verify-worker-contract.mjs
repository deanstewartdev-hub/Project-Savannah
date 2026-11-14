#!/usr/bin/env node
// Non-executing production contract check for the media-worker dispatcher.
//
// It confirms what a deployment is and what it is doing, and it proves that its submission routes refuse requests
// without starting anything. Every request it sends is one the dispatcher must refuse before it reads or writes job
// state, so no render can start, whatever the deployment's current settings. It never sends a body that could be
// accepted: each POST body is checked to be invalid by construction before it is sent.
//
// Required environment:
//   PRODUCTION_DISPATCHER_URL   base URL of the dispatcher, e.g. https://dispatcher.example.run.app
//   PRODUCTION_PROJECT_ID       the project the deployment must report (must not contain "staging")
//   PRODUCTION_SERVICE_NAME     the service the deployment must report (must not contain "staging")
//   PRODUCTION_SUBMIT_SECRET    the current submit secret (used only on requests that must still be refused)
//   EXPECT_SUBMISSIONS_PAUSED   "yes" or "no": the maintenance switch the deployment must report
//   EXPECT_REQUIRE_SUBMIT_INTENT  "yes" or "no": the intent switch the deployment must report
//
// Exit code 0 only when every check passes. The secret is never printed.

import { pathToFileURL } from "node:url";

const MUSIC_PROTOCOL = "verified-v1";

// Refuses to run against anything that does not name production, before any request is made.
export function identityProblems(env) {
  const problems = [];
  if (!env.PRODUCTION_DISPATCHER_URL) problems.push("PRODUCTION_DISPATCHER_URL is required.");
  if (!env.PRODUCTION_PROJECT_ID || !env.PRODUCTION_SERVICE_NAME) {
    problems.push("PRODUCTION_PROJECT_ID and PRODUCTION_SERVICE_NAME are required.");
  }
  if (/staging/i.test(env.PRODUCTION_PROJECT_ID || "") || /staging/i.test(env.PRODUCTION_SERVICE_NAME || "")) {
    problems.push("The expected identity names staging. This check is for production only.");
  }
  if (env.PRODUCTION_DISPATCHER_URL && /staging/i.test(env.PRODUCTION_DISPATCHER_URL)) {
    problems.push("The dispatcher URL names staging. This check is for production only.");
  }
  if (!env.PRODUCTION_SUBMIT_SECRET) problems.push("PRODUCTION_SUBMIT_SECRET is required.");
  for (const name of ["EXPECT_SUBMISSIONS_PAUSED", "EXPECT_REQUIRE_SUBMIT_INTENT"]) {
    if (env[name] !== "yes" && env[name] !== "no") problems.push(name + " must be \"yes\" or \"no\".");
  }
  return problems;
}

// A body the dispatcher must refuse: an empty beat list. Checked before every POST, so a later edit cannot make the
// check send a body that could start a render.
export function assertRefusedByConstruction(body) {
  const beatsEmpty = Array.isArray(body.beats) && body.beats.length === 0;
  if (!beatsEmpty) throw new Error("Internal check: a POST body in this contract check would not be refused. Not sent.");
  return body;
}

export async function runContractCheck(env, { log = console.log } = {}) {
  const problems = identityProblems(env);
  if (problems.length) {
    for (const problem of problems) log("REFUSED TO RUN: " + problem);
    return { ok: false, requests: 0 };
  }
  const base = env.PRODUCTION_DISPATCHER_URL.replace(/\/+$/, "");
  const results = [];
  let requests = 0;
  const check = (name, ok, detail) => { results.push({ name, ok }); log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + detail + ")" : "")); };

  // 1. Identity and switches, from the public health report.
  requests++;
  const healthResponse = await fetch(base + "/health");
  const health = healthResponse.status === 200 ? await healthResponse.json().catch(() => null) : null;
  check("health answers 200 with a report", !!health, "HTTP " + healthResponse.status);
  if (health) {
    check("the deployment is production", health.environment === "production", "environment " + health.environment);
    check("it reports the expected project and service",
      health.project === env.PRODUCTION_PROJECT_ID && health.service === env.PRODUCTION_SERVICE_NAME,
      "project " + health.project + ", service " + health.service);
    check("it speaks the verified music protocol", health.musicProtocol === MUSIC_PROTOCOL, "protocol " + health.musicProtocol);
    check("the maintenance switch is as expected",
      health.submissionsPaused === (env.EXPECT_SUBMISSIONS_PAUSED === "yes"),
      "submissionsPaused " + health.submissionsPaused);
    check("the intent switch is as expected",
      health.requireSubmitIntent === (env.EXPECT_REQUIRE_SUBMIT_INTENT === "yes"),
      "requireSubmitIntent " + health.requireSubmitIntent);
  }

  // 2. Submission routes refuse without a valid secret, and refuse invalid bodies with a valid one. None starts a render.
  const refused = async (name, path, headers, body, allowed) => {
    requests++;
    const response = await fetch(base + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify(body) });
    const ok = allowed.includes(response.status);
    check(name, ok, "HTTP " + response.status + ", expected one of " + allowed.join("/"));
  };
  const secret = { Authorization: "Bearer " + env.PRODUCTION_SUBMIT_SECRET };
  await refused("a submission without a secret is refused", "/jobs", {}, assertRefusedByConstruction({ beats: [] }), [401]);
  await refused("a submission with a wrong secret is refused", "/jobs", { Authorization: "Bearer wrong-secret-value" },
    assertRefusedByConstruction({ beats: [] }), [401]);
  await refused("a submission with a valid secret and an empty beat list is refused before any job starts", "/jobs", secret,
    assertRefusedByConstruction({ beats: [] }), [400, 503]);
  await refused("recovery with a valid secret and no job is refused before any job starts", "/jobs/recover", secret,
    assertRefusedByConstruction({ beats: [] }), [400, 503]);

  const passed = results.filter((entry) => entry.ok).length;
  log("");
  log("Production contract check (non-executing): " + passed + "/" + results.length + " passed, " + requests + " requests, none able to start a render.");
  return { ok: passed === results.length, requests };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runContractCheck(process.env).then((outcome) => {
    process.exitCode = outcome.ok ? 0 : 1;
  }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
