import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessTreeTerminationResult {
  method: "process-group" | "taskkill" | "direct-child";
  forceKilled: boolean;
  descendantsReaped: boolean;
}

interface ProcessTreeTerminationOptions {
  platform?: NodeJS.Platform;
  graceMs?: number;
  killGroup?: (pid: number, signal: NodeJS.Signals | 0) => void;
  runTaskkill?: (pid: number) => Promise<boolean>;
  wait?: (durationMs: number) => Promise<void>;
}

/** Terminate a gate's complete descendant tree and wait for cleanup. */
export async function terminateProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  options: ProcessTreeTerminationOptions = {}
): Promise<ProcessTreeTerminationResult> {
  const pid = child.pid;
  if (!pid) {
    child.kill("SIGKILL");
    return { method: "direct-child", forceKilled: true, descendantsReaped: true };
  }

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const reaped = await (options.runTaskkill ?? runTaskkill)(pid);
    return { method: "taskkill", forceKilled: true, descendantsReaped: reaped };
  }

  const killGroup = options.killGroup ?? process.kill.bind(process);
  const wait =
    options.wait ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
  const graceMs = options.graceMs ?? 500;
  let method: ProcessTreeTerminationResult["method"] = "process-group";
  try {
    killGroup(-pid, "SIGTERM");
  } catch {
    method = "direct-child";
    child.kill("SIGTERM");
  }
  await wait(graceMs);

  let alive = method === "process-group" ? groupExists(pid, killGroup) : false;
  let forceKilled = false;
  if (alive) {
    forceKilled = true;
    try {
      killGroup(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await wait(Math.min(graceMs, 500));
    alive = groupExists(pid, killGroup);
  }
  return { method, forceKilled, descendantsReaped: !alive };
}

function groupExists(
  pid: number,
  killGroup: (pid: number, signal: NodeJS.Signals | 0) => void
): boolean {
  try {
    killGroup(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runTaskkill(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve(false));
    killer.once("close", (code) => resolve(code === 0 || code === 128));
  });
}
