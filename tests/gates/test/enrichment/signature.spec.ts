/**
 * Tests for failure signature generation
 */

import { describe, it, expect } from "vitest";
import { generateSignature } from "../../../../src/gates/test/enrichment/signature.js";

describe("generateSignature", () => {
  it("should scrub timestamps", () => {
    const sig1 = generateSignature("Failed at 2024-01-01T10:00:00.000Z");
    const sig2 = generateSignature("Failed at 2024-12-31T23:59:59.999Z");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<timestamp>");
  });

  it("should scrub Unix timestamps", () => {
    const sig1 = generateSignature("Timestamp: 1234567890123");
    const sig2 = generateSignature("Timestamp: 9876543210987");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<timestamp>");
  });

  it("should scrub ports", () => {
    const sig1 = generateSignature("Connection to localhost:3000 failed");
    const sig2 = generateSignature("Connection to localhost:8080 failed");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<port>");
  });

  it("should scrub IP addresses with ports", () => {
    const sig1 = generateSignature("Server at 127.0.0.1:3000");
    const sig2 = generateSignature("Server at 127.0.0.1:8080");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("127.0.0.1:<port>");
  });

  it("should scrub process IDs", () => {
    const sig1 = generateSignature("Process pid: 12345 crashed");
    const sig2 = generateSignature("Process pid: 67890 crashed");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<pid>");
  });

  it("should scrub UUIDs", () => {
    const sig1 = generateSignature("Request a1b2c3d4-e5f6-7890-abcd-ef1234567890 failed");
    const sig2 = generateSignature("Request ffffffff-ffff-ffff-ffff-ffffffffffff failed");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<uuid>");
  });

  it("should scrub hex hashes", () => {
    const sig1 = generateSignature("Hash: abc123def456789012345678901234567890");
    const sig2 = generateSignature("Hash: ffffffffffffffffffffffffffffffffffffffff");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<hash>");
  });

  it("should scrub memory addresses", () => {
    const sig1 = generateSignature("Pointer at 0x1a2b3c4d");
    const sig2 = generateSignature("Pointer at 0xdeadbeef");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("0x<addr>");
  });

  it("should scrub timeout values", () => {
    const sig1 = generateSignature("Test failed: timeout of 5000ms exceeded");
    const sig2 = generateSignature("Test failed: timeout of 10000ms exceeded");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("timeout of <ms>ms");
  });

  it("should scrub duration values", () => {
    const sig1 = generateSignature("Operation completed after 123ms");
    const sig2 = generateSignature("Operation completed after 999ms");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("after <ms>ms");
  });

  it("should scrub expected/received values", () => {
    const sig1 = generateSignature("Expected 42 but received 100");
    const sig2 = generateSignature("Expected 99 but received 200");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("expected <n>");
    expect(sig1).toContain("received <n>");
  });

  it("should normalize file paths", () => {
    const sig1 = generateSignature("Error in /home/user/project/src/test.ts");
    const sig2 = generateSignature("Error in /different/path/src/test.ts");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain(".../test.ts");
  });

  it("should scrub random base64 strings", () => {
    const sig1 = generateSignature("Token: SGVsbG8gV29ybGQhCg==");
    const sig2 = generateSignature("Token: QW5vdGhlclRva2VuCg==");

    expect(sig1).toBe(sig2);
    expect(sig1).toContain("<random>");
  });

  it("should handle empty messages", () => {
    const sig = generateSignature("");
    expect(sig).toBe("");
  });

  it("should normalize whitespace", () => {
    const sig1 = generateSignature("Error:   multiple    spaces");
    const sig2 = generateSignature("Error: multiple spaces");

    expect(sig1).toBe(sig2);
  });

  it("should handle complex real-world error", () => {
    const err1 = `TypeError: Cannot read property 'foo' of undefined
      at /home/user/project/src/test.ts:42:10
      Timeout of 5000ms exceeded
      Process pid: 12345
      Request ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
      Server: localhost:3000
      Timestamp: 1234567890123`;

    const err2 = `TypeError: Cannot read property 'foo' of undefined
      at /other/path/src/test.ts:42:10
      Timeout of 10000ms exceeded
      Process pid: 67890
      Request ID: ffffffff-ffff-ffff-ffff-ffffffffffff
      Server: localhost:8080
      Timestamp: 9876543210987`;

    const sig1 = generateSignature(err1);
    const sig2 = generateSignature(err2);

    expect(sig1).toBe(sig2);
  });

  it("should preserve essential error structure", () => {
    const sig = generateSignature("Cannot find module 'express'");

    // Should NOT scrub the module name
    expect(sig).toContain("express");
    expect(sig).toContain("Cannot find module");
  });

  it("should handle snapshot mismatch messages", () => {
    const sig1 = generateSignature("Snapshot mismatch: expected 123, received 456");
    const sig2 = generateSignature("Snapshot mismatch: expected 789, received 999");

    expect(sig1).toBe(sig2);
  });
});
