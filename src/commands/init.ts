/**
 * Interactive initialization command for setting up lexrunner workspace
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import {
  createMinimalWorkspace,
  detectProjectType,
  bootstrapWorkspace,
} from "../core/bootstrap.js";
import {
  WriteProtectionError,
  resolveProfile,
  logProfileMessage,
} from "../config/profileResolver.js";
import { createGitHubClient, GitHubAuthError } from "../github/client.js";

interface InitOptions {
  force?: boolean;
  nonInteractive?: boolean;
  githubToken?: string;
  profileDir?: string;
  jsonMode?: boolean;
}

export interface InitResult {
  success: boolean;
  profileDir: string;
  message: string;
}

/**
 * Run interactive initialization wizard
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const baseDir = process.cwd();

  // Determine profile directory first (before calling bootstrapWorkspace)
  let profileDir: string;
  if (options.profileDir) {
    profileDir = path.isAbsolute(options.profileDir)
      ? options.profileDir
      : path.resolve(baseDir, options.profileDir);
  } else {
    // Default to .smartergpt.local (either as override or new setup)
    profileDir = path.join(baseDir, ".smartergpt.local");

    // Only log in non-JSON mode
    if (!options.jsonMode) {
      // Check if .smartergpt exists (tracked example)
      const trackedExample = path.join(baseDir, ".smartergpt");
      if (fs.existsSync(trackedExample)) {
        logProfileMessage(
          "Found tracked example profile, using .smartergpt.local for your workspace"
        );
      }
    }
  }

  // Check if configuration already exists (only if directory and manifest exist)
  if (fs.existsSync(profileDir) && fs.existsSync(path.join(profileDir, "profile.yml"))) {
    try {
      const bootstrap = bootstrapWorkspace(baseDir, options.profileDir);
      if (bootstrap.hasConfiguration && !options.force) {
        return {
          success: false,
          profileDir: bootstrap.profileDir,
          message: `Configuration already exists at ${bootstrap.profileDir}. Use --force to overwrite.`,
        };
      }
    } catch (error) {
      // If bootstrap fails, we'll create from scratch (might be missing files)
      if (!options.force && !options.jsonMode) {
        logProfileMessage(`Profile directory exists but is incomplete. Use --force to recreate.`);
      }
    }
  }

  // Detect project type
  const projectType = detectProjectType(baseDir);
  if (!options.jsonMode) {
    console.log(`\n🔍 Detected project type: ${projectType}\n`);
  }

  // Interactive setup
  if (!options.nonInteractive && !options.jsonMode) {
    console.log("Welcome to lexrunner setup! 🚀\n");
    console.log("This wizard will help you configure your workspace.\n");

    // GitHub token setup
    const githubToken = options.githubToken || (await promptGitHubToken());

    if (githubToken) {
      try {
        // Validate token by creating a client
        const client = await createGitHubClient({ token: githubToken });
        const repoInfo = await client.validateRepository();
        console.log(`✓ GitHub: Connected to ${repoInfo.owner}/${repoInfo.repo}\n`);

        // Store token suggestion
        console.log("💡 Tip: Store your GitHub token in an environment variable:");
        console.log("   export GITHUB_TOKEN=your_token_here\n");
      } catch (error) {
        if (error instanceof GitHubAuthError) {
          console.log("✗ GitHub authentication failed. Continuing without GitHub integration.\n");
        } else {
          console.log(`ℹ GitHub: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }
  }

  // Create workspace
  try {
    // Ensure profile directory exists and has proper manifest
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Ensure runner/ subdirectory exists for working artifacts
    const runnerDir = path.join(profileDir, "runner");
    fs.mkdirSync(runnerDir, { recursive: true });

    // Create or update profile manifest
    const manifestPath = path.join(profileDir, "profile.yml");
    if (!fs.existsSync(manifestPath)) {
      const manifestContent = `role: local
name: Local Development Profile
description: Auto-generated workspace for local development
`;
      fs.writeFileSync(manifestPath, manifestContent);
    }

    // Create minimal workspace (config at root per v1 spec)
    createMinimalWorkspace(baseDir, profileDir);

    // Create pull-request-template.md at profile root
    const templatePath = path.join(profileDir, "pull-request-template.md");
    if (!fs.existsSync(templatePath)) {
      const templateContent = getPRTemplateContent();
      fs.writeFileSync(templatePath, templateContent);
    }

    // Only show console output if not in JSON mode
    if (!options.jsonMode) {
      console.log(`\n✅ Workspace initialized successfully!\n`);
      console.log(`📂 Profile directory: ${profileDir}`);
      console.log(`\n📝 Created files:`);
      console.log(`   - intent.md (project goals and scope)`);
      console.log(`   - scope.yml (PR discovery rules)`);
      console.log(`   - deps.yml (dependency relationships)`);
      console.log(`   - gates.yml (quality gates configuration)`);
      console.log(`   - pull-request-template.md (PR template with dependency syntax)`);
      console.log(`   - runner/ (working artifacts directory)`);

      console.log(`\n📚 Next steps:`);
      console.log(`   1. Edit ${profileDir}/intent.md to describe your project`);
      console.log(`   2. Configure ${profileDir}/scope.yml for PR discovery`);
      console.log(`   3. Set up quality gates in ${profileDir}/gates.yml`);
      console.log(`   4. Run 'lex-pr doctor' to verify your setup`);
      console.log(`   5. Run 'lex-pr discover' to find open PRs\n`);
    }

    return {
      success: true,
      profileDir,
      message: "Workspace initialized successfully",
    };
  } catch (error) {
    if (error instanceof WriteProtectionError) {
      return {
        success: false,
        profileDir,
        message: `Write protection error: ${error.message}`,
      };
    }
    throw error;
  }
}

/**
 * Prompt for GitHub token
 */
async function promptGitHubToken(): Promise<string> {
  // Check environment first
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    console.log("✓ GitHub token found in environment variables\n");
    return envToken;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("GitHub token (optional, press Enter to skip): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Get PR template content with dependency syntax examples
 */
function getPRTemplateContent(): string {
  return `# Pull Request Template

## Description
<!-- Describe your changes -->

## Dependencies
<!-- Use this section to declare dependencies on other PRs -->
<!-- Syntax examples: -->

<!-- Single dependency -->
<!-- Depends-On: #123 -->

<!-- Multiple dependencies -->
<!-- Depends-On: #123, #456 -->

<!-- Block syntax -->
<!-- Depends-On: -->
<!-- - #123 -->
<!-- - #456 -->

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] All quality gates pass

## Notes
<!-- Any additional context or notes -->
`;
}
