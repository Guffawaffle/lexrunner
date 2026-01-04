/**
 * Gate test command - Parse test output and emit AX-compliant results
 *
 * Implements the `lexrunner gate test` CLI command for parsing test output
 * from various test runners and normalizing to AXTestResult format.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import { Command } from "commander";
import { throwExit } from "../../exitHandler.js";
import {
  requireAdapter,
  requireDetectedAdapter,
  listAdapters,
  AdapterNotFoundError,
  AdapterParseError,
} from "../../../gates/test/adapters/index.js";
import { formatAsMarkdown } from "../../../gates/test/formatters/markdown.js";
import type { AXTestResult } from "../../../gates/test/schema.js";
import * as fs from "fs";

/**
 * Detect if running in CI environment
 */
function isCI(): boolean {
  return (
    process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true" ||
    process.env.CIRCLECI === "true"
  );
}

/**
 * Read input from file or stdin
 */
async function readInput(inputPath?: string): Promise<string> {
  if (inputPath) {
    // Read from file
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    return fs.readFileSync(inputPath, "utf-8");
  } else {
    // Read from stdin
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      process.stdin.on("error", reject);
    });
  }
}

/**
 * Write output to file or stdout
 */
function writeOutput(content: string, outputPath?: string): void {
  if (outputPath) {
    // Write to file
    fs.writeFileSync(outputPath, content, "utf-8");
  } else {
    // Write to stdout
    process.stdout.write(content);
  }
}

/**
 * Register the gate test command
 */
export function registerGateTestCommand(program: Command): void {
  program
    .command("test")
    .description("Parse test output and emit AX-compliant results")
    .option("-a, --adapter <name>", "Adapter name (e.g., vitest, junit)")
    .option("-i, --input <path>", "Input file path (or stdin if omitted)")
    .option("-o, --output <path>", "Output file path (or stdout if omitted)")
    .option("-f, --format <format>", "Output format: json (default), markdown", "json")
    .option("--strict", "Require explicit adapter, fail on ambiguity")
    .option("--include-raw", "Include original output in raw field")
    .action(async (opts) => {
      try {
        // Validate format
        if (opts.format !== "json" && opts.format !== "markdown") {
          console.error(`❌ Error: Invalid format '${opts.format}'. Must be 'json' or 'markdown'.`);
          console.error("\n💡 Next Actions:");
          console.error("  - Use --format json (default) for machine-readable output");
          console.error("  - Use --format markdown for PR comments");
          throwExit(2);
        }

        // Read input
        let input: string;
        try {
          input = await readInput(opts.input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Error: Failed to read input: ${message}`);
          console.error("\n💡 Next Actions:");
          console.error("  - Verify the input file exists and is readable");
          console.error("  - Ensure stdin contains valid test output when using pipe mode");
          throwExit(2);
        }

        // Validate input is non-empty
        if (!input || input.trim().length === 0) {
          console.error("❌ Error: Input is empty. No test output to parse.");
          console.error("\n💡 Next Actions:");
          console.error("  - Verify the test runner produced output");
          console.error("  - Check that the input file contains valid test results");
          throwExit(2);
        }

        // Adapter selection
        let result: AXTestResult;
        try {
          if (opts.adapter) {
            // Explicit adapter
            const adapter = requireAdapter(opts.adapter);
            result = adapter.parse(input);
          } else {
            // Auto-detect
            if (opts.strict) {
              console.error("❌ Error: --strict mode requires explicit --adapter");
              console.error("\n💡 Next Actions:");
              const adapters = listAdapters();
              if (adapters.length > 0) {
                console.error(`  - Available adapters: ${adapters.map((a) => a.name).join(", ")}`);
                console.error(
                  `  - Example: lexrunner gate test --adapter ${adapters[0].name} --strict`
                );
              } else {
                console.error("  - No adapters registered");
              }
              throwExit(2);
            }

            // Warn in CI if auto-detecting
            if (isCI()) {
              console.warn("⚠️  Warning: Auto-detecting adapter in CI environment");
              console.warn("   Consider using --adapter for deterministic behavior");
              console.warn("   or --strict to enforce explicit adapter selection\n");
            }

            const adapter = requireDetectedAdapter(input);
            result = adapter.parse(input);
          }
        } catch (error) {
          if (error instanceof AdapterNotFoundError) {
            console.error(`❌ Error: ${error.message}`);
            console.error("\n💡 Next Actions:");
            for (const suggestion of error.suggestions) {
              console.error(`  - ${suggestion}`);
            }
            throwExit(2);
          } else if (error instanceof AdapterParseError) {
            console.error(`❌ Error: Parse failed (${error.adapterName}): ${error.message}`);
            console.error("\n💡 Next Actions:");
            console.error("  - Verify the input is valid test output");
            console.error(`  - Check that ${error.adapterName} supports this format`);
            console.error("  - Try a different adapter with --adapter");
            const adapters = listAdapters();
            if (adapters.length > 0) {
              console.error(`  - Available adapters: ${adapters.map((a) => a.name).join(", ")}`);
            }
            throwExit(2);
          } else {
            throw error;
          }
        }

        // Include raw output if requested
        if (opts.includeRaw && !result.raw) {
          result.raw = input;
        }

        // Format output
        let output: string;
        if (opts.format === "markdown") {
          output = formatAsMarkdown(result);
        } else {
          // JSON format (default)
          output = JSON.stringify(result, null, 2);
        }

        // Write output
        try {
          writeOutput(output, opts.output);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Error: Failed to write output: ${message}`);
          console.error("\n💡 Next Actions:");
          console.error("  - Verify the output directory exists and is writable");
          console.error("  - Check disk space availability");
          throwExit(2);
        }

        // Determine exit code based on test results
        if (result.summary.failed > 0) {
          // Tests failed, but parsing succeeded
          throwExit(1);
        }

        // Success - all tests passed
        throwExit(0);
      } catch (error) {
        // Unexpected error
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Unexpected error: ${message}`);
        throwExit(1);
      }
    });
}
