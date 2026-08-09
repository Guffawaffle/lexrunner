import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WindowsProtectedEvidenceAuthority,
  defaultWindowsProtectedEvidenceRoot,
} from "../../src/store/windows-protected-evidence-authority.js";

const roots: string[] = [];
const windowsIt = process.platform === "win32" ? it : it.skip;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("WindowsProtectedEvidenceAuthority", () => {
  windowsIt("flushes directory metadata through a resident Win32 helper", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lexrunner-windows-evidence-"));
    roots.push(root);
    const authority = new WindowsProtectedEvidenceAuthority();
    await expect(authority.syncDirectory(root)).resolves.toBeUndefined();
    await expect(authority.attestRoot(root)).resolves.toBe(false);
    await authority.close();
  });

  windowsIt("will not replace the ACL on any path except the exact default root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lexrunner-windows-evidence-"));
    roots.push(root);
    const authority = new WindowsProtectedEvidenceAuthority();
    await expect(authority.provisionDefaultRoot(root)).rejects.toThrow(
      "Only the exact default protected-evidence root"
    );
    await authority.close();
  });

  windowsIt("selects a separate per-user protected-evidence root", () => {
    expect(defaultWindowsProtectedEvidenceRoot()).toBe(
      path.win32.join(process.env.LOCALAPPDATA!, "LexRunner", "protected-evidence", "stage1-v1")
    );
  });
});
