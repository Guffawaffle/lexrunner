import { describe, expect, it } from "vitest";

import { evaluateNodeRuntime } from "../src/application/workspace-config-services.js";
import { NODE_ENGINE_RANGE, NODE_RUNTIME_MAJOR } from "../src/runtime-contract.js";

describe("Node runtime contract", () => {
  it("publishes Node 24 as the floor without an artificial upper bound", () => {
    expect(NODE_RUNTIME_MAJOR).toBe(24);
    expect(NODE_ENGINE_RANGE).toBe(">=24");
    expect(evaluateNodeRuntime("v26.5.0")).toMatchObject({
      status: "no_constraint",
      required: ">=24",
    });
  });
});
