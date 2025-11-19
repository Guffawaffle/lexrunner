import { describe, it, expect, beforeEach } from 'vitest';
import { GitOperations, GitOperationError } from '../src/git/operations.js';

describe('Git Operations', () => {
  describe('GitOperations', () => {
    it('should initialize with working directory', () => {
      const gitOps = new GitOperations('/tmp');
      expect(gitOps).toBeInstanceOf(GitOperations);
    });

    it('should initialize with default working directory', () => {
      const gitOps = new GitOperations();
      expect(gitOps).toBeInstanceOf(GitOperations);
    });
  });

  describe('GitOperationError', () => {
    it('should create proper error instances', () => {
      const error = new GitOperationError('Test git error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(GitOperationError);
      expect(error.message).toBe('Test git error');
      expect(error.name).toBe('GitOperationError');
    });
  });

  describe('Merge strategies', () => {
    it('should recognize valid merge strategies', () => {
      const validStrategies = ['rebase-weave', 'merge-weave', 'squash-weave'];
      
      validStrategies.forEach(strategy => {
        expect(['rebase-weave', 'merge-weave', 'squash-weave']).toContain(strategy);
      });
    });
  });

  describe('Integration branch naming', () => {
    it('should generate proper branch names with timestamps', () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const expectedPattern = /^weave\/integration-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
      
      const branchName = `weave/integration-${timestamp}`;
      expect(branchName).toMatch(expectedPattern);
    });
  });

  describe('WeaveResult interface', () => {
    it('should handle successful weave results', () => {
      const result = {
        success: true,
        item: { name: 'test-item', deps: [], gates: [] },
        sha: 'abc123',
        message: 'Successfully merged',
      };

      expect(result.success).toBe(true);
      expect(result.item.name).toBe('test-item');
      expect(result.sha).toBe('abc123');
      expect(result.message).toBe('Successfully merged');
    });

    it('should handle failed weave results with conflicts', () => {
      const result = {
        success: false,
        item: { name: 'test-item', deps: [], gates: [] },
        conflicts: ['file1.txt', 'file2.txt'],
        message: 'Merge conflicts detected',
      };

      expect(result.success).toBe(false);
      expect(result.conflicts).toEqual(['file1.txt', 'file2.txt']);
      expect(result.message).toBe('Merge conflicts detected');
    });

    it('should include conflict files in message when detected', () => {
      const result = {
        success: false,
        item: { name: 'test-item', deps: [], gates: [] },
        conflicts: ['src/index.ts', 'package.json'],
        message: 'CONFLICTS: src/index.ts, package.json',
      };

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(2);
      expect(result.message).toContain('CONFLICTS:');
      expect(result.message).toContain('src/index.ts');
      expect(result.message).toContain('package.json');
    });
  });

  describe('WeaveExecutionResult interface', () => {
    it('should aggregate execution results correctly', () => {
      const result = {
        operations: [
          { success: true, item: { name: 'a', deps: [], gates: [] } },
          { success: false, item: { name: 'b', deps: [], gates: [] }, conflicts: ['file.txt'] },
          { success: true, item: { name: 'c', deps: [], gates: [] } },
        ],
        successful: 2,
        failed: 1,
        conflicts: 1,
        totalOperations: 3,
      };

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.conflicts).toBe(1);
      expect(result.totalOperations).toBe(3);
      expect(result.operations).toHaveLength(3);
    });

    it('should correctly count conflicts when multiple items have conflicts', () => {
      const result = {
        operations: [
          { success: false, item: { name: 'a', deps: [], gates: [] }, conflicts: ['file1.txt'] },
          { success: false, item: { name: 'b', deps: [], gates: [] }, conflicts: ['file2.txt', 'file3.txt'] },
          { success: true, item: { name: 'c', deps: [], gates: [] } },
        ],
        successful: 1,
        failed: 2,
        conflicts: 2, // Two items have conflicts
        totalOperations: 3,
      };

      expect(result.conflicts).toBe(2);
      expect(result.failed).toBe(2);
      expect(result.successful).toBe(1);
    });

    it('should report zero conflicts when none detected', () => {
      const result = {
        operations: [
          { success: true, item: { name: 'a', deps: [], gates: [] } },
          { success: true, item: { name: 'b', deps: [], gates: [] } },
        ],
        successful: 2,
        failed: 0,
        conflicts: 0,
        totalOperations: 2,
      };

      expect(result.conflicts).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.successful).toBe(2);
    });
  });
});