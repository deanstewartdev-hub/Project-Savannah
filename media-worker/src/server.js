import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { jobsRouter } from "./routes/jobs.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));
app.use(jobsRouter);

app.listen(config.port, () => {
  console.log(`savannah-media-worker listening on port ${config.port}`);
});
