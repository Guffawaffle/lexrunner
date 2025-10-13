/**
 * Color output control for CLI
 * Manages chalk color levels based on flags and environment
 */

import chalk from 'chalk';

let colorDisabled = false;

/**
 * Disable all ANSI color output
 */
export function disableColor(): void {
	colorDisabled = true;
	chalk.level = 0;
}

/**
 * Check if color output is disabled
 */
export function isColorDisabled(): boolean {
	return colorDisabled;
}

/**
 * Initialize color control based on flags and environment
 */
export function initColorControl(options: {
	noColor?: boolean;
	jsonMode?: boolean;
}): void {
	// Priority: --no-color flag > --json flag > NO_COLOR env > TTY detection
	if (options.noColor || options.jsonMode || process.env.NO_COLOR) {
		disableColor();
	}
}
