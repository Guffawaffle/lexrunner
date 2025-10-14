/**
 * Tests for Issue Analyzer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueAnalyzer } from '../src/orchestrate/analyzer.js';
import type { GitHubIssue, GitHubClient } from '../src/github/client.js';

// Mock GitHub client
const createMockClient = (): GitHubClient => ({
	listOpenPRs: vi.fn(),
	getPRDetails: vi.fn(),
	getPRDependencies: vi.fn(),
	validateRepository: vi.fn(),
	listIssues: vi.fn(),
	getOctokit: vi.fn(),
	getOwner: vi.fn().mockReturnValue('owner'),
	getRepo: vi.fn().mockReturnValue('repo')
});

describe('IssueAnalyzer', () => {
	let analyzer: IssueAnalyzer;
	let mockClient: GitHubClient;

	beforeEach(() => {
		mockClient = createMockClient();
		analyzer = new IssueAnalyzer(mockClient);
	});

	describe('extractMetadata', () => {
		it('should extract basic metadata from issue', () => {
			const issue: GitHubIssue = {
				number: 1,
				title: 'Test Issue',
				body: 'This is a test issue',
				state: 'open',
				labels: [
					{ name: 'bug', color: 'red' },
					{ name: 'priority:high', color: 'orange' }
				],
				user: { login: 'testuser' },
				assignees: [{ login: 'dev1' }],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-02T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.number).toBe(1);
			expect(metadata.title).toBe('Test Issue');
			expect(metadata.labels).toEqual(['bug', 'priority:high']);
			expect(metadata.assignees).toEqual(['dev1']);
			expect(metadata.author).toBe('testuser');
		});

		it('should extract affected files from issue body', () => {
			const issue: GitHubIssue = {
				number: 2,
				title: 'Fix bug in module',
				body: `
# Bug Description
Need to fix src/utils/helper.ts and src/components/Button.tsx

Also affects:
- src/types/index.ts
- tests/utils.spec.ts
				`,
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.affectedFiles).toContain('src/utils/helper.ts');
			expect(metadata.affectedFiles).toContain('src/components/Button.tsx');
			expect(metadata.affectedFiles).toContain('src/types/index.ts');
			expect(metadata.affectedFiles).toContain('tests/utils.spec.ts');
		});

		it('should extract directories from affected files', () => {
			const issue: GitHubIssue = {
				number: 3,
				title: 'Update module',
				body: 'Modify src/components/Button.tsx',
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.affectedDirectories).toContain('src');
			expect(metadata.affectedDirectories).toContain('src/components');
		});

		it('should extract dependencies from issue body', () => {
			const issue: GitHubIssue = {
				number: 4,
				title: 'Feature depends on other issue',
				body: `
## Dependencies
Depends-on: #123
Requires: #456

This also:
Blocks: #789
				`,
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.dependencies).toContain('#123');
			expect(metadata.dependencies).toContain('#456');
			expect(metadata.dependencies).toContain('#789');
		});

		it('should compute complexity score', () => {
			const issue: GitHubIssue = {
				number: 5,
				title: 'Large refactor',
				body: `
Need to update 15 files
Estimated 800 lines of code changes
				`,
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.complexity.estimatedFiles).toBe(15);
			expect(metadata.complexity.estimatedLines).toBe(800);
			expect(metadata.complexity.score).toBeGreaterThan(0);
		});

		it('should detect Copilot agent assignment', () => {
			const issue: GitHubIssue = {
				number: 6,
				title: 'Task for Copilot',
				body: 'Agent: code-editor',
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [{ login: 'copilot' }],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.copilotAgent?.assigned).toBe(true);
			expect(metadata.copilotAgent?.agent).toBe('code-editor');
		});

		it('should estimate duration from explicit time mentions', () => {
			const issue: GitHubIssue = {
				number: 7,
				title: 'Task with time estimate',
				body: 'This will take approximately 8 hours',
				state: 'open',
				labels: [],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			};

			const metadata = analyzer.extractMetadata(issue);

			expect(metadata.durationEstimate?.hours).toBe(8);
			expect(metadata.durationEstimate?.confidence).toBe('high');
		});
	});

	describe('computeOverlap', () => {
		it('should compute file overlap between issues', () => {
			const issue1 = analyzer.extractMetadata({
				number: 1,
				title: 'Issue 1',
				body: 'Modify src/a.ts and src/b.ts',
				state: 'open',
				labels: [],
				user: { login: 'dev1' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const issue2 = analyzer.extractMetadata({
				number: 2,
				title: 'Issue 2',
				body: 'Modify src/b.ts and src/c.ts',
				state: 'open',
				labels: [],
				user: { login: 'dev2' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const overlap = analyzer.computeOverlap(issue1, issue2);

			expect(overlap.issue1).toBe(1);
			expect(overlap.issue2).toBe(2);
			expect(overlap.fileOverlap).toBeGreaterThan(0);
			expect(overlap.score).toBeGreaterThan(0);
		});

		it('should compute label overlap', () => {
			const issue1 = analyzer.extractMetadata({
				number: 1,
				title: 'Issue 1',
				body: 'Test',
				state: 'open',
				labels: [
					{ name: 'bug', color: 'red' },
					{ name: 'priority:high', color: 'orange' }
				],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const issue2 = analyzer.extractMetadata({
				number: 2,
				title: 'Issue 2',
				body: 'Test',
				state: 'open',
				labels: [
					{ name: 'bug', color: 'red' },
					{ name: 'feature', color: 'blue' }
				],
				user: { login: 'dev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const overlap = analyzer.computeOverlap(issue1, issue2);

			expect(overlap.labelOverlap).toBeGreaterThan(0);
		});

		it('should detect same author', () => {
			const issue1 = analyzer.extractMetadata({
				number: 1,
				title: 'Issue 1',
				body: 'Test',
				state: 'open',
				labels: [],
				user: { login: 'samedev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const issue2 = analyzer.extractMetadata({
				number: 2,
				title: 'Issue 2',
				body: 'Test',
				state: 'open',
				labels: [],
				user: { login: 'samedev' },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			});

			const overlap = analyzer.computeOverlap(issue1, issue2);

			expect(overlap.authorOverlap).toBe(1);
		});
	});

	describe('buildOverlapMatrix', () => {
		it('should build matrix for all issue pairs', () => {
			const issues: GitHubIssue[] = [
				{
					number: 1,
					title: 'Issue 1',
					body: 'Modify src/a.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev1' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 2,
					title: 'Issue 2',
					body: 'Modify src/b.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev2' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 3,
					title: 'Issue 3',
					body: 'Modify src/c.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev3' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}
			];

			const metadata = issues.map(i => analyzer.extractMetadata(i));
			const matrix = analyzer.buildOverlapMatrix(metadata);

			// Should have 3 pairs: (1,2), (1,3), (2,3)
			expect(matrix).toHaveLength(3);
			expect(matrix[0].issue1).toBe(1);
			expect(matrix[0].issue2).toBe(2);
			expect(matrix[1].issue1).toBe(1);
			expect(matrix[1].issue2).toBe(3);
			expect(matrix[2].issue1).toBe(2);
			expect(matrix[2].issue2).toBe(3);
		});

		it('should produce deterministic ordering', () => {
			const issues: GitHubIssue[] = [
				{
					number: 3,
					title: 'Issue 3',
					body: 'Test',
					state: 'open',
					labels: [],
					user: { login: 'dev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 1,
					title: 'Issue 1',
					body: 'Test',
					state: 'open',
					labels: [],
					user: { login: 'dev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 2,
					title: 'Issue 2',
					body: 'Test',
					state: 'open',
					labels: [],
					user: { login: 'dev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}
			];

			const metadata = issues.map(i => analyzer.extractMetadata(i));
			const matrix = analyzer.buildOverlapMatrix(metadata);

			// Matrix pairs from metadata order: (3,1), (3,2), (1,2)
			// After sorting by issue1, issue2: (1,2), (3,1), (3,2)
			expect(matrix[0].issue1).toBe(1);
			expect(matrix[0].issue2).toBe(2);
			expect(matrix[1].issue1).toBe(3);
			expect(matrix[1].issue2).toBe(1);
			expect(matrix[2].issue1).toBe(3);
			expect(matrix[2].issue2).toBe(2);
		});
	});

	describe('identifyParallelGroups', () => {
		it('should identify groups with low overlap', () => {
			const issues: GitHubIssue[] = [
				{
					number: 1,
					title: 'Issue 1',
					body: '- src/module1/a.ts\n- src/module1/b.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev1' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 2,
					title: 'Issue 2',
					body: '- src/module2/c.ts\n- src/module2/d.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev2' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}
			];

			const metadata = issues.map(i => analyzer.extractMetadata(i));
			const matrix = analyzer.buildOverlapMatrix(metadata);
			const groups = analyzer.identifyParallelGroups(metadata, matrix, 0.5);

			// Issues with low file/directory overlap should be in a parallel group
			expect(groups.length).toBeGreaterThan(0);
		});

		it('should sort groups by size', () => {
			const issues: GitHubIssue[] = Array.from({ length: 5 }, (_, i) => ({
				number: i + 1,
				title: `Issue ${i + 1}`,
				body: `Modify src/${i}.ts`,
				state: 'open' as const,
				labels: [],
				user: { login: `dev${i}` },
				assignees: [],
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z'
			}));

			const metadata = issues.map(i => analyzer.extractMetadata(i));
			const matrix = analyzer.buildOverlapMatrix(metadata);
			const groups = analyzer.identifyParallelGroups(metadata, matrix, 0.3);

			if (groups.length > 1) {
				// Larger groups should come first
				for (let i = 0; i < groups.length - 1; i++) {
					expect(groups[i].issues.length).toBeGreaterThanOrEqual(groups[i + 1].issues.length);
				}
			}
		});
	});

	describe('generateRecommendations', () => {
		it('should generate recommendations for parallel groups', () => {
			const metadata = [
				analyzer.extractMetadata({
					number: 1,
					title: 'Issue 1',
					body: '- src/module1/a.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev1' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}),
				analyzer.extractMetadata({
					number: 2,
					title: 'Issue 2',
					body: '- src/module2/b.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev2' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				})
			];

			const matrix = analyzer.buildOverlapMatrix(metadata);
			const groups = analyzer.identifyParallelGroups(metadata, matrix, 0.5);
			const recommendations = analyzer.generateRecommendations(metadata, matrix, groups);

			expect(recommendations.length).toBeGreaterThan(0);
			expect(recommendations.some(r => r.includes('parallel'))).toBe(true);
		});

		it('should warn about high overlap pairs', () => {
			const metadata = [
				analyzer.extractMetadata({
					number: 1,
					title: 'Issue 1',
					body: 'Modify src/same.ts and src/other.ts',
					state: 'open',
					labels: [{ name: 'bug', color: 'red' }],
					user: { login: 'samedev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}),
				analyzer.extractMetadata({
					number: 2,
					title: 'Issue 2',
					body: 'Modify src/same.ts and src/other.ts',
					state: 'open',
					labels: [{ name: 'bug', color: 'red' }],
					user: { login: 'samedev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				})
			];

			const matrix = analyzer.buildOverlapMatrix(metadata);
			const groups = analyzer.identifyParallelGroups(metadata, matrix, 0.3);
			const recommendations = analyzer.generateRecommendations(metadata, matrix, groups);

			expect(recommendations.some(r => r.includes('high overlap'))).toBe(true);
		});

		it('should note explicit dependencies', () => {
			const metadata = [
				analyzer.extractMetadata({
					number: 1,
					title: 'Issue 1',
					body: 'Depends-on: #2',
					state: 'open',
					labels: [],
					user: { login: 'dev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}),
				analyzer.extractMetadata({
					number: 2,
					title: 'Issue 2',
					body: 'Test',
					state: 'open',
					labels: [],
					user: { login: 'dev' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				})
			];

			const matrix = analyzer.buildOverlapMatrix(metadata);
			const groups = analyzer.identifyParallelGroups(metadata, matrix, 0.3);
			const recommendations = analyzer.generateRecommendations(metadata, matrix, groups);

			expect(recommendations.some(r => r.includes('dependencies'))).toBe(true);
		});
	});

	describe('analyzeIssues', () => {
		it('should perform complete analysis', async () => {
			const issues: GitHubIssue[] = [
				{
					number: 1,
					title: 'Issue 1',
					body: 'Modify src/a.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev1' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				},
				{
					number: 2,
					title: 'Issue 2',
					body: 'Modify src/b.ts',
					state: 'open',
					labels: [],
					user: { login: 'dev2' },
					assignees: [],
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z'
				}
			];

			const result = await analyzer.analyzeIssues(issues);

			expect(result.metadata).toHaveLength(2);
			expect(result.overlapMatrix).toHaveLength(1);
			expect(result.parallelGroups).toBeDefined();
			expect(result.recommendations).toBeDefined();
		});
	});
});
