#!/usr/bin/env node
/**
 * Example: Using TokenLogger to track instruction and persona file loading
 *
 * This demonstrates how to instrument code to track token usage.
 */

import { createTokenLogger } from "../src/monitoring/tokenLogger.js";
import * as fs from "fs";
import * as path from "path";

async function trackFileLoading(profileDir: string) {
  const logger = createTokenLogger({ profileDir });

  console.log("📊 Tracking token usage for file loading...\n");

  // Example 1: Track instruction files
  const instructionFiles = ["AGENTS.md", ".github/copilot-instructions.md", "CLAUDE.md"];

  for (const file of instructionFiles) {
    if (fs.existsSync(file)) {
      logger.logFile("load-instruction", file, {
        type: "instruction",
        stage: "startup",
      });
      console.log(`✓ Logged: ${file}`);
    }
  }

  // Example 2: Track persona files
  const personaDir = path.join(profileDir, "personas");
  if (fs.existsSync(personaDir)) {
    const personaFiles = fs
      .readdirSync(personaDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(personaDir, f));

    for (const file of personaFiles) {
      logger.logFile("load-persona", file, {
        type: "persona",
        stage: "startup",
      });
      console.log(`✓ Logged: ${file}`);
    }
  }

  // Example 3: Track CLI operation
  logger.logText("cli-operation", "merge-weave", "Command execution context...", {
    command: "merge-weave",
    prCount: 5,
    conflicts: 2,
  });
  console.log(`✓ Logged: merge-weave operation`);

  // Example 4: Track tool response
  const gitOutput = "On branch main\nYour branch is up to date...";
  logger.logText("tool-response", "git-status", gitOutput, {
    tool: "git",
    command: "status",
  });
  console.log(`✓ Logged: git status response`);

  await logger.close();

  console.log("\n✅ Token usage logged to:", logger.getLogFilePath());
  console.log("\n💡 View report with: lex-pr token-report --profile-dir", profileDir);
}

// Example usage
const profileDir = process.argv[2] || ".smartergpt.local";
trackFileLoading(profileDir).catch(console.error);
