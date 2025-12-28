/**
 * Token estimation utility for tracking context usage
 * Uses character-based heuristic (chars/4) for rough estimation
 */

/**
 * Estimate token count from text using chars/4 heuristic
 * This is a rough approximation suitable for directional data
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  // Simple heuristic: 1 token ≈ 4 characters
  // This is a rough approximation but sufficient for tracking trends
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a file by reading its contents
 *
 * @param filePath - Path to file
 * @param fs - File system module (injected for testability)
 * @returns Estimated token count
 */
export function estimateTokensFromFile(filePath: string, fs: any): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return estimateTokens(content);
  } catch (error) {
    // File doesn't exist or can't be read
    return 0;
  }
}

/**
 * Estimate tokens for multiple files
 *
 * @param filePaths - Array of file paths
 * @param fs - File system module (injected for testability)
 * @returns Object mapping file paths to token estimates
 */
export function estimateTokensFromFiles(filePaths: string[], fs: any): Record<string, number> {
  const results: Record<string, number> = {};

  for (const filePath of filePaths) {
    results[filePath] = estimateTokensFromFile(filePath, fs);
  }

  return results;
}
