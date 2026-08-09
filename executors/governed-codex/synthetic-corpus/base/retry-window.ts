export function retryDelay(attempt: number, maximumMs: number): number {
  const boundedAttempt = Math.max(0, Math.min(attempt, 10));
  return Math.min(maximumMs, 100 * 2 ** boundedAttempt);
}
