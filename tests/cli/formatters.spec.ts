import { describe, it, expect } from 'vitest';
import {
	getStatusIcon,
	formatTable,
	formatTree,
	formatStatusTable,
	formatMarkdown,
	formatDuration,
	formatFileSize,
	formatCSV,
	formatQueryResult,
	pluralize,
	type TreeNode,
	type MarkdownSection
} from '../../src/cli/formatters.js';

describe('CLI Formatters', () => {
	describe('getStatusIcon', () => {
		it('should return correct icon for pass', () => {
			expect(getStatusIcon('pass')).toBe('✓');
		});

		it('should return correct icon for fail', () => {
			expect(getStatusIcon('fail')).toBe('✗');
		});

		it('should return correct icon for blocked', () => {
			expect(getStatusIcon('blocked')).toBe('⛔');
		});

		it('should return correct icon for skipped', () => {
			expect(getStatusIcon('skipped')).toBe('⏭');
		});

		it('should return correct icon for retrying', () => {
			expect(getStatusIcon('retrying')).toBe('🔄');
		});

		it('should return ? for unknown status', () => {
			expect(getStatusIcon('unknown')).toBe('?');
		});
	});

	describe('pluralize', () => {
		it('should return singular for count of 1', () => {
			expect(pluralize(1, 'node')).toBe('node');
			expect(pluralize(1, 'item')).toBe('item');
		});

		it('should return plural for count > 1', () => {
			expect(pluralize(2, 'node')).toBe('nodes');
			expect(pluralize(5, 'item')).toBe('items');
			expect(pluralize(0, 'node')).toBe('nodes'); // 0 is plural
		});

		it('should use custom plural form if provided', () => {
			expect(pluralize(1, 'child', 'children')).toBe('child');
			expect(pluralize(2, 'child', 'children')).toBe('children');
			expect(pluralize(3, 'person', 'people')).toBe('people');
		});

		it('should handle edge cases', () => {
			expect(pluralize(0, 'node')).toBe('nodes');
			expect(pluralize(-1, 'node')).toBe('nodes');
		});
	});

	describe('formatTable', () => {
		it('should format empty data', () => {
			expect(formatTable([])).toBe('No results');
		});

		it('should align columns correctly', () => {
			const data = [
				{ name: 'item1', value: '10' },
				{ name: 'item2', value: '200' }
			];
			const result = formatTable(data);
			
			expect(result).toContain('name');
			expect(result).toContain('value');
			expect(result).toContain('item1');
			expect(result).toContain('item2');
			expect(result.split('\n').length).toBe(4); // header + separator + 2 rows
		});

		it('should handle custom headers', () => {
			const data = [
				{ name: 'test', value: '1', extra: 'ignored' }
			];
			const result = formatTable(data, { headers: ['name', 'value'] });
			
			expect(result).toContain('name');
			expect(result).toContain('value');
			expect(result).not.toContain('extra');
		});

		it('should pad columns for alignment', () => {
			const data = [
				{ a: 'short', b: 'value' },
				{ a: 'very long name', b: 'v' }
			];
			const result = formatTable(data);
			const lines = result.split('\n');
			
			// All rows should have same length (within margin for separators)
			const lengths = lines.map(l => l.length);
			expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2);
		});
	});

	describe('formatTree', () => {
		it('should format empty tree', () => {
			expect(formatTree([])).toBe('');
		});

		it('should render single node', () => {
			const nodes: TreeNode[] = [
				{ id: 'root' }
			];
			const result = formatTree(nodes);
			
			expect(result).toContain('root');
			expect(result).toContain('└──');
		});

		it('should render tree with children', () => {
			const nodes: TreeNode[] = [
				{ id: 'root', children: ['child1', 'child2'] },
				{ id: 'child1' },
				{ id: 'child2' }
			];
			const result = formatTree(nodes);
			
			expect(result).toContain('root');
			expect(result).toContain('child1');
			expect(result).toContain('child2');
			expect(result).toContain('├──');
			expect(result).toContain('└──');
		});

		it('should render multi-level tree', () => {
			const nodes: TreeNode[] = [
				{ id: 'root', children: ['child1'] },
				{ id: 'child1', children: ['grandchild'] },
				{ id: 'grandchild' }
			];
			const result = formatTree(nodes);
			
			expect(result).toContain('root');
			expect(result).toContain('child1');
			expect(result).toContain('grandchild');
			expect(result).toContain('└──');
		});

		it('should handle multiple roots', () => {
			const nodes: TreeNode[] = [
				{ id: 'root1', children: ['child1'] },
				{ id: 'root2', children: ['child2'] },
				{ id: 'child1' },
				{ id: 'child2' }
			];
			const result = formatTree(nodes);
			
			expect(result).toContain('root1');
			expect(result).toContain('root2');
		});
	});

	describe('formatStatusTable', () => {
		it('should format status table with results', () => {
			const results = new Map([
				['node1', {
					status: 'pass',
					gates: [
						{ status: 'pass', gate: 'test', duration: 100 }
					],
					eligibleForMerge: true
				}],
				['node2', {
					status: 'fail',
					gates: [
						{ status: 'fail', gate: 'lint', duration: 50 }
					],
					eligibleForMerge: false
				}]
			]);
			const mergeSummary = {
				eligible: ['node1'],
				pending: [],
				failed: ['node2'],
				blocked: []
			};

			const result = formatStatusTable(results, mergeSummary);
			
			expect(result).toContain('Execution Status Table');
			expect(result).toContain('node1');
			expect(result).toContain('node2');
			expect(result).toContain('✓ pass');
			expect(result).toContain('✗ fail');
			expect(result).toContain('Summary');
			expect(result).toContain('**Eligible**: 1 node');
			expect(result).toContain('**Failed**: 1 node');
		});

		it('should show gate pass/fail counts', () => {
			const results = new Map([
				['node1', {
					status: 'fail',
					gates: [
						{ status: 'pass', gate: 'test1', duration: 100 },
						{ status: 'pass', gate: 'test2', duration: 100 },
						{ status: 'fail', gate: 'test3', duration: 50 }
					],
					eligibleForMerge: false
				}]
			]);
			const mergeSummary = {
				eligible: [],
				pending: [],
				failed: ['node1'],
				blocked: []
			};

			const result = formatStatusTable(results, mergeSummary);
			
			expect(result).toContain('2/3 passed');
			expect(result).toContain('1 failed');
		});

		it('should use correct pluralization', () => {
			const results = new Map();
			const mergeSummary = {
				eligible: ['node1'],
				pending: ['node2', 'node3'],
				failed: [],
				blocked: []
			};

			const result = formatStatusTable(results, mergeSummary);
			
			// Singular
			expect(result).toContain('1 node ready for merge');
			// Plural
			expect(result).toContain('2 nodes waiting');
		});
	});

	describe('formatMarkdown', () => {
		it('should format single section', () => {
			const sections: MarkdownSection[] = [
				{ heading: 'Test', content: 'Content here' }
			];
			const result = formatMarkdown(sections);
			
			expect(result).toContain('## Test');
			expect(result).toContain('Content here');
		});

		it('should respect heading levels', () => {
			const sections: MarkdownSection[] = [
				{ heading: 'Level 1', content: 'Content', level: 1 },
				{ heading: 'Level 3', content: 'Content', level: 3 }
			];
			const result = formatMarkdown(sections);
			
			expect(result).toContain('# Level 1');
			expect(result).toContain('### Level 3');
		});

		it('should join multiple sections', () => {
			const sections: MarkdownSection[] = [
				{ heading: 'First', content: 'A' },
				{ heading: 'Second', content: 'B' }
			];
			const result = formatMarkdown(sections);
			
			expect(result).toContain('## First');
			expect(result).toContain('## Second');
			expect(result.split('\n\n').length).toBeGreaterThanOrEqual(3);
		});
	});

	describe('formatDuration', () => {
		it('should format milliseconds', () => {
			expect(formatDuration(0)).toBe('0ms');
			expect(formatDuration(500)).toBe('500ms');
			expect(formatDuration(999)).toBe('999ms');
		});

		it('should format seconds', () => {
			expect(formatDuration(1000)).toBe('1.0s');
			expect(formatDuration(5500)).toBe('5.5s');
			expect(formatDuration(59999)).toBe('60.0s');
		});

		it('should format minutes', () => {
			expect(formatDuration(60000)).toBe('1.0m');
			expect(formatDuration(150000)).toBe('2.5m');
			expect(formatDuration(3599999)).toBe('60.0m');
		});

		it('should format hours', () => {
			expect(formatDuration(3600000)).toBe('1.0h');
			expect(formatDuration(7200000)).toBe('2.0h');
			expect(formatDuration(10800000)).toBe('3.0h');
		});

		it('should handle edge cases', () => {
			expect(formatDuration(0)).toBe('0ms');
			expect(formatDuration(1)).toBe('1ms');
		});
	});

	describe('formatFileSize', () => {
		it('should format bytes', () => {
			expect(formatFileSize(0)).toBe('0 B');
			expect(formatFileSize(500)).toBe('500 B');
			expect(formatFileSize(1023)).toBe('1023 B');
		});

		it('should format kilobytes', () => {
			expect(formatFileSize(1024)).toBe('1.00 KB');
			expect(formatFileSize(2048)).toBe('2.00 KB');
			expect(formatFileSize(1024 * 1024 - 1)).toContain('KB');
		});

		it('should format megabytes', () => {
			expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
			expect(formatFileSize(1024 * 1024 * 5)).toBe('5.00 MB');
		});

		it('should format gigabytes', () => {
			expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
			expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
		});

		it('should use correct units', () => {
			expect(formatFileSize(1024).endsWith('KB')).toBe(true);
			expect(formatFileSize(1024 * 1024).endsWith('MB')).toBe(true);
			expect(formatFileSize(1024 * 1024 * 1024).endsWith('GB')).toBe(true);
		});
	});

	describe('formatCSV', () => {
		it('should format empty data', () => {
			expect(formatCSV([])).toBe('No results');
		});

		it('should format data with headers', () => {
			const data = [
				{ name: 'item1', value: '10' },
				{ name: 'item2', value: '20' }
			];
			const result = formatCSV(data);
			
			expect(result).toContain('name,value');
			expect(result).toContain('"item1","10"');
			expect(result).toContain('"item2","20"');
		});

		it('should escape values correctly', () => {
			const data = [
				{ name: 'test, with comma', value: 'ok' }
			];
			const result = formatCSV(data);
			
			// Values should be JSON-stringified (quoted)
			expect(result).toContain('"test, with comma"');
		});

		it('should handle missing values', () => {
			const data = [
				{ name: 'item1', value: '10' },
				{ name: 'item2' } // missing value
			];
			const result = formatCSV(data);
			
			expect(result).toContain('""'); // empty string for missing value
		});
	});

	describe('formatQueryResult', () => {
		it('should format JSON (placeholder)', () => {
			const result = { items: [], count: 0, query: 'test' };
			const output = formatQueryResult(result, 'json');
			
			// Note: In actual use, CLI should use canonicalJSONStringify
			expect(output).toContain('{');
			expect(() => JSON.parse(output)).not.toThrow();
		});

		it('should format stats', () => {
			const result = {
				stats: {
					totalItems: 10,
					totalLevels: 3,
					avgDepsPerItem: 2.5,
					avgGatesPerItem: 1.2,
					rootNodes: 2,
					leafNodes: 4
				}
			};
			const output = formatQueryResult(result, 'table');
			
			expect(output).toContain('Plan Statistics:');
			expect(output).toContain('Total Items: 10');
			expect(output).toContain('Total Levels: 3');
			expect(output).toContain('Avg Dependencies/Item: 2.50');
			expect(output).toContain('Root Nodes: 2');
		});

		it('should format CSV output', () => {
			const result = {
				items: [
					{ name: 'item1', level: 1, deps: [] }
				],
				count: 1,
				query: 'test'
			};
			const output = formatQueryResult(result, 'csv');
			
			expect(output).toContain('name,level,deps');
		});

		it('should format table output (default)', () => {
			const result = {
				items: [
					{ name: 'item1', level: 1, deps: ['dep1'], gates: [{ name: 'test' }] }
				],
				count: 1,
				query: 'test query'
			};
			const output = formatQueryResult(result, 'table');
			
			expect(output).toContain('Query: test query');
			expect(output).toContain('Results: 1');
			expect(output).toContain('- item1 [Level 1]');
			expect(output).toContain('Deps: dep1');
			expect(output).toContain('Gates: test');
		});

		it('should handle empty items', () => {
			const result = { items: [], count: 0, query: 'test' };
			const output = formatQueryResult(result, 'table');
			
			expect(output).toBe('No results');
		});

		it('should show dependents if present', () => {
			const result = {
				items: [
					{ name: 'item1', level: 1, deps: [], dependents: ['item2', 'item3'], gates: [] }
				],
				count: 1,
				query: 'test'
			};
			const output = formatQueryResult(result, 'table');
			
			expect(output).toContain('Dependents: item2, item3');
		});
	});

	describe('Integration: no-color support', () => {
		// Note: The formatters module respects isColorDisabled() from colorControl
		// These tests verify the structure without ANSI codes
		
		it('should produce plain text output', () => {
			const data = [{ name: 'test', value: '1' }];
			const result = formatTable(data);
			
			// Should not contain ANSI escape codes
			expect(result).not.toMatch(/\u001b\[[0-9;]*m/);
		});

		it('should use text icons consistently', () => {
			const icons = ['pass', 'fail', 'blocked', 'skipped', 'retrying'].map(getStatusIcon);
			
			// All icons should be single characters or emoji
			icons.forEach(icon => {
				expect(icon.length).toBeGreaterThanOrEqual(1);
				expect(icon.length).toBeLessThanOrEqual(2); // emoji can be 2 chars in some encodings
			});
		});
	});

	describe('Edge cases', () => {
		it('should handle very long strings in tables', () => {
			const data = [
				{ name: 'a'.repeat(100), value: 'short' }
			];
			const result = formatTable(data);
			
			expect(result).toContain('a'.repeat(100));
			expect(result.split('\n').length).toBe(3); // header + separator + row
		});

		it('should handle special characters in tree nodes', () => {
			const nodes: TreeNode[] = [
				{ id: 'root/with/slashes' },
				{ id: 'node-with-dashes' },
				{ id: 'node_with_underscores' }
			];
			const result = formatTree(nodes);
			
			expect(result).toContain('root/with/slashes');
			expect(result).toContain('node-with-dashes');
		});

		it('should handle zero duration', () => {
			expect(formatDuration(0)).toBe('0ms');
		});

		it('should handle zero file size', () => {
			expect(formatFileSize(0)).toBe('0 B');
		});

		it('should handle very large numbers', () => {
			expect(formatDuration(Number.MAX_SAFE_INTEGER)).toContain('h');
			expect(formatFileSize(Number.MAX_SAFE_INTEGER)).toContain('GB');
		});
	});
});
