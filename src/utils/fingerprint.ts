/**
 * Fingerprint generation utilities for idempotent Issue updates
 */

import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'yaml';

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

/**
 * Generate deterministic SHA-256 fingerprint (alias for generateFingerprint)
 * 
 * @param data - Object to fingerprint
 * @returns - Hex string hash (SHA-256)
 */
export function fingerprint(data: Record<string, unknown>): string {
  return generateFingerprint(data);
}

/**
 * Verify fingerprint matches expected hash
 * 
 * @param data - Object to fingerprint
 * @param expectedFingerprint - Expected hash
 * @returns - true if fingerprint matches
 */
export function verifyFingerprint(data: Record<string, unknown>, expectedFingerprint: string): boolean {
  const actual = generateFingerprint(data);
  return actual === expectedFingerprint;
}

/**
 * Generate fingerprint from file content
 * Supports TS, JSON, YAML file types
 * 
 * @param filePath - Path to file
 * @returns - Hex string hash (SHA-256)
 */
export async function fingerprintFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.json') {
    const data = JSON.parse(content);
    return generateFingerprint(data);
  } else if (ext === '.yaml' || ext === '.yml') {
    const data = yaml.parse(content);
    return generateFingerprint(data);
  } else {
    // For TS/JS files and unknown types, hash the raw content
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
