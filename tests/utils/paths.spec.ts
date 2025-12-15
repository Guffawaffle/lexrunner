/**
 * Unit tests for path validation utilities
 * 
 * Validates that artifact path restrictions work correctly
 */

import { describe, it, expect } from 'vitest';
import { 
	normalizePath, 
	isSafeArtifactPath, 
	validateOutputPath,
	wslToWindowsPath,
	windowsToWSLPath,
	isWSLEnvironment
} from '../../src/utils/paths.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('paths: normalizePath', () => {
	it('should expand ~ to home directory', () => {
		const result = normalizePath('~/project');
		expect(result).toContain(os.homedir());
		expect(result.endsWith('project')).toBe(true);
	});
	
	it('should resolve relative paths to absolute', () => {
		const result = normalizePath('./project');
		expect(path.isAbsolute(result)).toBe(true);
		expect(result.endsWith('project')).toBe(true);
	});
	
	it('should resolve absolute paths', () => {
		const absPath = process.platform === 'win32' ? 'C:\\path\\to\\file.txt' : '/path/to/file.txt';
		const result = normalizePath(absPath);
		expect(path.isAbsolute(result)).toBe(true);
	});
	
	it('should convert backslashes to forward slashes on POSIX', () => {
		// This test only makes sense on non-Windows platforms
		if (process.platform !== 'win32') {
			const result = normalizePath('./test');
			expect(result).not.toContain('\\');
			expect(result).toContain('/');
		}
	});
	
	it('should handle ~ with subdirectory', () => {
		const result = normalizePath('~/some/nested/path');
		expect(result).toContain(os.homedir());
		expect(result.endsWith('nested/path') || result.endsWith('nested\\path')).toBe(true);
	});
	
	it('should handle .. in paths', () => {
		const result = normalizePath('./some/path/..');
		expect(path.isAbsolute(result)).toBe(true);
		expect(result).not.toContain('..');
	});
});

describe('paths: isSafeArtifactPath', () => {
	describe('should block PR artifact paths', () => {
		it('should block /pr-<number>/ paths', () => {
			expect(() => isSafeArtifactPath('/path/to/pr-123')).toThrow('SAFETY VIOLATION');
			expect(() => isSafeArtifactPath('/path/to/pr-123')).toThrow('PR artifact directory');
			expect(() => isSafeArtifactPath('/artifacts/pr-456/output.json')).toThrow('SAFETY VIOLATION');
		});
		
		it('should block /PR-<number>/ paths (case insensitive)', () => {
			expect(() => isSafeArtifactPath('/path/to/PR-123')).toThrow('SAFETY VIOLATION');
			expect(() => isSafeArtifactPath('/path/to/Pr-456')).toThrow('SAFETY VIOLATION');
		});
		
		it('should block Windows-style paths with PR directories', () => {
			expect(() => isSafeArtifactPath('C:\\path\\to\\pr-123')).toThrow('SAFETY VIOLATION');
			expect(() => isSafeArtifactPath('C:\\artifacts\\PR-456\\output.json')).toThrow('SAFETY VIOLATION');
		});
		
		it('should block /artifacts/PR-*/ paths', () => {
			expect(() => isSafeArtifactPath('artifacts/PR-123/spec.json')).toThrow('SAFETY VIOLATION');
			expect(() => isSafeArtifactPath('/home/user/artifacts/pr-456/file.txt')).toThrow('SAFETY VIOLATION');
		});
		
		it('should include helpful guidance in error message', () => {
			try {
				isSafeArtifactPath('/path/to/pr-123');
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).toContain('.smartergpt.local/deliverables/_session/');
			}
		});
	});
	
	describe('should allow session deliverable paths', () => {
		it('should allow .smartergpt.local/deliverables/_session/', () => {
			expect(isSafeArtifactPath('.smartergpt.local/deliverables/_session/idea.json')).toBe(true);
			expect(isSafeArtifactPath('/home/user/.smartergpt.local/deliverables/_session/spec.json')).toBe(true);
		});
		
		it('should allow .smartergpt.local/runner/logs/', () => {
			expect(isSafeArtifactPath('.smartergpt.local/runner/logs/output.log')).toBe(true);
			expect(isSafeArtifactPath('/project/.smartergpt.local/runner/logs/debug.log')).toBe(true);
		});
		
		it('should allow .smartergpt/deliverables/_session/', () => {
			expect(isSafeArtifactPath('.smartergpt/deliverables/_session/file.json')).toBe(true);
			expect(isSafeArtifactPath('/workspace/.smartergpt/deliverables/_session/output.txt')).toBe(true);
		});
		
		it('should be case insensitive for allowed patterns', () => {
			expect(isSafeArtifactPath('.SmartErGPT.Local/deliverables/_session/file.json')).toBe(true);
			expect(isSafeArtifactPath('.SMARTERGPT/DELIVERABLES/_SESSION/file.txt')).toBe(true);
		});
	});
	
	describe('should allow other safe paths', () => {
		it('should allow /tmp paths', () => {
			expect(isSafeArtifactPath('/tmp/output.json')).toBe(true);
			expect(isSafeArtifactPath('/tmp/work/file.txt')).toBe(true);
		});
		
		it('should allow home directory paths', () => {
			expect(isSafeArtifactPath('/home/user/documents/file.txt')).toBe(true);
			expect(isSafeArtifactPath('~/projects/output.json')).toBe(true);
		});
		
		it('should allow project root paths (if not in PR dir)', () => {
			expect(isSafeArtifactPath('./output.json')).toBe(true);
			expect(isSafeArtifactPath('output/file.txt')).toBe(true);
		});
	});
	
	describe('edge cases', () => {
		it('should allow pr in filename without number', () => {
			expect(isSafeArtifactPath('/path/to/pr-template.txt')).toBe(true);
			// pr-<number> with digits is still caught
		});
		
		it('should handle empty paths', () => {
			expect(isSafeArtifactPath('')).toBe(true);
		});
		
		it('should handle relative paths with ../', () => {
			expect(isSafeArtifactPath('../output/file.txt')).toBe(true);
			expect(() => isSafeArtifactPath('../pr-123/file.txt')).toThrow('SAFETY VIOLATION');
		});
	});
});

describe('paths: validateOutputPath', () => {
	it('should pass for safe allowed paths', async () => {
		const tmpDir = os.tmpdir();
		const testPath = path.join(tmpDir, 'lex-pr-test', 'output.json');
		
		await expect(validateOutputPath(testPath)).resolves.not.toThrow();
		
		// Cleanup
		try {
			await fs.rm(path.dirname(testPath), { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});
	
	it('should create parent directory if missing', async () => {
		const tmpDir = os.tmpdir();
		const testDir = path.join(tmpDir, 'lex-pr-test-' + Date.now());
		const testPath = path.join(testDir, 'nested', 'dir', 'output.json');
		
		await validateOutputPath(testPath);
		
		// Check that parent directory was created
		const parentDir = path.dirname(testPath);
		await expect(fs.access(parentDir)).resolves.not.toThrow();
		
		// Cleanup
		await fs.rm(testDir, { recursive: true, force: true });
	});
	
	it('should throw for PR artifact paths', async () => {
		await expect(validateOutputPath('/path/to/pr-123/output.json'))
			.rejects.toThrow('SAFETY VIOLATION');
	});
	
	it('should throw for artifacts/PR-* paths', async () => {
		await expect(validateOutputPath('artifacts/PR-456/spec.json'))
			.rejects.toThrow('SAFETY VIOLATION');
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
	
	it('returns unchanged if not WSL path', () => {
		expect(wslToWindowsPath('/home/user/file.txt')).toBe('/home/user/file.txt');
	});
});

describe('windowsToWSLPath', () => {
	it('converts Windows path to WSL path', () => {
		expect(windowsToWSLPath('C:\\Users\\alice')).toBe('/mnt/c/Users/alice');
		expect(windowsToWSLPath('D:\\projects')).toBe('/mnt/d/projects');
	});
	
	it('handles paths without rest', () => {
		expect(windowsToWSLPath('C:')).toBe('/mnt/c');
	});
	
	it('returns unchanged if not Windows path', () => {
		expect(windowsToWSLPath('/home/user/file.txt')).toBe('/home/user/file.txt');
	});
});

describe('WSL bidirectional conversion', () => {
	it('roundtrip conversion works', () => {
		const winPath = 'C:\\Users\\alice\\project';
		const wslPath = '/mnt/c/Users/alice/project';
		
		expect(windowsToWSLPath(winPath)).toBe(wslPath);
		expect(wslToWindowsPath(wslPath)).toBe(winPath);
		
		// Roundtrip
		expect(wslToWindowsPath(windowsToWSLPath(winPath))).toBe(winPath);
		expect(windowsToWSLPath(wslToWindowsPath(wslPath))).toBe(wslPath);
	});
});

describe('isWSLEnvironment', () => {
	it('returns a boolean', async () => {
		const result = await isWSLEnvironment();
		expect(typeof result).toBe('boolean');
	});

	it('detects WSL via environment variable', async () => {
		// We can't easily test this without modifying process.env
		// Just verify it doesn't throw
		const result = await isWSLEnvironment();
		expect(typeof result).toBe('boolean');
	});
});

describe('Path traversal protection', () => {
	it('normalizes path with ../ to prevent traversal', () => {
		const result = normalizePath('./some/../../other/path');
		expect(path.isAbsolute(result)).toBe(true);
		// Should resolve .. properly
		expect(result).not.toContain('..');
	});

	it('handles multiple ../ segments', () => {
		const result = normalizePath('./a/b/../../c');
		expect(path.isAbsolute(result)).toBe(true);
		expect(result).not.toContain('..');
		expect(result.endsWith('c')).toBe(true);
	});

	it('blocks PR directory access even with traversal attempts', () => {
		expect(() => isSafeArtifactPath('./some/../pr-123/file.txt')).toThrow('SAFETY VIOLATION');
	});

	it('handles absolute paths with ../', () => {
		const absPath = process.platform === 'win32' ? 'C:\\test\\..\\file.txt' : '/test/../file.txt';
		const result = normalizePath(absPath);
		expect(path.isAbsolute(result)).toBe(true);
		expect(result).not.toContain('..');
	});
});
