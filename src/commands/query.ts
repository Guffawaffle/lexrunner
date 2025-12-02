/**
 * Advanced query language for plan analysis
 */

import { Command } from "commander";
import { Plan, loadPlan } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { formatQueryResult } from "../cli/formatters.js";
import { throwExit } from "../cli/exitHandler.js";
import * as fs from "fs";

export interface QueryResult {
	items: any[];
	count: number;
	query: string;
}

export type QueryOperator = "eq" | "ne" | "contains" | "in" | "gt" | "lt" | "gte" | "lte";

export interface QueryFilter {
	field: string;
	operator: QueryOperator;
	value: any;
}

/**
 * Advanced query engine for plan analysis
 */
export class PlanQueryEngine {
	private plan: Plan;
	private levels: string[][];

	constructor(plan: Plan) {
		this.plan = plan;
		this.levels = computeMergeOrder(plan);
	}

	/**
	 * Execute a query against the plan
	 * Query format: field operator value [AND field operator value]
	 * Examples:
	 *   "name contains feature"
	 *   "level eq 1"
	 *   "deps.length gt 2"
	 *   "gates.length eq 0"
	 */
	query(queryString: string): QueryResult {
		const filters = this.parseQuery(queryString);
		const enrichedItems = this.enrichItems();
		const filteredItems = enrichedItems.filter((item) =>
			this.matchesFilters(item, filters)
		);

		return {
			items: filteredItems,
			count: filteredItems.length,
			query: queryString,
		};
	}

	/**
	 * Get items by merge level
	 */
	byLevel(level: number): QueryResult {
		const items = this.levels[level - 1] || [];
		const enrichedItems = this.enrichItems().filter((item) =>
			items.includes(item.name)
		);

		return {
			items: enrichedItems,
			count: enrichedItems.length,
			query: `level eq ${level}`,
		};
	}

	/**
	 * Get items with no dependencies (roots)
	 */
	roots(): QueryResult {
		const enrichedItems = this.enrichItems().filter(
			(item) => item.deps.length === 0
		);

		return {
			items: enrichedItems,
			count: enrichedItems.length,
			query: "deps.length eq 0",
		};
	}

	/**
	 * Get items with no dependents (leaves)
	 */
	leaves(): QueryResult {
		const hasDependents = new Set<string>();
		this.plan.items.forEach((item) => {
			item.deps.forEach((dep) => hasDependents.add(dep));
		});

		const enrichedItems = this.enrichItems().filter(
			(item) => !hasDependents.has(item.name)
		);

		return {
			items: enrichedItems,
			count: enrichedItems.length,
			query: "dependents.length eq 0",
		};
	}

	/**
	 * Get statistics about the plan
	 */
	stats(): {
		totalItems: number;
		totalLevels: number;
		avgDepsPerItem: number;
		avgGatesPerItem: number;
		rootNodes: number;
		leafNodes: number;
	} {
		const roots = this.roots();
		const leaves = this.leaves();
		const totalDeps = this.plan.items.reduce((sum, item) => sum + item.deps.length, 0);
		const totalGates = this.plan.items.reduce((sum, item) => sum + item.gates.length, 0);

		return {
			totalItems: this.plan.items.length,
			totalLevels: this.levels.length,
			avgDepsPerItem: totalDeps / this.plan.items.length,
			avgGatesPerItem: totalGates / this.plan.items.length,
			rootNodes: roots.count,
			leafNodes: leaves.count,
		};
	}

	private enrichItems(): any[] {
		return this.plan.items.map((item) => {
			const level = this.getMergeLevel(item.name);
			const dependents = this.getDependents(item.name);

			return {
				...item,
				level,
				dependents,
				depsCount: item.deps.length,
				gatesCount: item.gates.length,
				dependentsCount: dependents.length,
			};
		});
	}

	private getMergeLevel(itemName: string): number {
		for (let i = 0; i < this.levels.length; i++) {
			if (this.levels[i].includes(itemName)) {
				return i + 1;
			}
		}
		return -1;
	}

	private getDependents(itemName: string): string[] {
		return this.plan.items
			.filter((item) => item.deps.includes(itemName))
			.map((item) => item.name);
	}

	private parseQuery(queryString: string): QueryFilter[] {
		const filters: QueryFilter[] = [];
		const parts = queryString.split(/\s+AND\s+/i);

		for (const part of parts) {
			const match = part.trim().match(/^(\S+)\s+(eq|ne|contains|in|gt|lt|gte|lte)\s+(.+)$/i);
			if (match) {
				filters.push({
					field: match[1],
					operator: match[2].toLowerCase() as QueryOperator,
					value: this.parseValue(match[3]),
				});
			}
		}

		return filters;
	}

	private parseValue(valueStr: string): any {
		// Try to parse as number
		const num = Number(valueStr);
		if (!isNaN(num)) return num;

		// Try to parse as boolean
		if (valueStr.toLowerCase() === "true") return true;
		if (valueStr.toLowerCase() === "false") return false;

		// Return as string, removing quotes if present
		return valueStr.replace(/^["']|["']$/g, "");
	}

	private matchesFilters(item: any, filters: QueryFilter[]): boolean {
		for (const filter of filters) {
			if (!this.matchesFilter(item, filter)) {
				return false;
			}
		}
		return true;
	}

	private matchesFilter(item: any, filter: QueryFilter): boolean {
		const value = this.getFieldValue(item, filter.field);

		switch (filter.operator) {
			case "eq":
				return value === filter.value;
			case "ne":
				return value !== filter.value;
			case "contains":
				return String(value).includes(String(filter.value));
			case "in":
				return Array.isArray(value) && value.includes(filter.value);
			case "gt":
				return value > filter.value;
			case "lt":
				return value < filter.value;
			case "gte":
				return value >= filter.value;
			case "lte":
				return value <= filter.value;
			default:
				return false;
		}
	}

	private getFieldValue(item: any, field: string): any {
		const parts = field.split(".");
		let value = item;

		for (const part of parts) {
			if (value === undefined || value === null) return undefined;
			value = value[part];
		}

		return value;
	}
}

/**
 * Error handler type - passed from cli.ts to handle errors consistently
 */
export type ExitWithHandler = (error: unknown) => void;

interface QueryCommandDeps {
	exitWith: ExitWithHandler;
	jsonModeActive: () => boolean;
}

/**
 * Register the query command with the CLI program
 */
export function registerQueryCommand(program: Command, deps: QueryCommandDeps): void {
	program
		.command("query [file] [query]")
		.description("Advanced query and analysis of plan")
		.option("--plan <file>", "Path to plan.json file")
		.option("--json", "Output JSON format (alias for --format json)")
		.option("--format <format>", "Output format: json, table, csv", "table")
		.option("--output <file>", "Output file (default: stdout)")
		.option("--stats", "Show plan statistics")
		.option("--roots", "Show root nodes (no dependencies)")
		.option("--leaves", "Show leaf nodes (no dependents)")
		.option("--level <level>", "Filter by merge level", parseInt)
		.action(async (file: string | undefined, queryString: string | undefined, opts: any) => {
			const planFile = opts.plan || file;

			if (!planFile) {
				console.error("Error: plan file is required (use --plan <file> or provide as argument)");
				throwExit(1);
			}

			try {
				const planContent = fs.readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);

				const engine = new PlanQueryEngine(plan);
				let result;

				if (opts.stats) {
					result = { stats: engine.stats() };
				} else if (opts.roots) {
					result = engine.roots();
				} else if (opts.leaves) {
					result = engine.leaves();
				} else if (opts.level) {
					result = engine.byLevel(opts.level);
				} else if (queryString) {
					result = engine.query(queryString);
				} else {
					console.error("Error: query string or option (--stats, --roots, --leaves, --level) required");
					throwExit(1);
				}

				// --json flag or global json mode takes precedence over --format
				const useJson = opts.json || deps.jsonModeActive() || opts.format === 'json';
				const output = useJson
					? canonicalJSONStringify(result)
					: formatQueryResult(result, opts.format);

				if (opts.output) {
					fs.writeFileSync(opts.output, output);
					console.log(`✓ Results written to ${opts.output}`);
				} else {
					console.log(output);
				}

				return;
			} catch (error) {
				deps.exitWith(error);
			}
		});
}
