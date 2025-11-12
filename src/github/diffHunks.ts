/**
 * Diff hunk extraction for minimal context packaging
 * Extracts 20-40 line windows around changes for AI context minimization
 */

export interface DiffHunk {
	/** File path relative to repository root */
	path: string;
	/** Starting line number in the original file */
	oldStart: number;
	/** Number of lines in the original file */
	oldLines: number;
	/** Starting line number in the new file */
	newStart: number;
	/** Number of lines in the new file */
	newLines: number;
	/** The actual diff content (including context lines) */
	content: string;
	/** Change type: added, modified, deleted, renamed */
	changeType: "added" | "modified" | "deleted" | "renamed";
}

export interface DiffFile {
	/** File path */
	path: string;
	/** Previous path (if renamed) */
	previousPath?: string;
	/** Change type */
	changeType: "added" | "modified" | "deleted" | "renamed";
	/** Hunks extracted from this file */
	hunks: DiffHunk[];
	/** Total additions */
	additions: number;
	/** Total deletions */
	deletions: number;
}

export interface MinimalDiffContext {
	/** Files changed with their hunks */
	files: DiffFile[];
	/** Total size in characters */
	totalSize: number;
	/** Number of hunks */
	hunkCount: number;
	/** Number of files */
	fileCount: number;
}

const CONTEXT_LINES_BEFORE = 3;
const CONTEXT_LINES_AFTER = 3;
const MIN_HUNK_SIZE = 20;
const MAX_HUNK_SIZE = 40;

/**
 * Parse unified diff format and extract hunks with minimal context
 */
export function extractDiffHunks(unifiedDiff: string): MinimalDiffContext {
	const files: DiffFile[] = [];
	const lines = unifiedDiff.split('\n');
	let currentFile: DiffFile | null = null;
	let currentHunk: DiffHunk | null = null;
	let hunkLines: string[] = [];
	let totalSize = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Start of a new file
		if (line.startsWith('diff --git')) {
			if (currentFile && currentHunk) {
				currentHunk.content = hunkLines.join('\n');
				currentFile.hunks.push(currentHunk);
			}
			
			// Parse file paths
			const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
			if (match) {
				const [, oldPath, newPath] = match;
				currentFile = {
					path: newPath,
					previousPath: oldPath !== newPath ? oldPath : undefined,
					changeType: "modified",
					hunks: [],
					additions: 0,
					deletions: 0,
				};
				files.push(currentFile);
			}
			currentHunk = null;
			hunkLines = [];
			continue;
		}

		if (!currentFile) continue;

		// Detect file status
		if (line.startsWith('new file mode')) {
			currentFile.changeType = "added";
		} else if (line.startsWith('deleted file mode')) {
			currentFile.changeType = "deleted";
		} else if (line.startsWith('rename from')) {
			currentFile.changeType = "renamed";
		}

		// Hunk header: @@ -old_start,old_lines +new_start,new_lines @@
		if (line.startsWith('@@')) {
			// Save previous hunk if exists
			if (currentHunk) {
				currentHunk.content = hunkLines.join('\n');
				currentFile.hunks.push(currentHunk);
			}

			const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
			if (match) {
				const [, oldStart, oldLines = '1', newStart, newLines = '1'] = match;
				currentHunk = {
					path: currentFile.path,
					oldStart: parseInt(oldStart, 10),
					oldLines: parseInt(oldLines, 10),
					newStart: parseInt(newStart, 10),
					newLines: parseInt(newLines, 10),
					content: '',
					changeType: currentFile.changeType,
				};
				hunkLines = [line];
			}
			continue;
		}

		// Collect hunk content
		if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
			hunkLines.push(line);

			// Track additions/deletions
			if (line.startsWith('+') && !line.startsWith('+++')) {
				currentFile.additions++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				currentFile.deletions++;
			}
		}
	}

	// Save last hunk
	if (currentFile && currentHunk) {
		currentHunk.content = hunkLines.join('\n');
		currentFile.hunks.push(currentHunk);
	}

	// Calculate total size
	for (const file of files) {
		for (const hunk of file.hunks) {
			totalSize += hunk.content.length;
		}
	}

	const hunkCount = files.reduce((sum, file) => sum + file.hunks.length, 0);

	return {
		files,
		totalSize,
		hunkCount,
		fileCount: files.length,
	};
}

/**
 * Optimize hunks to fit within size constraints (20-40 lines per hunk)
 * Combines small hunks and splits large ones
 */
export function optimizeHunkSize(context: MinimalDiffContext): MinimalDiffContext {
	const optimizedFiles: DiffFile[] = [];

	for (const file of context.files) {
		const optimizedHunks: DiffHunk[] = [];

		for (const hunk of file.hunks) {
			const lines = hunk.content.split('\n');
			const lineCount = lines.length;

			// If hunk is too large, split it
			if (lineCount > MAX_HUNK_SIZE) {
				const chunks = Math.ceil(lineCount / MAX_HUNK_SIZE);
				const chunkSize = Math.ceil(lineCount / chunks);

				for (let i = 0; i < chunks; i++) {
					const start = i * chunkSize;
					const end = Math.min(start + chunkSize, lineCount);
					const chunkLines = lines.slice(start, end);

					optimizedHunks.push({
						...hunk,
						content: chunkLines.join('\n'),
					});
				}
			} else {
				// Keep hunk as-is if within bounds
				optimizedHunks.push(hunk);
			}
		}

		optimizedFiles.push({
			...file,
			hunks: optimizedHunks,
		});
	}

	// Recalculate metrics
	const totalSize = optimizedFiles.reduce(
		(sum, file) => sum + file.hunks.reduce((s, h) => s + h.content.length, 0),
		0
	);
	const hunkCount = optimizedFiles.reduce((sum, file) => sum + file.hunks.length, 0);

	return {
		files: optimizedFiles,
		totalSize,
		hunkCount,
		fileCount: optimizedFiles.length,
	};
}

/**
 * Format diff context as a compact string representation for AI consumption
 */
export function formatMinimalDiff(context: MinimalDiffContext): string {
	const parts: string[] = [];

	parts.push(`# Diff Context (${context.fileCount} files, ${context.hunkCount} hunks, ${context.totalSize} chars)`);
	parts.push('');

	for (const file of context.files) {
		parts.push(`## ${file.changeType}: ${file.path}${file.previousPath ? ` (from ${file.previousPath})` : ''}`);
		parts.push(`+${file.additions} -${file.deletions}`);
		parts.push('');

		for (const hunk of file.hunks) {
			parts.push(hunk.content);
			parts.push('');
		}
	}

	return parts.join('\n');
}

/**
 * Calculate size metrics for context awareness
 */
export interface ContextMetrics {
	/** Raw unified diff size in bytes */
	rawSize: number;
	/** Minimal hunk size in bytes */
	minimalSize: number;
	/** Reduction percentage */
	reductionPercent: number;
	/** Number of files */
	fileCount: number;
	/** Number of hunks */
	hunkCount: number;
	/** Average hunk size */
	avgHunkSize: number;
}

export function calculateContextMetrics(
	rawDiff: string,
	minimalContext: MinimalDiffContext
): ContextMetrics {
	const rawSize = rawDiff.length;
	const minimalSize = minimalContext.totalSize;
	const reductionPercent = rawSize > 0 ? ((rawSize - minimalSize) / rawSize) * 100 : 0;
	const avgHunkSize = minimalContext.hunkCount > 0 
		? minimalContext.totalSize / minimalContext.hunkCount 
		: 0;

	return {
		rawSize,
		minimalSize,
		reductionPercent,
		fileCount: minimalContext.fileCount,
		hunkCount: minimalContext.hunkCount,
		avgHunkSize,
	};
}
