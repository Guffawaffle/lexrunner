/**
 * Engine Verifier (ADR-007)
 *
 * Implements the "trust but verify" pattern for agent task completion.
 */

import { exec } from "child_process";
import { promisify } from "util";
import {
  TaskSnapshot_v1,
  TaskReceipt_v1,
  EngineVerification_v1,
  verifySnapshotBinding,
  computeCanonicalHash,
} from "../schemas/task-contract.js";
import { DiffApplier } from "./diff-applier.js";
import { SnapshotMismatchError, VerificationTimeoutError } from "./errors.js";

const execAsync = promisify(exec);

export interface VerifyOptions {
  snapshot: TaskSnapshot_v1;
  receipt: TaskReceipt_v1;
  workingDir: string;
  applyPatch?: boolean; // Default: true
}

export interface VerificationResult {
  verification: EngineVerification_v1;
  trustGap: boolean;
  patchApplied: boolean;
}

interface CmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class EngineVerifier {
  async verify(options: VerifyOptions): Promise<VerificationResult> {
    const { snapshot, receipt, workingDir, applyPatch = true } = options;

    // 1. Verify snapshot binding
    if (!verifySnapshotBinding(snapshot, receipt.snapshot_hash)) {
      throw new SnapshotMismatchError(snapshot.snapshot_hash, receipt.snapshot_hash);
    }

    // 2. Apply patch if provided
    let patchApplied = false;
    if (applyPatch && receipt.claims.patch) {
      await this.applyUnifiedDiff(receipt.claims.patch, workingDir);
      patchApplied = true;
    }

    // 3. Run verification command
    const result = await this.runVerificationCmd(snapshot.verification, workingDir);

    // 4. Check verification expectations
    const verified = this.checkExpectations(snapshot.verification.expect, result);

    // 5. Detect trust gap
    const trustGap = receipt.claims.success && !verified;

    // 6. Build verification record
    const verification: EngineVerification_v1 = {
      task_id: snapshot.task_id,
      timestamp: new Date().toISOString(),
      snapshot_hash: snapshot.snapshot_hash,
      receipt_hash: computeCanonicalHash(receipt),
      verified,
      cmd_ran: snapshot.verification.cmd,
      exit_code: result.exitCode,
      stdout_snip: result.stdout,
      stderr_snip: result.stderr,
      patch_hash: receipt.claims.patch ? computeCanonicalHash(receipt.claims.patch) : undefined,
      patch_applied: patchApplied,
      agent_claimed: receipt.claims.success,
      trust_gap: trustGap,
      failures: [],
    };

    return { verification, trustGap, patchApplied };
  }

  /**
   * Apply unified diff to working directory
   */
  private async applyUnifiedDiff(unifiedDiff: string, workingDir: string): Promise<void> {
    const applier = new DiffApplier({ workingDir });
    await applier.apply(unifiedDiff);
  }

  /**
   * Run verification command and capture results
   *
   * SECURITY NOTE: This executes the command specified in the TaskSnapshot.
   * The snapshot should be created by a trusted source and validated before use.
   * In a production system, consider implementing command allowlisting or sandboxing.
   */
  private async runVerificationCmd(
    verification: TaskSnapshot_v1["verification"],
    cwd: string
  ): Promise<CmdResult> {
    const startTime = Date.now();
    const timeout = 60000; // Default 60s

    try {
      const { stdout, stderr } = await execAsync(verification.cmd, {
        cwd,
        timeout,
        encoding: "utf8",
      });

      const durationMs = Date.now() - startTime;

      return {
        exitCode: 0,
        stdout: stdout || "",
        stderr: stderr || "",
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Handle timeout
      if (error.killed && error.signal === "SIGTERM") {
        throw new VerificationTimeoutError(timeout);
      }

      // Handle non-zero exit code
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        durationMs,
      };
    }
  }

  /**
   * Check if verification output meets expectations
   */
  private checkExpectations(
    expect: TaskSnapshot_v1["verification"]["expect"],
    result: CmdResult
  ): boolean {
    // Check exit code
    if (expect.exit_code !== undefined && result.exitCode !== expect.exit_code) {
      return false;
    }

    // Check must_include patterns
    const output = result.stdout + result.stderr;
    for (const pattern of expect.must_include ?? []) {
      if (!output.includes(pattern)) {
        return false;
      }
    }

    // Check must_not_include patterns
    for (const pattern of expect.must_not_include ?? []) {
      if (output.includes(pattern)) {
        return false;
      }
    }

    return true;
  }
}
