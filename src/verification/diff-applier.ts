/**
 * Unified Diff Application Module
 *
 * Applies unified diff patches to files in a working directory.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { PatchApplicationError } from "./errors.js";

const execAsync = promisify(exec);

export interface DiffApplierOptions {
	workingDir: string;
	stripCount?: number; // Default: 1 (for -p1)
}

export class DiffApplier {
	constructor(private readonly options: DiffApplierOptions) {}

	/**
	 * Apply a unified diff using the `patch` command
	 */
	async apply(unifiedDiff: string): Promise<void> {
		const { workingDir, stripCount = 1 } = this.options;

		// Write diff to temporary file
		const tmpDir = join(workingDir, ".tmp");
		await mkdir(tmpDir, { recursive: true });
		const diffPath = join(
			tmpDir,
			`patch-${Date.now()}-${process.pid}.diff`
		);

		try {
			await writeFile(diffPath, unifiedDiff, "utf8");

			// Apply patch using system `patch` command.
			// Rely on the process exit code for error detection;
			// execAsync will reject if the command fails.
			await execAsync(`patch -p${stripCount} -i "${diffPath}"`, {
				cwd: workingDir,
			});
		} catch (error) {
			if (error instanceof PatchApplicationError) {
				throw error;
			}
			throw new PatchApplicationError(
				`Failed to apply patch: ${
					error instanceof Error ? error.message : String(error)
				}`,
				error instanceof Error ? error : undefined
			);
		} finally {
			// Clean up temporary diff file
			try {
				await rm(diffPath, { force: true });
			} catch {
				// Ignore cleanup errors
			}
		}
	}
}
