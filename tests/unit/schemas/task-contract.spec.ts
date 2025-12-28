/**
 * Task Snapshot Contract Schema Tests
 *
 * Tests for ADR-007 schemas and hash binding validation.
 * Uses golden fixtures from ADR-007 Appendix D.
 */

import { describe, it, expect } from "vitest";
import {
  TASK_CONTRACT_VERSION,
  computeCanonicalHash,
  computeSnapshotHash,
  verifySnapshotBinding,
  parseTaskSnapshot,
  parseTaskReceipt,
  parseEngineVerification,
  safeParseTaskSnapshot,
  safeParseTaskReceipt,
  safeParseEngineVerification,
  validateReceiptBinding,
  validateVerificationBinding,
  TaskSnapshot_v1,
  TaskReceipt_v1,
  EngineVerification_v1,
  RepoRelativePath,
  SHA256Hash,
} from "../../../src/schemas/task-contract.js";

// =============================================================================
// GOLDEN FIXTURES (from ADR-007 Appendix D, with real hashes)
// =============================================================================

/**
 * Golden snapshot fixture - represents a D1 post-merge-fix task
 */
function createGoldenSnapshot(): TaskSnapshot_v1 {
  const snapshotWithoutHash = {
    schema_version: TASK_CONTRACT_VERSION as "1.0.0",
    task_id: "fix-tool-count-2025-12-19-001",
    procedure: "post-merge-fix",
    determinism: "D1" as const,
    repo: {
      id: "Guffawaffle/lexrunner",
      root: "/srv/lex-mcp/lexrunner",
      commit_sha: "81102f1452a3ad0428879c32a02ede2771df63fc",
    },
    scope: {
      read_globs: ["**/*.ts", "**/*.json"],
      write_globs: ["tests/**/*.spec.ts"],
      deny_globs: ["node_modules/**", "dist/**"],
      cross_repo_allowed: false,
    },
    failure: {
      message: "Expected 6, received 7",
      file_rel: "tests/unit/weave/metrics-schema.spec.ts",
      line: 45,
      runner_output_snip:
        "FAIL tests/unit/weave/metrics-schema.spec.ts\n  ✕ should have correct tool count (3ms)",
      excerpt: "it('should have correct tool count', () => {\n  expect(tools.length).toBe(6);\n});",
    },
    invariants: [
      "Prefer semantic assertion over numeric count when possible",
      "Registry INTERVENTION_CATALOG is source of truth for tool count",
    ],
    targets: [
      {
        path_rel: "tests/unit/weave/metrics-schema.spec.ts",
        hunk: "describe('tool registry', () => {\n  it('should have correct tool count', () => {\n    expect(tools.length).toBe(6);\n  });",
        hunk_sha256: "sha256:placeholder", // Will be replaced
        hint_edit: {
          find: "expect(tools.length).toBe(6)",
          replace: "expect(tools.length).toBe(7)",
        },
      },
    ],
    source_of_truth: {
      kind: "registry" as const,
      path_rel: "src/weave/metrics/schema.ts",
      excerpt: "export const INTERVENTION_CATALOG = { /* 19 interventions */ }",
      introducing_change: {
        commit_sha: "81102f1452a3ad0428879c32a02ede2771df63fc",
        diff_hunk: "+  'validate_remember': { ... }",
      },
    },
    verification: {
      cmd: "npm test -- tests/unit/weave/metrics-schema.spec.ts",
      expect: {
        exit_code: 0,
        must_include: ["PASS"],
        must_not_include: ["FAIL", "Expected: 6"],
      },
    },
    budget: {
      max_bytes: 8000,
      truncated_fields: [],
    },
    receipt_schema_id: "TaskReceipt_v1",
  };

  // Compute real hunk hash
  const hunkHash = computeCanonicalHash(snapshotWithoutHash.targets[0].hunk);
  snapshotWithoutHash.targets[0].hunk_sha256 = hunkHash;

  // Compute snapshot hash
  const snapshotHash = computeCanonicalHash(snapshotWithoutHash);

  return {
    ...snapshotWithoutHash,
    snapshot_hash: snapshotHash,
  };
}

/**
 * Golden receipt fixture - matches the snapshot
 */
function createGoldenReceipt(snapshotHash: string): TaskReceipt_v1 {
  return {
    schema_version: TASK_CONTRACT_VERSION as "1.0.0",
    task_id: "fix-tool-count-2025-12-19-001",
    snapshot_hash: snapshotHash,
    claims: {
      success: true,
      patch:
        "--- a/tests/unit/weave/metrics-schema.spec.ts\n+++ b/tests/unit/weave/metrics-schema.spec.ts\n@@ -43,7 +43,7 @@\n-    expect(tools.length).toBe(6);\n+    expect(tools.length).toBe(7);",
      files_touched: ["tests/unit/weave/metrics-schema.spec.ts"],
      rationale: "Updated assertion to match new tool count after validate_remember was added",
      confidence: "high",
      invariants_respected: ["Registry INTERVENTION_CATALOG is source of truth for tool count"],
      assumptions_made: [
        {
          type: "test",
          text: "No other tests rely on exact tool count",
          validated: false,
        },
        {
          type: "codebase",
          text: "validate_remember is the only new tool",
          validated: true,
          evidence: "git diff shows single addition",
        },
      ],
    },
    search_activity: [],
    cost: {
      token_usage: {
        input: 1200,
        output: 350,
        total: 1550,
      },
      tool_calls_count: 2,
      elapsed_ms: 4500,
    },
    agent_verification: {
      cmd_ran: true,
      exit_code: 0,
      output_snip: "PASS tests/unit/weave/metrics-schema.spec.ts",
    },
    blockers: [],
  };
}

/**
 * Golden engine verification fixture
 */
function createGoldenVerification(
  snapshotHash: string,
  receipt: TaskReceipt_v1
): EngineVerification_v1 {
  const receiptHash = computeCanonicalHash(receipt);
  const patchHash = computeCanonicalHash(receipt.claims.patch ?? "");

  return {
    task_id: "fix-tool-count-2025-12-19-001",
    timestamp: "2025-12-19T00:45:00.000Z",
    snapshot_hash: snapshotHash,
    receipt_hash: receiptHash,
    verified: true,
    cmd_ran: "npm test -- tests/unit/weave/metrics-schema.spec.ts",
    exit_code: 0,
    stdout_snip:
      "PASS tests/unit/weave/metrics-schema.spec.ts\n  ✓ should have correct tool count (2ms)",
    stderr_snip: "",
    patch_hash: patchHash,
    patch_applied: true,
    agent_claimed: true,
    trust_gap: false,
    failures: [],
  };
}

// =============================================================================
// HASH HELPER TESTS
// =============================================================================

describe("Canonical Hash Helper", () => {
  describe("computeCanonicalHash", () => {
    it("produces sha256 prefixed hash", () => {
      const hash = computeCanonicalHash({ foo: "bar" });
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("is deterministic - same input produces same hash", () => {
      const obj = { name: "test", value: 42 };
      const hash1 = computeCanonicalHash(obj);
      const hash2 = computeCanonicalHash(obj);
      expect(hash1).toBe(hash2);
    });

    it("is order-independent for object keys", () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("produces different hashes for different content", () => {
      const hash1 = computeCanonicalHash({ value: 1 });
      const hash2 = computeCanonicalHash({ value: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it("handles nested objects with deterministic ordering", () => {
      const obj1 = { outer: { z: 1, a: 2 } };
      const obj2 = { outer: { a: 2, z: 1 } };
      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("handles arrays (preserves order)", () => {
      const arr1 = [1, 2, 3];
      const arr2 = [3, 2, 1];
      expect(computeCanonicalHash(arr1)).not.toBe(computeCanonicalHash(arr2));
    });
  });

  describe("verifySnapshotBinding", () => {
    it("returns true when hashes match", () => {
      const snapshot = createGoldenSnapshot();
      expect(verifySnapshotBinding(snapshot, snapshot.snapshot_hash)).toBe(true);
    });

    it("returns false when hashes don't match", () => {
      const snapshot = createGoldenSnapshot();
      expect(verifySnapshotBinding(snapshot, "sha256:wrong")).toBe(false);
    });
  });
});

// =============================================================================
// SCHEMA VALIDATION TESTS
// =============================================================================

describe("TaskSnapshot_v1 Schema", () => {
  it("validates golden fixture", () => {
    const snapshot = createGoldenSnapshot();
    const result = safeParseTaskSnapshot(snapshot);
    expect(result.success).toBe(true);
  });

  it("requires schema_version to be 1.0.0", () => {
    const snapshot = createGoldenSnapshot();
    const invalid = { ...snapshot, schema_version: "2.0.0" };
    const result = safeParseTaskSnapshot(invalid);
    expect(result.success).toBe(false);
  });

  it("requires valid determinism level", () => {
    const snapshot = createGoldenSnapshot();
    const invalid = { ...snapshot, determinism: "D4" };
    const result = safeParseTaskSnapshot(invalid);
    expect(result.success).toBe(false);
  });

  it("requires at least one target", () => {
    const snapshot = createGoldenSnapshot();
    const invalid = { ...snapshot, targets: [] };
    const result = safeParseTaskSnapshot(invalid);
    expect(result.success).toBe(false);
  });

  it("requires repo-relative paths (no leading slash)", () => {
    const snapshot = createGoldenSnapshot();
    const invalid = {
      ...snapshot,
      failure: { ...snapshot.failure, file_rel: "/absolute/path.ts" },
    };
    const result = safeParseTaskSnapshot(invalid);
    expect(result.success).toBe(false);
  });
});

describe("TaskReceipt_v1 Schema", () => {
  it("validates golden fixture", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const result = safeParseTaskReceipt(receipt);
    expect(result.success).toBe(true);
  });

  it("requires structured assumptions", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const invalid = {
      ...receipt,
      claims: {
        ...receipt.claims,
        assumptions_made: ["plain string assumption"], // Wrong format
      },
    };
    const result = safeParseTaskReceipt(invalid);
    expect(result.success).toBe(false);
  });

  it("requires valid assumption type", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const invalid = {
      ...receipt,
      claims: {
        ...receipt.claims,
        assumptions_made: [{ type: "invalid_type", text: "test" }],
      },
    };
    const result = safeParseTaskReceipt(invalid);
    expect(result.success).toBe(false);
  });

  it("requires valid confidence level", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const invalid = {
      ...receipt,
      claims: { ...receipt.claims, confidence: "very_high" },
    };
    const result = safeParseTaskReceipt(invalid);
    expect(result.success).toBe(false);
  });
});

describe("EngineVerification_v1 Schema", () => {
  it("validates golden fixture", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    const result = safeParseEngineVerification(verification);
    expect(result.success).toBe(true);
  });

  it("requires ISO 8601 timestamp", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    const invalid = { ...verification, timestamp: "not-a-date" };
    const result = safeParseEngineVerification(invalid);
    expect(result.success).toBe(false);
  });

  it("requires both snapshot_hash and receipt_hash", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    const { snapshot_hash: _, ...invalid } = verification;
    const result = safeParseEngineVerification(invalid);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// BINDING VALIDATION TESTS
// =============================================================================

describe("Receipt Binding Validation", () => {
  it("validates matching snapshot and receipt", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const result = validateReceiptBinding(snapshot, receipt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects task_id mismatch", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    receipt.task_id = "different-task-id";
    const result = validateReceiptBinding(snapshot, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Task ID mismatch");
  });

  it("rejects floating receipts (snapshot_hash mismatch)", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt("sha256:wrong_hash_prevents_floating_receipts");
    const result = validateReceiptBinding(snapshot, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Snapshot hash mismatch");
    expect(result.errors[0]).toContain("floating receipts");
  });
});

describe("Verification Binding Validation", () => {
  it("validates complete trio", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    const result = validateVerificationBinding(snapshot, receipt, verification);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects snapshot_hash mismatch in verification", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    verification.snapshot_hash = "sha256:wrong";
    const result = validateVerificationBinding(snapshot, receipt, verification);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("Snapshot hash mismatch"));
  });

  it("detects trust gap incorrectly computed", () => {
    const snapshot = createGoldenSnapshot();
    const receipt = createGoldenReceipt(snapshot.snapshot_hash);
    const verification = createGoldenVerification(snapshot.snapshot_hash, receipt);
    // Agent claimed success, verification says true, but trust_gap is wrong
    verification.trust_gap = true; // Should be false
    const result = validateVerificationBinding(snapshot, receipt, verification);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("Trust gap incorrectly computed"));
  });
});

// =============================================================================
// REPO-RELATIVE PATH VALIDATION TESTS
// =============================================================================

describe("RepoRelativePath Validation", () => {
  it("accepts valid repo-relative paths", () => {
    expect(RepoRelativePath.safeParse("src/file.ts").success).toBe(true);
    expect(RepoRelativePath.safeParse("tests/unit/test.spec.ts").success).toBe(true);
    expect(RepoRelativePath.safeParse("file.ts").success).toBe(true);
  });

  it("rejects absolute paths (leading slash)", () => {
    expect(RepoRelativePath.safeParse("/absolute/path.ts").success).toBe(false);
  });

  it("rejects Windows absolute paths", () => {
    expect(RepoRelativePath.safeParse("C:\\path\\file.ts").success).toBe(false);
    expect(RepoRelativePath.safeParse("D:/path/file.ts").success).toBe(false);
  });

  it("rejects paths escaping repo root", () => {
    expect(RepoRelativePath.safeParse("../outside/file.ts").success).toBe(false);
  });
});

// =============================================================================
// SHA256 HASH VALIDATION TESTS
// =============================================================================

describe("SHA256Hash Validation", () => {
  it("accepts valid sha256 hashes", () => {
    const validHash = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(SHA256Hash.safeParse(validHash).success).toBe(true);
  });

  it("rejects hashes without prefix", () => {
    expect(
      SHA256Hash.safeParse("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        .success
    ).toBe(false);
  });

  it("rejects hashes with wrong length", () => {
    expect(SHA256Hash.safeParse("sha256:abc123").success).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(
      SHA256Hash.safeParse(
        "sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
      ).success
    ).toBe(false);
  });
});
