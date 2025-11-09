/**
 * Path normalization utilities for cross-platform compatibility
 */

import path from 'path';
import os from 'os';

/**
 * Normalize path for current platform
 * 
 * - Converts backslashes to forward slashes on POSIX
 * - Resolves relative paths to absolute
 * - Expands ~ to home directory
 * 
 * @param inputPath - Raw path
 * @returns - Normalized absolute path
 */
export function normalizePath(inputPath: string): string {
  let normalized = inputPath;
  
  // Expand ~ to home directory
  if (normalized.startsWith('~')) {
    normalized = path.join(os.homedir(), normalized.slice(1));
  }
  
  // Resolve to absolute path
  normalized = path.resolve(normalized);
  
  // Convert to forward slashes on POSIX (consistent with Git)
  if (process.platform !== 'win32') {
    normalized = normalized.replace(/\\/g, '/');
  }
  
  return normalized;
}

/**
 * Check if path is WSL path (e.g., /mnt/c/...)
 */
export function isWSLPath(inputPath: string): boolean {
  return inputPath.startsWith('/mnt/') && /^\/mnt\/[a-z]\//.test(inputPath);
}

/**
 * Convert WSL path to Windows path
 * 
 * @example /mnt/c/Users/... -> C:\Users\...
 */
export function wslToWindowsPath(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (!match) return wslPath;
  
  const [, drive, rest = '/'] = match;
  return `${drive.toUpperCase()}:${rest.replace(/\//g, '\\')}`;
}

/**
 * Convert Windows path to WSL path
 * 
 * @example C:\Users\... -> /mnt/c/Users/...
 */
export function windowsToWSLPath(winPath: string): string {
  const match = winPath.match(/^([A-Z]):(\\.*)?$/);
  if (!match) return winPath;
  
  const [, drive, rest = '/'] = match;
  return `/mnt/${drive.toLowerCase()}${rest.replace(/\\/g, '/')}`;
}

/**
 * Ensure directory exists (create if missing)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  const fs = await import('fs/promises');
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if path is safe for artifact writes (no PR dirs)
 */
export function isSafeArtifactPath(inputPath: string): boolean {
  const normalized = normalizePath(inputPath).toLowerCase();
  return !normalized.includes('/pr-') && !normalized.includes('\\pr-');
}
