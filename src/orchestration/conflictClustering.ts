/**
 * Conflict Clustering - Group conflicts by file and symbol
 * Uses parser-lite approach with rename and whitespace tolerance
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Symbol information extracted from code
 */
export interface Symbol {
	name: string;
	type: "function" | "class" | "interface" | "type" | "const" | "let" | "var" | "import" | "export";
	line: number;
	signature?: string; // normalized signature for comparison
}

/**
 * Clustered conflict group by file and symbol
 */
export interface ConflictCluster {
	file: string;
	symbols: string[];
	conflictType: "both-modified" | "rename" | "whitespace" | "mixed";
	details: {
		lineRange: string;
		affectedSymbols: Symbol[];
	};
}

/**
 * Complete conflict clustering report
 */
export interface ClusteredConflictReport {
	analyzedAt: string;
	baseBranch: string;
	clusters: ConflictCluster[];
	summary: {
		totalClusters: number;
		fileCount: number;
		symbolCount: number;
		conflictTypes: Record<string, number>;
	};
}

/**
 * Parser-lite: Extract symbols from TypeScript/JavaScript code
 */
export function extractSymbols(code: string): Symbol[] {
	const symbols: Symbol[] = [];
	const lines = code.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const lineNumber = i + 1;

		// Function declarations
		const funcMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
		if (funcMatch) {
			symbols.push({
				name: funcMatch[1],
				type: "function",
				line: lineNumber,
				signature: normalizeSignature(line)
			});
		}

		// Arrow functions and const/let/var
		const arrowMatch = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/);
		if (arrowMatch) {
			const varType = line.includes("const") ? "const" : line.includes("let") ? "let" : "var";
			symbols.push({
				name: arrowMatch[1],
				type: varType as "const" | "let" | "var",
				line: lineNumber,
				signature: normalizeSignature(line)
			});
		}

		// Class declarations
		const classMatch = line.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
		if (classMatch) {
			symbols.push({
				name: classMatch[1],
				type: "class",
				line: lineNumber,
				signature: normalizeSignature(line)
			});
		}

		// Interface declarations
		const interfaceMatch = line.match(/^(?:export\s+)?interface\s+(\w+)/);
		if (interfaceMatch) {
			symbols.push({
				name: interfaceMatch[1],
				type: "interface",
				line: lineNumber,
				signature: normalizeSignature(line)
			});
		}

		// Type declarations
		const typeMatch = line.match(/^(?:export\s+)?type\s+(\w+)\s*=/);
		if (typeMatch) {
			symbols.push({
				name: typeMatch[1],
				type: "type",
				line: lineNumber,
				signature: normalizeSignature(line)
			});
		}

		// Import statements
		const importMatch = line.match(/^import\s+(?:\*\s+as\s+(\w+)|{([^}]+)})\s+from/);
		if (importMatch) {
			const name = importMatch[1] || importMatch[2]?.trim();
			if (name) {
				symbols.push({
					name,
					type: "import",
					line: lineNumber,
					signature: normalizeSignature(line)
				});
			}
		}

		// Export statements
		const exportMatch = line.match(/^export\s+{([^}]+)}/);
		if (exportMatch) {
			const names = exportMatch[1].split(",").map(n => n.trim());
			for (const name of names) {
				symbols.push({
					name,
					type: "export",
					line: lineNumber,
					signature: normalizeSignature(line)
				});
			}
		}
	}

	return symbols;
}

/**
 * Normalize signature for comparison (whitespace-tolerant)
 */
export function normalizeSignature(signature: string): string {
	return signature
		.replace(/\s+/g, " ") // collapse multiple spaces
		.replace(/\s*([{}():;,<>])\s*/g, "$1") // remove spaces around punctuation
		.trim()
		.toLowerCase();
}

/**
 * Normalize whitespace in code for comparison
 */
export function normalizeWhitespace(code: string): string {
	return code
		.replace(/\r\n/g, "\n") // normalize line endings
		.replace(/\t/g, "  ") // tabs to spaces
		.replace(/\s+$/gm, "") // trim trailing whitespace
		.replace(/^\s+$/gm, "") // remove whitespace-only lines
		.trim();
}

/**
 * Detect if two symbols are likely renames based on signature similarity
 */
export function detectRename(symbol1: Symbol, symbol2: Symbol): boolean {
	// Same type and signature but different names
	if (symbol1.type !== symbol2.type) {
		return false;
	}

	if (symbol1.name === symbol2.name) {
		return false;
	}

	// Compare normalized signatures
	const sig1 = symbol1.signature || "";
	const sig2 = symbol2.signature || "";

	// Remove the symbol name from signatures and compare
	const sig1WithoutName = sig1.replace(symbol1.name.toLowerCase(), "");
	const sig2WithoutName = sig2.replace(symbol2.name.toLowerCase(), "");

	// If signatures match after removing names, likely a rename
	return sig1WithoutName === sig2WithoutName && sig1WithoutName.length > 0;
}

/**
 * Find symbols affected by a conflict line range
 */
export function findAffectedSymbols(
	symbols: Symbol[],
	lineRange: string
): Symbol[] {
	const [startStr, endStr] = lineRange.split("-").map(s => parseInt(s.trim()));
	const start = isNaN(startStr) ? 0 : startStr;
	const end = isNaN(endStr) ? Infinity : endStr;

	return symbols.filter(symbol => {
		// Symbol is affected if it's in or near the conflict range
		// Using a small buffer (e.g., 5 lines) to catch nearby symbols
		const buffer = 5;
		return symbol.line >= start - buffer && symbol.line <= end + buffer;
	});
}

/**
 * Cluster conflicts by file and symbol
 */
export async function clusterConflicts(
	conflicts: Array<{ file: string; lines: string; type: string }>,
	workingDir: string = process.cwd()
): Promise<ConflictCluster[]> {
	const clusters: ConflictCluster[] = [];
	const fileSymbolMap = new Map<string, Symbol[]>();

	// Group conflicts by file
	const fileConflicts = new Map<string, Array<{ lines: string; type: string }>>();
	for (const conflict of conflicts) {
		if (!fileConflicts.has(conflict.file)) {
			fileConflicts.set(conflict.file, []);
		}
		fileConflicts.get(conflict.file)!.push({
			lines: conflict.lines,
			type: conflict.type
		});
	}

	// Process each file
	for (const [file, fileConflictList] of fileConflicts.entries()) {
		// Extract symbols from file if it exists
		const filePath = path.join(workingDir, file);
		let symbols: Symbol[] = [];
		
		if (fs.existsSync(filePath)) {
			try {
				const code = fs.readFileSync(filePath, "utf-8");
				symbols = extractSymbols(code);
				fileSymbolMap.set(file, symbols);
			} catch (error) {
				// File might not be readable, skip symbol extraction
			}
		}

		// Process each conflict in the file
		for (const conflict of fileConflictList) {
			const affectedSymbols = findAffectedSymbols(symbols, conflict.lines);
			
			// Determine conflict type
			let conflictType: ConflictCluster["conflictType"] = "both-modified";
			
			// Check for renames
			if (affectedSymbols.length >= 2) {
				const hasRename = affectedSymbols.some((s1, i) =>
					affectedSymbols.slice(i + 1).some(s2 => detectRename(s1, s2))
				);
				if (hasRename) {
					conflictType = "rename";
				}
			}

			clusters.push({
				file,
				symbols: affectedSymbols.map(s => s.name),
				conflictType,
				details: {
					lineRange: conflict.lines,
					affectedSymbols
				}
			});
		}
	}

	// Sort clusters for deterministic output
	clusters.sort((a, b) => {
		const fileCompare = a.file.localeCompare(b.file);
		if (fileCompare !== 0) return fileCompare;
		
		// Sort by line range
		const aStart = parseInt(a.details.lineRange.split("-")[0]) || 0;
		const bStart = parseInt(b.details.lineRange.split("-")[0]) || 0;
		return aStart - bStart;
	});

	return clusters;
}

/**
 * Generate clustered conflict report
 */
export async function generateClusteredReport(
	conflicts: Array<{ file: string; lines: string; type: string }>,
	baseBranch: string,
	workingDir?: string
): Promise<ClusteredConflictReport> {
	const clusters = await clusterConflicts(conflicts, workingDir);

	// Calculate summary
	const fileSet = new Set(clusters.map(c => c.file));
	const symbolSet = new Set(clusters.flatMap(c => c.symbols));
	const conflictTypes: Record<string, number> = {};

	for (const cluster of clusters) {
		conflictTypes[cluster.conflictType] = (conflictTypes[cluster.conflictType] || 0) + 1;
	}

	return {
		analyzedAt: new Date().toISOString(),
		baseBranch,
		clusters,
		summary: {
			totalClusters: clusters.length,
			fileCount: fileSet.size,
			symbolCount: symbolSet.size,
			conflictTypes
		}
	};
}

/**
 * Write clustered conflicts to .weave/conflicts.json
 */
export async function writeConflictsJson(
	report: ClusteredConflictReport,
	outputDir: string = ".weave"
): Promise<string> {
	// Ensure .weave directory exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const outputPath = path.join(outputDir, "conflicts.json");
	
	// Write with deterministic ordering (use canonicalJSONStringify if available)
	const json = JSON.stringify(report, null, 2);
	fs.writeFileSync(outputPath, json, "utf-8");

	return outputPath;
}
