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
export { vitestJsonAdapter } from "./vitest-json.js";
export { jestJsonAdapter } from "./jest-json.js";
export { junitXmlAdapter } from "./junit-xml.js";

// Auto-register built-in adapters on import
import { registerAdapter as _register, getAdapterCount } from "./registry.js";
import { vitestJsonAdapter } from "./vitest-json.js";
import { jestJsonAdapter } from "./jest-json.js";
import { junitXmlAdapter } from "./junit-xml.js";

// Only register if not already registered (avoids duplicate registration)
if (getAdapterCount() === 0) {
  _register(vitestJsonAdapter);
  _register(jestJsonAdapter);
  _register(junitXmlAdapter);
}
