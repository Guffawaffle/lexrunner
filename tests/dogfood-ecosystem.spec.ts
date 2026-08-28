import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VERSIONS,
  DOGFOOD_INSTALL_POLICY,
  assertExactPublishedVersions,
  assertRegistryOnlyPackageLock,
  inspectDogfoodRun,
  reapDogfoodRun,
} from "../scripts/dogfood-ecosystem.js";
import { computeCanonicalHash } from "../src/schemas/task-contract.js";
import { canonicalJSONStringify } from "../src/util/canonicalJson.js";

const temporaryRoots: string[] = [];
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("ecosystem dogfood allocation lifecycle", () => {
  it("defaults to the coordinated published ecosystem", () => {
    expect(DEFAULT_VERSIONS).toEqual({
      lex: "4.0.3",
      lexMcp: "4.0.3",
      axf: "2.1.1",
      lexsona: "2.0.2",
    });
  });

  it("forbids package lifecycle scripts during the credentialed registry install", () => {
    expect(DOGFOOD_INSTALL_POLICY).toEqual({
      network: "registry_only",
      registries: ["https://registry.npmjs.org/"],
      cache: "read_write",
      lifecycle_scripts: "forbidden",
    });
  });

  it("rejects non-exact package selections before installation", () => {
    expect(() => assertExactPublishedVersions(DEFAULT_VERSIONS)).not.toThrow();
    for (const version of [
      "^4.0.3",
      "latest",
      "npm:@smartergpt/lex@4.0.3",
      "file:../lex",
      "git+https://github.com/Guffawaffle/lex.git",
      "github:Guffawaffle/lex",
      "https://example.test/lex.tgz",
      "4.0.3-beta.1",
    ]) {
      expect(() => assertExactPublishedVersions({ lex: version })).toThrow("non_exact_version_lex");
    }
  });

  it("accepts only registry lock entries plus the staged LexRunner tarball", () => {
    const valid = {
      "": {},
      "node_modules/example": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/example/-/example-1.2.3.tgz",
        integrity: "sha512-example",
      },
      "node_modules/@smartergpt/lexrunner": {
        version: "1.5.2",
        resolved: "file:../../stage/smartergpt-lexrunner-1.5.2.tgz",
        integrity: "sha512-candidate",
      },
    };
    expect(assertRegistryOnlyPackageLock(valid, "https://registry.npmjs.org/")).toHaveLength(2);
    for (const resolved of [
      "https://example.test/package.tgz",
      "git+https://github.com/example/package.git",
      "file:../../outside.tgz",
    ]) {
      expect(() =>
        assertRegistryOnlyPackageLock(
          {
            ...valid,
            "node_modules/escape": { version: "1.0.0", resolved, integrity: "sha512-x" },
          },
          "https://registry.npmjs.org/"
        )
      ).toThrow("registry_lock_external_resolution");
    }
  });

  it("inspects compact status, exposes bounded diagnostics explicitly, and reaps idempotently", async () => {
    const { allocationRoot, runRoot } = await fixture();
    await expect(inspectDogfoodRun({ allocationRoot, runRoot })).resolves.toEqual({
      ok: true,
      runId: path.basename(runRoot),
      status: "interrupted",
      phase: "prepare",
      passed: 1,
      total: 1,
    });
    const diagnostic = await inspectDogfoodRun({ allocationRoot, runRoot, diagnostics: true });
    expect(diagnostic).toMatchObject({
      ok: true,
      versions: { "@smartergpt/lex": "4.0.0" },
      steps: [{ id: "prepare", outcome: "passed" }],
    });
    expect(JSON.stringify(diagnostic)).not.toContain(allocationRoot);

    await expect(reapDogfoodRun({ allocationRoot, runRoot })).resolves.toMatchObject({
      ok: true,
      outcome: "removed",
    });
    await expect(reapDogfoodRun({ allocationRoot, runRoot })).resolves.toEqual({
      ok: true,
      outcome: "absent",
    });
  });

  it("refuses cleanup outside a direct marked allocation child", async () => {
    const { allocationRoot, runRoot } = await fixture();
    await expect(reapDogfoodRun({ allocationRoot, runRoot: allocationRoot })).rejects.toThrow(
      "cleanup_containment_violation"
    );
    await expect(
      reapDogfoodRun({ allocationRoot, runRoot: path.join(runRoot, "nested") })
    ).rejects.toThrow("cleanup_containment_violation");
  });

  it("refuses symlinked run roots and forged ownership markers", async () => {
    const { allocationRoot, runRoot } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "lexrunner-dogfood-outside-"));
    temporaryRoots.push(outside);
    const link = path.join(allocationRoot, "run-link");
    await symlink(outside, link, directoryLinkType);
    await expect(reapDogfoodRun({ allocationRoot, runRoot: link })).rejects.toThrow(
      "allocation_not_directory"
    );

    const markerPath = path.join(runRoot, ".lexrunner-dogfood-allocation.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    marker.run_id = "forged";
    await writeFile(markerPath, `${canonicalJSONStringify(marker)}\n`);
    await expect(reapDogfoodRun({ allocationRoot, runRoot })).rejects.toThrow(
      "allocation_marker_mismatch"
    );
  });
});

async function fixture(): Promise<{ allocationRoot: string; runRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lexrunner-dogfood-test-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "alloc"));
  const actualAllocationRoot = await realpath(path.join(root, "alloc"));
  const runRoot = path.join(actualAllocationRoot, "run-test");
  await mkdir(runRoot);
  const runId = path.basename(runRoot);
  await writeFile(
    path.join(runRoot, ".lexrunner-dogfood-allocation.json"),
    `${canonicalJSONStringify({
      schema_version: 1,
      kind: "LexRunnerEcosystemDogfoodAllocation",
      run_id: runId,
      allocation_root_hash: hashText(actualAllocationRoot),
      created_at: "2026-07-20T10:00:00.000Z",
    })}\n`
  );
  const receiptWithoutHash = {
    schema_version: 1,
    kind: "LexRunnerEcosystemDogfoodReceipt",
    run_id: runId,
    status: "interrupted",
    phase: "prepare",
    allocation_root_hash: hashText(actualAllocationRoot),
    versions: { "@smartergpt/lex": "4.0.0" },
    steps: [{ id: "prepare", outcome: "passed", evidence_hash: hashText("passed") }],
    started_at: "2026-07-20T10:00:00.000Z",
    completed_at: "2026-07-20T10:01:00.000Z",
    error_code: "fault_after_prepare",
  };
  await writeFile(
    path.join(runRoot, "dogfood-receipt.json"),
    `${canonicalJSONStringify({
      ...receiptWithoutHash,
      receipt_hash: computeCanonicalHash(receiptWithoutHash),
    })}\n`
  );
  return { allocationRoot: actualAllocationRoot, runRoot };
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
