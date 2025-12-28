import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initAuditEmitter, finalizeAudit } from "../../src/audit/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Audit Integration - End to End", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "audit-e2e-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("Complete Audit Flow", () => {
    it("should emit audit events with context and generate gate matrix", async () => {
      // Initialize emitter with soc2 profile
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: tmpDir,
        sessionId: "01JB123456789",
        runId: "01JB987654321",
        tool: { name: "lexrunner", version: "0.1.0" },
      });

      // Emit gate events for multiple PRs
      // PR 166 - all gates pass
      emitter.emit("gate_started", { item: "166", gate: "lint" });
      emitter.emit("gate_finished", {
        item: "166",
        gate: "lint",
        status: "pass",
        duration_ms: 1234,
      });

      emitter.emit("gate_started", { item: "166", gate: "typecheck" });
      emitter.emit("gate_finished", {
        item: "166",
        gate: "typecheck",
        status: "pass",
        duration_ms: 2345,
      });

      emitter.emit("gate_started", { item: "166", gate: "unit" });
      emitter.emit("gate_finished", {
        item: "166",
        gate: "unit",
        status: "pass",
        duration_ms: 3456,
      });

      // PR 167 - typecheck fails, unit blocked
      emitter.emit("gate_started", { item: "167", gate: "lint" });
      emitter.emit("gate_finished", {
        item: "167",
        gate: "lint",
        status: "pass",
        duration_ms: 1111,
      });

      emitter.emit("gate_started", { item: "167", gate: "typecheck" });
      emitter.emit("gate_finished", {
        item: "167",
        gate: "typecheck",
        status: "fail",
        duration_ms: 2222,
        error: "Type mismatch in cli.ts:125",
      });

      emitter.emit("gate_finished", {
        item: "167",
        gate: "unit",
        status: "blocked",
        reason: "typecheck failed",
      });

      // PR 168 - e2e skipped
      emitter.emit("gate_finished", {
        item: "168",
        gate: "lint",
        status: "pass",
        duration_ms: 1000,
      });

      emitter.emit("gate_finished", {
        item: "168",
        gate: "e2e",
        status: "skip",
        reason: "Not configured",
      });

      // Finalize audit (generates gate matrix)
      await finalizeAudit(emitter);

      // Verify NDJSON audit log exists
      const auditPath = path.join(tmpDir, "audit.ndjson");
      expect(fs.existsSync(auditPath)).toBe(true);

      // Read and verify audit log
      const auditContent = await fs.promises.readFile(auditPath, "utf-8");
      const auditLines = auditContent.trim().split("\n");
      expect(auditLines.length).toBeGreaterThan(0);

      // Verify event structure
      const firstEvent = JSON.parse(auditLines[0]);
      expect(firstEvent).toHaveProperty("schema_version", "0.1.0");
      expect(firstEvent).toHaveProperty("event");
      expect(firstEvent).toHaveProperty("ts");
      expect(firstEvent).toHaveProperty("session_id", "01JB123456789");
      expect(firstEvent).toHaveProperty("run_id", "01JB987654321");
      expect(firstEvent).toHaveProperty("tool");
      expect(firstEvent.tool).toEqual({ name: "lexrunner", version: "0.1.0" });

      // Verify context is included (soc2 profile includes git and ci)
      expect(firstEvent).toHaveProperty("context");
      expect(firstEvent.context).toHaveProperty("git");
      expect(firstEvent.context).toHaveProperty("ci");
      expect(firstEvent.context.git).toHaveProperty("commit");
      expect(firstEvent.context.git).toHaveProperty("branch");

      // Verify gate matrix exists
      const matrixPath = path.join(tmpDir, "audit-gate-matrix.json");
      expect(fs.existsSync(matrixPath)).toBe(true);

      // Read and verify gate matrix
      const matrixContent = await fs.promises.readFile(matrixPath, "utf-8");
      const matrix = JSON.parse(matrixContent);

      // Verify structure
      expect(matrix).toHaveProperty("generated_at");
      expect(matrix).toHaveProperty("session_id", "01JB123456789");
      expect(matrix).toHaveProperty("matrix");
      expect(matrix).toHaveProperty("summary");

      // Verify matrix content
      expect(matrix.matrix["166"]).toBeDefined();
      expect(matrix.matrix["166"]["lint"].status).toBe("pass");
      expect(matrix.matrix["166"]["lint"].duration_ms).toBe(1234);

      expect(matrix.matrix["166"]["typecheck"].status).toBe("pass");
      expect(matrix.matrix["166"]["typecheck"].duration_ms).toBe(2345);

      expect(matrix.matrix["166"]["unit"].status).toBe("pass");
      expect(matrix.matrix["166"]["unit"].duration_ms).toBe(3456);

      expect(matrix.matrix["167"]["lint"].status).toBe("pass");
      expect(matrix.matrix["167"]["lint"].duration_ms).toBe(1111);

      expect(matrix.matrix["167"]["typecheck"].status).toBe("fail");
      expect(matrix.matrix["167"]["typecheck"].duration_ms).toBe(2222);
      expect(matrix.matrix["167"]["typecheck"].error).toBe("Type mismatch in cli.ts:125");

      expect(matrix.matrix["167"]["unit"].status).toBe("blocked");
      expect(matrix.matrix["167"]["unit"].reason).toBe("typecheck failed");

      expect(matrix.matrix["168"]["lint"].status).toBe("pass");
      expect(matrix.matrix["168"]["lint"].duration_ms).toBe(1000);

      expect(matrix.matrix["168"]["e2e"].status).toBe("skip");
      expect(matrix.matrix["168"]["e2e"].reason).toBe("Not configured");

      // Verify summary
      expect(matrix.summary).toEqual({
        total_prs: 3,
        total_gates: 8,
        passed: 5,
        failed: 1,
        skipped: 1,
        blocked: 1,
      });
    });

    it("should support context override with --audit-context flag", async () => {
      // Initialize with basic profile but override to only OS context
      const emitter = await initAuditEmitter({
        profile: "basic",
        contextTypes: ["os"], // Override
        dir: tmpDir,
      });

      emitter.emit("test_event", { test: "data" });

      await finalizeAudit(emitter);

      // Read audit log
      const auditPath = path.join(tmpDir, "audit.ndjson");
      const content = await fs.promises.readFile(auditPath, "utf-8");
      const event = JSON.parse(content.trim());

      // Should only have OS context
      expect(event.context.os).toBeDefined();
      expect(event.context.git).toBeUndefined();
      expect(event.context.ci).toBeUndefined();
    });

    it("should not generate gate matrix for basic profile", async () => {
      const emitter = await initAuditEmitter({
        profile: "basic",
        dir: tmpDir,
      });

      emitter.emit("gate_finished", { item: "166", gate: "lint", status: "pass" });

      await finalizeAudit(emitter);

      // Gate matrix should not exist
      const matrixPath = path.join(tmpDir, "audit-gate-matrix.json");
      expect(fs.existsSync(matrixPath)).toBe(false);
    });

    it("should support all context types", async () => {
      const emitter = await initAuditEmitter({
        profile: "basic",
        contextTypes: ["git", "ci", "os"],
        dir: tmpDir,
      });

      emitter.emit("test_event", { test: "data" });

      await finalizeAudit(emitter);

      // Read audit log
      const auditPath = path.join(tmpDir, "audit.ndjson");
      const content = await fs.promises.readFile(auditPath, "utf-8");
      const event = JSON.parse(content.trim());

      // Should have all context types
      expect(event.context.git).toBeDefined();
      expect(event.context.ci).toBeDefined();
      expect(event.context.os).toBeDefined();
    });
  });
});
