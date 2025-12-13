/**
 * Governance Report Command (QOL-004)
 *
 * Analyze LexSona shadow governance logs from the CLI.
 */

import { Command } from "commander";
import {
	readGovernanceLogs,
	readGovernanceLogsWithLegacy,
	type LegacyLogResult,
} from "../lexsona/logger.js";
import type { GovernanceComparisonLog } from "../lexsona/types.js";
import * as fs from "fs";

interface ReportOptions {
	since?: string;
	until?: string;
	persona?: string;
	workflow?: string;
	disagreementsOnly?: boolean;
	format?: "text" | "json" | "table" | "markdown";
	output?: string;
	top?: number;
	acceptLegacy?: boolean;
}

/**
 * Uncertainty summary for "fail forward" visibility.
 * Surfaces logs where LexSona admitted uncertainty or operated with limited context.
 */
interface UncertaintySummary {
	/** Logs where offlineMode was true (no Lex DB connection) */
	offlineCount: number;
	/** Logs where derivation failed */
	failedCount: number;
	/** Logs with confidence ceiling applied */
	withConfidenceCeiling: number;
	/** Logs where no persona was set */
	noPersonaCount: number;
	/** Whether any uncertainty exists */
	hasUncertainty: boolean;
}

interface Stats {
	total: number;
	successes: number;
	offline: number;
	withConstraints: number;
	avgConstraintCount: number;
	personaCounts: Record<string, number>;
	topConstraints: Array<[string, number]>;
	agreeCount: number;
	/** Fail-forward: explicit uncertainty summary */
	uncertainty: UncertaintySummary;
}

function filterLogs(
	logs: GovernanceComparisonLog[],
	opts: ReportOptions
): GovernanceComparisonLog[] {
	let filtered = logs;

	if (opts.since) {
		const sinceDate = new Date(opts.since);
		filtered = filtered.filter((l) => new Date(l.timestamp) >= sinceDate);
	}

	if (opts.until) {
		const untilDate = new Date(opts.until);
		filtered = filtered.filter((l) => new Date(l.timestamp) <= untilDate);
	}

	if (opts.persona) {
		filtered = filtered.filter((l) => l.lexsona.personaId === opts.persona);
	}

	if (opts.workflow) {
		filtered = filtered.filter(
			(l) => l.context.workflowId === opts.workflow
		);
	}

	if (opts.disagreementsOnly) {
		filtered = filtered.filter((l) => {
			const runnerEligible = l.runner.mergeEligible ?? false;
			const lexsonaBlocking =
				(l.lexsona.constraintSet?.constraintCount ?? 0) > 0;
			// Disagreement: runner allows but LexSona would block
			return runnerEligible && lexsonaBlocking;
		});
	}

	return filtered;
}

function computeStats(logs: GovernanceComparisonLog[], topN = 10): Stats {
	if (logs.length === 0) {
		return {
			total: 0,
			successes: 0,
			offline: 0,
			withConstraints: 0,
			avgConstraintCount: 0,
			personaCounts: {},
			topConstraints: [],
			agreeCount: 0,
			uncertainty: {
				offlineCount: 0,
				failedCount: 0,
				withConfidenceCeiling: 0,
				noPersonaCount: 0,
				hasUncertainty: false,
			},
		};
	}

	const total = logs.length;
	const successes = logs.filter((l) => l.lexsona.success).length;
	const offline = logs.filter((l) => l.lexsona.offlineMode).length;
	const withConstraints = logs.filter(
		(l) =>
			l.lexsona.constraintSet &&
			l.lexsona.constraintSet.constraintCount > 0
	).length;

	const avgConstraintCount =
		logs.reduce(
			(s, l) => s + (l.lexsona.constraintSet?.constraintCount ?? 0),
			0
		) / total;

	const personaCounts: Record<string, number> = {};
	for (const l of logs) {
		const persona = l.lexsona.personaId ?? "null";
		personaCounts[persona] = (personaCounts[persona] || 0) + 1;
	}

	// Top constraints by frequency
	const freq = new Map<string, number>();
	for (const l of logs) {
		const cs = l.lexsona.constraintSet?.topConstraints ?? [];
		for (const c of cs) {
			const k = c.description.slice(0, 80);
			freq.set(k, (freq.get(k) || 0) + 1);
		}
	}
	const topConstraints = Array.from(freq.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN);

	// Agreement metric
	let agreeCount = 0;
	for (const l of logs) {
		const runnerEligible = l.runner.mergeEligible ?? false;
		const lexsonaBlocking =
			(l.lexsona.constraintSet?.constraintCount ?? 0) > 0;
		if (runnerEligible && !lexsonaBlocking) agreeCount++;
	}

	// Compute uncertainty summary ("fail forward" visibility)
	const failedCount = logs.filter((l) => !l.lexsona.success).length;
	const withConfidenceCeiling = logs.filter(
		(l) => l.lexsona.confidenceCeiling !== undefined
	).length;
	const noPersonaCount = logs.filter(
		(l) => l.lexsona.personaId === null
	).length;
	const hasUncertainty =
		offline > 0 ||
		failedCount > 0 ||
		withConfidenceCeiling > 0 ||
		noPersonaCount > 0;

	return {
		total,
		successes,
		offline,
		withConstraints,
		avgConstraintCount,
		personaCounts,
		topConstraints,
		agreeCount,
		uncertainty: {
			offlineCount: offline,
			failedCount,
			withConfidenceCeiling,
			noPersonaCount,
			hasUncertainty,
		},
	};
}

function formatText(stats: Stats): string {
	const lines: string[] = [];

	lines.push("Governance logs summary:");
	lines.push(`  total logs: ${stats.total}`);
	lines.push(
		`  successful derivations: ${stats.successes} (${(
			(stats.successes / stats.total) *
			100
		).toFixed(0)}%)`
	);
	lines.push(
		`  offline-mode logs: ${stats.offline} (${(
			(stats.offline / stats.total) *
			100
		).toFixed(0)}%)`
	);
	lines.push(
		`  logs with >0 constraints: ${stats.withConstraints} (${(
			(stats.withConstraints / stats.total) *
			100
		).toFixed(0)}%)`
	);
	lines.push(
		`  average constraintCount: ${stats.avgConstraintCount.toFixed(2)}`
	);
	lines.push(
		`  persona usage: ${JSON.stringify(stats.personaCounts, null, 2)}`
	);

	if (stats.topConstraints.length > 0) {
		lines.push("\nTop constraints (by frequency):");
		for (const [desc, count] of stats.topConstraints) {
			lines.push(`  - "${desc}" x ${count}`);
		}
	} else {
		lines.push("\nNo constraints recorded in logs.");
	}

	lines.push(
		`\nSimple agreement: runner allowed and LexSona no-block == ${
			stats.agreeCount
		}/${stats.total} (${((stats.agreeCount / stats.total) * 100).toFixed(
			0
		)}%)`
	);

	// Uncertainty summary (fail-forward surfacing)
	if (stats.uncertainty.hasUncertainty) {
		lines.push("\n⚠️  Uncertainty Summary (fail-forward):");
		if (stats.uncertainty.offlineCount > 0) {
			lines.push(
				`  - offline mode: ${stats.uncertainty.offlineCount} logs (LexSona unavailable)`
			);
		}
		if (stats.uncertainty.failedCount > 0) {
			lines.push(
				`  - derivation failures: ${stats.uncertainty.failedCount} logs`
			);
		}
		if (stats.uncertainty.withConfidenceCeiling > 0) {
			lines.push(
				`  - confidence ceiling: ${stats.uncertainty.withConfidenceCeiling} logs had capped confidence`
			);
		}
		if (stats.uncertainty.noPersonaCount > 0) {
			lines.push(
				`  - no persona: ${stats.uncertainty.noPersonaCount} logs (persona not set)`
			);
		}
		lines.push(
			"\n  → These represent areas where governance insight is incomplete."
		);
		lines.push(
			"    Consider investigating patterns in failed/offline logs."
		);
	} else {
		lines.push("\n✓ No uncertainty flags detected in this log set.");
	}

	return lines.join("\n");
}

function formatMarkdown(stats: Stats): string {
	const lines: string[] = [];

	lines.push("# Governance Logs Summary\n");
	lines.push("## Overall Statistics\n");
	lines.push("| Metric | Value |");
	lines.push("|--------|-------|");
	lines.push(`| Total Logs | ${stats.total} |`);
	lines.push(
		`| Successful Derivations | ${stats.successes} (${(
			(stats.successes / stats.total) *
			100
		).toFixed(0)}%) |`
	);
	lines.push(
		`| Offline Mode Logs | ${stats.offline} (${(
			(stats.offline / stats.total) *
			100
		).toFixed(0)}%) |`
	);
	lines.push(
		`| Logs with Constraints | ${stats.withConstraints} (${(
			(stats.withConstraints / stats.total) *
			100
		).toFixed(0)}%) |`
	);
	lines.push(
		`| Avg Constraint Count | ${stats.avgConstraintCount.toFixed(2)} |`
	);
	lines.push(
		`| Agreement Rate | ${stats.agreeCount}/${stats.total} (${(
			(stats.agreeCount / stats.total) *
			100
		).toFixed(0)}%) |`
	);

	if (Object.keys(stats.personaCounts).length > 0) {
		lines.push("\n## Persona Usage\n");
		lines.push("| Persona | Count |");
		lines.push("|---------|-------|");
		for (const [persona, count] of Object.entries(stats.personaCounts)) {
			lines.push(`| ${persona} | ${count} |`);
		}
	}

	if (stats.topConstraints.length > 0) {
		lines.push("\n## Top Constraints\n");
		lines.push("| Constraint | Frequency |");
		lines.push("|------------|-----------|");
		for (const [desc, count] of stats.topConstraints) {
			lines.push(`| ${desc} | ${count} |`);
		}
	}

	// Uncertainty summary (fail-forward surfacing)
	lines.push("\n## Uncertainty Summary\n");
	if (stats.uncertainty.hasUncertainty) {
		lines.push(
			"> ⚠️ **Fail-forward:** Some logs have incomplete governance insight.\n"
		);
		lines.push("| Source | Count |");
		lines.push("|--------|-------|");
		if (stats.uncertainty.offlineCount > 0) {
			lines.push(`| Offline mode | ${stats.uncertainty.offlineCount} |`);
		}
		if (stats.uncertainty.failedCount > 0) {
			lines.push(
				`| Derivation failures | ${stats.uncertainty.failedCount} |`
			);
		}
		if (stats.uncertainty.withConfidenceCeiling > 0) {
			lines.push(
				`| Confidence ceiling | ${stats.uncertainty.withConfidenceCeiling} |`
			);
		}
		if (stats.uncertainty.noPersonaCount > 0) {
			lines.push(
				`| No persona set | ${stats.uncertainty.noPersonaCount} |`
			);
		}
		lines.push(
			"\n_Consider investigating patterns in failed/offline logs._"
		);
	} else {
		lines.push("✓ No uncertainty flags detected in this log set.");
	}

	return lines.join("\n");
}

function formatTable(stats: Stats): string {
	const lines: string[] = [];

	lines.push("┌─────────────────────────────┬──────────┐");
	lines.push("│ Metric                      │ Value    │");
	lines.push("├─────────────────────────────┼──────────┤");
	lines.push(
		`│ Total Logs                  │ ${String(stats.total).padStart(8)} │`
	);
	lines.push(
		`│ Successful Derivations      │ ${String(stats.successes).padStart(
			8
		)} │`
	);
	lines.push(
		`│ Offline Mode Logs           │ ${String(stats.offline).padStart(8)} │`
	);
	lines.push(
		`│ Logs with Constraints       │ ${String(
			stats.withConstraints
		).padStart(8)} │`
	);
	lines.push(
		`│ Avg Constraint Count        │ ${stats.avgConstraintCount
			.toFixed(2)
			.padStart(8)} │`
	);
	lines.push(
		`│ Agreement Rate              │ ${String(stats.agreeCount).padStart(
			8
		)} │`
	);
	lines.push("└─────────────────────────────┴──────────┘");

	if (Object.keys(stats.personaCounts).length > 0) {
		lines.push("\nPersona Usage:");
		lines.push("┌──────────────────────────────────────┬───────┐");
		lines.push("│ Persona                              │ Count │");
		lines.push("├──────────────────────────────────────┼───────┤");
		for (const [persona, count] of Object.entries(stats.personaCounts)) {
			lines.push(
				`│ ${persona.padEnd(36)} │ ${String(count).padStart(5)} │`
			);
		}
		lines.push("└──────────────────────────────────────┴───────┘");
	}

	// Uncertainty summary (fail-forward surfacing)
	if (stats.uncertainty.hasUncertainty) {
		lines.push("\n⚠️  Uncertainty (fail-forward):");
		lines.push("┌──────────────────────────────────────┬───────┐");
		lines.push("│ Source                               │ Count │");
		lines.push("├──────────────────────────────────────┼───────┤");
		if (stats.uncertainty.offlineCount > 0) {
			lines.push(
				`│ Offline mode                         │ ${String(
					stats.uncertainty.offlineCount
				).padStart(5)} │`
			);
		}
		if (stats.uncertainty.failedCount > 0) {
			lines.push(
				`│ Derivation failures                  │ ${String(
					stats.uncertainty.failedCount
				).padStart(5)} │`
			);
		}
		if (stats.uncertainty.withConfidenceCeiling > 0) {
			lines.push(
				`│ Confidence ceiling                   │ ${String(
					stats.uncertainty.withConfidenceCeiling
				).padStart(5)} │`
			);
		}
		if (stats.uncertainty.noPersonaCount > 0) {
			lines.push(
				`│ No persona set                       │ ${String(
					stats.uncertainty.noPersonaCount
				).padStart(5)} │`
			);
		}
		lines.push("└──────────────────────────────────────┴───────┘");
	} else {
		lines.push("\n✓ No uncertainty flags detected.");
	}

	return lines.join("\n");
}

export async function governanceReport(opts: ReportOptions): Promise<void> {
	// Read governance logs (with or without legacy normalization)
	let allLogs: GovernanceComparisonLog[];
	let legacyCount = 0;
	let normalizationWarningCount = 0;

	if (opts.acceptLegacy) {
		const results = readGovernanceLogsWithLegacy();
		allLogs = results.map((r) => r.log);
		legacyCount = results.filter((r) => r.wasLegacy).length;
		normalizationWarningCount = results.reduce(
			(sum, r) => sum + r.normalizationWarnings.length,
			0
		);
		if (legacyCount > 0) {
			const warn = opts.format === "json" ? console.error : console.log;
			warn(
				`⚠️  Included ${legacyCount} legacy log(s) with ${normalizationWarningCount} normalization warning(s).`
			);
			warn(
				"   Legacy logs may have incomplete data. Consider re-running with current schema.\n"
			);
		}
	} else {
		allLogs = readGovernanceLogs();
	}

	if (allLogs.length === 0) {
		if (opts.format === "json") {
			console.log("[]");
			return;
		}
		if (opts.acceptLegacy) {
			console.log(
				"No governance logs found (even with legacy inclusion)."
			);
		} else {
			console.log(
				"No governance logs found.\n\nHint: Use --accept-legacy to include older logs without schemaVersion."
			);
		}
		return;
	}

	// Apply filters
	const logs = filterLogs(allLogs, opts);

	if (logs.length === 0) {
		if (opts.format === "json") {
			console.log("[]");
			return;
		}
		console.log("No logs match the specified filters.");
		return;
	}

	// Compute statistics
	const topN = opts.top ?? 10;
	const stats = computeStats(logs, topN);

	// Format output
	let output: string;
	switch (opts.format) {
		case "json":
			output = JSON.stringify(stats, null, 2);
			break;
		case "table":
			output = formatTable(stats);
			break;
		case "markdown":
			output = formatMarkdown(stats);
			break;
		default:
			output = formatText(stats);
	}

	// Write to file or stdout
	if (opts.output) {
		fs.writeFileSync(opts.output, output, "utf8");
		console.log(`Report written to: ${opts.output}`);
	} else {
		console.log(output);
	}
}

export function registerGovernanceReportCommand(program: Command): void {
	program
		.command("governance:report")
		.description("Analyze LexSona shadow governance logs")
		.option("--since <date>", "Filter logs from this date (ISO 8601)")
		.option("--until <date>", "Filter logs until this date (ISO 8601)")
		.option("--persona <id>", "Filter by persona ID")
		.option("--workflow <id>", "Filter by workflow ID")
		.option(
			"--disagreements-only",
			"Show only logs where runner/LexSona disagree"
		)
		.option(
			"--format <type>",
			"Output format: text, json, table, markdown",
			"text"
		)
		.option("--output <file>", "Write report to file")
		.option("--top <n>", "Show top N constraints", "10")
		.option(
			"--accept-legacy",
			"Include legacy logs without schemaVersion (best-effort normalization)"
		)
		.action(async (options) => {
			await governanceReport({
				since: options.since,
				until: options.until,
				persona: options.persona,
				workflow: options.workflow,
				disagreementsOnly: options.disagreementsOnly,
				format: options.format as
					| "text"
					| "json"
					| "table"
					| "markdown",
				output: options.output,
				top: options.top ? parseInt(options.top, 10) : undefined,
				acceptLegacy: options.acceptLegacy,
			});
		});
}
