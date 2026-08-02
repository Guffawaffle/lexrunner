import { platform } from "node:os";

import { describe, expect, it } from "vitest";

import { resolveWorkspaceBoundary } from "../../src/workspaces/workspace-boundary-resolver.js";

describe("production WorkspaceBoundary resolution", () => {
  it("derives native routing from the actual host", () => {
    const resolution = resolveWorkspaceBoundary({ mode: "native" });

    if (platform() === "linux") {
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;
      expect(resolution.boundary.capability).toMatchObject({
        state: "ready",
        backend_kind: "linux-native",
        host: { platform: "linux", path_comparison: "case-sensitive" },
        backend: { transport: "in_process", implementation: "linux-directory-identity" },
      });
      return;
    }

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    if (platform() === "win32") {
      expect(resolution.decision).toMatchObject({
        state: "unavailable",
        reason_code: "helper_missing",
        backend_kind: "windows-native",
        host: { platform: "windows", path_comparison: "case-insensitive" },
        backend: { transport: "native_helper", signature: { status: "not_available" } },
      });
    } else {
      expect(resolution.decision).toMatchObject({
        state: "unsupported",
        reason_code: "unsupported_host",
        host: { platform: "other" },
      });
    }
  });

  it("keeps WSL projection explicit and unavailable until a profile adapter is supplied", () => {
    const native = resolveWorkspaceBoundary({ mode: "native" });
    const projection = resolveWorkspaceBoundary({
      mode: "explicit_projection",
      profile_id: "projection-profile-1",
    });

    expect(projection).toMatchObject({
      ok: false,
      decision: {
        selection: { mode: "explicit_projection", profile_id: "projection-profile-1" },
        backend_kind: "native-wsl-projection",
        state: "unavailable",
        reason_code: "projection_unavailable",
      },
    });
    expect(native.ok ? native.boundary.capability.selection : native.decision.selection).toEqual({
      mode: "native",
    });
  });

  it("rejects caller-supplied platform and backend routing fields", () => {
    expect(() =>
      resolveWorkspaceBoundary({
        mode: "native",
        platform: "linux",
        backend_kind: "linux-native",
      } as never)
    ).toThrow();
  });
});
