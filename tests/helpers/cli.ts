import fs from "node:fs";
import path from "node:path";

/** Determine if the built CLI artifact exists (dist/cli.js) at repo root. */
export function isCliBuilt(): boolean {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const cliPath = path.join(repoRoot, "dist", "cli.js");
  return fs.existsSync(cliPath);
}

/**
 * Skip a test if CLI is not built. Accepts an optional Vitest context object
 * exposing a skip function. Returns true if the test was skipped (caller should return early).
 */
export function skipIfCliNotBuilt(ctx?: { skip: (why?: string) => void }): boolean {
  if (!isCliBuilt()) {
    const why = "CLI not built, skipping test";
    if (ctx?.skip) ctx.skip(why);
    else console.log(why);
    return true;
  }
  return false;
}
