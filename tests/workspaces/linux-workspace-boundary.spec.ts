import { resolveWorkspaceBoundary } from "../../src/workspaces/workspace-boundary-resolver.js";
import { workspaceBoundaryConformance } from "./workspace-boundary-conformance.js";

workspaceBoundaryConformance("LinuxWorkspaceBoundary conformance", () => {
  const resolution = resolveWorkspaceBoundary({ mode: "native" });
  if (!resolution.ok || resolution.boundary.capability.backend_kind !== "linux-native") {
    throw new Error(
      "Linux WorkspaceBoundary conformance requires the verified native Linux backend"
    );
  }
  return resolution.boundary;
});
