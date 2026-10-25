import { createHash, timingSafeEqual } from "node:crypto";

// Shared by both the legacy single-process server (routes/jobs.js) and the dispatcher
// (dispatcher.js), parameterized on the secret rather than reading config.js directly so
// it doesn't pull in the job-runner's required env vars just to be imported.
//
// Fails closed (SAV-13): both config.js and dispatcherConfig.js now require
// JOB_SUBMIT_SECRET to be present and well-formed, so `secret` here should never
// actually be empty in production - but if this were ever constructed with a
// missing/empty secret anyway (a future refactor, a different caller), every
// request must be rejected, never silently let through unauthenticated.
//
// `secret` may also be an array (current secret first, then an optional previous one)
// so JOB_SUBMIT_SECRET can be rotated without a window where the dispatcher and Apps
// Script disagree: during a rotation both values are accepted, then the previous one is
// removed. Empty entries are ignored; an array with no usable entry still fails closed.
export function requireAuth(secret) {
  const accepted = (Array.isArray(secret) ? secret : [secret]).filter((value) => typeof value === "string" && value.length > 0);
  return function requireAuthMiddleware(req, res, next) {
    if (accepted.length === 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    // Every accepted secret is compared (no early exit) so timing doesn't reveal which
    // one matched or how much of either prefix was right.
    let matched = false;
    for (const value of accepted) {
      if (token !== null && constantTimeEquals(token, value)) matched = true;
    }
    if (!matched) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

// Hashing both sides first gives equal-length buffers, so timingSafeEqual never throws
// and the comparison time doesn't depend on the candidate's length either.
function constantTimeEquals(a, b) {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
