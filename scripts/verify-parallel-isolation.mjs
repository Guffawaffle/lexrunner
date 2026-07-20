import { spawn } from "node:child_process";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repeat = parseRepeat(process.argv.slice(2));
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const results = [];

for (let ordinal = 1; ordinal <= repeat; ordinal += 1) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `lexrunner-isolation-${ordinal}-`));
  const started = Date.now();
  let child;
  try {
    child = spawn(process.execPath, [vitest, "run"], {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        TMPDIR: tempRoot,
        TMP: tempRoot,
        TEMP: tempRoot,
        NODE_DISABLE_COMPILE_CACHE: "1",
        TSX_DISABLE_CACHE: "1",
      },
      stdio: "ignore",
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const liveProcessGroup = process.platform !== "win32" && processGroupExists(child.pid);
    if (liveProcessGroup) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The process group may finish between observation and cleanup.
      }
    }
    const reapedToolCaches = await reapOwnedToolCaches(tempRoot);
    const leakedEntries = await readdir(tempRoot);
    results.push({
      ordinal,
      exitCode,
      liveProcessGroup,
      reapedToolCacheCount: reapedToolCaches.length,
      leakedEntryCount: leakedEntries.length,
      ...(leakedEntries.length > 0 ? { leakedEntries: leakedEntries.sort().slice(0, 32) } : {}),
      durationMs: Date.now() - started,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const ok = results.every(
  ({ exitCode, liveProcessGroup, leakedEntryCount }) =>
    exitCode === 0 && !liveProcessGroup && leakedEntryCount === 0
);
process.stdout.write(`${JSON.stringify({ ok, repeat, results })}\n`);
if (!ok) process.exitCode = 1;

function parseRepeat(argv) {
  const index = argv.indexOf("--runs");
  const value = index < 0 ? 2 : Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 2 || value > 10) {
    throw new TypeError("--runs must be an integer from 2 through 10");
  }
  return value;
}

function processGroupExists(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function reapOwnedToolCaches(tempRoot) {
  const entries = await readdir(tempRoot);
  const candidates = entries.filter((entry) => /^tsx-\d+$/u.test(entry));
  const removed = [];
  for (const entry of candidates) {
    const target = path.join(tempRoot, entry);
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    await rm(target, { recursive: true, force: false });
    removed.push(entry);
  }
  return removed;
}
