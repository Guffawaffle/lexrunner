import { describe, it, expect } from "vitest";
import { canonicalJSONStringify } from "../src/util/canonicalJson";
import { generateEmptyPlan } from "../src/core/plan";

describe("deterministic utilities", () => {
  it("should produce deterministic JSON output", () => {
    const data = {
      z: "last",
      a: "first",
      m: {
        nested: true,
        array: [3, 1, 2],
      },
    };

    const json1 = canonicalJSONStringify(data);
    const json2 = canonicalJSONStringify(data);

    expect(json1).toBe(json2);
    expect(json1).toMatch(/"a".*"m".*"z"/s);
  });

  it("should generate deterministic empty plans", () => {
    const plan1 = generateEmptyPlan("main");
    const plan2 = generateEmptyPlan("main");

    expect(canonicalJSONStringify(plan1)).toBe(canonicalJSONStringify(plan2));
    expect(plan1.schemaVersion).toBe("1.0.0");
    expect(plan1.target).toBe("main");
    expect(plan1.items).toEqual([]);
  });
});
