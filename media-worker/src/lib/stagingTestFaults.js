// STAGING-ONLY test controls for the isolated staging render job (S5 and S7 in tools/staging/APPROVAL_PROPOSAL.md).
//
// Two switches, both off unless the job's environment sets them explicitly:
//   STAGING_FAIL_RENDER_AFTER_MUSIC=true        the render fails after synthetic music preparation (S7)
//   STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS=1|2    that many callback attempts are rejected before anything is
//                                               sent, so the existing retry routine must deliver (S5)
//
// They are read only by staging-job-runner.js. They refuse to start anything unless SAVANNAH_ENVIRONMENT is
// exactly "staging", so a production job that carried one of these variables would stop instead of running.
// The cap of 2 keeps at least one real delivery inside the retry schedule (three retries after the first try).

export const MAX_INJECTED_CALLBACK_FAILURES = 2;

export function stagingTestFaults(env) {
  const failRaw = env.STAGING_FAIL_RENDER_AFTER_MUSIC;
  const callbackRaw = env.STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS;
  const failRender = failRaw === undefined || failRaw === "" ? false : failRaw === "true" ? true : null;
  if (failRender === null) throw new Error("STAGING_FAIL_RENDER_AFTER_MUSIC must be exactly 'true' when set.");

  let failFirst = 0;
  if (callbackRaw !== undefined && callbackRaw !== "") {
    if (!/^[0-9]+$/.test(callbackRaw)) throw new Error("STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS must be a whole number.");
    failFirst = Number(callbackRaw);
    if (failFirst > MAX_INJECTED_CALLBACK_FAILURES) {
      throw new Error(`STAGING_FAIL_FIRST_CALLBACK_ATTEMPTS may be at most ${MAX_INJECTED_CALLBACK_FAILURES}.`);
    }
  }

  const requested = failRender || failFirst > 0;
  if (requested && env.SAVANNAH_ENVIRONMENT !== "staging") {
    throw new Error("Staging test faults are refused outside the staging environment.");
  }
  return {
    failRenderAfterMusic: failRender,
    callbackTestFaults: failFirst > 0 ? { failFirstAttempts: failFirst } : {}
  };
}
