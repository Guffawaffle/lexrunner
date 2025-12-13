/**
 * Git Operations Performance Benchmarks
 * Measures performance of git command execution and parsing
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Git Operations Performance', () => {
  const tmpDir = path.join(os.tmpdir(), 'lex-pr-runner-bench-git');
  const repoPath = path.join(tmpDir, 'test-repo');

  beforeAll(async () => {
    // Create temp git repository for testing
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(repoPath, { recursive: true });

    // Initialize git repo
    await execa('git', ['init'], { cwd: repoPath });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });

    // Create initial commit
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo');
    await execa('git', ['add', '.'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath });

    // Create some branches for testing
    for (let i = 1; i <= 10; i++) {
      await execa('git', ['checkout', '-b', `feature-${i}`], { cwd: repoPath });
      fs.writeFileSync(path.join(repoPath, `file-${i}.txt`), `Content ${i}`);
      await execa('git', ['add', '.'], { cwd: repoPath });
      await execa('git', ['commit', '-m', `Feature ${i}`], { cwd: repoPath });
      await execa('git', ['checkout', 'main'], { cwd: repoPath });
    }
  });

  afterAll(() => {
    // Cleanup temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Branch operations', () => {
    bench('list all branches', async () => {
      await execa('git', ['branch', '-a'], { cwd: repoPath });
    });

    bench('list remote branches', async () => {
      await execa('git', ['branch', '-r'], { cwd: repoPath });
    });

    bench('get current branch', async () => {
      await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
    });
  });

  describe('Commit operations', () => {
    bench('get commit SHA', async () => {
      await execa('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
    });

    bench('get commit message', async () => {
      await execa('git', ['log', '-1', '--pretty=%B'], { cwd: repoPath });
    });

    bench('list last 10 commits', async () => {
      await execa('git', ['log', '-10', '--oneline'], { cwd: repoPath });
    });
  });

  describe('Status operations', () => {
    bench('git status', async () => {
      await execa('git', ['status', '--porcelain'], { cwd: repoPath });
    });

    bench('check clean working tree', async () => {
      const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: repoPath });
      return stdout.trim() === '';
    });
  });

  describe('Diff operations', () => {
    bench('diff between branches', async () => {
      await execa('git', ['diff', 'main...feature-1', '--stat'], { cwd: repoPath });
    });

    bench('diff file count', async () => {
      await execa('git', ['diff', 'main...feature-1', '--name-only'], { cwd: repoPath });
    });
  });
});
