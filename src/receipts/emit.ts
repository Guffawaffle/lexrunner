/**
 * ActionReceipt Emission Helper
 *
 * Provides a simple, ergonomic interface for emitting ActionReceipts
 * during merge-weave and gate execution operations.
 *
 * @module receipts/emit
 * @see docs/DISCIPLINED_FAILURE.md
 */

import {
	ActionReceiptSchema,
	type ActionReceipt,
	type ConfidenceLevel,
	type ReversibilityLevel,
	type Outcome,
	type UncertaintyMarker,
	UncertaintyMarkerSchema,
} from "./schema.js";

// =============================================================================
// Receipt Emission Parameters
// =============================================================================

/**
 * Parameters for creating an ActionReceipt
 */
export interface EmitReceiptParams {
	/** Human-readable description of the action */
	action: string;

	/** Explanation for why this action was taken */
	rationale: string;

	/** Confidence level in the action's success */
	confidence: ConfidenceLevel;

	/** Classification of action reversibility */
	reversibility: ReversibilityLevel;

	/** Human-readable rollback instructions */
	rollbackPath?: string;

	/** Actual command to execute for rollback */
	rollbackCommand?: string;

	/** Suggested next actions */
	nextActions?: string[];

	/** Execution phase (e.g., 'planning', 'apply', 'verify') */
	phase?: string;

	/** Run ID for correlation */
	runId?: string;

	/** Plan hash for verification */
	planHash?: string;

	/** Notes about sources of uncertainty */
	uncertaintyNotes?: string[];

	/** Whether human escalation is required */
	escalationRequired?: boolean;

	/** Reason for escalation */
	escalationReason?: string;

	/** Override outcome (defaults to 'success') */
	outcome?: Outcome;
}

/**
 * Options for receipt emission behavior
 */
export interface EmitOptions {
	/** Whether to log the receipt to console (default: true) */
	log?: boolean;

	/** Whether to emit as structured JSON (default: true when logging) */
	json?: boolean;

	/** Custom logger function (default: console.log) */
	logger?: (message: string) => void;
}

// =============================================================================
// Receipt Emission Function
// =============================================================================

/**
 * Emit an ActionReceipt documenting an action taken
 *
 * This function creates and optionally logs an ActionReceipt that documents
 * the decision chain for disciplined failure. It supports:
 *
 * - Full traceability of agent actions
 * - Structured logging for observability
 * - Validation against schema for consistency
 *
 * @param params - Receipt parameters
 * @param options - Emission options
 * @returns The validated ActionReceipt
 *
 * @example
 * ```typescript
 * // Simple success receipt
 * emitActionReceipt({
 *   action: 'merge PR-123 to integration',
 *   rationale: 'PR dependencies satisfied, gates green',
 *   confidence: 'high',
 *   reversibility: 'reversible',
 *   rollbackPath: 'git reset --hard HEAD~1',
 *   phase: 'apply',
 * });
 *
 * // Failure receipt with escalation
 * emitActionReceipt({
 *   action: 'merge PR-456 to integration',
 *   rationale: 'Merge conflict detected',
 *   confidence: 'high',
 *   reversibility: 'reversible',
 *   outcome: 'failure',
 *   escalationRequired: true,
 *   escalationReason: 'Conflict resolution requires human review',
 *   nextActions: ['Resolve conflicts in src/cli.ts', 'Re-run merge'],
 * });
 * ```
 */
export function emitActionReceipt(
	params: EmitReceiptParams,
	options: EmitOptions = {}
): ActionReceipt {
	const { log = true, json = true, logger = console.log } = options;

	// Build the receipt object
	const receipt: ActionReceipt = {
		schemaVersion: "1.0.0",
		kind: "ActionReceipt",
		action: params.action,
		outcome: params.outcome ?? "success",
		rationale: params.rationale,
		confidence: params.confidence,
		reversibility: params.reversibility,
		escalationRequired: params.escalationRequired ?? false,
		timestamp: new Date().toISOString(),
	};

	// Add optional fields if provided
	if (params.rollbackPath) receipt.rollbackPath = params.rollbackPath;
	if (params.rollbackCommand) receipt.rollbackCommand = params.rollbackCommand;
	if (params.nextActions) receipt.nextActions = params.nextActions;
	if (params.phase) receipt.phase = params.phase;
	if (params.runId) receipt.runId = params.runId;
	if (params.planHash) receipt.planHash = params.planHash;
	if (params.uncertaintyNotes)
		receipt.uncertaintyNotes = params.uncertaintyNotes;
	if (params.escalationReason)
		receipt.escalationReason = params.escalationReason;

	// Validate against schema
	const validated = ActionReceiptSchema.parse(receipt);

	// Log if requested
	if (log) {
		if (json) {
			logger(JSON.stringify({ event: "action_receipt", ...validated }));
		} else {
			logger(
				`[ActionReceipt] ${validated.action} (${validated.outcome}) - ${validated.rationale}`
			);
		}
	}

	return validated;
}

/**
 * Emit a failure ActionReceipt
 *
 * Convenience wrapper for emitting failure receipts with appropriate defaults.
 *
 * @param params - Receipt parameters (outcome defaults to 'failure')
 * @param options - Emission options
 * @returns The validated ActionReceipt
 *
 * @example
 * ```typescript
 * emitFailureReceipt({
 *   action: 'execute gate: test',
 *   rationale: 'Test suite failed with 3 errors',
 *   confidence: 'high',
 *   reversibility: 'reversible',
 *   nextActions: ['Fix failing tests', 'Re-run gate'],
 * });
 * ```
 */
export function emitFailureReceipt(
	params: Omit<EmitReceiptParams, "outcome">,
	options: EmitOptions = {}
): ActionReceipt {
	return emitActionReceipt({ ...params, outcome: "failure" }, options);
}

/**
 * Emit a deferred ActionReceipt
 *
 * Use when an action is postponed due to uncertainty or dependencies.
 *
 * @param params - Receipt parameters (outcome defaults to 'deferred')
 * @param options - Emission options
 * @returns The validated ActionReceipt
 *
 * @example
 * ```typescript
 * emitDeferredReceipt({
 *   action: 'merge PR-789 to integration',
 *   rationale: 'Waiting for dependency PR-456 to merge first',
 *   confidence: 'medium',
 *   reversibility: 'reversible',
 *   uncertaintyNotes: ['PR-456 gate status unknown'],
 * });
 * ```
 */
export function emitDeferredReceipt(
	params: Omit<EmitReceiptParams, "outcome">,
	options: EmitOptions = {}
): ActionReceipt {
	return emitActionReceipt({ ...params, outcome: "deferred" }, options);
}

// =============================================================================
// Uncertainty Marker Emission
// =============================================================================

/**
 * Parameters for creating an UncertaintyMarker
 */
export interface EmitUncertaintyParams {
	/** Operation about to be performed */
	operation: string;

	/** Explicit list of known uncertainties */
	uncertainties: string[];

	/** Mitigations in place for the uncertainties */
	mitigations: string[];

	/** Whether proceeding despite uncertainties */
	proceedingAnyway: boolean;

	/** Reason for proceeding (if proceedingAnyway is true) */
	reason?: string;
}

/**
 * Emit an UncertaintyMarker before taking a risky action
 *
 * This function creates and optionally logs an UncertaintyMarker that
 * explicitly declares uncertainty BEFORE an action is taken, satisfying
 * requirement (1) of Disciplined Failure.
 *
 * @param params - Uncertainty marker parameters
 * @param options - Emission options
 * @returns The validated UncertaintyMarker
 *
 * @example
 * ```typescript
 * emitUncertaintyMarker({
 *   operation: 'merge PR-456 with active dependencies',
 *   uncertainties: [
 *     'Dependency PR-123 may have untested changes',
 *     'Target branch received commits since last check'
 *   ],
 *   mitigations: [
 *     'Will run full test suite after merge',
 *     'Rollback path: git reset --hard HEAD~1'
 *   ],
 *   proceedingAnyway: true,
 *   reason: 'Time-sensitive release; risk accepted by policy'
 * });
 * ```
 */
export function emitUncertaintyMarker(
	params: EmitUncertaintyParams,
	options: EmitOptions = {}
): UncertaintyMarker {
	const { log = true, json = true, logger = console.log } = options;

	const marker: UncertaintyMarker = {
		...params,
		timestamp: new Date().toISOString(),
	};

	// Validate against schema
	const validated = UncertaintyMarkerSchema.parse(marker);

	// Log if requested
	if (log) {
		if (json) {
			logger(JSON.stringify({ event: "uncertainty_marker", ...validated }));
		} else {
			const status = validated.proceedingAnyway
				? "PROCEEDING"
				: "BLOCKED";
			logger(
				`[UncertaintyMarker] ${status}: ${validated.operation} - ${validated.uncertainties.length} uncertainties`
			);
		}
	}

	return validated;
}

// =============================================================================
// Governance Context Builder
// =============================================================================

/**
 * Build governance context for AXError
 *
 * Creates a context object with governance fields that can be merged
 * with other context fields when creating an AXError.
 *
 * @param params - Governance parameters
 * @returns Context object with governance fields
 *
 * @example
 * ```typescript
 * const ctx = buildGovernanceContext({
 *   reversibility: 'reversible',
 *   rollbackPath: 'git reset --hard HEAD~1',
 *   confidence: 'high',
 * });
 *
 * const error = createAXError(
 *   'MERGE_CONFLICT',
 *   'Merge conflict detected',
 *   ['Resolve conflicts manually'],
 *   { ...otherContext, ...ctx }
 * );
 * ```
 */
export function buildGovernanceContext(params: {
	reversibility?: ReversibilityLevel;
	rollbackPath?: string;
	rollbackCommand?: string;
	confidence?: ConfidenceLevel;
	uncertaintyNotes?: string[];
}): Record<string, unknown> {
	const ctx: Record<string, unknown> = {};

	if (params.reversibility) ctx.reversibility = params.reversibility;
	if (params.rollbackPath) ctx.rollbackPath = params.rollbackPath;
	if (params.rollbackCommand) ctx.rollbackCommand = params.rollbackCommand;
	if (params.confidence) ctx.confidence = params.confidence;
	if (params.uncertaintyNotes)
		ctx.uncertaintyNotes = params.uncertaintyNotes;

	return ctx;
}
