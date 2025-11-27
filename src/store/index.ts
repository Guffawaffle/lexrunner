/**
 * Store Layer — Persistence abstraction for run lifecycle.
 *
 * This module exports the RunStore interface and available implementations.
 *
 * @module store
 */

// Interface and types
export type {
        RunStore,
        RunRecord,
        StepOutcome,
        Receipt,
        RunState,
        StepStatus,
        ListRunsOptions,
} from "./run-store.js";

export {
        RunRecordSchema,
        StepOutcomeSchema,
        ReceiptSchema,
        RunStateSchema,
        StepStatusSchema,
        parseRunRecord,
        safeParseRunRecord,
        parseStepOutcome,
        safeParseStepOutcome,
        parseReceipt,
        safeParseReceipt,
} from "./run-store.js";

// Implementations
export { InMemoryRunStore, InMemoryRunStoreOptions } from "./inmemory/index.js";
export { SqliteRunStore } from "./sqlite/index.js";