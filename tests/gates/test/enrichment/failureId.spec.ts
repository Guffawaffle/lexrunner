/**
 * Tests for failureId generation
 */

import { describe, it, expect } from "vitest";
import { generateFailureId } from "../../../../src/gates/test/enrichment/failureId.js";

describe("generateFailureId", () => {
  it("should generate deterministic IDs for same inputs", () => {
    const id1 = generateFailureId("test.ts", "my test", "Error", "something failed");
    const id2 = generateFailureId("test.ts", "my test", "Error", "something failed");

    expect(id1).toBe(id2);
    expect(id1).toHaveLength(16);
  });

  it("should generate different IDs for different files", () => {
    const id1 = generateFailureId("test1.ts", "my test", "Error", "failed");
    const id2 = generateFailureId("test2.ts", "my test", "Error", "failed");

    expect(id1).not.toBe(id2);
  });

  it("should generate different IDs for different test names", () => {
    const id1 = generateFailureId("test.ts", "test 1", "Error", "failed");
    const id2 = generateFailureId("test.ts", "test 2", "Error", "failed");

    expect(id1).not.toBe(id2);
  });

  it("should generate different IDs for different error types", () => {
    const id1 = generateFailureId("test.ts", "my test", "TypeError", "failed");
    const id2 = generateFailureId("test.ts", "my test", "ReferenceError", "failed");

    expect(id1).not.toBe(id2);
  });

  it("should canonicalize timestamps in messages", () => {
    const id1 = generateFailureId(
      "test.ts",
      "my test",
      "Error",
      "Failed at 2024-01-01T10:30:00.000Z"
    );
    const id2 = generateFailureId(
      "test.ts",
      "my test",
      "Error",
      "Failed at 2024-12-31T23:59:59.999Z"
    );

    // Same after timestamp canonicalization
    expect(id1).toBe(id2);
  });

  it("should canonicalize ports in messages", () => {
    const id1 = generateFailureId("test.ts", "my test", "Error", "Server failed on port 3000");
    const id2 = generateFailureId("test.ts", "my test", "Error", "Server failed on port 8080");

    expect(id1).toBe(id2);
  });

  it("should canonicalize process IDs", () => {
    const id1 = generateFailureId("test.ts", "my test", "Error", "Process pid: 12345 failed");
    const id2 = generateFailureId("test.ts", "my test", "Error", "Process pid: 67890 failed");

    expect(id1).toBe(id2);
  });

  it("should canonicalize UUIDs", () => {
    const id1 = generateFailureId(
      "test.ts",
      "my test",
      "Error",
      "ID a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found"
    );
    const id2 = generateFailureId(
      "test.ts",
      "my test",
      "Error",
      "ID ffffffff-ffff-ffff-ffff-ffffffffffff not found"
    );

    expect(id1).toBe(id2);
  });

  it("should canonicalize memory addresses", () => {
    const id1 = generateFailureId("test.ts", "my test", "Error", "Pointer at 0x1a2b3c4d");
    const id2 = generateFailureId("test.ts", "my test", "Error", "Pointer at 0xffffffff");

    expect(id1).toBe(id2);
  });

  it("should handle empty messages", () => {
    const id = generateFailureId("test.ts", "my test", "Error", "");

    expect(id).toHaveLength(16);
    expect(typeof id).toBe("string");
  });

  it("should handle missing error type", () => {
    const id1 = generateFailureId("test.ts", "my test", "", "failed");
    const id2 = generateFailureId("test.ts", "my test", undefined as any, "failed");

    expect(id1).toBe(id2);
  });

  it("should normalize whitespace", () => {
    const id1 = generateFailureId("test.ts", "my test", "Error", "Failed    with   spaces");
    const id2 = generateFailureId("test.ts", "my test", "Error", "Failed with spaces");

    expect(id1).toBe(id2);
  });

  it("should handle complex real-world message", () => {
    const msg1 = `Error: Connection to localhost:3000 failed at 2024-01-01T10:00:00Z
      Process 12345 died
      Request ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
      Memory: 0x1a2b3c4d`;

    const msg2 = `Error: Connection to localhost:8080 failed at 2024-12-31T23:59:59Z
      Process 67890 died
      Request ID: ffffffff-ffff-ffff-ffff-ffffffffffff
      Memory: 0xdeadbeef`;

    const id1 = generateFailureId("test.ts", "connection test", "Error", msg1);
    const id2 = generateFailureId("test.ts", "connection test", "Error", msg2);

    expect(id1).toBe(id2);
  });
});
