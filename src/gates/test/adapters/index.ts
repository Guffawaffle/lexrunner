/**
 * TestAdapter system - Interface, Registry, and Errors (ADR-009)
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

export type { TestAdapter, AdapterInfo } from "./interface.js";
export { AdapterNotFoundError, AdapterParseError } from "./errors.js";
export {
  registerAdapter,
  getAdapter,
  detectAdapter,
  listAdapters,
  requireAdapter,
  requireDetectedAdapter,
  clearAdapters,
  getAdapterCount,
} from "./registry.js";

// Adapter implementations
export { jestJsonAdapter } from "./jest-json.js";
