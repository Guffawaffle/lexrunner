/**
 * Enterprise Security Integration Example
 *
 * Demonstrates how to use all security features together in a production environment
 */

import {
  AuthenticationManager,
  AuthorizationService,
  EnterpriseAuditService,
  SecretsManager,
  SecurityScanningService,
  CompliancePolicyService,
  ComplianceFormat,
  Permission,
} from "../src/security";

/**
 * Example: Complete security-enabled autopilot execution
 */
async function secureAutopilotExecution(autopilotLevel: number) {
  try {
    // Step 1: Initialize secrets manager
    const secretsManager = new SecretsManager();

    // Validate required secrets
    const secretValidation = await secretsManager.validateSecrets(["GITHUB_TOKEN"]);

    if (!secretValidation.valid) {
      throw new Error(`Missing required secrets: ${secretValidation.missing.join(", ")}`);
    }

    // Step 2: Initialize authentication
    const authManager = new AuthenticationManager();
    const authContext = await authManager.initialize();

    console.log(`✓ Authenticated as: ${authContext.user}`);
    console.log(`  Roles: ${authContext.roles.join(", ")}`);
    console.log(`  Method: ${authContext.method}`);

    // Step 3: Check authorization
    const authService = new AuthorizationService();

    // Enforce autopilot level permission
    try {
      authService.enforceAutopilotLevel(authContext, autopilotLevel);
      console.log(`✓ Authorized for autopilot level ${autopilotLevel}`);
    } catch (error) {
      const maxLevel = authService.getMaxAutopilotLevel(authContext);
      console.error(`✗ Authorization failed. Max level: ${maxLevel}`);
      throw error;
    }

    // Step 4: Initialize audit service with signing
    const auditService = new EnterpriseAuditService(
      (await secretsManager.getSecret("AUDIT_SIGNING_KEY")) || undefined
    );

    // Log the start of operation
    const correlationId = `autopilot-${Date.now()}`;
    auditService.logSecure(
      "autopilot_start",
      "initiated",
      {
        level: autopilotLevel,
        user: authContext.user,
        timestamp: new Date().toISOString(),
      },
      authContext,
      correlationId
    );

    // Step 5: Run security scan
    const scanService = new SecurityScanningService({
      blockCritical: true,
      blockHigh: true,
      maxMedium: 5,
      maxLow: 10,
    });

    console.log("\n🔍 Running security scan...");
    const scanResults = await scanService.scanAll();

    for (const result of scanResults) {
      const evaluation = scanService.evaluatePolicy(result);

      if (!evaluation.passed) {
        // Log security scan failure
        auditService.logSecure(
          "security_scan",
          "failed",
          {
            scanner: result.scanner,
            violations: evaluation.violations,
            criticalCount: result.criticalCount,
            highCount: result.highCount,
          },
          authContext,
          correlationId
        );

        throw new Error(`Security scan failed: ${evaluation.violations.join("; ")}`);
      }

      console.log(
        `✓ ${result.scanner}: ${result.totalVulnerabilities} vulnerabilities (within policy)`
      );
    }

    auditService.logSecure(
      "security_scan",
      "passed",
      {
        totalScanners: scanResults.length,
      },
      authContext,
      correlationId
    );

    // Step 6: Check compliance policy (for merge operations)
    if (autopilotLevel >= 4) {
      const policyService = new CompliancePolicyService();

      // Example PR approval status
      const prStatus = {
        prNumber: 101,
        approvals: [{ reviewer: "reviewer1", timestamp: new Date() }],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const mergeCheck = policyService.checkMergeOperation(prStatus, "main", "squash", authContext);

      if (!mergeCheck.allowed) {
        auditService.logSecure(
          "policy_check",
          "failed",
          {
            violations: mergeCheck.violations,
            warnings: mergeCheck.warnings,
          },
          authContext,
          correlationId
        );

        throw new Error(`Policy violations: ${mergeCheck.violations.join("; ")}`);
      }

      auditService.logSecure(
        "policy_check",
        "passed",
        {
          prNumber: prStatus.prNumber,
          approvals: prStatus.approvals.length,
        },
        authContext,
        correlationId
      );

      console.log("✓ Compliance policy checks passed");
    }

    // Step 7: Execute autopilot (simulated)
    console.log(`\n🤖 Executing autopilot level ${autopilotLevel}...`);

    // Simulate execution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Log successful completion
    auditService.logSecure(
      "autopilot_completion",
      "success",
      {
        level: autopilotLevel,
        duration: "1s",
      },
      authContext,
      correlationId
    );

    console.log("✓ Autopilot execution completed successfully");

    // Step 8: Generate compliance report
    console.log("\n📊 Generating compliance reports...");

    const soxReport = auditService.generateComplianceReport(ComplianceFormat.SOX);
    console.log(`✓ SOX report generated (${soxReport.totalEntries} entries)`);

    const soc2Report = auditService.generateComplianceReport(ComplianceFormat.SOC2);
    console.log(`✓ SOC2 report generated (${soc2Report.totalEntries} entries)`);

    // Export reports
    // auditService.exportReport(soxReport, './reports/sox-compliance.json');
    // auditService.exportReport(soc2Report, './reports/soc2-compliance.json');

    console.log("\n✅ Secure autopilot execution completed with full audit trail");
  } catch (error) {
    console.error("\n❌ Execution failed:", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Example: Secret rotation check
 */
async function checkSecretRotation() {
  const secretsManager = new SecretsManager();

  const secrets = ["GITHUB_TOKEN", "API_KEY", "DATABASE_URL"];
  const maxAgeDays = 90;

  console.log("\n🔐 Checking secret rotation status...");

  for (const secretId of secrets) {
    const needsRotation = await secretsManager.checkRotationNeeded(secretId, maxAgeDays);

    if (needsRotation) {
      console.log(`⚠️  ${secretId}: Needs rotation (>${maxAgeDays} days old)`);
    } else {
      console.log(`✓ ${secretId}: Within rotation window`);
    }
  }
}

/**
 * Example: Custom role-based workflow
 */
async function roleBasedWorkflow() {
  const authManager = new AuthenticationManager();
  const authService = new AuthorizationService();

  const authContext = await authManager.initialize();
  const permissions = authService.getUserPermissions(authContext);

  console.log(`\n👤 User: ${authContext.user}`);
  console.log(`   Roles: ${authContext.roles.join(", ")}`);
  console.log(`   Permissions: ${permissions.join(", ")}`);

  // Determine allowed actions
  const actions = [];

  if (authService.hasPermission(authContext, Permission.READ)) {
    actions.push("View plans and reports");
  }

  if (authService.hasPermission(authContext, Permission.ARTIFACTS)) {
    actions.push("Generate execution artifacts");
  }

  if (authService.hasPermission(authContext, Permission.ANNOTATE)) {
    actions.push("Add PR comments and status updates");
  }

  if (authService.hasPermission(authContext, Permission.CREATE_PR)) {
    actions.push("Create integration branches and PRs");
  }

  if (authService.hasPermission(authContext, Permission.MERGE)) {
    actions.push("Execute full automation with merges");
  }

  console.log("\n✓ Allowed actions:");
  actions.forEach((action) => console.log(`  - ${action}`));
}

/**
 * Main execution
 */
async function main() {
  console.log("🔒 Enterprise Security Integration Example\n");
  console.log("=".repeat(50));

  try {
    // Example 1: Secure autopilot execution
    await secureAutopilotExecution(2);

    // Example 2: Secret rotation check
    // await checkSecretRotation();

    // Example 3: Role-based workflow
    // await roleBasedWorkflow();
  } catch (error) {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  }
}

// Run example if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { secureAutopilotExecution, checkSecretRotation, roleBasedWorkflow };
