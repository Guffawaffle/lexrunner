import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { skipIfCliNotBuilt } from './helpers/cli';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('End-to-End Integration Tests', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach((context) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-test-'));
    projectDir = path.dirname(__dirname); // Root of the project
    if (skipIfCliNotBuilt({ skip: context.skip })) return;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  const runCLI = async (args: string, cwd: string = tempDir) => {
    // Use the built CLI directly to avoid npm output contamination
    const cliPath = path.join(projectDir, 'dist/cli.js');
    return execAsync(`node ${cliPath} ${args}`, { cwd });
  };

  describe('CLI Command Availability', () => {
    it('should show help for main CLI', async () => {
      const { stdout, stderr } = await runCLI('--help');

      expect(stdout).toContain('Lex-PR Runner');
      expect(stdout).toContain('discover');
      expect(stdout).toContain('merge');
      expect(stdout).toContain('bootstrap');
      expect(stdout).toContain('doctor');
      expect(stdout).toContain('init');
      expect(stderr).toBe('');
    });

    it('should show help for discover command', async () => {
      const { stdout } = await runCLI('discover --help');

      expect(stdout).toContain('Discover open pull requests from GitHub');
      expect(stdout).toContain('--owner');
      expect(stdout).toContain('--repo');
      expect(stdout).toContain('--json');
    });

    it('should show help for merge command', async () => {
      const { stdout } = await runCLI('merge --help');

      expect(stdout).toContain('Execute merge pyramid with git operations');
      expect(stdout).toContain('--plan');
      expect(stdout).toContain('--dry-run');
      expect(stdout).toContain('--execute');
    });

    it('should show help for bootstrap command', async () => {
      const { stdout } = await runCLI('bootstrap --help');

      expect(stdout).toContain('Create minimal workspace configuration');
      expect(stdout).toContain('--force');
      expect(stdout).toContain('--json');
    });

    it('should show help for doctor command', async () => {
      const { stdout } = await runCLI('doctor --help');

      expect(stdout).toContain('Environment and config sanity checks');
      expect(stdout).toContain('--bootstrap');
      expect(stdout).toContain('--json');
    });
  });

  describe('Plan Validation Workflow', () => {
    it('should validate simple plan file', async () => {
      // Create a simple valid plan
      const plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feature-a", deps: [], gates: [] },
          { name: "feature-b", deps: ["feature-a"], gates: [] }
        ]
      };

      const planPath = path.join(tempDir, 'test-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

      const { stdout } = await runCLI(`schema validate ${planPath}`);

      // Updated: validation now uses ✅ instead of ✓
      expect(stdout).toMatch(/[✓✅]/);
      expect(stdout).toContain('is valid');
    });

    it('should detect plan validation errors', async () => {
      // Create an invalid plan
      const invalidPlan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feature-a", invalidField: "should not be here" }
        ]
      };

      const planPath = path.join(tempDir, 'invalid-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(invalidPlan, null, 2));

      try {
        await runCLI(`schema validate ${planPath}`);
        expect.fail('Should have thrown an error for invalid plan');
      } catch (error: any) {
        expect(error.code).toBe(1); // Schema validation error (actual exit code)
        expect(error.stdout || error.stderr).toContain('validation failed');
      }
    });
  });

  describe('Merge Order Computation', () => {
    it('should compute merge order for valid plan', async () => {
      // Create a plan with dependencies
      const plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feature-c", deps: ["feature-a", "feature-b"], gates: [] },
          { name: "feature-a", deps: [], gates: [] },
          { name: "feature-b", deps: ["feature-a"], gates: [] }
        ]
      };

      const planPath = path.join(tempDir, 'dep-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

      const { stdout } = await runCLI(`merge-order ${planPath} --json`);

      const result = JSON.parse(stdout);
      expect(result.levels).toBeDefined();
      expect(result.levels).toHaveLength(3);
      expect(result.levels[0]).toEqual(["feature-a"]);
      expect(result.levels[1]).toEqual(["feature-b"]);
      expect(result.levels[2]).toEqual(["feature-c"]);
    });
  });

  describe('Merge Dry Run', () => {
    it('should perform merge dry run successfully', async () => {
      // Initialize git repository in temp directory
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });

      // Create a simple plan
      const plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feature-a", deps: [], gates: [] },
          { name: "feature-b", deps: ["feature-a"], gates: [] }
        ]
      };

      const planPath = path.join(tempDir, 'merge-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

      const { stdout } = await runCLI(`merge --plan ${planPath} --dry-run`);

      // Updated for new dry-run format
      expect(stdout).toContain('DRY RUN: Merge Execution Plan');
      expect(stdout).toContain('Batch 1');
      expect(stdout).toContain('Items: feature-a');
      expect(stdout).toContain('Batch 2');
      expect(stdout).toContain('Items: feature-b');
      expect(stdout).toContain('Use --execute to perform actual merges');
    });

    it('should output JSON format for merge dry run', async () => {
      // Initialize git repository in temp directory
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });

      // Create a simple plan
      const plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "test-item", deps: [], gates: [] }
        ]
      };

      const planPath = path.join(tempDir, 'json-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

      const { stdout } = await runCLI(`merge --plan ${planPath} --dry-run --json`);

      const result = JSON.parse(stdout);
      // Updated for new dry-run output structure
      expect(result.summary).toBeDefined();
      expect(result.summary.targetBranch).toBe('main');
      expect(result.summary.totalItems).toBe(1);
      expect(result.batches).toBeDefined();
      expect(result.batches).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing plan file gracefully', async () => {
      try {
        await runCLI('merge --plan nonexistent.json');
        expect.fail('Should have thrown an error for missing file');
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain('not found');
      }
    });

    it('should handle invalid JSON gracefully', async () => {
      const invalidPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidPath, 'not valid json');

      try {
        await runCLI(`schema validate ${invalidPath}`);
        expect.fail('Should have thrown an error for invalid JSON');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });
  });
});
