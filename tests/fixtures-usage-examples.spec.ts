/**
 * Example tests demonstrating fixture library usage
 * These tests showcase common patterns and best practices
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fixtures } from './fixtures/index.js';
import type { Plan } from '../src/schema.js';

describe('Fixture Library Usage Examples', () => {
  describe('Using plan fixtures', () => {
    it('example: validates a simple plan structure', () => {
      // Get a pre-built simple plan fixture
      const plan = fixtures.plans.simple();

      // Verify structure
      expect(plan.schemaVersion).toBe('1.0.0');
      expect(plan.items).toHaveLength(3);
      expect(plan.items.every(item => item.deps.length === 0)).toBe(true);
    });

    it('example: tests with complex dependency patterns', () => {
      // Get diamond dependency pattern
      const plan = fixtures.plans.diamond();

      // Find the integration item (depends on both foundations)
      const integration = plan.items.find(item => item.name === 'integration');
      expect(integration?.deps).toHaveLength(2);
      expect(integration?.deps).toContain('foundation-a');
      expect(integration?.deps).toContain('foundation-b');
    });

    it('example: uses linear chain for sequential testing', () => {
      const plan = fixtures.plans.linear();

      // Verify each item depends on previous
      for (let i = 1; i < plan.items.length; i++) {
        const current = plan.items[i];
        const previous = plan.items[i - 1];
        expect(current.deps).toContain(previous.name);
      }
    });
  });

  describe('Using PR fixtures', () => {
    it('example: creates PRs with realistic metadata', () => {
      // Create a basic PR
      const pr = fixtures.prs.basic({
        number: 100,
        title: 'Add authentication feature',
        files: ['src/auth.ts', 'tests/auth.spec.ts']
      });

      expect(pr.number).toBe(100);
      expect(pr.files).toHaveLength(2);
      expect(pr.state).toBe('open');
    });

    it('example: creates PR chains for dependency testing', () => {
      // Get a chain of 3 dependent PRs
      const chain = fixtures.prs.chain(3, 100);

      // First PR has no dependencies
      expect(chain[0].body).not.toContain('Depends on');

      // Second PR depends on first
      expect(chain[1].body).toContain('#100');

      // Third PR depends on second
      expect(chain[2].body).toContain('#101');
    });

    it('example: creates large batch for performance testing', () => {
      // Create 50 PRs at once
      const prs = fixtures.prs.batch(50);

      expect(prs).toHaveLength(50);
      expect(prs[0].number).toBe(100);
      expect(prs[49].number).toBe(149);
    });
  });

  describe('Using gate fixtures', () => {
    it('example: configures standard gates', () => {
      // Get standard lint + test gates
      const gates = fixtures.gates.configs.standard();

      expect(gates).toHaveLength(2);
      expect(gates.map(g => g.name)).toEqual(['lint', 'test']);
    });

    it('example: simulates gate execution results', () => {
      // Simulate all gates passing
      const results = fixtures.gates.results.allPass(['lint', 'test', 'e2e']);

      expect(results.every(r => r.status === 'pass')).toBe(true);
      expect(results.every(r => r.exitCode === 0)).toBe(true);
    });

    it('example: simulates mixed gate results', () => {
      // Simulate scenario where lint passes but test fails
      const results = fixtures.gates.results.someFail({
        pass: ['lint', 'build'],
        fail: ['test', 'e2e']
      });

      const passing = results.filter(r => r.status === 'pass');
      const failing = results.filter(r => r.status === 'fail');

      expect(passing).toHaveLength(2);
      expect(failing).toHaveLength(2);
    });
  });

  describe('Using mock GitHub API', () => {
    it('example: mocks PR listing', async () => {
      // Create PRs and mock GitHub API
      const prs = fixtures.prs.batch(5);
      const github = fixtures.utils.mockGitHub.createMockGitHub(prs);

      // List all PRs
      const result = await github.rest.pulls.list();

      expect(result.data).toHaveLength(5);
      expect(result.data.every(pr => pr.state === 'open')).toBe(true);
    });

    it('example: mocks PR retrieval', async () => {
      const prs = fixtures.prs.batch(3);
      const github = fixtures.utils.mockGitHub.createMockGitHub(prs);

      // Get specific PR
      const result = await github.rest.pulls.get({ pull_number: 101 });

      expect(result.data.number).toBe(101);
      expect(result.data.title).toContain('Feature 2');
    });

    it('example: handles errors gracefully', async () => {
      const prs = fixtures.prs.batch(3);
      const github = fixtures.utils.mockGitHub.createMockGitHub(prs);

      // Try to get non-existent PR
      await expect(
        github.rest.pulls.get({ pull_number: 999 })
      ).rejects.toThrow('PR #999 not found');
    });
  });

  describe('Using complete scenarios', () => {
    it('example: runs simple success scenario', () => {
      const scenario = fixtures.scenarios.simpleSuccess();

      // Verify scenario structure
      expect(scenario.description).toBeTruthy();
      expect(scenario.plan.items).toHaveLength(scenario.prs.length);
      expect(scenario.expected?.merged).toBe(3);
    });

    it('example: tests complex merge workflow', () => {
      // Get a complex scenario with 20 PRs
      const scenario = fixtures.scenarios.complexMerge({ prCount: 20 });

      // Verify complexity
      expect(scenario.prs.length).toBeGreaterThan(15);
      expect(scenario.plan.items.length).toBeGreaterThan(15);
    });

    it('example: tests failure scenarios', () => {
      const scenario = fixtures.scenarios.withGateFailures();

      // Verify expectations include failures
      expect(scenario.expected?.merged).toBe(1);
      expect(scenario.expected?.failed).toBe(1);
      expect(scenario.expected?.blocked).toBe(1);
    });
  });

  describe('Using temporary directories', () => {
    let tmpDir: string;

    beforeEach(async () => {
      // Create temp directory for test
      tmpDir = await fixtures.utils.tempDir.create('example-test');
    });

    afterEach(async () => {
      // Clean up temp directory
      await fixtures.utils.tempDir.cleanup(tmpDir);
    });

    it('example: creates and uses temp directory', async () => {
      // Write a file
      await fixtures.utils.tempDir.writeFile(
        tmpDir,
        'test.txt',
        'Hello, fixtures!'
      );

      // Read it back
      const content = await fixtures.utils.tempDir.readFile(tmpDir, 'test.txt');
      expect(content).toBe('Hello, fixtures!');

      // Verify file exists
      const exists = await fixtures.utils.tempDir.exists(tmpDir, 'test.txt');
      expect(exists).toBe(true);
    });

    it('example: creates temp directory with initial files', async () => {
      // Create directory with pre-populated files
      const dir = await fixtures.utils.tempDir.createWithFiles({
        'config.json': '{"version": "1.0.0"}',
        'src/index.ts': 'export const foo = "bar";',
        'tests/index.spec.ts': 'describe("test", () => {})'
      });

      // Verify files exist
      const files = await fixtures.utils.tempDir.listFiles(dir);
      expect(files).toContain('config.json');
      expect(files).toContain('src/index.ts');
      expect(files).toContain('tests/index.spec.ts');

      // Cleanup
      await fixtures.utils.tempDir.cleanup(dir);
    });
  });

  describe('Using cleanup manager', () => {
    it('example: manages multiple cleanup tasks', async () => {
      const result = await fixtures.utils.cleanup.withCleanup(async (cleanup) => {
        // Create temp directory
        const tmpDir = await fixtures.utils.tempDir.create();
        cleanup.registerTempDir(tmpDir);

        // Add custom cleanup
        let customCleaned = false;
        cleanup.register(async () => {
          customCleaned = true;
        });

        // Do some work...
        await fixtures.utils.tempDir.writeFile(tmpDir, 'data.txt', 'test');

        // Return result
        return { tmpDir, customCleaned };
      });

      // After withCleanup, all cleanup has run
      // Temp directory is deleted, custom cleanup executed
      expect(result.tmpDir).toBeTruthy();
    });
  });

  describe('Combining fixtures for complex tests', () => {
    it('example: creates end-to-end test scenario', async () => {
      // 1. Get plan fixture
      const plan = fixtures.plans.complex();

      // 2. Create corresponding PRs
      const prs = plan.items.map((item, i) => 
        fixtures.prs.basic({
          number: 100 + i,
          title: `Implement ${item.name}`,
          files: [`src/${item.name}.ts`]
        })
      );

      // 3. Mock GitHub API
      const github = fixtures.utils.mockGitHub.createMockGitHub(prs);

      // 4. Verify we can fetch PRs
      const fetched = await github.rest.pulls.list();
      expect(fetched.data).toHaveLength(prs.length);

      // 5. Simulate gate results
      const gateResults = fixtures.gates.results.allPass(['lint', 'test']);
      expect(gateResults.every(r => r.status === 'pass')).toBe(true);
    });

    it('example: tests error recovery workflow', async () => {
      await fixtures.utils.cleanup.withCleanup(async (cleanup) => {
        // Create temp workspace
        const workspace = await fixtures.utils.tempDir.create();
        cleanup.registerTempDir(workspace);

        // Get scenario with failures
        const scenario = fixtures.scenarios.withGateFailures();

        // Verify failure expectations
        expect(scenario.expected?.failed).toBeGreaterThan(0);

        // Write plan to workspace
        await fixtures.utils.tempDir.writeFile(
          workspace,
          'plan.json',
          JSON.stringify(scenario.plan, null, 2)
        );

        // Verify plan file exists
        const exists = await fixtures.utils.tempDir.exists(workspace, 'plan.json');
        expect(exists).toBe(true);

        // Return success - cleanup will happen automatically
        return true;
      });
    });
  });
});
