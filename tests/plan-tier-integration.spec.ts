/**
 * Plan Command Tier Integration Tests
 *
 * Tests tier assignment during plan generation
 */

import { describe, it, expect } from "vitest";
import { generatePlan } from "../src/core/plan.js";
import type { InputConfig } from "../src/core/inputs.js";

describe("Plan Generation with Tiers", () => {
  it("should assign tiers to plan items during generation", () => {
    const inputs: InputConfig = {
      target: "main",
      items: [
        {
          id: "PR-1",
          name: "PR-1",
          deps: [],
          gates: [
            {
              name: "lint",
              run: "npm run lint",
            },
          ],
        },
        {
          id: "PR-2",
          name: "PR-2",
          deps: ["PR-1"],
          gates: [
            {
              name: "test",
              run: "npm test",
            },
          ],
        },
        {
          id: "PR-3",
          name: "PR-3",
          deps: ["PR-1", "PR-2"],
          gates: [
            {
              name: "build",
              run: "npm run build",
            },
          ],
        },
        {
          id: "PR-4",
          name: "PR-4",
          deps: ["PR-1", "PR-2", "PR-3"],
          gates: [
            {
              name: "build",
              run: "npm run build",
            },
          ],
        },
        {
          id: "PR-5",
          name: "PR-5",
          deps: ["PR-1", "PR-2", "PR-3", "PR-4"],
          gates: [
            {
              name: "e2e",
              run: "npm run e2e",
            },
          ],
        },
        {
          id: "PR-6",
          name: "PR-6",
          deps: ["PR-1", "PR-2", "PR-3", "PR-4", "PR-5"],
          gates: [
            {
              name: "deploy",
              run: "npm run deploy",
            },
          ],
        },
      ],
    };

    const plan = generatePlan(inputs);

    expect(plan.items).toHaveLength(6);

    // PR-1 should be junior (lint-only)
    const pr1 = plan.items.find((i) => i.name === "PR-1");
    expect(pr1?.tier).toBeDefined();
    expect(pr1?.tier?.suggested).toBe("junior");

    // PR-2 should be mid (test gate, 1 dep)
    const pr2 = plan.items.find((i) => i.name === "PR-2");
    expect(pr2?.tier).toBeDefined();
    expect(pr2?.tier?.suggested).toBe("mid");

    // PR-6 should be senior (many dependencies)
    const pr6 = plan.items.find((i) => i.name === "PR-6");
    expect(pr6?.tier).toBeDefined();
    expect(pr6?.tier?.suggested).toBe("senior");
  });

  it("should apply tier overrides during plan generation", () => {
    const inputs: InputConfig = {
      target: "main",
      items: [
        {
          id: "PR-1",
          name: "PR-1",
          deps: [],
          gates: [
            {
              name: "lint",
              run: "npm run lint",
            },
          ],
        },
      ],
    };

    const plan = generatePlan(inputs, {
      tierOverrides: [{ itemName: "PR-1", tier: "senior" }],
    });

    const pr1 = plan.items.find((i) => i.name === "PR-1");
    expect(pr1?.tier).toBeDefined();
    expect(pr1?.tier?.suggested).toBe("junior"); // Still suggests junior
    expect(pr1?.tier?.actual).toBe("senior"); // But overridden to senior
    expect(pr1?.tier?.escalated).toBe(true);
    expect(pr1?.tier?.mismatch).toBe(true);
  });

  it("should handle contract-related items as senior tier", () => {
    const inputs: InputConfig = {
      target: "main",
      items: [
        {
          id: "update-contract",
          name: "update-contract",
          deps: [],
          gates: [
            {
              name: "validate",
              run: "npm run validate",
            },
          ],
        },
      ],
    };

    const plan = generatePlan(inputs);

    const item = plan.items.find((i) => i.name === "update-contract");
    expect(item?.tier).toBeDefined();
    expect(item?.tier?.suggested).toBe("senior");
  });

  it("should assign mid tier to standard tasks", () => {
    const inputs: InputConfig = {
      target: "main",
      items: [
        {
          id: "feature-123",
          name: "feature-123",
          deps: [],
          gates: [
            {
              name: "test",
              run: "npm test",
            },
          ],
        },
      ],
    };

    const plan = generatePlan(inputs);

    const item = plan.items.find((i) => i.name === "feature-123");
    expect(item?.tier).toBeDefined();
    expect(item?.tier?.suggested).toBe("mid");
  });
});
