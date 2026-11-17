// Serves ONE request with the real dispatcher HTTP app, in this process, then exits. The Apps Script harness calls it
// with spawnSync, because Apps Script's UrlFetchApp is synchronous. State is kept on disk in stateDir, so each request
// behaves as it would against a deployed worker. Standard input: { stateDir, config, manifest, request }.
// Standard output: { status, body } for the worker's answer. Every render start is appended to executions.log.
// Nothing here reaches Cloud Run: the job client is a fake that only counts starts.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { createFileJobStore, createFileStorage } from "./fileStores.js";

// The dispatcher logs to standard output. Standard output carries only the JSON answer, so logs go to standard error.
console.log = (...parts) => console.error(...parts);
console.info = (...parts) => console.error(...parts);

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { stateDir, config, manifest, request } = input;
const executionsLog = path.join(stateDir, "executions.log");

const jobsClient = {
  getJob: async () => [{ template: { template: { containers: [{ image: config.allowedRenderImages[0] }] } } }],
  runJob: async () => {
    fs.appendFileSync(executionsLog, "start\n");
    const count = fs.readFileSync(executionsLog, "utf8").split("\n").filter(Boolean).length;
    return [{ name: "operations/op-" + count, metadata: { name: "executions/ex-" + count } }];
  },
  checkRunJobProgress: async () => ({})
};

const app = createDispatcherApp({
  config,
  jobsClient,
  executionsClient: { getExecution: async () => [{}] },
  storage: createFileStorage(path.join(stateDir, "objects")),
  jobStore: createFileJobStore(path.join(stateDir, "state")),
  manifest,
  buildStatusResponse: async () => ({ status: 200, body: {} })
});

const server = app.listen(0, "127.0.0.1", () => {
  const body = request.body;
  const headers = Object.assign({ Connection: "close" }, request.headers || {});
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }
  const outgoing = http.request({ host: "127.0.0.1", port: server.address().port, method: request.method,
    path: request.path, headers, agent: false }, (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => {
      server.close(() => {
        fs.writeSync(1, JSON.stringify({ status: response.statusCode, body: text }));
        process.exit(0);
      });
    });
  });
  outgoing.on("error", (error) => {
    server.close(() => {
      fs.writeSync(2, String(error && error.message || error));
      process.exit(1);
    });
  });
  if (body !== undefined) outgoing.write(body);
  outgoing.end();
});
