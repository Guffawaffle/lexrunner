export function retryDelay(attempt: number, maximumMs: number): number {
  return Math.min(maximumMs, 100 * 2 ** attempt);
}
