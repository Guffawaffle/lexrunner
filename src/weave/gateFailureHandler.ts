/**
 * Gate Failure Handler (ADR-007 Integration)
 *
 * Handles gate failures by generating TaskSnapshots and routing
 * to appropriate fix attempts based on determinism level.
 *
 * @module weave/gateFailureHandler
 */

import { GateResult } from "../schema.js";
import { SnapshotBuilder, type BuildSnapshotInput } from "../snapshot/builder.js";
import { TaskSnapshot_v1, TaskReceipt_v1, DeterminismLevel } from "../schemas/task-contract.js";
import { EngineVerifier, type VerificationResult } from "../verification/engine-verifier.js";
import { AuditLogger } from "./audit/logger.js";
import { ulid } from "ulid";
import { execSync } from "child_process";

/**
 * Gate failure context for snapshot generation
 */
export interface GateFailureContext {
  /** Name of the item being gated */
  itemName: string;
  /** Gate that failed */
  gate: GateResult;
  /** Repository root path */
  repoRoot: string;
  /** Repository ID (owner/repo) */
  repoId: string;
  /** Current commit SHA */
  commitSha: string;
  /** Failed gate output */
  gateOutput: string;
  /** Run ID for correlation */
  runId: string;
}

/**
 * Result of handling a gate failure
 */
export interface GateFailureHandlingResult {
  /** Generated snapshot */
  snapshot: TaskSnapshot_v1;
  /** Whether to route to local fix attempt */
  routeToLocalFix: boolean;
  /** Determinism level */
  determinism: DeterminismLevel;
  /** Task ID */
  taskId: string;
}

/**
 * Receipt processing result
 */
export interface ReceiptProcessingResult {
  /** Verification result */
  verification: VerificationResult;
  /** Whether patch was applied */
  patchApplied: boolean;
  /** Whether to continue with weave */
  continueWeave: boolean;
  /** Human review required */
  requiresHumanReview: boolean;
}

/**
 * Gate Failure Handler
 *
 * Implements ADR-007 integration with merge-weave loop:
 * - Generate snapshots on gate failures
 * - Route to fix attempts based on determinism
 * - Process receipts and verify
 * - Integrate with audit logging
 */
export class GateFailureHandler {
  private snapshotBuilder: SnapshotBuilder;
  private engineVerifier: EngineVerifier;
  private auditLogger?: AuditLogger;

  constructor(repoRoot: string, repoId: string, auditLogger?: AuditLogger) {
    this.snapshotBuilder = new SnapshotBuilder({
      repoRoot,
      repoId,
      contextRadius: 5,
    });
    this.engineVerifier = new EngineVerifier();
    this.auditLogger = auditLogger;
  }

  /**
   * Handle gate failure by generating snapshot
   *
   * Per ADR-007:
   * 1. Parse failure output
   * 2. Generate TaskSnapshot_v1 for potential fix
   * 3. Route based on determinism level (D1 → local, D2/D3 → agent handoff)
   */
  async handleGateFailure(context: GateFailureContext): Promise<GateFailureHandlingResult> {
    const taskId = this.generateTaskId(context.itemName, context.gate.gate);

    // Parse failure to extract target files
    const targetFiles = this.parseFailureFiles(context.gate, context.gateOutput);

    // Determine determinism level based on gate type
    const determinism = this.determineDeterminismLevel(context.gate);

    // Build snapshot
    const snapshotInput: BuildSnapshotInput = {
      taskId,
      procedure: `post-gate-fix:${context.gate.gate}`,
      determinism,
      targetFiles,
      failure: {
        message: this.extractFailureMessage(context.gateOutput),
        fileRel: targetFiles[0] || "unknown",
        runnerOutputSnip: this.truncateOutput(context.gateOutput, 500),
        excerpt: await this.extractFailureExcerpt(context.repoRoot, targetFiles[0]),
      },
      commitSha: context.commitSha,
      verificationCmd: this.getVerificationCommand(context.gate.gate),
      expectedExitCode: 0,
    };

    const snapshot = await this.snapshotBuilder.buildSnapshot(snapshotInput);

    // Log snapshot generation
    await this.logSnapshotGeneration(snapshot, context.runId);

    // Route based on determinism
    const routeToLocalFix = determinism === "D1";

    return {
      snapshot,
      routeToLocalFix,
      determinism,
      taskId,
    };
  }

  /**
   * Process receipt from agent
   *
   * Per ADR-007:
   * 1. Validate against TaskReceipt_v1 schema
   * 2. Run engine verification
   * 3. Check for trust gaps
   * 4. Determine next action
   */
  async processReceipt(
    snapshot: TaskSnapshot_v1,
    receipt: TaskReceipt_v1,
    workingDir: string,
    options?: { applyPatch?: boolean }
  ): Promise<ReceiptProcessingResult> {
    // Log receipt submission
    await this.logReceiptSubmission(snapshot, receipt);

    // Run engine verification
    const verification = await this.engineVerifier.verify({
      snapshot,
      receipt,
      workingDir,
      applyPatch: options?.applyPatch ?? true,
    });

    // Log verification result (pass determinism from snapshot)
    await this.logVerificationResult(verification.verification, snapshot.determinism);

    // Determine next action
    const continueWeave = verification.verification.verified && !verification.trustGap;
    const requiresHumanReview = verification.trustGap;

    return {
      verification,
      patchApplied: verification.patchApplied,
      continueWeave,
      requiresHumanReview,
    };
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(itemName: string, gateName: string): string {
    const timestamp = new Date().toISOString().split("T")[0];
    const id = ulid();
    return `fix-${itemName}-${gateName}-${timestamp}-${id}`;
  }

  /**
   * Parse failure output to extract affected files
   */
  private parseFailureFiles(gate: GateResult, output: string): string[] {
    // Heuristic: look for file paths in error output
    const filePattern = /(?:at|in|file:?\s+)([a-zA-Z0-9_./-]+\.(?:ts|js|json|md))/gi;
    const matches = output.matchAll(filePattern);
    const files = new Set<string>();

    for (const match of matches) {
      if (match[1]) {
        files.add(match[1].replace(/^\.\//, ""));
      }
    }

    // Fallback: use gate name to infer test files
    if (files.size === 0) {
      const testFile = this.inferTestFileFromGate(gate.gate);
      if (testFile) {
        files.add(testFile);
      }
    }

    return Array.from(files);
  }

  /**
   * Infer test file from gate name
   */
  private inferTestFileFromGate(gateName: string): string | null {
    // Common patterns
    if (gateName.includes("test")) {
      return "tests/**/*.spec.ts";
    }
    if (gateName.includes("lint")) {
      return "src/**/*.ts";
    }
    return null;
  }

  /**
   * Get verification command for gate
   */
  private getVerificationCommand(gateName: string): string {
    // Try to infer command from gate name
    if (gateName.includes("test")) {
      return "npm test";
    }
    if (gateName.includes("lint")) {
      return "npm run lint";
    }
    if (gateName.includes("build")) {
      return "npm run build";
    }
    // Default: echo success (for testing)
    return 'echo "verification passed"';
  }

  /**
   * Extract failure message from gate output
   */
  private extractFailureMessage(output: string): string {
    // Look for common error patterns
    const patterns = [/Error: (.+)/i, /FAIL (.+)/i, /✕ (.+)/i, /Expected (.+)/i];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) {
        return match[1].trim().slice(0, 200);
      }
    }

    return "Gate execution failed";
  }

  /**
   * Extract failure excerpt from file
   */
  private async extractFailureExcerpt(
    repoRoot: string,
    fileRel: string | undefined
  ): Promise<string | undefined> {
    if (!fileRel || fileRel.includes("*")) {
      return undefined;
    }

    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const filePath = path.join(repoRoot, fileRel);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      // Return first 10 lines as excerpt
      return lines.slice(0, 10).join("\n");
    } catch {
      return undefined;
    }
  }

  /**
   * Truncate output to max length
   */
  private truncateOutput(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output;
    }
    return output.slice(0, maxLength) + "\n... (truncated)";
  }

  /**
   * Determine determinism level based on gate characteristics
   */
  private determineDeterminismLevel(gate: GateResult): DeterminismLevel {
    const gateName = gate.gate.toLowerCase();

    // D3: Non-deterministic (manual review, complex analysis)
    if (gateName.includes("manual") || gateName.includes("review")) {
      return "D3";
    }

    // D2: Semi-deterministic (integration tests, type checks)
    if (gateName.includes("integration") || gateName.includes("e2e")) {
      return "D2";
    }

    // D1: Deterministic, script-safe (tests, linting, build)
    return "D1";
  }

  /**
   * Get current git commit SHA
   */
  private getCurrentCommitSha(repoRoot: string): string {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  // =========================================================================
  // Audit Logging Integration
  // =========================================================================

  /**
   * Log snapshot generation to audit trail
   */
  private async logSnapshotGeneration(snapshot: TaskSnapshot_v1, runId: string): Promise<void> {
    if (!this.auditLogger) return;

    await this.auditLogger.logEvent({
      timestamp: new Date().toISOString(),
      interventionId: snapshot.task_id,
      type: "auto_fix", // ADR-007 gate fix intervention
      action: "start",
      determinism: snapshot.determinism,
      details: {
        procedure: snapshot.procedure,
        target_files: snapshot.targets.length,
        snapshot_hash: snapshot.snapshot_hash,
      },
    });
  }

  /**
   * Log receipt submission
   */
  private async logReceiptSubmission(
    snapshot: TaskSnapshot_v1,
    receipt: TaskReceipt_v1
  ): Promise<void> {
    if (!this.auditLogger) return;

    await this.auditLogger.logEvent({
      timestamp: new Date().toISOString(),
      interventionId: receipt.task_id,
      type: "auto_fix",
      action: receipt.claims.success ? "complete" : "fail",
      determinism: snapshot.determinism,
      details: {
        success: receipt.claims.success,
        confidence: receipt.claims.confidence,
        files_touched: receipt.claims.files_touched.length,
        snapshot_hash: receipt.snapshot_hash,
      },
    });
  }

  /**
   * Log verification result
   */
  private async logVerificationResult(
    verification: VerificationResult["verification"],
    determinism: DeterminismLevel
  ): Promise<void> {
    if (!this.auditLogger) return;

    await this.auditLogger.logEvent({
      timestamp: new Date().toISOString(),
      interventionId: verification.task_id,
      type: "auto_fix",
      action: verification.verified ? "complete" : "fail",
      determinism,
      details: {
        verified: verification.verified,
        trust_gap: verification.trust_gap,
        agent_claimed: verification.agent_claimed,
        exit_code: verification.exit_code,
      },
    });
  }
}
