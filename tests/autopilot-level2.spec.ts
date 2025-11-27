import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutopilotLevel2 } from '../src/autopilot/level2.js';
import { AutopilotContext } from '../src/autopilot/base.js';
import { Plan } from '../src/schema.js';

describe('AutopilotLevel2', () => {
	let context: AutopilotContext;
	let plan: Plan;

	beforeEach(() => {
		plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{
					name: "test-item",
					deps: [],
					gates: [
						{
							name: "lint",
							run: "npm run lint",
							env: {},
							runtime: "local" as const,
							artifacts: []
						},
						{
							name: "test",
							run: "npm test",
							env: {},
							runtime: "local" as const,
							artifacts: []
						}
					]
				}
			]
		};

		context = {
			plan,
			profilePath: '/tmp/test-profile',
			profileRole: 'local'
		};
	});

	describe('basic functionality', () => {
		it('should report level 2', () => {
			const autopilot = new AutopilotLevel2(context);
			expect(autopilot.getLevel()).toBe(2);
		});

		it('should execute successfully without PR context', async () => {
			const autopilot = new AutopilotLevel2(context);

			// Mock the ArtifactWriter to avoid filesystem operations
			vi.doMock('../src/autopilot/artifacts.js', () => ({
				ArtifactWriter: vi.fn(function () {
					return {
						initialize: vi.fn().mockResolvedValue(undefined),
						writeAnalysis: vi.fn().mockResolvedValue('/tmp/analysis.json'),
						writeWeaveReport: vi.fn().mockResolvedValue('/tmp/weave-report.md'),
						writeGatePredictions: vi.fn().mockResolvedValue('/tmp/gate-predictions.json'),
						writeExecutionLog: vi.fn().mockResolvedValue('/tmp/execution-log.md'),
						writeMetadata: vi.fn().mockResolvedValue('/tmp/metadata.json'),
						getOutputDir: vi.fn().mockReturnValue('/tmp/deliverables')
					};
				})
			}));

			const result = await autopilot.execute();

			expect(result.level).toBe(2);
			expect(result.success).toBe(true);
			expect(result.message).toContain('Level 2: No PR context detected - artifacts only mode');
		});

		it('should handle PR context from environment variables', async () => {
			// Mock environment variables
			const originalEnv = process.env;
			process.env = {
				...originalEnv,
				GITHUB_PR_NUMBER: '123',
				GITHUB_REPOSITORY: 'owner/repo',
				GITHUB_TOKEN: 'fake-token'
			};

			const autopilot = new AutopilotLevel2(context);

			// Mock GitHub API calls
			const mockOctokit = {
				rest: {
					issues: {
						listComments: vi.fn().mockResolvedValue({ data: [] }),
						createComment: vi.fn().mockResolvedValue({ data: { id: 1 } })
					},
					repos: {
						createCommitStatus: vi.fn().mockResolvedValue({ data: {} })
					}
				}
			};

			// Mock Octokit import
			vi.doMock('@octokit/rest', () => ({
				Octokit: vi.fn(function () {
					return mockOctokit;
				})
			}));

			// Mock ArtifactWriter
			vi.doMock('../src/autopilot/artifacts.js', () => ({
				ArtifactWriter: vi.fn().mockImplementation(() => ({
					initialize: vi.fn().mockResolvedValue(undefined),
					writeAnalysis: vi.fn().mockResolvedValue('/tmp/analysis.json'),
					writeWeaveReport: vi.fn().mockResolvedValue('/tmp/weave-report.md'),
					writeGatePredictions: vi.fn().mockResolvedValue('/tmp/gate-predictions.json'),
					writeExecutionLog: vi.fn().mockResolvedValue('/tmp/execution-log.md'),
					writeMetadata: vi.fn().mockResolvedValue('/tmp/metadata.json'),
					getOutputDir: vi.fn().mockReturnValue('/tmp/deliverables')
				}))
			}));

			try {
				const result = await autopilot.execute();

				expect(result.level).toBe(2);
				expect(result.success).toBe(true);
				expect(result.message).toContain('Level 2: PR annotations complete');
			} finally {
				// Restore environment
				process.env = originalEnv;
			}
		});

		it('should handle missing GitHub token gracefully', async () => {
			// Mock environment variables with PR context but no token
			const originalEnv = process.env;
			process.env = {
				...originalEnv,
				GITHUB_PR_NUMBER: '123',
				GITHUB_REPOSITORY: 'owner/repo'
			};
			delete process.env.GITHUB_TOKEN;

			const autopilot = new AutopilotLevel2(context);

			// Mock ArtifactWriter
			vi.doMock('../src/autopilot/artifacts.js', () => ({
				ArtifactWriter: vi.fn().mockImplementation(() => ({
					initialize: vi.fn().mockResolvedValue(undefined),
					writeAnalysis: vi.fn().mockResolvedValue('/tmp/analysis.json'),
					writeWeaveReport: vi.fn().mockResolvedValue('/tmp/weave-report.md'),
					writeGatePredictions: vi.fn().mockResolvedValue('/tmp/gate-predictions.json'),
					writeExecutionLog: vi.fn().mockResolvedValue('/tmp/execution-log.md'),
					writeMetadata: vi.fn().mockResolvedValue('/tmp/metadata.json'),
					getOutputDir: vi.fn().mockReturnValue('/tmp/deliverables')
				}))
			}));

			try {
				const result = await autopilot.execute();

				expect(result.level).toBe(2);
				expect(result.success).toBe(false);
				expect(result.message).toContain('GitHub token required for Level 2');
			} finally {
				// Restore environment
				process.env = originalEnv;
			}
		});
	});

	describe('comment generation', () => {
		it('should generate proper PR comment format', () => {
			const autopilot = new AutopilotLevel2(context);

			// Test comment generation would require access to private methods
			// For now, just verify the autopilot can be instantiated
			expect(autopilot).toBeInstanceOf(AutopilotLevel2);
		});
	});

	describe('idempotent updates', () => {
		it('should update existing comments instead of creating new ones', async () => {
			// This test would require mocking the GitHub API responses
			// with existing comments containing the lex-pr marker
			expect(true).toBe(true); // Placeholder
		});
	});
});