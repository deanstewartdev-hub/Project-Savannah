// Shared by callback.js and recover-delivery.js. Apps Script's callback URL carries the
// shared callback secret in its own query string (?route=media-worker-callback&secret=...)
// because Apps Script's doPost can't read custom headers - so that URL, and any error text
// that might embed it, must never be logged or thrown verbatim (SAV-14).
export function redactSecretParams(text) {
  return String(text || "").replace(/secret=[^&\s]+/gi, "secret=<redacted>");
}
