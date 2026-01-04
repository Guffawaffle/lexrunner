/**
 * Generate deterministic failure IDs for test failures
 */

import { createHash } from "crypto";

/**
 * Canonicalize an error message by removing volatile values
 * that would make the same failure appear different across runs
 */
function canonicalizeMessage(message: string): string {
  if (!message) return "";

  let canonical = message;

  // Remove UUIDs first (before other patterns that might match parts)
  canonical = canonical.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "UUID"
  );

  // Remove timestamps (various formats) - limited to realistic ranges
  canonical = canonical.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "TIMESTAMP");
  canonical = canonical.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "TIMESTAMP");
  canonical = canonical.replace(/\d{13,16}\b/g, "TIMESTAMP"); // Unix ms timestamps (13-16 digits)

  // Remove ports
  canonical = canonical.replace(/:\d{4,5}\b/g, ":PORT");
  canonical = canonical.replace(/port \d{4,5}/gi, "port PORT");

  // Remove process IDs
  canonical = canonical.replace(/\bpid[:\s]+\d+/gi, "pid PID");
  canonical = canonical.replace(/\bprocess[:\s]+\d+/gi, "process PID");

  // Remove hex hashes (32+ chars)
  canonical = canonical.replace(/\b[0-9a-f]{32,}\b/gi, "HASH");

  // Remove memory addresses
  canonical = canonical.replace(/0x[0-9a-f]+/gi, "0xADDR");

  // Normalize whitespace
  canonical = canonical.replace(/\s+/g, " ").trim();

  return canonical;
}

/**
 * Generate a deterministic failure ID
 *
 * @param file - Test file path
 * @param name - Test name
 * @param errorType - Error type/name
 * @param message - Error message
 * @returns Deterministic hash string (same inputs → same output)
 */
export function generateFailureId(
  file: string,
  name: string,
  errorType: string = "",
  message: string = ""
): string {
  // Canonicalize the message to remove volatile values
  const canonicalMessage = canonicalizeMessage(message);

  // Combine inputs in a deterministic way
  const input = [file, name, errorType, canonicalMessage].join("|");

  // Generate SHA-256 hash
  const hash = createHash("sha256");
  hash.update(input);

  // Return first 16 chars for readability while maintaining uniqueness
  return hash.digest("hex").substring(0, 16);
}
