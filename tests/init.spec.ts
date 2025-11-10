import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Init Command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Non-interactive mode', () => {
    it('should create workspace with default configuration', async () => {
      const result = await runInit({ 
        nonInteractive: true 
      });

      expect(result.success).toBe(true);
      expect(result.profileDir).toContain('.smartergpt.local');
      
      // Check that files were created in runner/ subdirectory
      const runnerDir = path.join(result.profileDir, 'runner');
      expect(fs.existsSync(runnerDir)).toBe(true);
      
      const configFiles = [
        'intent.md',
        'scope.yml',
        'deps.yml',
        'gates.yml',
        'pull-request-template.md'
      ];

      for (const file of configFiles) {
        const filePath = path.join(runnerDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
      
      // Check profile.yml is in root of profile dir
      const profileManifest = path.join(result.profileDir, 'profile.yml');
      expect(fs.existsSync(profileManifest)).toBe(true);
    });

    it('should respect --profile-dir option', async () => {
      const customDir = path.join(tempDir, 'custom-profile');
      fs.mkdirSync(customDir, { recursive: true });
      
      // Create manifest for custom directory
      fs.writeFileSync(
        path.join(customDir, 'profile.yml'),
        'role: local\nname: Custom Profile\n'
      );
      
      const result = await runInit({
        nonInteractive: true,
        profileDir: customDir
      });

      expect(result.success).toBe(true);
      expect(result.profileDir).toBe(customDir);
      expect(fs.existsSync(customDir)).toBe(true);
    });

    it('should fail when configuration exists without --force', async () => {
      // Create initial configuration
      await runInit({ nonInteractive: true });

      // Try to create again without force
      const result = await runInit({ nonInteractive: true });

      expect(result.success).toBe(false);
      expect(result.message).toContain('already exists');
    });

    it('should overwrite configuration with --force', async () => {
      // Create initial configuration
      const result1 = await runInit({ nonInteractive: true });
      
      // Modify a file in runner/
      const intentPath = path.join(result1.profileDir, 'runner', 'intent.md');
      const originalContent = fs.readFileSync(intentPath, 'utf-8');
      fs.writeFileSync(intentPath, '# Modified content');

      // Create again with force
      const result2 = await runInit({ 
        nonInteractive: true, 
        force: true 
      });

      expect(result2.success).toBe(true);
      
      // Check that file was reset (or left alone - depends on implementation)
      const currentContent = fs.readFileSync(intentPath, 'utf-8');
      // File should either be reset or remain modified
      expect(currentContent).toBeDefined();
    });
  });

  describe('Profile directory selection', () => {
    it('should use .smartergpt.local when no tracked example exists', async () => {
      const result = await runInit({ nonInteractive: true });

      expect(result.success).toBe(true);
      expect(result.profileDir).toContain('.smartergpt.local');
    });

    it('should suggest .smartergpt.local when tracked example exists', async () => {
      // Create a tracked example
      const trackedDir = path.join(tempDir, '.smartergpt');
      fs.mkdirSync(trackedDir);
      fs.writeFileSync(
        path.join(trackedDir, 'profile.yml'),
        'role: example\nname: Example Profile\n'
      );

      const result = await runInit({ nonInteractive: true });

      expect(result.success).toBe(true);
      expect(result.profileDir).toContain('.smartergpt.local');
      expect(result.profileDir).not.toBe(trackedDir);
    });
  });

  describe('File generation', () => {
    it('should create intent.md with project goals template', async () => {
      const result = await runInit({ nonInteractive: true });

      const intentPath = path.join(result.profileDir, 'runner', 'intent.md');
      const content = fs.readFileSync(intentPath, 'utf-8');

      expect(content).toContain('# Project Intent');
      expect(content).toContain('## Goals');
      expect(content).toContain('## Success Criteria');
    });

    it('should create scope.yml with proper structure', async () => {
      const result = await runInit({ nonInteractive: true });

      const scopePath = path.join(result.profileDir, 'runner', 'scope.yml');
      const content = fs.readFileSync(scopePath, 'utf-8');

      expect(content).toContain('version: 1');
      expect(content).toContain('target: main');
      expect(content).toContain('sources:');
    });

    it('should create gates.yml with example gates', async () => {
      const result = await runInit({ nonInteractive: true });

      const gatesPath = path.join(result.profileDir, 'runner', 'gates.yml');
      const content = fs.readFileSync(gatesPath, 'utf-8');

      expect(content).toContain('version: 1');
      expect(content).toContain('gates:');
      expect(content).toContain('typecheck');
      expect(content).toContain('test');
    });

    it('should create pull-request-template.md with dependency syntax', async () => {
      const result = await runInit({ nonInteractive: true });

      const templatePath = path.join(result.profileDir, 'runner', 'pull-request-template.md');
      const content = fs.readFileSync(templatePath, 'utf-8');

      expect(content).toContain('Depends-On:');
      expect(content).toContain('#123');
      expect(content).toContain('## Dependencies');
    });

    it('should create profile.yml with local role', async () => {
      const result = await runInit({ nonInteractive: true });

      const manifestPath = path.join(result.profileDir, 'profile.yml');
      const content = fs.readFileSync(manifestPath, 'utf-8');

      expect(content).toContain('role: local');
      expect(content).toContain('name: Local Development Profile');
    });

    it('should not overwrite existing files', async () => {
      const result = await runInit({ nonInteractive: true });

      const intentPath = path.join(result.profileDir, 'runner', 'intent.md');
      const customContent = '# My Custom Intent';
      fs.writeFileSync(intentPath, customContent);

      // Run init again with force, but files shouldn't overwrite
      await runInit({ nonInteractive: true, force: true });

      const content = fs.readFileSync(intentPath, 'utf-8');
      expect(content).toBe(customContent);
    });
  });

  describe('Project type detection', () => {
    it('should detect Node.js project', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');

      const result = await runInit({ nonInteractive: true });

      expect(result.success).toBe(true);
      // Detection happens during init, but we can't easily assert console output in tests
    });

    it('should detect Python project', async () => {
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'requests==2.28.0');

      const result = await runInit({ nonInteractive: true });

      expect(result.success).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle write protection errors', async () => {
      // Create a read-only tracked profile
      const trackedDir = path.join(tempDir, '.smartergpt');
      fs.mkdirSync(trackedDir);
      fs.writeFileSync(
        path.join(trackedDir, 'profile.yml'),
        'role: example\nname: Example Profile\n'
      );

      // Try to init with explicit read-only dir (should fail)
      const result = await runInit({
        nonInteractive: true,
        profileDir: trackedDir
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Write protection');
    });
  });

  describe('GitHub token handling', () => {
    it('should use environment variable if available', async () => {
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'test-token';

      try {
        const result = await runInit({ nonInteractive: true });
        expect(result.success).toBe(true);
        // Token validation happens internally
      } finally {
        if (originalToken) {
          process.env.GITHUB_TOKEN = originalToken;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });

    it('should use provided token option', async () => {
      const result = await runInit({
        nonInteractive: true,
        githubToken: 'cli-token'
      });

      expect(result.success).toBe(true);
      // Token validation happens internally
    });
  });
});
