/**
 * Audit verify command
 *
 * Verifies signatures on audit manifest files
 */

import { verifyManifestSignature, VerificationResult } from "../../audit/signing.js";

/**
 * Standardized audit command result
 */
export interface AuditCommandResult {
  /** Exit code to be used by CLI */
  exitCode: number;
  /** Human-readable report */
  report: string;
  /** Machine-readable verification result */
  result?: VerificationResult;
  /** Status classification */
  status: "verified" | "invalid" | "error";
}

/**
 * Verify audit manifest signature
 */
export async function verifyCommand(manifestPath: string): Promise<AuditCommandResult> {
  try {
    const result = await verifyManifestSignature(manifestPath);

    if (result.valid) {
      const reportLines: string[] = [];
      reportLines.push("✅ Signature verified");
      reportLines.push(`Provider: ${result.provider}`);

      if (result.keyInfo) {
        if (result.provider === "kms") {
          reportLines.push(`Key: ${result.keyInfo}`);
        } else if (result.provider === "gpg") {
          reportLines.push(`Fingerprint: ${result.keyInfo}`);
        }
      }

      if (result.algorithm) {
        reportLines.push(`Algorithm: ${result.algorithm}`);
      }

      if (result.signedAt) {
        reportLines.push(`Signed at: ${result.signedAt}`);
      }

      if (result.manifestHash) {
        reportLines.push(`Manifest SHA-256: ${result.manifestHash}`);
      }

      return {
        exitCode: 0,
        report: reportLines.join("\n"),
        result,
        status: "verified",
      };
    } else {
      const reportLines: string[] = [];
      reportLines.push("❌ Signature verification failed");
      reportLines.push(`Provider: ${result.provider}`);

      if (result.error) {
        reportLines.push(`Error: ${result.error}`);
      }

      return {
        exitCode: 1,
        report: reportLines.join("\n"),
        result,
        status: "invalid",
      };
    }
  } catch (error: any) {
    // Distinguish between file not found (exit 1) and other errors (exit 2)
    const isFileNotFound = error.code === "ENOENT" || error.message?.includes("ENOENT");

    return {
      exitCode: isFileNotFound ? 1 : 2,
      report: `Error: ${error.message}`,
      status: "error",
    };
  }
}
