/**
 * Generate failure signatures for grouping similar failures
 */

/**
 * Scrub volatile values from error message to create a signature
 * that groups "same kind of failure" across runs
 *
 * @param message - Raw error message
 * @returns Normalized signature string
 */
export function generateSignature(message: string): string {
  if (!message) return "";

  let sig = message;

  // Remove UUIDs FIRST (before timestamps which might match part of UUID)
  sig = sig.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>");

  // Remove hex hashes (32+ chars) BEFORE timestamps
  sig = sig.replace(/\b[0-9a-f]{32,}\b/gi, "<hash>");

  // Remove timestamps (various formats) - limited to realistic ranges
  sig = sig.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<timestamp>");
  sig = sig.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<timestamp>");
  sig = sig.replace(/\d{13,16}\b/g, "<timestamp>"); // Unix timestamps (13-16 digits)

  // Remove ports
  sig = sig.replace(/:\d{4,5}\b/g, ":<port>");
  sig = sig.replace(/port \d{4,5}/gi, "port <port>");
  sig = sig.replace(/localhost:\d+/gi, "localhost:<port>");
  sig = sig.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");

  // Remove process IDs
  sig = sig.replace(/\bpid[:\s]+\d+/gi, "pid <pid>");
  sig = sig.replace(/\bprocess[:\s]+\d+/gi, "process <pid>");

  // Remove memory addresses
  sig = sig.replace(/0x[0-9a-f]+/gi, "0x<addr>");

  // Remove specific numeric values in common patterns
  sig = sig.replace(/\btimeout of \d+ms\b/gi, "timeout of <ms>ms");
  sig = sig.replace(/\bafter \d+ms\b/gi, "after <ms>ms");
  sig = sig.replace(/\bexpected \d+/gi, "expected <n>");
  sig = sig.replace(/\breceived \d+/gi, "received <n>");
  sig = sig.replace(/\bgot \d+/gi, "got <n>");

  // Remove file paths but keep structure
  sig = sig.replace(/\/[^\s:]+\/([^/\s:]+\.(ts|js|tsx|jsx))/g, ".../$1");

  // Normalize random strings (base64, alphanumeric hashes) - LAST to avoid false positives
  sig = sig.replace(/\b[A-Za-z0-9+/]{16,}={0,2}\b/g, "<random>");

  // Normalize whitespace
  sig = sig.replace(/\s+/g, " ").trim();

  return sig;
}
