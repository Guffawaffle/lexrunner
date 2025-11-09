/**
 * Tests for path normalization utilities
 */

import { describe, it, expect } from 'vitest';
import { 
  normalizePath, 
  isWSLPath, 
  wslToWindowsPath, 
  windowsToWSLPath,
  ensureDir,
  isSafeArtifactPath 
} from '../../src/utils/paths';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

describe('normalizePath', () => {
  it('expands ~ to home directory', () => {
    const result = normalizePath('~/project');
    expect(result).toContain(os.homedir());
    expect(result.endsWith('project')).toBe(true);
  });

  it('resolves relative paths', () => {
    const result = normalizePath('./project');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('keeps absolute paths absolute', () => {
    const absolutePath = process.platform === 'win32' ? 'C:\\Users\\test' : '/home/test';
    const result = normalizePath(absolutePath);
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('resolves .. in paths', () => {
    const result = normalizePath('/home/user/project/../other');
    expect(result).not.toContain('..');
  });

  it('handles current directory', () => {
    const result = normalizePath('.');
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(process.cwd());
  });

  it('normalizes multiple slashes', () => {
    const result = normalizePath('/home//user///project');
    expect(result).not.toContain('//');
  });

  it('converts backslashes on POSIX', () => {
    if (process.platform !== 'win32') {
      const result = normalizePath('/home/user');
      expect(result).not.toContain('\\');
    }
  });

  it('handles trailing slashes', () => {
    const result = normalizePath('/home/user/');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('expands ~ with subdirectory', () => {
    const result = normalizePath('~/.config/app');
    expect(result).toContain(os.homedir());
    expect(result).toContain('.config');
    expect(result).toContain('app');
  });
});

describe('isWSLPath', () => {
  it('identifies WSL paths', () => {
    expect(isWSLPath('/mnt/c/Users')).toBe(true);
    expect(isWSLPath('/mnt/d/projects')).toBe(true);
    expect(isWSLPath('/mnt/e/data')).toBe(true);
  });

  it('rejects non-WSL paths', () => {
    expect(isWSLPath('/home/user')).toBe(false);
    expect(isWSLPath('/usr/local')).toBe(false);
    expect(isWSLPath('/var/log')).toBe(false);
  });

  it('rejects Windows paths', () => {
    expect(isWSLPath('C:\\Users')).toBe(false);
    expect(isWSLPath('D:\\projects')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isWSLPath('/mnt/')).toBe(false); // No drive letter
    expect(isWSLPath('/mnt/cd/path')).toBe(false); // Multi-char after mnt
    expect(isWSLPath('mnt/c/path')).toBe(false); // No leading slash
  });

  it('is case-sensitive for drive letter', () => {
    expect(isWSLPath('/mnt/c/Users')).toBe(true);
    expect(isWSLPath('/mnt/C/Users')).toBe(false); // Uppercase not valid
  });
});

describe('wslToWindowsPath', () => {
  it('converts WSL path to Windows path', () => {
    expect(wslToWindowsPath('/mnt/c/Users/alice')).toBe('C:\\Users\\alice');
    expect(wslToWindowsPath('/mnt/d/projects')).toBe('D:\\projects');
  });

  it('handles paths without rest', () => {
    expect(wslToWindowsPath('/mnt/c')).toBe('C:\\');
  });

  it('handles root drive paths', () => {
    expect(wslToWindowsPath('/mnt/c/')).toBe('C:\\');
    expect(wslToWindowsPath('/mnt/d/')).toBe('D:\\');
  });

  it('preserves path structure', () => {
    expect(wslToWindowsPath('/mnt/c/Users/alice/Documents/file.txt')).toBe('C:\\Users\\alice\\Documents\\file.txt');
  });

  it('returns original path if not WSL format', () => {
    expect(wslToWindowsPath('/home/user')).toBe('/home/user');
    expect(wslToWindowsPath('C:\\Windows')).toBe('C:\\Windows');
  });

  it('handles all lowercase drive letters', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    letters.forEach(letter => {
      const wslPath = `/mnt/${letter}/test`;
      const winPath = wslToWindowsPath(wslPath);
      expect(winPath).toBe(`${letter.toUpperCase()}:\\test`);
    });
  });
});

describe('windowsToWSLPath', () => {
  it('converts Windows path to WSL path', () => {
    expect(windowsToWSLPath('C:\\Users\\alice')).toBe('/mnt/c/Users/alice');
    expect(windowsToWSLPath('D:\\projects')).toBe('/mnt/d/projects');
  });

  it('handles root drive paths', () => {
    expect(windowsToWSLPath('C:\\')).toBe('/mnt/c/');
    expect(windowsToWSLPath('D:\\')).toBe('/mnt/d/');
  });

  it('handles paths without rest', () => {
    expect(windowsToWSLPath('C:')).toBe('/mnt/c/');
  });

  it('preserves path structure', () => {
    expect(windowsToWSLPath('C:\\Users\\alice\\Documents\\file.txt')).toBe('/mnt/c/Users/alice/Documents/file.txt');
  });

  it('returns original path if not Windows format', () => {
    expect(windowsToWSLPath('/home/user')).toBe('/home/user');
    expect(windowsToWSLPath('/mnt/c/test')).toBe('/mnt/c/test');
  });

  it('handles all uppercase drive letters', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    letters.forEach(letter => {
      const winPath = `${letter}:\\test`;
      const wslPath = windowsToWSLPath(winPath);
      expect(wslPath).toBe(`/mnt/${letter.toLowerCase()}/test`);
    });
  });

  it('roundtrips with wslToWindowsPath', () => {
    const originalWin = 'C:\\Users\\test\\file.txt';
    const wsl = windowsToWSLPath(originalWin);
    const backToWin = wslToWindowsPath(wsl);
    expect(backToWin).toBe(originalWin);
  });
});

describe('ensureDir', () => {
  it('creates directory if it does not exist', async () => {
    const testDir = path.join('/tmp', `test-dir-${Date.now()}`);
    
    await ensureDir(testDir);
    
    const stats = await fs.stat(testDir);
    expect(stats.isDirectory()).toBe(true);
    
    // Cleanup
    await fs.rmdir(testDir);
  });

  it('does not throw if directory already exists', async () => {
    const testDir = path.join('/tmp', `test-dir-existing-${Date.now()}`);
    
    await fs.mkdir(testDir, { recursive: true });
    await ensureDir(testDir);
    
    const stats = await fs.stat(testDir);
    expect(stats.isDirectory()).toBe(true);
    
    // Cleanup
    await fs.rmdir(testDir);
  });

  it('creates nested directories', async () => {
    const timestamp = Date.now();
    const testDir = path.join('/tmp', `test-parent-${timestamp}`, 'nested', 'deep');
    
    await ensureDir(testDir);
    
    const stats = await fs.stat(testDir);
    expect(stats.isDirectory()).toBe(true);
    
    // Cleanup
    await fs.rm(path.join('/tmp', `test-parent-${timestamp}`), { recursive: true, force: true });
  });
});

describe('isSafeArtifactPath', () => {
  it('rejects PR artifact paths', () => {
    expect(isSafeArtifactPath('/path/to/pr-123')).toBe(false);
    expect(isSafeArtifactPath('/path/to/pr-456/file.txt')).toBe(false);
  });

  it('rejects PR paths on Windows', () => {
    expect(isSafeArtifactPath('C:\\path\\to\\PR-456')).toBe(false);
    expect(isSafeArtifactPath('D:\\work\\PR-789\\file.txt')).toBe(false);
  });

  it('allows safe paths', () => {
    expect(isSafeArtifactPath('/path/to/idea-123')).toBe(true);
    expect(isSafeArtifactPath('.smartergpt.local/deliverables')).toBe(true);
    expect(isSafeArtifactPath('/home/user/projects')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSafeArtifactPath('/path/to/PR-123')).toBe(false);
    expect(isSafeArtifactPath('/path/to/pr-123')).toBe(false);
    expect(isSafeArtifactPath('/path/to/Pr-123')).toBe(false);
  });

  it('handles relative paths', () => {
    expect(isSafeArtifactPath('./pr-123/file')).toBe(false);
    expect(isSafeArtifactPath('./idea-123/file')).toBe(true);
  });

  it('handles home directory expansion', () => {
    expect(isSafeArtifactPath('~/pr-123')).toBe(false);
    expect(isSafeArtifactPath('~/projects/safe-dir')).toBe(true);
  });

  it('rejects paths with pr- in middle', () => {
    expect(isSafeArtifactPath('/root/work/pr-123/sub')).toBe(false);
    expect(isSafeArtifactPath('/root/work/sub/pr-456')).toBe(false);
  });

  it('allows paths with "pr" but not "pr-"', () => {
    expect(isSafeArtifactPath('/path/to/project')).toBe(true);
    expect(isSafeArtifactPath('/path/to/practice')).toBe(true);
    expect(isSafeArtifactPath('/path/to/spring')).toBe(true);
  });
});
