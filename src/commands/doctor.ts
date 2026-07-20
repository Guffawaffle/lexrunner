/**
 * Doctor command - Environment and config sanity checks
 */

import { Command } from "commander";
import { loadPlan } from "../schema.js";
import {
  bootstrapWorkspace,
  createMinimalWorkspace,
  detectProjectType,
  getEnvironmentSuggestions,
} from "../core/bootstrap.js";
import { WriteProtectionError } from "../config/profileResolver.js";
import { createGitHubAPI } from "../github/api.js";
import { createGitOperations } from "../git/operations.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import { initColorControl } from "../util/colorControl.js";
import { runEnvironmentQualityCheck, formatHostilityReport } from "../hostility/index.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Perform all doctor checks and return results
 */
async function performDoctorChecks(includeEnvironmentQuality: boolean = false): Promise<any> {
  const checks: any = {
    hasErrors: false,
    issues: [],
    suggestions: [],
  };

  // Node.js version check
  try {
    const nvmrcContent = fs.readFileSync(".nvmrc", "utf-8").trim();
    const currentVersion = process.version.slice(1);
    const expectedVersion = nvmrcContent;

    if (currentVersion === expectedVersion) {
      checks.nodejs = {
        status: "ok",
        current: process.version,
        expected: `v${expectedVersion}`,
      };
    } else {
      checks.nodejs = {
        status: "mismatch",
        current: process.version,
        expected: `v${expectedVersion}`,
      };
      checks.hasErrors = true;
      checks.issues.push(`Node.js version mismatch: ${process.version} vs v${expectedVersion}`);
    }
  } catch (error) {
    // If a HIPAA prefixed error made it here, ensure we exit with code 2
    if (
      error instanceof Error &&
      typeof error.message === "string" &&
      error.message.startsWith("HIPAA:")
    ) {
      process.stderr.write(`${error.message.replace(/^HIPAA:\s*/, "")}\n`);
      process.exitCode = 2;
      return;
    }
    checks.nodejs = { status: "no_constraint", current: process.version };
    checks.suggestions.push("Consider adding .nvmrc file for Node.js version consistency");
  }

  // Configuration check
  const bootstrap = bootstrapWorkspace();
  checks.configuration = {
    hasConfiguration: bootstrap.hasConfiguration,
    missingFiles: bootstrap.missingFiles,
    suggestions: bootstrap.suggestions,
  };

  // Project type detection
  checks.projectType = detectProjectType();

  // Environment suggestions
  checks.environmentSuggestions = getEnvironmentSuggestions();

  // GitHub integration
  try {
    const githubAPI = await createGitHubAPI();
    if (githubAPI) {
      const authStatus = await githubAPI.checkAuth();
      checks.github = {
        detected: true,
        authenticated: authStatus.authenticated,
        user: authStatus.user,
      };
    } else {
      checks.github = { detected: false };
    }
  } catch (error) {
    checks.github = {
      detected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Git operations
  try {
    const gitOps = createGitOperations();
    const isClean = await gitOps.isClean();
    const currentBranch = await gitOps.getCurrentBranch();

    checks.git = {
      status: "ok",
      isClean,
      currentBranch,
    };
  } catch (error) {
    checks.git = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    checks.hasErrors = true;
    checks.issues.push(
      `Git operations failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Environment quality check (hostility scoring) if requested
  if (includeEnvironmentQuality) {
    checks.environmentQuality = runEnvironmentQualityCheck();
  }

  return checks;
}

/**
 * Register the doctor command with the CLI program
 */
export function registerDoctorCommand(program: Command, jsonModeActive?: () => boolean): void {
  program
    .command("doctor")
    .description("Environment and config sanity checks (canonical: lex-pr workspace doctor)")
    .option("--bootstrap", "Create minimal workspace configuration if missing")
    .option("--json", "Output JSON format")
    .option("--environment-quality", "Run environmental hostility scoring")
    .action(async (opts) => {
      let hasErrors = false;
      const issues: string[] = [];
      const suggestions: string[] = [];

      // Check if JSON mode is active (from global flag or command flag)
      const isJsonMode = opts.json || (jsonModeActive && jsonModeActive());

      if (isJsonMode) {
        // Initialize color control to set JSON mode globally
        initColorControl({ jsonMode: true });

        // JSON mode for programmatic use
        const result = await performDoctorChecks(opts.environmentQuality);
        writeJsonOutput(result);
        if (result.hasErrors) {
          throwExit(1);
        }
        return;
      }

      // If only environment quality is requested, show that report
      if (opts.environmentQuality) {
        const score = runEnvironmentQualityCheck();
        console.log(formatHostilityReport(score));
        console.log("");

        // Exit with error if hostility is high
        if (score.status === "high") {
          throwExit(1);
        }
        return;
      }

      console.log("🩺 Doctor - Environment and config sanity checks");
      console.log("");

      // Check Node.js version against .nvmrc
      try {
        const nvmrcContent = fs.readFileSync(".nvmrc", "utf-8").trim();
        const currentVersion = process.version.slice(1); // Remove 'v' prefix
        const expectedVersion = nvmrcContent;

        if (currentVersion === expectedVersion) {
          console.log(`✓ Node.js version: ${process.version} (matches .nvmrc)`);
        } else {
          console.log(`✗ Node.js version mismatch:`);
          console.log(`  Current: ${process.version}`);
          console.log(`  Expected: v${expectedVersion} (from .nvmrc)`);
          hasErrors = true;
        }
      } catch (error) {
        console.log("ℹ .nvmrc file not found");
        console.log("✓ Node.js version:", process.version, "(no .nvmrc constraint)");
      }

      // Check npm version against packageManager field
      try {
        const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        const expectedNpmVersion = packageJson.packageManager?.replace("npm@", "");

        if (expectedNpmVersion) {
          const { spawn } = await import("child_process");
          const npmVersionProcess = spawn("npm", ["--version"], {
            stdio: "pipe",
          });

          let npmVersion = "";
          npmVersionProcess.stdout.on("data", (data) => {
            npmVersion += data.toString().trim();
          });

          await new Promise((resolve) => {
            npmVersionProcess.on("close", resolve);
          });

          if (npmVersion === expectedNpmVersion) {
            console.log(`✓ npm version: ${npmVersion} (matches packageManager)`);
          } else {
            console.log(`✗ npm version mismatch:`);
            console.log(`  Current: ${npmVersion}`);
            console.log(`  Expected: ${expectedNpmVersion} (from packageManager field)`);
            hasErrors = true;
          }
        } else {
          console.log("✓ npm version: no packageManager constraint in package.json");
        }
      } catch (error) {
        console.log(
          "✗ Could not check npm version:",
          error instanceof Error ? error.message : String(error)
        );
        hasErrors = true;
      }

      // Check git configuration
      try {
        const { spawn } = await import("child_process");

        // Check git user.name
        const gitNameProcess = spawn("git", ["config", "user.name"], {
          stdio: "pipe",
        });
        let gitName = "";
        gitNameProcess.stdout.on("data", (data) => {
          gitName += data.toString().trim();
        });

        await new Promise((resolve) => {
          gitNameProcess.on("close", resolve);
        });

        // Check git user.email
        const gitEmailProcess = spawn("git", ["config", "user.email"], {
          stdio: "pipe",
        });
        let gitEmail = "";
        gitEmailProcess.stdout.on("data", (data) => {
          gitEmail += data.toString().trim();
        });

        await new Promise((resolve) => {
          gitEmailProcess.on("close", resolve);
        });

        if (gitName && gitEmail) {
          console.log(`✓ Git config: user.name="${gitName}", user.email="${gitEmail}"`);
        } else {
          console.log("✗ Git configuration incomplete:");
          if (!gitName) console.log("  Missing user.name");
          if (!gitEmail) console.log("  Missing user.email");
          hasErrors = true;
        }
      } catch (error) {
        console.log(
          "✗ Could not check git configuration:",
          error instanceof Error ? error.message : String(error)
        );
        hasErrors = true;
      }

      // Check platform and working directory
      console.log(`✓ Platform: ${process.platform}`);
      console.log(`✓ Working directory: ${process.cwd()}`);

      // Check for plan.json and validate it
      const planExists = fs.existsSync("plan.json");
      if (planExists) {
        try {
          const planContent = fs.readFileSync("plan.json", "utf-8");
          const plan = loadPlan(planContent);
          console.log(
            `✓ plan.json: valid (${plan.items.length} items, schema ${plan.schemaVersion})`
          );
        } catch (error) {
          console.log(
            "✗ plan.json validation failed:",
            error instanceof Error ? error.message : String(error)
          );
          hasErrors = true;
        }
      } else {
        console.log("ℹ plan.json: not found (run 'lex-pr plan' to generate)");
      }

      // Check .smartergpt directory structure with runner/ support
      const smartergptDir = ".smartergpt";
      if (fs.existsSync(smartergptDir)) {
        const expectedFiles = ["intent.md", "scope.yml", "deps.yml", "gates.yml"];
        const runnerDir = path.join(smartergptDir, "runner");

        // Check both runner/ and flat structure
        const missingFiles = expectedFiles.filter((file) => {
          const runnerPath = path.join(runnerDir, file);
          const flatPath = path.join(smartergptDir, file);
          return !fs.existsSync(runnerPath) && !fs.existsSync(flatPath);
        });

        if (missingFiles.length === 0) {
          console.log(`✓ .smartergpt: all expected files present`);
        } else {
          console.log(`ℹ .smartergpt: missing optional files: ${missingFiles.join(", ")}`);
        }
      } else {
        console.log("ℹ .smartergpt: directory not found (create for project configuration)");
      }

      // Enhanced configuration checks with bootstrap
      const bootstrap = bootstrapWorkspace();
      const projectType = detectProjectType();
      const envSuggestions = getEnvironmentSuggestions();

      console.log(`📁 Project type: ${projectType}`);
      console.log("");

      // Configuration assessment
      if (bootstrap.hasConfiguration) {
        console.log("✓ .smartergpt: configuration complete");
      } else {
        console.log(`ℹ .smartergpt: missing ${bootstrap.missingFiles.length} files`);
        bootstrap.missingFiles.forEach((file) => {
          console.log(`  - ${file}`);
        });

        if (opts.bootstrap) {
          console.log("");
          console.log("🔧 Creating minimal workspace configuration...");
          try {
            createMinimalWorkspace();
            console.log("✓ Minimal configuration created");
          } catch (error) {
            if (error instanceof WriteProtectionError) {
              console.error(`❌ ${error.message}`);
              throwExit(2);
            }
            throw error;
          }
        } else {
          console.log("");
          console.log("💡 Use --bootstrap to create minimal configuration");
        }
      }

      // Environment suggestions
      if (envSuggestions.length > 0) {
        console.log("");
        console.log("💡 Environment suggestions:");
        envSuggestions.forEach((suggestion) => {
          console.log(`  - ${suggestion}`);
        });
      }

      // GitHub integration check
      try {
        const githubAPI = await createGitHubAPI();
        if (githubAPI) {
          const authStatus = await githubAPI.checkAuth();
          if (authStatus.authenticated) {
            console.log(`✓ GitHub: authenticated as ${authStatus.user}`);
          } else {
            console.log("ℹ GitHub: not authenticated (set GITHUB_TOKEN for API access)");
          }
        } else {
          console.log("ℹ GitHub: repository not detected or not GitHub-hosted");
        }
      } catch (error) {
        console.log(
          `ℹ GitHub: integration check failed (${
            error instanceof Error ? error.message : String(error)
          })`
        );
      }

      // Git operations check
      try {
        const gitOps = createGitOperations();
        const isClean = await gitOps.isClean();
        const currentBranch = await gitOps.getCurrentBranch();

        console.log(`✓ Git: working directory ${isClean ? "clean" : "has changes"}`);
        console.log(`✓ Git: current branch '${currentBranch}'`);
      } catch (error) {
        console.log(
          `✗ Git: operations check failed (${
            error instanceof Error ? error.message : String(error)
          })`
        );
        hasErrors = true;
      }

      console.log("");
      if (hasErrors) {
        console.log("❌ Doctor found issues that need attention");
        throwExit(1);
      } else {
        console.log("✅ All checks passed - environment looks good!");

        if (!bootstrap.hasConfiguration) {
          console.log("");
          console.log("Next steps:");
          console.log("1. Run 'lex-pr doctor --bootstrap' to create minimal configuration");
          console.log("2. Customize .smartergpt/ files for your project");
          console.log("3. Run 'lex-pr discover' to find open PRs");
        }

        return;
      }
    });
}
