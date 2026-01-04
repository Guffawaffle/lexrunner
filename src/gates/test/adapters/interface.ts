/**
 * TestAdapter Interface (ADR-009)
 *
 * Defines the contract for test output adapters that normalize
 * runner-specific formats into AXTestResult.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import type { AXTestResult } from "../schema.js";

/**
 * Test output adapter interface
 *
 * Adapters convert runner-specific test output (JSON, XML, TAP, etc.)
 * into the standardized AXTestResult format.
 *
 * Naming convention: {runner}-{format} (e.g., "vitest-json", "junit-xml")
 */
export interface TestAdapter {
  /**
   * Adapter name following convention: {runner}-{format}
   * Examples: "vitest-json", "jest-json", "junit-xml", "node-tap"
   */
  name: string;

  /**
   * Adapter version (semver)
   */
  version: string;

  /**
   * File extensions this adapter handles (e.g., [".json", ".xml"])
   */
  extensions: string[];

  /**
   * Content-based detection for auto-discovery
   *
   * @param content - Raw file content or test output
   * @returns true if this adapter can parse the content
   */
  detect(content: string): boolean;

  /**
   * Parse raw test output into normalized AXTestResult
   *
   * @param input - Raw test output (string or Buffer)
   * @returns Normalized AXTestResult with failures, summary, and nextActions
   * @throws AdapterParseError on parse failure (preserves raw input)
   */
  parse(input: string | Buffer): AXTestResult;
}

/**
 * Adapter information for discovery/listing
 */
export interface AdapterInfo {
  name: string;
  version: string;
  extensions: string[];
}
