import { describe, it, expect } from "vitest";
import { canonicalJSONStringify } from "../src/util/canonicalJson";

describe("canonicalJSONStringify", () => {
  it("should sort object keys recursively", () => {
    const obj = {
      z: "last",
      a: "first",
      m: {
        z: "nested-last",
        a: "nested-first",
        c: "nested-middle",
      },
    };

    const result = canonicalJSONStringify(obj);
    const parsed = JSON.parse(result);

    // Verify structure is preserved
    expect(parsed).toEqual(obj);

    // Verify key ordering in serialized string
    const lines = result.split("\n");
    const objStartLine = lines.findIndex((line) => line.trim() === "{");
    const nestedStartLine = lines.findIndex((line) => line.includes('"m": {'));

    // Keys should appear in alphabetical order
    expect(result).toMatch(/"a".*"m".*"z"/s);
    expect(result).toMatch(/"m":\s*{\s*"a".*"c".*"z"/s);
  });

  it("should handle arrays with stable sorting", () => {
    const obj = {
      numbers: [3, 1, 2],
      strings: ["z", "a", "m"],
      objects: [
        { z: 1, a: 2 },
        { b: 3, a: 4 },
      ],
    };

    const result = canonicalJSONStringify(obj);
    const parsed = JSON.parse(result);

    // Arrays maintain original order (stable sort)
    expect(parsed.numbers).toEqual([3, 1, 2]);
    expect(parsed.strings).toEqual(["z", "a", "m"]);

    // But object keys within arrays are sorted
    expect(parsed.objects[0]).toEqual({ a: 2, z: 1 });
    expect(parsed.objects[1]).toEqual({ a: 4, b: 3 });
  });

  it("should handle edge cases", () => {
    // Empty object
    expect(canonicalJSONStringify({})).toBe("{}\n");

    // Empty array
    expect(canonicalJSONStringify([])).toBe("[]\n");

    // Null and primitives
    expect(canonicalJSONStringify(null)).toBe("null\n");
    expect(canonicalJSONStringify(42)).toBe("42\n");
    expect(canonicalJSONStringify("test")).toBe('"test"\n');
    expect(canonicalJSONStringify(true)).toBe("true\n");
  });
  it("should be deterministic across multiple calls", () => {
    const obj = {
      z: { nested: [{ c: 1, a: 2 }] },
      a: { array: [3, 1, 2] },
      m: "middle",
    };

    const result1 = canonicalJSONStringify(obj);
    const result2 = canonicalJSONStringify(obj);
    const result3 = canonicalJSONStringify(obj);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it("should handle complex nested structures", () => {
    const complex = {
      schemaVersion: "1.0.0",
      metadata: {
        generated: "2024-01-01T00:00:00Z",
        environment: {
          node: "18.x",
          os: "linux",
        },
      },
      items: [
        {
          id: "item-2",
          dependencies: ["item-1"],
          gates: ["lint", "test"],
        },
        {
          id: "item-1",
          dependencies: [],
          gates: ["lint"],
        },
      ],
      policy: {
        maxWorkers: 2,
        retries: {
          test: { maxAttempts: 3 },
        },
      },
    };

    const result = canonicalJSONStringify(complex);
    const parsed = JSON.parse(result);

    // Structure preserved
    expect(parsed).toEqual(complex);

    // Keys are sorted at each level
    expect(result).toMatch(/"items".*"metadata".*"policy".*"schemaVersion"/s);
    expect(result).toMatch(/"environment".*"generated"/s);
    expect(result).toMatch(/"maxWorkers".*"retries"/s);

    // Arrays maintain order but object keys within are sorted
    expect(parsed.items[0]).toEqual({
      dependencies: ["item-1"],
      gates: ["lint", "test"],
      id: "item-2",
    });
  });
});
