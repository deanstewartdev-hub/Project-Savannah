// Guards against the 2026-08-18 incident: a Secret Manager value for OPENAI_API_KEY
// carried a trailing CR/LF, which node-fetch's Headers constructor rejected with
// "is not a legal HTTP header value" the instant the OpenAI client tried to build an
// Authorization header from it - after ElevenLabs narration had already run and been
// paid for. That failure surfaced deep inside the pipeline (pipeline/alignment.js),
// with a stack trace that briefly included the raw header value in Cloud Run logs.
//
// This validates security-sensitive token/key env vars at config-load time instead,
// so a malformed credential fails loudly and immediately at startup - before any
// paid provider call - with an error that never contains the credential itself.

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

function describeControlChar(char) {
  const code = char.charCodeAt(0);
  if (code === 10) return "an embedded LF (\\n)";
  if (code === 13) return "an embedded CR (\\r)";
  if (code === 9) return "an embedded TAB (\\t)";
  return `an embedded control character (0x${code.toString(16).padStart(2, "0")})`;
}

/**
 * Throws a descriptive, secret-free error if `value` is not a clean, directly
 * usable credential string. Never trims or otherwise silently repairs the value -
 * a malformed credential must fail explicitly, not be guessed at.
 *
 * @param {string} name Environment variable name, for the error message only.
 * @param {*} value The candidate credential value.
 */
export function assertSecretFormat(name, value) {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  if (value.length === 0) {
    throw new Error(`${name} is empty.`);
  }

  const controlMatch = CONTROL_CHAR_PATTERN.exec(value);
  if (controlMatch) {
    throw new Error(
      `${name} contains ${describeControlChar(controlMatch[0])}. ` +
        "Re-copy the credential without surrounding whitespace or newlines."
    );
  }

  if (/^\s/.test(value)) {
    throw new Error(`${name} contains leading whitespace. Re-copy the credential without surrounding whitespace or newlines.`);
  }
  if (/\s$/.test(value)) {
    throw new Error(`${name} contains trailing whitespace. Re-copy the credential without surrounding whitespace or newlines.`);
  }
}

/**
 * Reads a required security-sensitive env var and validates its format. Unlike a
 * plain `required()` helper, this can never resolve to an empty string: a missing
 * or empty value fails here, at config-load time, rather than letting downstream
 * code (e.g. requireAuth) receive a falsy secret and have to decide what that means.
 *
 * @param {string} name Environment variable name.
 * @return {string} The validated value.
 */
export function requireSecretEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  assertSecretFormat(name, value);
  return value;
}
