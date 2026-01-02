/**
 * Executor Module
 *
 * Public API for merge-weave intervention execution.
 *
 * @module
 */

export {
  type InterventionResult,
  type InterventionHandler,
  type ExecutionContext,
  type GitHubAPI,
  type ShellExecutor,
  type ShellResult,
  type GitOperations,
  type MergeOptions,
  type CIStatus,
  type AuditEvent,
} from "./types.js";

export { executeD1Intervention, hasD1Handler, getD1InterventionTypes } from "./d1-executor.js";

export { executeD2Intervention, hasD2Handler, getD2InterventionTypes } from "./d2-executor.js";
