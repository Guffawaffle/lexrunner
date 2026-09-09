import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

// Explicit caller-selected process. Never invoked by reading/resuming a trail.
export function captureProbe(command, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString(),
      begin = performance.now();
    const child = spawn(command[0], command.slice(1), {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const retained = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const counts = { stdout: 0, stderr: 0 };
    let termination;
    for (const name of ["stdout", "stderr"])
      child[name].on("data", (chunk) => {
        counts[name] += chunk.length;
        const remaining = 4096 - retained[name].length;
        if (remaining > 0)
          retained[name] = Buffer.concat([retained[name], chunk.subarray(0, remaining)]);
      });
    const timer = setTimeout(() => {
      termination = "timeout; direct child termination requested";
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      termination = `spawn_error:${error.code ?? "unknown"}`;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        cwd,
        startedAt,
        durationMs: performance.now() - begin,
        exitCode,
        stdout: retained.stdout.toString("utf8"),
        stderr: retained.stderr.toString("utf8"),
        stdoutBytes: counts.stdout,
        stderrBytes: counts.stderr,
        outputTruncated:
          counts.stdout > retained.stdout.length || counts.stderr > retained.stderr.length,
        ...(termination || signal ? { termination: termination ?? `signal:${signal}` } : {}),
      });
    });
  });
}
