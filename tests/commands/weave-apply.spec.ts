import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MergeApplicationServiceError } from "../../src/application/merge-application-service.js";
import { runWeaveApply } from "../../src/commands/weave.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("weave apply bounded errors", () => {
  it("projects a stable service failure to bounded AXError JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-weave-apply-"));
    roots.push(root);
    const planPath = join(root, "plan.json");
    await writeFile(
      planPath,
      `${JSON.stringify({ schemaVersion: "1.0.0", target: "main", items: [] })}\n`,
      "utf8"
    );

    const service = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          summary: {
            contract: "bounded-ax-v1",
            mode: "dry-run",
            dryRun: true,
            ok: true,
            status: "preview",
            totalItems: 0,
            levels: [],
            maxParallelism: 0,
            artifactRefs: [],
          },
        })
        .mockRejectedValueOnce(
          new MergeApplicationServiceError(
            "MERGE_STALE_INPUT",
            "Merge input is stale because the working tree is not clean"
          )
        ),
    };
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runWeaveApply(
        { plan: planPath, execute: true, skipGates: true, json: true },
        {
          jsonModeActive: () => false,
          getProgramOpts: () => ({}),
          mergeApplicationService: service,
        }
      )
    ).rejects.toMatchObject({ exitCode: 1 });

    const output = stderr.mock.calls
      .map(([value]) => String(value))
      .find((value) => value[0] === "{");
    expect(output).toBeDefined();
    expect(JSON.parse(output!)).toMatchObject({
      code: "MERGE_STALE_INPUT",
      context: { tool: "merge.apply" },
      message: "Merge input is stale because the working tree is not clean",
    });
    expect(Buffer.byteLength(output!, "utf8")).toBeLessThan(4_096);
  });
});
