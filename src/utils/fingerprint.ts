/**
 * Fingerprint generation utilities for idempotent Issue updates
 */

import crypto from 'crypto';

/**
 * Generate deterministic fingerprint from spec content
 * 
 * @param data - Object to fingerprint (title, description, AC)
 * @returns - Hex string hash (SHA-256)
 */
export function generateFingerprint(data: Record<string, unknown>): string {
  // Sort keys for determinism
  const normalized = JSON.stringify(sortKeys(data));
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {} as any);
  }
  return obj;
}

/**
 * Extract fingerprint from Issue body (if present)
 * 
 * @param body - Issue body markdown
 * @returns - Fingerprint or null
 */
export function extractFingerprint(body: string): string | null {
  const match = body.match(/<!-- lex-pr-idea-fingerprint: ([a-f0-9]+) -->/);
  return match ? match[1] : null;
}

/**
 * Inject fingerprint comment into Issue body
 * 
 * @param body - Issue body markdown
 * @param fingerprint - Fingerprint hash
 * @returns - Body with fingerprint comment
 */
export function injectFingerprint(body: string, fingerprint: string): string {
  return `<!-- lex-pr-idea-fingerprint: ${fingerprint} -->\n\n${body}`;
}
