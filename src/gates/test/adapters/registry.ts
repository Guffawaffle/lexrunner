/**
 * TestAdapter Registry (ADR-009)
 *
 * Central registry for discovering and selecting test adapters.
 * Supports:
 * - Manual registration via registerAdapter()
 * - Auto-detection via detectAdapter()
 * - Name-based lookup via getAdapter()
 * - Discovery via listAdapters()
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import type { TestAdapter, AdapterInfo } from "./interface.js";
import { AdapterNotFoundError } from "./errors.js";

/**
 * Global adapter registry
 *
 * Maintains registration order for priority-based detection.
 */
const adapters = new Map<string, TestAdapter>();

/**
 * Register a test adapter
 *
 * @param adapter - TestAdapter implementation
 * @throws Error if adapter with same name already registered
 */
export function registerAdapter(adapter: TestAdapter): void {
  if (adapters.has(adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" is already registered`);
  }
  adapters.set(adapter.name, adapter);
}

/**
 * Get adapter by name
 *
 * @param name - Adapter name (e.g., "vitest-json")
 * @returns TestAdapter or undefined if not found
 */
export function getAdapter(name: string): TestAdapter | undefined {
  return adapters.get(name);
}

/**
 * Auto-detect adapter from content
 *
 * Runs detect() on all registered adapters in registration order.
 * Returns first match.
 *
 * @param content - Raw test output content
 * @returns First matching TestAdapter, or undefined if no match
 */
export function detectAdapter(content: string): TestAdapter | undefined {
  for (const adapter of adapters.values()) {
    try {
      if (adapter.detect(content)) {
        return adapter;
      }
    } catch {
      // Adapter.detect() threw - skip this adapter
      continue;
    }
  }
  return undefined;
}

/**
 * List all registered adapters
 *
 * @returns Array of AdapterInfo for CLI help/discovery
 */
export function listAdapters(): AdapterInfo[] {
  return Array.from(adapters.values()).map((adapter) => ({
    name: adapter.name,
    version: adapter.version,
    extensions: adapter.extensions,
  }));
}

/**
 * Get adapter by name with error
 *
 * Helper that throws AdapterNotFoundError with suggestions.
 *
 * @param name - Adapter name
 * @returns TestAdapter
 * @throws AdapterNotFoundError if not found
 */
export function requireAdapter(name: string): TestAdapter {
  const adapter = getAdapter(name);
  if (!adapter) {
    const available = Array.from(adapters.keys());
    throw new AdapterNotFoundError(
      `Adapter "${name}" not found`,
      available.length > 0
        ? [`Available adapters: ${available.join(", ")}`]
        : ["No adapters registered"]
    );
  }
  return adapter;
}

/**
 * Detect adapter from content with error
 *
 * Helper that throws AdapterNotFoundError if no adapter matches.
 *
 * @param content - Raw test output content
 * @returns TestAdapter
 * @throws AdapterNotFoundError if no adapter matches
 */
export function requireDetectedAdapter(content: string): TestAdapter {
  const adapter = detectAdapter(content);
  if (!adapter) {
    const available = Array.from(adapters.keys());
    throw new AdapterNotFoundError(
      "No adapter detected for the provided content. Content may not be valid test output or format may not be supported.",
      available.length > 0
        ? [
            `Registered adapters: ${available.join(", ")}`,
            "Try specifying an adapter explicitly with --adapter",
            "Verify the content is valid test output from a supported runner",
          ]
        : ["No adapters registered"]
    );
  }
  return adapter;
}

/**
 * Clear all registered adapters
 *
 * Primarily for testing - allows clean slate between test runs.
 */
export function clearAdapters(): void {
  adapters.clear();
}

/**
 * Get count of registered adapters
 *
 * Primarily for testing/debugging.
 */
export function getAdapterCount(): number {
  return adapters.size;
}
