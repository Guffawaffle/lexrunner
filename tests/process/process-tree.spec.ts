import { describe, expect, it, vi } from "vitest";

import { terminateProcessTree } from "../../src/process/process-tree.js";

describe("terminateProcessTree", () => {
  it("uses taskkill tree termination on Windows", async () => {
    const runTaskkill = vi.fn(async () => true);
    const child = { pid: 4321, kill: vi.fn(() => true) };

    const result = await terminateProcessTree(child as any, {
      platform: "win32",
      runTaskkill,
    });

    expect(runTaskkill).toHaveBeenCalledWith(4321);
    expect(result).toEqual({
      method: "taskkill",
      forceKilled: true,
      descendantsReaped: true,
    });
  });

  it("escalates a live POSIX process group and verifies it is gone", async () => {
    const signals: Array<NodeJS.Signals | 0> = [];
    let alive = true;
    const killGroup = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      signals.push(signal);
      if (signal === "SIGKILL") alive = false;
      if (signal === 0 && !alive) throw new Error("ESRCH");
    });

    const result = await terminateProcessTree({ pid: 123, kill: vi.fn(() => true) } as any, {
      platform: "linux",
      graceMs: 0,
      killGroup,
      wait: async () => undefined,
    });

    expect(signals).toEqual(["SIGTERM", 0, "SIGKILL", 0]);
    expect(result).toEqual({
      method: "process-group",
      forceKilled: true,
      descendantsReaped: true,
    });
  });
});
