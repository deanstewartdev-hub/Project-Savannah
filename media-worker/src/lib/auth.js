// Shared by both the legacy single-process server (routes/jobs.js) and the dispatcher
// (dispatcher.js), parameterized on the secret rather than reading config.js directly so
// it doesn't pull in the job-runner's required env vars just to be imported.
//
// Fails closed (SAV-13): both config.js and dispatcherConfig.js now require
// JOB_SUBMIT_SECRET to be present and well-formed, so `secret` here should never
// actually be empty in production - but if this were ever constructed with a
// missing/empty secret anyway (a future refactor, a different caller), every
// request must be rejected, never silently let through unauthenticated.
export function requireAuth(secret) {
  return function requireAuthMiddleware(req, res, next) {
    if (!secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (token !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
