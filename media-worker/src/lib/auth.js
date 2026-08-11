// Shared by both the legacy single-process server (routes/jobs.js) and the dispatcher
// (dispatcher.js), parameterized on the secret rather than reading config.js directly so
// it doesn't pull in the job-runner's required env vars just to be imported.
export function requireAuth(secret) {
  return function requireAuthMiddleware(req, res, next) {
    if (!secret) {
      next();
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
