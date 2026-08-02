import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, onTestFinished } from "vitest";

import type { WorkspaceBoundary } from "../../src/workspaces/workspace-boundary.js";

export function workspaceBoundaryConformance(
  name: string,
  createBoundary: () => WorkspaceBoundary
): void {
  describe(name, () => {
    let repositoryRoot: string;
    let allocationRoot: string;

    beforeEach(async () => {
      const sandbox = await mkdtemp(join(tmpdir(), "lexrunner-boundary-conformance-"));
      onTestFinished(() => rm(sandbox, { recursive: true, force: true }));
      repositoryRoot = join(sandbox, "repository");
      allocationRoot = join(sandbox, "allocation");
      await mkdir(join(repositoryRoot, ".git"), { recursive: true });
      await mkdir(allocationRoot);
    });

    it("binds roots, child operations, file I/O, process paths, and receipts to one lease", async () => {
      const acquired = await acquire(createBoundary(), repositoryRoot, allocationRoot, "lease-1");
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      const { lease } = acquired;
      const repository = lease.root("repository");
      const allocation = lease.root("allocation");

      expect(lease.acquired).toMatchObject({
        orchestration_lease_id: "lease-1",
        orchestration_lease_revision: 7,
        owner_id: "owner-1",
        backend_kind: "linux-native",
        phase: "acquired",
      });
      expect(repository.identity).toMatchObject({
        backend_kind: "linux-native",
        identity_kind: "linux-device-inode",
        canonical_path: repositoryRoot,
      });
      expect(JSON.stringify(repository)).not.toMatch(/(?:procPath|\/proc\/|"fd"|directory)/u);

      const git = await lease.openChild(repository, ".git", "open-git");
      expect(git.ok).toBe(true);
      if (!git.ok) return;
      const created = await lease.createChild(allocation, "attempt-1", "create-attempt");
      expect(created).toMatchObject({
        ok: true,
        receipt: {
          operation_id: "create-attempt",
          operation: "create-child",
          mutation: true,
          outcome: "completed",
          durability: "not_requested",
        },
      });
      if (!created.ok) return;

      const written = await lease.writeFile({
        operationId: "write-marker",
        directory: git.value,
        component: "marker.json",
        content: Buffer.from('{"owned":true}\n', "utf8"),
        exclusive: true,
      });
      expect(written).toMatchObject({
        ok: true,
        receipt: {
          operation_id: "write-marker",
          operation: "write-owned-file",
          mutation: true,
        },
      });
      const read = await lease.readFile({
        operationId: "read-marker",
        directory: git.value,
        component: "marker.json",
        maxBytes: 1_024,
      });
      expect(read.ok && Buffer.from(read.value).toString("utf8")).toBe('{"owned":true}\n');

      const processResult = await lease.runProcess({
        operationId: "process-path",
        executable: process.execPath,
        args: [
          { kind: "literal", value: "-e" },
          {
            kind: "literal",
            value: "process.stdout.write(require('node:fs').realpathSync(process.argv[1]))",
          },
          { kind: "directory", directory: created.value },
        ],
        cwd: repository,
        timeoutMs: 10_000,
      });
      expect(processResult.ok).toBe(true);
      if (processResult.ok) {
        expect(processResult.value).toMatchObject({
          ok: true,
          stdout: created.value.identity.canonical_path,
        });
        expect(processResult.receipt).toMatchObject({
          operation_id: "process-path",
          operation: "spawn-process",
          backend_kind: "linux-native",
        });
      }

      const cwdRelativeResult = await lease.runProcess({
        operationId: "process-cwd-relative",
        executable: process.execPath,
        args: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: "process.stdout.write(process.argv[1])" },
          {
            kind: "directory",
            directory: repository,
            prefix: "cwd=",
            relativeToCwd: true,
          },
        ],
        cwd: repository,
        timeoutMs: 10_000,
      });
      expect(cwdRelativeResult.ok && cwdRelativeResult.value).toMatchObject({
        ok: true,
        stdout: "cwd=.",
      });
      const mismatchedCwdRelativeResult = await lease.runProcess({
        operationId: "process-cwd-relative-mismatch",
        executable: process.execPath,
        args: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: "process.exit(99)" },
          { kind: "directory", directory: created.value, relativeToCwd: true },
        ],
        cwd: repository,
        timeoutMs: 10_000,
      });
      expect(mismatchedCwdRelativeResult).toMatchObject({
        ok: false,
        error: { reason_code: "invalid_path" },
        receipt: { operation_id: "process-cwd-relative-mismatch", mutation: false },
      });

      const asserted = await lease.assertCurrent(
        [repository, allocation, created.value],
        "assert-current"
      );
      expect(asserted).toMatchObject({ ok: true, value: expect.any(Array) });
      expect(asserted.ok && asserted.value).toHaveLength(3);
      await expect(lease.close("completed")).resolves.toMatchObject({ phase: "released" });
    });

    it("rejects foreign and stale capabilities with no-effect receipts", async () => {
      const first = await acquire(createBoundary(), repositoryRoot, allocationRoot, "lease-a");
      const second = await acquire(createBoundary(), repositoryRoot, allocationRoot, "lease-b");
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const foreign = await first.lease.openChild(
        second.lease.root("repository"),
        ".git",
        "foreign-capability"
      );
      expect(foreign).toMatchObject({
        ok: false,
        error: { code: "identity_changed", effect_state: "no_effect" },
        receipt: { outcome: "rejected", operation_id: "foreign-capability" },
      });

      const staleRoot = first.lease.root("repository");
      await first.lease.close("cancelled");
      const stale = await first.lease.assertCurrent([staleRoot], "stale-capability");
      expect(stale).toMatchObject({
        ok: false,
        error: { code: "identity_changed", effect_state: "no_effect" },
        receipt: { outcome: "rejected", operation_id: "stale-capability" },
      });
      await second.lease.close("completed");
    });

    it("classifies a duplicate exclusive mutation as rejected with no effect", async () => {
      const acquired = await acquire(createBoundary(), repositoryRoot, allocationRoot, "lease-2");
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      const git = await acquired.lease.openChild(
        acquired.lease.root("repository"),
        ".git",
        "open-git-duplicate"
      );
      expect(git.ok).toBe(true);
      if (!git.ok) return;
      const request = {
        directory: git.value,
        component: "exclusive.txt",
        content: Buffer.from("owned", "utf8"),
        exclusive: true,
      } as const;
      expect(
        await acquired.lease.writeFile({ ...request, operationId: "write-first" })
      ).toMatchObject({
        ok: true,
      });
      expect(
        await acquired.lease.writeFile({ ...request, operationId: "write-duplicate" })
      ).toMatchObject({
        ok: false,
        error: { effect_state: "no_effect" },
        receipt: { outcome: "rejected", durability: "not_applicable" },
      });
      await acquired.lease.close("completed");
    });
  });
}

function acquire(
  boundary: WorkspaceBoundary,
  repositoryRoot: string,
  allocationRoot: string,
  orchestrationLeaseId: string
) {
  return boundary.acquire({
    operationId: `acquire-${orchestrationLeaseId}`,
    orchestrationLeaseId,
    orchestrationLeaseRevision: 7,
    ownerId: "owner-1",
    roots: [
      { role: "repository", absolutePath: repositoryRoot },
      { role: "allocation", absolutePath: allocationRoot },
    ],
  });
}
