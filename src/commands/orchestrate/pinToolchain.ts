/**
 * Orchestrate: Pin Toolchain Command
 *
 * Verifies that current toolchain versions match pinned versions
 * for reproducible merge-weave operations.
 */

import { Command } from "commander";
import {
	verifyToolchainPins,
	ToolVersion,
} from "../../orchestration/determinism.js";
import { writeJsonOutput } from "../../cli/output.js";
import { throwExit } from "../../cli/exitHandler.js";

interface PinToolchainOptions {
	verify: boolean;
	json?: boolean;
}

/**
 * Format tool version for display.
 */
function formatToolVersion(
	tool: ToolVersion,
	useColor: boolean = true
): string {
	const icon = tool.matches ? "✅" : "❌";
	const name = tool.name.padEnd(12);
	const current = tool.version.padEnd(12);

	if (tool.pinned) {
		const pinned = tool.pinned.padEnd(12);
		const status = tool.matches ? "" : "[MISMATCH]";
		return `${icon} ${name} ${current} (pinned: ${pinned}) ${status}`;
	} else {
		return `${icon} ${name} ${current} (no pin)`;
	}
}

/**
 * Register the orchestrate:pin-toolchain command.
 */
export function registerPinToolchainCommand(program: Command): void {
	const orchestrateCmd = program
		.command("orchestrate")
		.description("Orchestration commands for merge-weave operations");

	orchestrateCmd
		.command("pin-toolchain")
		.description(
			"Verify toolchain versions match pinned versions (canonical: lex-pr workspace doctor)"
		)
		.option(
			"--verify",
			"Check if current versions match pinned versions (default: true)",
			true
		)
		.action(async (opts: PinToolchainOptions, command: Command) => {
			// Get global JSON mode from parent command
			const globalOpts = command.optsWithGlobals();
			const jsonMode = globalOpts.json || opts.json || false;

			try {
				const results = await verifyToolchainPins();
				const allMatch = results.every((r) => r.matches);

				if (jsonMode) {
					const output = {
						allMatch,
						tools: results.map((r) => ({
							name: r.name,
							version: r.version,
							pinned: r.pinned,
							matches: r.matches,
						})),
					};
					writeJsonOutput(output);
				} else {
					console.log("🔧 Toolchain Version Verification\n");

					results.forEach((tool) => {
						console.log(formatToolVersion(tool));
					});

					console.log("");

					if (allMatch) {
						console.log(
							"✅ All toolchain versions match pinned versions"
						);
					} else {
						console.log(
							"❌ Some toolchain versions do not match pinned versions"
						);
						console.log(
							"\n💡 Tip: Install pinned versions using asdf, mise, nvm, or volta"
						);
						console.log(
							"   See docs/determinism.md for setup instructions"
						);
					}
				}

				// Exit with code 1 if mismatch, 0 if match
				if (!allMatch) {
					throwExit(1);
				}
			} catch (error) {
				if (jsonMode) {
					writeJsonOutput({
						error:
							error instanceof Error
								? error.message
								: String(error),
					});
				} else {
					console.error(
						`\n❌ Error: ${
							error instanceof Error
								? error.message
								: String(error)
						}\n`
					);
				}
				throwExit(1);
			}
		});
}
