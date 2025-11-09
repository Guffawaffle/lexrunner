/**
 * Fingerprint generation and extraction utilities for idempotent updates
 */

import { sha256 } from '../util/hash.js';
import { canonicalJSONStringify } from '../util/canonicalJson.js';

/**
 * Generate deterministic fingerprint from content
 */
export function generateFingerprint(content: Record<string, any>): string {
	const canonicalJson = canonicalJSONStringify(content);
	return sha256(canonicalJson).substring(0, 16); // Use first 16 chars for brevity
}

/**
 * Extract fingerprint from text (looks for hidden HTML comment)
 */
export function extractFingerprint(text: string): string | null {
	const match = text.match(/<!-- fingerprint:([a-f0-9]{16}) -->/);
	return match ? match[1] : null;
}

/**
 * Inject fingerprint into text as hidden HTML comment
 */
export function injectFingerprint(text: string, fingerprint: string): string {
	// Add fingerprint at the end
	return `${text}\n\n<!-- fingerprint:${fingerprint} -->`;
}
