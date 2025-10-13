/**
 * CLI output formatters
 * Centralized formatting utilities for tables, trees, status displays, and more
 */

import { isColorDisabled } from '../util/colorControl.js';

/**
 * Table formatting options
 */
export interface TableOptions {
	headers?: string[];
	align?: ('left' | 'right' | 'center')[];
	noColor?: boolean;
}

/**
 * Tree node for dependency visualization
 */
export interface TreeNode {
	id: string;
	children?: string[];
	metadata?: Record<string, any>;
}

/**
 * Tree formatting options
 */
export interface TreeOptions {
	noColor?: boolean;
	indent?: string;
}

/**
 * Status item for status table
 */
export interface StatusItem {
	name: string;
	status: string;
	gates?: Array<{
		gate: string;
		status: string;
		duration?: number;
	}>;
	eligibleForMerge?: boolean;
}

/**
 * Markdown section
 */
export interface MarkdownSection {
	heading: string;
	content: string;
	level?: number;
}

/**
 * Get status icon for a given status
 */
export function getStatusIcon(status: string): string {
	switch (status) {
		case "pass": return "✓";
		case "fail": return "✗";
		case "blocked": return "⛔";
		case "skipped": return "⏭";
		case "retrying": return "🔄";
		default: return "?";
	}
}

/**
 * Helper for pluralization
 */
export function pluralize(count: number, singular: string, plural?: string): string {
	return count === 1 ? singular : (plural || singular + 's');
}

/**
 * Format data as ASCII table
 */
export function formatTable(
	data: Record<string, any>[],
	options?: TableOptions
): string {
	if (data.length === 0) return "No results";

	const headers = options?.headers || Object.keys(data[0]);
	const align = options?.align || headers.map(() => 'left' as const);
	
	// Calculate column widths
	const widths = headers.map((header, i) => {
		const dataWidth = Math.max(
			...data.map(row => String(row[header] || "").length)
		);
		return Math.max(header.length, dataWidth);
	});

	// Format header row
	const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
	const separator = widths.map(w => '-'.repeat(w)).join('-|-');
	
	// Format data rows
	const rows = data.map(row => 
		headers.map((h, i) => {
			const value = String(row[h] || "");
			return value.padEnd(widths[i]);
		}).join(' | ')
	);

	return [headerRow, separator, ...rows].join('\n');
}

/**
 * Format dependency tree (DAG visualization)
 */
export function formatTree(nodes: TreeNode[], options?: TreeOptions): string {
	const indent = options?.indent || '  ';
	const lines: string[] = [];
	
	// Build a map of nodes
	const nodeMap = new Map<string, TreeNode>();
	nodes.forEach(node => nodeMap.set(node.id, node));
	
	// Find root nodes (nodes with no parents)
	const childSet = new Set<string>();
	nodes.forEach(node => {
		node.children?.forEach(child => childSet.add(child));
	});
	const roots = nodes.filter(node => !childSet.has(node.id));
	
	// Recursive tree builder
	function buildTree(nodeId: string, prefix: string = '', isLast: boolean = true): void {
		const node = nodeMap.get(nodeId);
		if (!node) return;
		
		const connector = isLast ? '└──' : '├──';
		lines.push(`${prefix}${connector} ${node.id}`);
		
		const children = node.children || [];
		const newPrefix = prefix + (isLast ? '    ' : '│   ');
		
		children.forEach((child, index) => {
			buildTree(child, newPrefix, index === children.length - 1);
		});
	}
	
	// Build tree from roots
	roots.forEach((root, index) => {
		buildTree(root.id, '', index === roots.length - 1);
	});
	
	return lines.join('\n');
}

/**
 * Format status summary table for execution results
 */
export function formatStatusTable(
	results: Map<string, any>,
	mergeSummary: any
): string {
	const lines: string[] = [];
	
	lines.push("\n## Execution Status Table");
	lines.push("");
	lines.push("| Node | Status | Gates | Eligible | Details |");
	lines.push("|------|--------|-------|----------|---------|");
	
	for (const [name, result] of results) {
		const statusIcon = getStatusIcon(result.status);
		const gateCount = result.gates.length;
		const eligible = result.eligibleForMerge ? "✓" : "✗";
		
		let gateDetails = "";
		if (gateCount > 0) {
			const passed = result.gates.filter((g: any) => g.status === "pass").length;
			const failed = result.gates.filter((g: any) => g.status === "fail").length;
			gateDetails = `${passed}/${gateCount} passed`;
			if (failed > 0) gateDetails += `, ${failed} failed`;
		}
		
		lines.push(`| ${name} | ${statusIcon} ${result.status} | ${gateCount} | ${eligible} | ${gateDetails} |`);
	}
	
	lines.push("");
	lines.push("### Summary");
	lines.push(`- **Eligible**: ${mergeSummary.eligible.length} ${pluralize(mergeSummary.eligible.length, 'node')} ready for merge`);
	lines.push(`- **Pending**: ${mergeSummary.pending.length} ${pluralize(mergeSummary.pending.length, 'node')} waiting`);
	lines.push(`- **Failed**: ${mergeSummary.failed.length} ${pluralize(mergeSummary.failed.length, 'node')} with failures`);
	lines.push(`- **Blocked**: ${mergeSummary.blocked.length} ${pluralize(mergeSummary.blocked.length, 'node')} blocked by dependencies`);
	
	return lines.join('\n');
}

/**
 * Format markdown section
 */
export function formatMarkdown(sections: MarkdownSection[]): string {
	return sections.map(section => {
		const level = section.level || 2;
		const prefix = '#'.repeat(level);
		return `${prefix} ${section.heading}\n\n${section.content}`;
	}).join('\n\n');
}

/**
 * Format duration (ms → human-readable)
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
	return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format file size (bytes → human-readable)
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format CSV output from array of objects
 */
export function formatCSV(data: Record<string, any>[]): string {
	if (data.length === 0) return "No results";
	
	const headers = Object.keys(data[0]);
	const rows = data.map((item: any) =>
		headers.map((h) => JSON.stringify(item[h] || "")).join(",")
	);
	return [headers.join(","), ...rows].join("\n");
}

/**
 * Format query results in various formats
 */
export function formatQueryResult(result: any, format: string): string {
	// Note: For JSON format, the caller should use canonicalJSONStringify
	// This function returns a JSON string but doesn't guarantee canonical ordering
	if (format === 'json') {
		return JSON.stringify(result);
	}
	
	if (result.stats) {
		const stats = result.stats;
		return `Plan Statistics:
  Total Items: ${stats.totalItems}
  Total Levels: ${stats.totalLevels}
  Avg Dependencies/Item: ${stats.avgDepsPerItem.toFixed(2)}
  Avg Gates/Item: ${stats.avgGatesPerItem.toFixed(2)}
  Root Nodes: ${stats.rootNodes}
  Leaf Nodes: ${stats.leafNodes}`;
	}
	
	if (format === 'csv') {
		return formatCSV(result.items || []);
	}
	
	// Table format (default)
	const items = result.items || [];
	if (items.length === 0) return "No results";
	
	let output = `Query: ${result.query}\nResults: ${result.count}\n\n`;
	
	items.forEach((item: any) => {
		output += `- ${item.name} [Level ${item.level}]\n`;
		if (item.deps.length > 0) {
			output += `  Deps: ${item.deps.join(", ")}\n`;
		}
		if (item.dependents && item.dependents.length > 0) {
			output += `  Dependents: ${item.dependents.join(", ")}\n`;
		}
		if (item.gates.length > 0) {
			output += `  Gates: ${item.gates.map((g: any) => g.name).join(", ")}\n`;
		}
	});
	
	return output;
}
