/**
 * Temporary directory helpers for tests
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ulid } from 'ulid';

/**
 * Create a temporary directory for testing
 * Returns the absolute path to the directory
 */
export async function create(prefix: string = 'lex-test'): Promise<string> {
  const tmpBase = os.tmpdir();
  const dirName = `${prefix}-${ulid()}`;
  const tmpDir = path.join(tmpBase, dirName);

  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Create a temporary directory with initial files
 */
export async function createWithFiles(files: Record<string, string>): Promise<string> {
  const tmpDir = await create();

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    const dir = path.dirname(fullPath);

    // Ensure parent directory exists
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  return tmpDir;
}

/**
 * Clean up a temporary directory
 */
export async function cleanup(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup (directory might not exist)
    console.warn(`Failed to cleanup ${tmpDir}:`, error);
  }
}

/**
 * Read a file from a temporary directory
 */
export async function readFile(tmpDir: string, filePath: string): Promise<string> {
  const fullPath = path.join(tmpDir, filePath);
  return await fs.readFile(fullPath, 'utf-8');
}

/**
 * Write a file to a temporary directory
 */
export async function writeFile(
  tmpDir: string,
  filePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(tmpDir, filePath);
  const dir = path.dirname(fullPath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * Check if a file exists in a temporary directory
 */
export async function exists(tmpDir: string, filePath: string): Promise<boolean> {
  try {
    const fullPath = path.join(tmpDir, filePath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List files in a temporary directory
 */
export async function listFiles(tmpDir: string, pattern?: RegExp): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, basePath: string = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relativePath);
      } else {
        if (!pattern || pattern.test(relativePath)) {
          files.push(relativePath);
        }
      }
    }
  }

  await walk(tmpDir);
  return files;
}
