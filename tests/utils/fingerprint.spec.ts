/**
 * Tests for fingerprint utilities
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateFingerprint,
  extractFingerprint,
  injectFingerprint,
  fingerprint,
  verifyFingerprint,
  fingerprintFile,
} from "../../src/utils/fingerprint";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import crypto from "crypto";

// Use crypto random for unique test directory
const TEST_DIR = path.join(
  os.tmpdir(),
  `fingerprint-test-${crypto.randomBytes(8).toString("hex")}`
);

describe("generateFingerprint", () => {
  it("generates deterministic hash", () => {
    const data = { title: "Test", description: "Desc", ac: ["A", "B"] };
    const fp1 = generateFingerprint(data);
    const fp2 = generateFingerprint(data);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
  });

  it("produces different hashes for different data", () => {
    const data1 = { title: "Test1", description: "Desc" };
    const data2 = { title: "Test2", description: "Desc" };
    expect(generateFingerprint(data1)).not.toBe(generateFingerprint(data2));
  });

  it("is order-independent for object keys", () => {
    const data1 = { a: 1, b: 2, c: 3 };
    const data2 = { c: 3, a: 1, b: 2 };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it("handles nested objects consistently", () => {
    const data1 = { outer: { b: 2, a: 1 }, array: [1, 2, 3] };
    const data2 = { outer: { a: 1, b: 2 }, array: [1, 2, 3] };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it("handles arrays in deterministic order", () => {
    const data1 = { items: ["a", "b", "c"] };
    const data2 = { items: ["a", "b", "c"] };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it("produces valid hex string", () => {
    const data = { test: "value" };
    const fp = generateFingerprint(data);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it("handles empty object", () => {
    const fp = generateFingerprint({});
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it("handles complex nested structures", () => {
    const data = {
      title: "Complex Issue",
      description: "Multi-line\ndescription",
      acceptance_criteria: ["AC1", "AC2", "AC3"],
      metadata: {
        priority: "high",
        tags: ["bug", "urgent"],
      },
    };
    const fp = generateFingerprint(data);
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("extractFingerprint", () => {
  it("extracts fingerprint from comment", () => {
    const body = "<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n## Content";
    expect(extractFingerprint(body)).toBe("abc123def456");
  });

  it("returns null if no fingerprint", () => {
    expect(extractFingerprint("No fingerprint here")).toBeNull();
  });

  it("extracts fingerprint from body with multiple comments", () => {
    const body =
      "<!-- other comment -->\n<!-- lex-pr-idea-fingerprint: 1234567890abcdef -->\n## Title";
    expect(extractFingerprint(body)).toBe("1234567890abcdef");
  });

  it("returns null for malformed fingerprint", () => {
    const body = "<!-- lex-pr-idea-fingerprint: xyz -->";
    expect(extractFingerprint(body)).toBeNull();
  });

  it("handles fingerprint at end of body", () => {
    const body = "## Issue Content\n\n<!-- lex-pr-idea-fingerprint: fedcba9876543210 -->";
    expect(extractFingerprint(body)).toBe("fedcba9876543210");
  });
});

describe("injectFingerprint", () => {
  it("injects fingerprint comment at beginning", () => {
    const body = "## Title\n\nContent";
    const result = injectFingerprint(body, "abc123def456");
    expect(result).toBe("<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n## Title\n\nContent");
  });

  it("injects fingerprint into empty body", () => {
    const result = injectFingerprint("", "abc123def456");
    expect(result).toBe("<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n");
  });

  it("preserves existing content", () => {
    const body = "# Header\n\n- List item\n- Another item";
    const result = injectFingerprint(body, "1234567890abcdef");
    expect(result).toContain("# Header");
    expect(result).toContain("- List item");
    expect(result).toContain("<!-- lex-pr-idea-fingerprint: 1234567890abcdef -->");
  });

  it("can roundtrip inject and extract", () => {
    const body = "## Test Issue";
    const fingerprint = "abc123def456";
    const injected = injectFingerprint(body, fingerprint);
    const extracted = extractFingerprint(injected);
    expect(extracted).toBe(fingerprint);
  });
});

describe("fingerprint", () => {
  it("is an alias for generateFingerprint", () => {
    const data = { title: "Test", description: "Desc" };
    expect(fingerprint(data)).toBe(generateFingerprint(data));
  });

  it("produces deterministic results", () => {
    const data = { a: 1, b: 2, c: 3 };
    const fp1 = fingerprint(data);
    const fp2 = fingerprint(data);
    expect(fp1).toBe(fp2);
  });
});

describe("verifyFingerprint", () => {
  it("returns true for matching fingerprint", () => {
    const data = { title: "Test", description: "Desc" };
    const fp = generateFingerprint(data);
    expect(verifyFingerprint(data, fp)).toBe(true);
  });

  it("returns false for non-matching fingerprint", () => {
    const data = { title: "Test", description: "Desc" };
    expect(verifyFingerprint(data, "invalid")).toBe(false);
  });

  it("returns false when data changes", () => {
    const data1 = { title: "Test1" };
    const data2 = { title: "Test2" };
    const fp1 = generateFingerprint(data1);
    expect(verifyFingerprint(data2, fp1)).toBe(false);
  });

  it("is order-independent for object keys", () => {
    const data1 = { a: 1, b: 2, c: 3 };
    const data2 = { c: 3, a: 1, b: 2 };
    const fp1 = generateFingerprint(data1);
    expect(verifyFingerprint(data2, fp1)).toBe(true);
  });
});

describe("fingerprintFile", () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("handles JSON files", async () => {
    const testFile = path.join(TEST_DIR, "test.json");
    const data = { title: "Test", description: "Desc" };
    await fs.writeFile(testFile, JSON.stringify(data, null, 2));

    const fp = await fingerprintFile(testFile);
    expect(fp).toBe(generateFingerprint(data));
  });

  it("handles YAML files", async () => {
    const testFile = path.join(TEST_DIR, "test.yaml");
    const content = "title: Test\ndescription: Desc\n";
    await fs.writeFile(testFile, content);

    const fp = await fingerprintFile(testFile);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);

    // Should be deterministic
    const fp2 = await fingerprintFile(testFile);
    expect(fp).toBe(fp2);
  });

  it("handles TypeScript files", async () => {
    const testFile = path.join(TEST_DIR, "test.ts");
    const content = 'export const test = "value";\n';
    await fs.writeFile(testFile, content);

    const fp = await fingerprintFile(testFile);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);

    // Should be deterministic
    const fp2 = await fingerprintFile(testFile);
    expect(fp).toBe(fp2);
  });

  it("produces same fingerprint for same JSON content", async () => {
    const testFile1 = path.join(TEST_DIR, "test1.json");
    const testFile2 = path.join(TEST_DIR, "test2.json");
    const data = { a: 1, b: 2 };

    await fs.writeFile(testFile1, JSON.stringify(data, null, 2));
    await fs.writeFile(testFile2, JSON.stringify(data, null, 4)); // Different formatting

    const fp1 = await fingerprintFile(testFile1);
    const fp2 = await fingerprintFile(testFile2);
    expect(fp1).toBe(fp2); // Same because we parse JSON
  });

  it("produces different fingerprints for different TS content", async () => {
    const testFile1 = path.join(TEST_DIR, "test1.ts");
    const testFile2 = path.join(TEST_DIR, "test2.ts");

    await fs.writeFile(testFile1, "const a = 1;");
    await fs.writeFile(testFile2, "const b = 2;");

    const fp1 = await fingerprintFile(testFile1);
    const fp2 = await fingerprintFile(testFile2);
    expect(fp1).not.toBe(fp2);
  });
});
