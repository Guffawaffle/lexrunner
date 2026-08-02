import { describe, expect, it } from "vitest";

import { resolveWorkspaceBoundary } from "../../src/workspaces/workspace-boundary-resolver.js";
import { workspaceBoundaryConformance } from "./workspace-boundary-conformance.js";

const resolution = resolveWorkspaceBoundary({ mode: "native" });

if (resolution.ok && resolution.boundary.capability.backend_kind === "linux-native") {
  const linuxBoundary = resolution.boundary;
  workspaceBoundaryConformance("LinuxWorkspaceBoundary conformance", () => linuxBoundary);
} else {
  describe("LinuxWorkspaceBoundary conformance", () => {
    it("does not select the Linux backend on the actual host", () => {
      const decision = resolution.ok ? resolution.boundary.capability : resolution.decision;
      expect(decision.backend_kind).not.toBe("linux-native");
    });

    it.skip("runs when production resolution selects linux-native", () => undefined);
  });
}
