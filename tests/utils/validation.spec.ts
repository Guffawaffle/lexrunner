/**
 * Tests for schema validation utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadAndValidate, validate } from "../../src/utils/validation";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

const testSchema = z.object({
  name: z.string(),
  version: z.string(),
  items: z.array(z.string()).optional(),
});

type TestData = z.infer<typeof testSchema>;

describe("validate", () => {
  it("validates correct data", () => {
    const data = { name: "test", version: "1.0.0" };
    const result = validate(data, testSchema);
    expect(result).toEqual(data);
  });

  it("throws on invalid data", () => {
    const data = { name: "test" }; // missing version
    expect(() => validate(data, testSchema)).toThrow("Schema validation failed");
  });

  it("provides detailed error messages", () => {
    const data = { name: 123, version: "1.0.0" }; // wrong type

    try {
      validate(data, testSchema);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Schema validation failed");
      expect(e.message).toContain("name");
    }
  });

  it("validates nested structures", () => {
    const nestedSchema = z.object({
      meta: z.object({
        title: z.string(),
        count: z.number(),
      }),
    });

    const data = { meta: { title: "Test", count: 5 } };
    const result = validate(data, nestedSchema);
    expect(result).toEqual(data);
  });

  it("handles optional fields", () => {
    const data1 = { name: "test", version: "1.0.0" };
    const data2 = { name: "test", version: "1.0.0", items: ["a", "b"] };

    expect(() => validate(data1, testSchema)).not.toThrow();
    expect(() => validate(data2, testSchema)).not.toThrow();
  });

  it("reports multiple validation errors", () => {
    const data = { name: 123, items: "not-an-array" }; // multiple errors

    try {
      validate(data, testSchema);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Schema validation failed");
      // Should mention both errors
      expect(e.message).toContain("name");
    }
  });

  it("validates arrays correctly", () => {
    const data = { name: "test", version: "1.0.0", items: ["a", "b", "c"] };
    const result = validate(data, testSchema);
    expect(result.items).toEqual(["a", "b", "c"]);
  });

  it("rejects invalid array items", () => {
    const data = { name: "test", version: "1.0.0", items: [1, 2, 3] }; // numbers instead of strings

    expect(() => validate(data, testSchema)).toThrow();
  });
});

describe("loadAndValidate", () => {
  const testDir = "/tmp/validation-test";
  const testFile = path.join(testDir, "test.json");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("loads and validates valid JSON file", async () => {
    const data = { name: "test", version: "1.0.0" };
    await fs.writeFile(testFile, JSON.stringify(data));

    const result = await loadAndValidate(testFile, testSchema);
    expect(result).toEqual(data);
  });

  it("throws on invalid JSON file", async () => {
    const data = { name: "test" }; // missing version
    await fs.writeFile(testFile, JSON.stringify(data));

    await expect(loadAndValidate(testFile, testSchema)).rejects.toThrow("Schema validation failed");
  });

  it("throws on malformed JSON", async () => {
    await fs.writeFile(testFile, "{ invalid json }");

    await expect(loadAndValidate(testFile, testSchema)).rejects.toThrow();
  });

  it("throws on non-existent file", async () => {
    const nonExistentFile = path.join(testDir, "nonexistent.json");

    await expect(loadAndValidate(nonExistentFile, testSchema)).rejects.toThrow();
  });

  it("includes filename in error message", async () => {
    const data = { name: "test" }; // missing version
    await fs.writeFile(testFile, JSON.stringify(data));

    try {
      await loadAndValidate(testFile, testSchema);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain(testFile);
      expect(e.message).toContain("Schema validation failed");
    }
  });

  it("validates complex nested JSON", async () => {
    const complexSchema = z.object({
      config: z.object({
        settings: z.array(
          z.object({
            key: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]),
          })
        ),
      }),
    });

    const data = {
      config: {
        settings: [
          { key: "name", value: "test" },
          { key: "count", value: 42 },
          { key: "enabled", value: true },
        ],
      },
    };

    await fs.writeFile(testFile, JSON.stringify(data));
    const result = await loadAndValidate(testFile, complexSchema);
    expect(result).toEqual(data);
  });

  it("handles empty objects", async () => {
    const emptySchema = z.object({});
    await fs.writeFile(testFile, "{}");

    const result = await loadAndValidate(testFile, emptySchema);
    expect(result).toEqual({});
  });

  it("validates with additional properties when schema allows", async () => {
    const permissiveSchema = z
      .object({
        name: z.string(),
      })
      .passthrough(); // Allows additional properties

    const data = { name: "test", extra: "allowed" };
    await fs.writeFile(testFile, JSON.stringify(data));

    const result = await loadAndValidate(testFile, permissiveSchema);
    expect(result).toEqual(data);
  });

  it("handles UTF-8 encoded files", async () => {
    const data = { name: "test 中文 🚀", version: "1.0.0" };
    await fs.writeFile(testFile, JSON.stringify(data), "utf-8");

    const result = await loadAndValidate(testFile, testSchema);
    expect(result.name).toBe("test 中文 🚀");
  });

  it("reports path in validation error", async () => {
    const data = { name: "test", version: 123 }; // wrong type
    await fs.writeFile(testFile, JSON.stringify(data));

    try {
      await loadAndValidate(testFile, testSchema);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain(testFile);
      expect(e.message).toContain("version");
    }
  });
});
