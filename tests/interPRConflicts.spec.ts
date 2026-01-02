/**
 * Tests for inter-PR conflict detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectPreflightConflicts } from "../src/weave/preflightConflicts.js";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";
import { execa } from "execa";

// Skip git-dependent tests unless LEX_GIT_MODE=live
const describeIfGitEnabled = process.env.LEX_GIT_MODE === "live" ? describe : describe.skip;

describeIfGitEnabled("Inter-PR Conflict Detection", () => {
  const tempDir = "/tmp/lex-pr-test-inter-pr-conflicts";

  beforeEach(async () => {
    // Create a test git repository
    if (fs.existsSync(tempDir)) {
      await execa("rm", ["-rf", tempDir]);
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Initialize git repo
    await execa("git", ["init"], { cwd: tempDir });
    await execa("git", ["config", "user.email", "test@example.com"], {
      cwd: tempDir,
    });
    await execa("git", ["config", "user.name", "Test User"], {
      cwd: tempDir,
    });
    await execa("git", ["config", "commit.gpgsign", "false"], {
      cwd: tempDir,
    });

    // Create initial commit on main
    fs.writeFileSync(path.join(tempDir, "file.txt"), "initial content\n");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Initial commit"], {
      cwd: tempDir,
    });
    await execa("git", ["branch", "-M", "main"], { cwd: tempDir });
  });

  afterEach(async () => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      await execa("rm", ["-rf", tempDir]);
    }
  });

  it("should detect inter-PR conflicts when both modify tsconfig.json", async () => {
    // Create branch-1 that modifies tsconfig.json
    await execa("git", ["checkout", "-b", "branch-1"], { cwd: tempDir });
    fs.writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ include: ["src/**/*", "new1/**/*"] }, null, 2)
    );
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add tsconfig with new1"], {
      cwd: tempDir,
    });

    // Create branch-2 that also modifies tsconfig.json
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-2"], { cwd: tempDir });
    fs.writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ include: ["src/**/*", "new2/**/*"] }, null, 2)
    );
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add tsconfig with new2"], {
      cwd: tempDir,
    });

    // Go back to main for detection
    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const plan: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        { name: "branch-1", deps: [], gates: [] },
        { name: "branch-2", deps: [], gates: [] },
      ],
    };

    const result = await detectPreflightConflicts(plan, tempDir);

    // Should detect inter-PR conflict
    expect(result.interPRConflicts).toBeDefined();
    expect(result.interPRConflicts?.length).toBeGreaterThan(0);

    const conflict = result.interPRConflicts?.[0];
    expect(conflict?.item1).toBe("branch-1");
    expect(conflict?.item2).toBe("branch-2");
    expect(conflict?.files).toContain("tsconfig.json");
    expect(conflict?.severity).toBe("possible"); // tsconfig is "possible" conflict
    expect(conflict?.guidance).toBeDefined();
    expect(conflict?.guidance?.type).toBe("auto-merge-safe");
  });

  it("should detect inter-PR conflicts for package-lock.json with likely severity", async () => {
    // Create branch-1 that modifies package-lock.json
    await execa("git", ["checkout", "-b", "branch-1"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ version: 1 }));
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Update package-lock"], {
      cwd: tempDir,
    });

    // Create branch-2 that also modifies package-lock.json
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-2"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ version: 2 }));
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Update package-lock differently"], {
      cwd: tempDir,
    });

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const plan: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        { name: "branch-1", deps: [], gates: [] },
        { name: "branch-2", deps: [], gates: [] },
      ],
    };

    const result = await detectPreflightConflicts(plan, tempDir);

    expect(result.interPRConflicts).toBeDefined();
    expect(result.interPRConflicts?.length).toBeGreaterThan(0);

    const conflict = result.interPRConflicts?.[0];
    expect(conflict?.files).toContain("package-lock.json");
    expect(conflict?.severity).toBe("likely");
    expect(conflict?.guidance?.context?.regenerationCommand).toBe("npm install");
  });

  it("should not detect inter-PR conflicts when PRs modify different files", async () => {
    // Create branch-1 that modifies file1.txt
    await execa("git", ["checkout", "-b", "branch-1"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "file1.txt"), "content 1");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add file1"], { cwd: tempDir });

    // Create branch-2 that modifies file2.txt
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-2"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "file2.txt"), "content 2");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add file2"], { cwd: tempDir });

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const plan: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        { name: "branch-1", deps: [], gates: [] },
        { name: "branch-2", deps: [], gates: [] },
      ],
    };

    const result = await detectPreflightConflicts(plan, tempDir);

    // Should not detect inter-PR conflicts
    expect(result.interPRConflicts).toBeDefined();
    expect(result.interPRConflicts?.length).toBe(0);
  });

  it("should detect multiple inter-PR conflicts when multiple pairs overlap", async () => {
    // Create branch-1 that modifies file1.txt
    await execa("git", ["checkout", "-b", "branch-1"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "shared.txt"), "from branch 1");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Modify shared"], { cwd: tempDir });

    // Create branch-2 that also modifies shared.txt
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-2"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "shared.txt"), "from branch 2");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Modify shared"], { cwd: tempDir });

    // Create branch-3 that also modifies shared.txt
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-3"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "shared.txt"), "from branch 3");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Modify shared"], { cwd: tempDir });

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const plan: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        { name: "branch-1", deps: [], gates: [] },
        { name: "branch-2", deps: [], gates: [] },
        { name: "branch-3", deps: [], gates: [] },
      ],
    };

    const result = await detectPreflightConflicts(plan, tempDir);

    // Should detect conflicts between each pair
    expect(result.interPRConflicts).toBeDefined();
    expect(result.interPRConflicts?.length).toBe(3); // branch-1 <-> branch-2, branch-1 <-> branch-3, branch-2 <-> branch-3
  });

  it("should provide default guidance for unrecognized file types", async () => {
    // Create branch-1 that modifies a regular source file
    await execa("git", ["checkout", "-b", "branch-1"], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "src/index.ts"), "export const a = 1;");
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add index"], { cwd: tempDir });

    // Create branch-2 that modifies the same file
    await execa("git", ["checkout", "main"], { cwd: tempDir });
    await execa("git", ["checkout", "-b", "branch-2"], { cwd: tempDir });
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src/index.ts"), "export const b = 2;");
    await execa("git", ["add", "."], { cwd: tempDir });
    await execa("git", ["commit", "-m", "Add index differently"], {
      cwd: tempDir,
    });

    await execa("git", ["checkout", "main"], { cwd: tempDir });

    const plan: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        { name: "branch-1", deps: [], gates: [] },
        { name: "branch-2", deps: [], gates: [] },
      ],
    };

    const result = await detectPreflightConflicts(plan, tempDir);

    expect(result.interPRConflicts).toBeDefined();
    expect(result.interPRConflicts?.length).toBeGreaterThan(0);

    const conflict = result.interPRConflicts?.[0];
    expect(conflict?.guidance?.type).toBe("manual-review");
    expect(conflict?.guidance?.strategy).toBe("manual");
  });
});
