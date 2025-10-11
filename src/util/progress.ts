/**
 * Progress indicators for human mode CLI output
 * Provides timing and progress ticks for long operations
 */

const PROGRESS_THRESHOLD_MS = 2000; // Show progress ticks for operations >2s

export interface ProgressOptions {
	/** Whether to show progress indicators (disabled in JSON mode) */
	enabled: boolean;
}

/**
 * Progress reporter for long-running operations
 */
export class ProgressReporter {
	private enabled: boolean;
	private startTimes: Map<string, number> = new Map();

	constructor(options: ProgressOptions = { enabled: true }) {
		this.enabled = options.enabled;
	}

	/**
	 * Mark the start of a level
	 */
	levelStart(level: number, items: string[]): void {
		if (!this.enabled) return;
		const key = `level-${level}`;
		this.startTimes.set(key, Date.now());
		console.log(`\n⏳ Level ${level}: Starting [${items.join(', ')}]...`);
	}

	/**
	 * Mark the completion of a level
	 */
	levelComplete(level: number): void {
		if (!this.enabled) return;
		const key = `level-${level}`;
		const startTime = this.startTimes.get(key);
		if (startTime) {
			const duration = Date.now() - startTime;
			this.startTimes.delete(key);
			if (duration >= PROGRESS_THRESHOLD_MS) {
				console.log(`✅ Level ${level}: Completed (${this.formatDuration(duration)})`);
			}
		}
	}

	/**
	 * Mark the start of a node/item
	 */
	nodeStart(name: string): void {
		if (!this.enabled) return;
		this.startTimes.set(name, Date.now());
		console.log(`  ⏳ ${name}: Starting...`);
	}

	/**
	 * Mark the completion of a node/item (only if >2s threshold)
	 */
	nodeComplete(name: string, success: boolean = true): void {
		if (!this.enabled) return;
		const startTime = this.startTimes.get(name);
		if (startTime) {
			const duration = Date.now() - startTime;
			this.startTimes.delete(name);
			if (duration >= PROGRESS_THRESHOLD_MS) {
				const icon = success ? '✅' : '❌';
				console.log(`  ${icon} ${name}: Completed (${this.formatDuration(duration)})`);
			}
		}
	}

	/**
	 * Format duration in human-readable format
	 */
	private formatDuration(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		} else if (ms < 60000) {
			return `${(ms / 1000).toFixed(1)}s`;
		} else {
			const minutes = Math.floor(ms / 60000);
			const seconds = Math.floor((ms % 60000) / 1000);
			return `${minutes}m ${seconds}s`;
		}
	}
}
