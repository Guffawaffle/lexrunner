/**
 * Unit tests for PR creation guards
 * 
 * Validates that safety mechanisms prevent accidental PR creation
 * in Issues-only commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertNoCreatePR, validateNoCreatePRFlags } from '../../src/commands/guards.js';

describe('guards: assertNoCreatePR', () => {
	let originalPrepareStackTrace: typeof Error.prepareStackTrace;
	
	beforeEach(() => {
		originalPrepareStackTrace = Error.prepareStackTrace;
	});
	
	afterEach(() => {
		Error.prepareStackTrace = originalPrepareStackTrace;
	});
	
	it('should throw if call stack includes createPullRequest', () => {
		// Mock call stack to include PR creation method
		Error.prepareStackTrace = () => 'at createPullRequest (/path/to/file.js:10:5)';
		
		expect(() => assertNoCreatePR('test-operation')).toThrow('SAFETY VIOLATION');
		expect(() => assertNoCreatePR('test-operation')).toThrow('createPullRequest');
		expect(() => assertNoCreatePR('test-operation')).toThrow('Issues-only');
	});
	
	it('should throw if call stack includes pulls.create', () => {
		Error.prepareStackTrace = () => 'at pulls.create (/path/to/file.js:10:5)';
		
		expect(() => assertNoCreatePR('test-operation')).toThrow('SAFETY VIOLATION');
		expect(() => assertNoCreatePR('test-operation')).toThrow('pulls.create');
	});
	
	it('should throw if call stack includes mergePullRequest', () => {
		Error.prepareStackTrace = () => 'at mergePullRequest (/path/to/file.js:10:5)';
		
		expect(() => assertNoCreatePR('test-operation')).toThrow('SAFETY VIOLATION');
		expect(() => assertNoCreatePR('test-operation')).toThrow('mergePullRequest');
	});
	
	it('should not throw for safe operations', () => {
		// Normal call stack without PR creation
		expect(() => assertNoCreatePR('test-operation')).not.toThrow();
	});
	
	it('should include operation name in error message', () => {
		Error.prepareStackTrace = () => 'at createPullRequest (/path/to/file.js:10:5)';
		
		expect(() => assertNoCreatePR('lex-pr idea')).toThrow('lex-pr idea');
	});
	
	it('should not be fooled by similar method names', () => {
		Error.prepareStackTrace = () => 'at createPoll (/path/to/file.js:10:5)';
		
		expect(() => assertNoCreatePR('test-operation')).not.toThrow();
	});
});

describe('guards: validateNoCreatePRFlags', () => {
	it('should throw if create-pr flag is present', () => {
		expect(() => validateNoCreatePRFlags({ 'create-pr': true })).toThrow('SAFETY VIOLATION');
		expect(() => validateNoCreatePRFlags({ 'create-pr': true })).toThrow('--create-pr');
	});
	
	it('should throw if pr flag is present', () => {
		expect(() => validateNoCreatePRFlags({ pr: 'main' })).toThrow('SAFETY VIOLATION');
		expect(() => validateNoCreatePRFlags({ pr: 'main' })).toThrow('--pr');
	});
	
	it('should throw if pull-request flag is present', () => {
		expect(() => validateNoCreatePRFlags({ 'pull-request': true })).toThrow('SAFETY VIOLATION');
		expect(() => validateNoCreatePRFlags({ 'pull-request': true })).toThrow('--pull-request');
	});
	
	it('should throw if merge flag is present', () => {
		expect(() => validateNoCreatePRFlags({ merge: true })).toThrow('SAFETY VIOLATION');
		expect(() => validateNoCreatePRFlags({ merge: true })).toThrow('--merge');
	});
	
	it('should allow safe flags', () => {
		expect(() => validateNoCreatePRFlags({ 'dry-run': true })).not.toThrow();
		expect(() => validateNoCreatePRFlags({ output: '/tmp/out.json' })).not.toThrow();
		expect(() => validateNoCreatePRFlags({ title: 'Test', description: 'Test' })).not.toThrow();
	});
	
	it('should allow multiple safe flags', () => {
		expect(() => validateNoCreatePRFlags({
			'dry-run': true,
			output: '/tmp/out.json',
			title: 'Test',
			description: 'Test description'
		})).not.toThrow();
	});
	
	it('should throw on first forbidden flag found', () => {
		expect(() => validateNoCreatePRFlags({
			'dry-run': true,
			'create-pr': true,
			pr: 'main'
		})).toThrow('SAFETY VIOLATION');
	});
	
	it('should include guidance in error message', () => {
		expect(() => validateNoCreatePRFlags({ pr: true })).toThrow('GitHub Projects');
	});
});
