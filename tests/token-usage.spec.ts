import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { estimateTokens, estimateTokensFromFile, estimateTokensFromFiles } from '../src/util/tokenEstimator';
import { createTokenLogger, TokenLogger } from '../src/monitoring/tokenLogger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Token Estimator', () => {
	describe('estimateTokens', () => {
		it('should return 0 for empty string', () => {
			expect(estimateTokens('')).toBe(0);
		});

		it('should return 0 for null/undefined', () => {
			expect(estimateTokens(null as any)).toBe(0);
			expect(estimateTokens(undefined as any)).toBe(0);
		});

		it('should estimate tokens using chars/4 heuristic', () => {
			// 4 characters = 1 token
			expect(estimateTokens('test')).toBe(1);
			
			// 8 characters = 2 tokens
			expect(estimateTokens('testtest')).toBe(2);
			
			// 5 characters = 2 tokens (ceil)
			expect(estimateTokens('hello')).toBe(2);
		});

		it('should handle multiline text', () => {
			const text = 'line1\nline2\nline3'; // 17 chars
			expect(estimateTokens(text)).toBe(5); // ceil(17/4) = 5
		});

		it('should handle special characters', () => {
			const text = '{ "key": "value" }'; // 18 chars
			expect(estimateTokens(text)).toBe(5); // ceil(18/4) = 5
		});
	});

	describe('estimateTokensFromFile', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-estimator-test-'));
		});

		afterEach(() => {
			fs.rmSync(testDir, { recursive: true, force: true });
		});

		it('should estimate tokens from file content', () => {
			const filePath = path.join(testDir, 'test.txt');
			fs.writeFileSync(filePath, 'hello world test'); // 16 chars = 4 tokens
			
			expect(estimateTokensFromFile(filePath, fs)).toBe(4);
		});

		it('should return 0 for non-existent file', () => {
			const filePath = path.join(testDir, 'nonexistent.txt');
			expect(estimateTokensFromFile(filePath, fs)).toBe(0);
		});
	});

	describe('estimateTokensFromFiles', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-estimator-test-'));
		});

		afterEach(() => {
			fs.rmSync(testDir, { recursive: true, force: true });
		});

		it('should estimate tokens from multiple files', () => {
			const file1 = path.join(testDir, 'file1.txt');
			const file2 = path.join(testDir, 'file2.txt');
			
			fs.writeFileSync(file1, 'test'); // 4 chars = 1 token
			fs.writeFileSync(file2, 'hello world'); // 11 chars = 3 tokens
			
			const result = estimateTokensFromFiles([file1, file2], fs);
			
			expect(result[file1]).toBe(1);
			expect(result[file2]).toBe(3);
		});

		it('should handle mix of existing and non-existing files', () => {
			const existingFile = path.join(testDir, 'exists.txt');
			const missingFile = path.join(testDir, 'missing.txt');
			
			fs.writeFileSync(existingFile, 'content'); // 7 chars = 2 tokens
			
			const result = estimateTokensFromFiles([existingFile, missingFile], fs);
			
			expect(result[existingFile]).toBe(2);
			expect(result[missingFile]).toBe(0);
		});
	});
});

describe('TokenLogger', () => {
	let testProfileDir: string;
	let logger: TokenLogger;

	beforeEach(() => {
		testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-logger-test-'));
		logger = createTokenLogger({ profileDir: testProfileDir });
	});

	afterEach(async () => {
		await logger.close();
		fs.rmSync(testProfileDir, { recursive: true, force: true });
	});

	describe('Directory Creation', () => {
		it('should create logs directory automatically', () => {
			const logsDir = path.join(testProfileDir, 'runner', 'logs');
			expect(fs.existsSync(logsDir)).toBe(true);
		});

		it('should create token-usage.jsonl file on first write', async () => {
			logger.log('test-op', 'test-source', 100);
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			expect(fs.existsSync(logFile)).toBe(true);
		});
	});

	describe('JSONL Format', () => {
		it('should write valid JSONL entries', async () => {
			logger.log('op1', 'source1', 100);
			logger.log('op2', 'source2', 200);
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(2);

			const entry1 = JSON.parse(lines[0]);
			const entry2 = JSON.parse(lines[1]);

			expect(entry1.operation).toBe('op1');
			expect(entry1.source).toBe('source1');
			expect(entry1.estimatedTokens).toBe(100);

			expect(entry2.operation).toBe('op2');
			expect(entry2.source).toBe('source2');
			expect(entry2.estimatedTokens).toBe(200);
		});

		it('should include all required fields', async () => {
			logger.log('test-op', 'test-source', 150, { key: 'value' });
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const entry = JSON.parse(content.trim());

			expect(entry).toHaveProperty('timestamp');
			expect(entry).toHaveProperty('operation', 'test-op');
			expect(entry).toHaveProperty('source', 'test-source');
			expect(entry).toHaveProperty('estimatedTokens', 150);
			expect(entry).toHaveProperty('metadata');
			expect(entry.metadata).toEqual({ key: 'value' });
		});

		it('should format timestamp as ISO 8601', async () => {
			logger.log('test-op', 'test-source', 100);
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const entry = JSON.parse(content.trim());

			expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
		});
	});

	describe('Log Methods', () => {
		it('should log text with token estimation', async () => {
			logger.logText('load-file', 'test.txt', 'hello world test'); // 16 chars = 4 tokens
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const entry = JSON.parse(content.trim());

			expect(entry.operation).toBe('load-file');
			expect(entry.source).toBe('test.txt');
			expect(entry.estimatedTokens).toBe(4);
		});

		it('should log file with token estimation', async () => {
			const testFile = path.join(testProfileDir, 'test.txt');
			fs.writeFileSync(testFile, 'test content'); // 12 chars = 3 tokens

			logger.logFile('load-instruction', testFile);
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const entry = JSON.parse(content.trim());

			expect(entry.operation).toBe('load-instruction');
			expect(entry.source).toBe(testFile);
			expect(entry.estimatedTokens).toBe(3);
		});

		it('should log 0 tokens for non-existent file with error metadata', async () => {
			const missingFile = path.join(testProfileDir, 'missing.txt');

			logger.logFile('load-instruction', missingFile);
			await logger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			const content = fs.readFileSync(logFile, 'utf-8');
			const entry = JSON.parse(content.trim());

			expect(entry.operation).toBe('load-instruction');
			expect(entry.source).toBe(missingFile);
			expect(entry.estimatedTokens).toBe(0);
			expect(entry.metadata).toHaveProperty('error');
		});
	});

	describe('Disabled Logger', () => {
		it('should not write when disabled', async () => {
			const disabledLogger = createTokenLogger({
				profileDir: testProfileDir,
				enabled: false,
			});

			disabledLogger.log('test-op', 'test-source', 100);
			await disabledLogger.close();

			const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			expect(fs.existsSync(logFile)).toBe(false);
		});
	});

	describe('getLogFilePath', () => {
		it('should return correct log file path', () => {
			const expectedPath = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
			expect(logger.getLogFilePath()).toBe(expectedPath);
		});
	});
});

describe('Token Report Generation', () => {
	let testProfileDir: string;
	let logger: TokenLogger;

	beforeEach(() => {
		testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-report-test-'));
		logger = createTokenLogger({ profileDir: testProfileDir });
	});

	afterEach(async () => {
		await logger.close();
		fs.rmSync(testProfileDir, { recursive: true, force: true });
	});

	it('should generate deterministic summary from logs', async () => {
		// Log some entries in a specific order
		logger.log('load-instruction', 'AGENTS.md', 500);
		logger.log('load-instruction', 'copilot-instructions.md', 300);
		logger.log('load-persona', 'senior-dev.md', 200);
		logger.log('cli-operation', 'merge-weave', 100);
		logger.log('load-instruction', 'AGENTS.md', 500); // Duplicate to test aggregation
		await logger.close();

		// Read and verify log structure
		const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
		const content = fs.readFileSync(logFile, 'utf-8');
		const lines = content.trim().split('\n');

		expect(lines).toHaveLength(5);

		// Verify entries are parseable and have expected structure
		const entries = lines.map(line => JSON.parse(line));
		
		// Total tokens should be 1600
		const totalTokens = entries.reduce((sum, e) => sum + e.estimatedTokens, 0);
		expect(totalTokens).toBe(1600);

		// Check that AGENTS.md appears twice (1000 tokens total)
		const agentsEntries = entries.filter(e => e.source === 'AGENTS.md');
		expect(agentsEntries).toHaveLength(2);
		expect(agentsEntries.reduce((sum, e) => sum + e.estimatedTokens, 0)).toBe(1000);
	});

	it('should handle empty log file gracefully', () => {
		// Don't write anything, just verify empty case
		const logFile = path.join(testProfileDir, 'runner', 'logs', 'token-usage.jsonl');
		
		// File shouldn't exist yet
		expect(fs.existsSync(logFile)).toBe(false);
	});
});
