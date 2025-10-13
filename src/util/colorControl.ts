/**
 * Color output control for CLI
 * Manages chalk color levels based on flags and environment
 */

import chalk from 'chalk';

let colorDisabled = false;
let jsonMode = false;

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
 * Check if JSON mode is active
 */
export function isJsonMode(): boolean {
	return jsonMode;
}

/**
 * Initialize color control based on flags and environment
 */
export function initColorControl(options: {
	noColor?: boolean;
	jsonMode?: boolean;
}): void {
	// Set JSON mode flag
	if (options.jsonMode) {
		jsonMode = true;
	}
	
	// Priority: --no-color flag > --json flag > NO_COLOR env > TTY detection
	if (options.noColor || options.jsonMode || process.env.NO_COLOR) {
		disableColor();
	}
}
