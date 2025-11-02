/**
 * Tests for the report command module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerReportCommand } from '../../src/commands/report.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Report Command', () => {
	let program: Command;
	let tempDir: string;

	beforeEach(() => {
		// Create fresh Command instance for each test
		program = new Command();
		
		// Create temp directory for test fixtures
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-cmd-test-'));
	});

	afterEach(() => {
		// Cleanup temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('should register report command with correct description', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand).toBeDefined();
		expect(reportCommand?.description()).toBe('Aggregate gate reports from directory');
	});

	it('should accept directory argument', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand).toBeDefined();
		
		// Check that it has one argument
		const args = (reportCommand as any)._args;
		expect(args).toHaveLength(1);
		expect(args[0].name()).toBe('dir');
	});

	it('should have --out option with default value', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand).toBeDefined();
		
		// Check options
		const opts = reportCommand?.options;
		const outOption = opts?.find(opt => opt.long === '--out');
		expect(outOption).toBeDefined();
		expect(outOption?.defaultValue).toBe('json');
	});

	it('should be registered as a command', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand).toBeDefined();
		expect(reportCommand?.name()).toBe('report');
	});

	it('should have correct description', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand?.description()).toBe('Aggregate gate reports from directory');
	});

	it('should accept required directory argument', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		expect(reportCommand).toBeDefined();
		
		// Check that it has one required argument
		const args = (reportCommand as any)._args;
		expect(args).toHaveLength(1);
		expect(args[0].name()).toBe('dir');
		expect(args[0].required).toBe(true);
	});

	it('should have --out option for format selection', () => {
		registerReportCommand(program);
		
		const reportCommand = program.commands.find(cmd => cmd.name() === 'report');
		const opts = reportCommand?.options;
		const outOption = opts?.find(opt => opt.long === '--out');
		
		expect(outOption).toBeDefined();
		expect(outOption?.description).toContain('Output format');
		expect(outOption?.defaultValue).toBe('json');
	});
});
