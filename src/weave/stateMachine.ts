/**
 * Merge-weave execution state machine
 * Implements state transitions and execution flow control
 */

import { WeaveState, WeaveEvent, StateTransition, WeaveContext } from "./types.js";
import { ulid } from "ulid";
import { emitWeaveCompletionFrame } from "./frameHelper.js";
import type { FrameEmitResult } from "../frames/types.js";
import { weaveStateInvalidError } from "../errors/index.js";

/**
 * Valid state transitions for weave execution
 */
export const STATE_TRANSITIONS: StateTransition[] = [
  // Initial flow
  { from: WeaveState.IDLE, to: WeaveState.PLANNING, event: WeaveEvent.START },
  { from: WeaveState.PLANNING, to: WeaveState.COMPUTING_ORDER, event: WeaveEvent.PLAN_READY },
  { from: WeaveState.COMPUTING_ORDER, to: WeaveState.READY, event: WeaveEvent.ORDER_COMPUTED },

  // Execution flow
  { from: WeaveState.READY, to: WeaveState.MERGING, event: WeaveEvent.BEGIN_MERGE },
  { from: WeaveState.MERGING, to: WeaveState.VALIDATING, event: WeaveEvent.MERGE_SUCCESS },
  { from: WeaveState.MERGING, to: WeaveState.FAILED, event: WeaveEvent.MERGE_FAILED },

  // Validation flow
  { from: WeaveState.VALIDATING, to: WeaveState.READY, event: WeaveEvent.VALIDATION_PASSED },
  { from: WeaveState.VALIDATING, to: WeaveState.COMPLETED, event: WeaveEvent.ALL_COMPLETE },
  { from: WeaveState.VALIDATING, to: WeaveState.FAILED, event: WeaveEvent.VALIDATION_FAILED },

  // Gate failure flow (ADR-007)
  { from: WeaveState.VALIDATING, to: WeaveState.AWAITING_FIX, event: WeaveEvent.GATE_FAILED },
  { from: WeaveState.AWAITING_FIX, to: WeaveState.FIX_SUBMITTED, event: WeaveEvent.FIX_SUBMITTED },
  {
    from: WeaveState.FIX_SUBMITTED,
    to: WeaveState.VERIFYING,
    event: WeaveEvent.BEGIN_VERIFICATION,
  },
  { from: WeaveState.VERIFYING, to: WeaveState.VERIFIED, event: WeaveEvent.FIX_VERIFIED },
  { from: WeaveState.VERIFYING, to: WeaveState.TRUST_GAP, event: WeaveEvent.TRUST_GAP_DETECTED },
  { from: WeaveState.VERIFIED, to: WeaveState.VALIDATING, event: WeaveEvent.VALIDATION_PASSED },
  { from: WeaveState.TRUST_GAP, to: WeaveState.FAILED, event: WeaveEvent.VALIDATION_FAILED },

  // Pause/resume
  { from: WeaveState.READY, to: WeaveState.PAUSED, event: WeaveEvent.PAUSE },
  { from: WeaveState.MERGING, to: WeaveState.PAUSED, event: WeaveEvent.PAUSE },
  { from: WeaveState.VALIDATING, to: WeaveState.PAUSED, event: WeaveEvent.PAUSE },
  { from: WeaveState.PAUSED, to: WeaveState.READY, event: WeaveEvent.RESUME },

  // Reset
  { from: WeaveState.FAILED, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.COMPLETED, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.PAUSED, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.TRUST_GAP, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.AWAITING_FIX, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.FIX_SUBMITTED, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.VERIFYING, to: WeaveState.IDLE, event: WeaveEvent.RESET },
  { from: WeaveState.VERIFIED, to: WeaveState.IDLE, event: WeaveEvent.RESET },
];

/**
 * State machine for weave execution
 */
export class WeaveStateMachine {
  private context: WeaveContext;
  private transitions: Map<string, StateTransition>;
  /** Last Frame emit result (for testing/debugging) */
  private lastFrameResult?: FrameEmitResult;

  constructor(context: WeaveContext) {
    this.context = context;
    this.transitions = new Map();

    // Build transition lookup map
    for (const transition of STATE_TRANSITIONS) {
      const key = this.getTransitionKey(transition.from, transition.event);
      this.transitions.set(key, transition);
    }
  }

  /**
   * Get current state
   */
  getCurrentState(): WeaveState {
    return this.context.state;
  }

  /**
   * Get execution context
   */
  getContext(): WeaveContext {
    return { ...this.context };
  }

  /**
   * Get last Frame emit result
   */
  getLastFrameResult(): FrameEmitResult | undefined {
    return this.lastFrameResult;
  }

  /**
   * Check if a transition is valid
   */
  canTransition(event: WeaveEvent): boolean {
    const key = this.getTransitionKey(this.context.state, event);
    const transition = this.transitions.get(key);

    if (!transition) {
      return false;
    }

    // Check guard condition if present
    if (transition.guard && !transition.guard()) {
      return false;
    }

    return true;
  }

  /**
   * Execute a state transition
   */
  transition(event: WeaveEvent): WeaveState {
    if (!this.canTransition(event)) {
      throw weaveStateInvalidError({
        currentState: this.context.state,
        event,
        availableEvents: this.getAvailableTransitions(),
      });
    }

    const key = this.getTransitionKey(this.context.state, event);
    const transition = this.transitions.get(key)!;

    const previousState = this.context.state;
    this.context.state = transition.to;
    this.context.lastUpdatedAt = new Date().toISOString();

    // Handle state-specific logic
    this.onStateEnter(transition.to, previousState, event);

    return this.context.state;
  }

  /**
   * Update context
   */
  updateContext(updates: Partial<WeaveContext>): void {
    this.context = {
      ...this.context,
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get available transitions from current state
   */
  getAvailableTransitions(): WeaveEvent[] {
    const events: WeaveEvent[] = [];

    for (const transition of STATE_TRANSITIONS) {
      if (transition.from === this.context.state) {
        // Check guard if present
        if (!transition.guard || transition.guard()) {
          events.push(transition.event);
        }
      }
    }

    return events;
  }

  /**
   * Check if execution is complete (terminal state)
   */
  isTerminalState(): boolean {
    return this.context.state === WeaveState.COMPLETED || this.context.state === WeaveState.FAILED;
  }

  /**
   * Check if execution can be resumed
   */
  canResume(): boolean {
    return this.context.state === WeaveState.PAUSED;
  }

  /**
   * Private: Generate transition lookup key
   */
  private getTransitionKey(from: WeaveState, event: WeaveEvent): string {
    return `${from}:${event}`;
  }

  /**
   * Private: Handle state entry logic
   */
  private onStateEnter(newState: WeaveState, previousState: WeaveState, event: WeaveEvent): void {
    switch (newState) {
      case WeaveState.COMPLETED:
        this.context.completedAt = new Date().toISOString();
        // Emit Frame for successful completion (AX-005)
        // Fire-and-forget async call (state transitions can't be async)
        emitWeaveCompletionFrame(this.context)
          .then((result) => {
            this.lastFrameResult = result;
          })
          .catch((error) => {
            // Log error but don't fail the state transition
            if (process.env.DEBUG) {
              console.error("[state-machine] Failed to emit completion frame:", error);
            }
          });
        break;

      case WeaveState.FAILED:
        // Mark current batch as failed if in progress
        if (this.context.currentBatchIndex < this.context.batches.length) {
          const batch = this.context.batches[this.context.currentBatchIndex];
          if (batch.state === "in-progress") {
            batch.state = "failed";
            batch.completedAt = new Date().toISOString();
          }
        }
        // Emit Frame for failure (AX-005)
        // Fire-and-forget async call (state transitions can't be async)
        emitWeaveCompletionFrame(this.context)
          .then((result) => {
            this.lastFrameResult = result;
          })
          .catch((error) => {
            // Log error but don't fail the state transition
            if (process.env.DEBUG) {
              console.error("[state-machine] Failed to emit failure frame:", error);
            }
          });
        break;

      case WeaveState.MERGING:
        // Mark current batch as in-progress
        if (this.context.currentBatchIndex < this.context.batches.length) {
          const batch = this.context.batches[this.context.currentBatchIndex];
          batch.state = "in-progress";
          batch.startedAt = new Date().toISOString();
        }
        break;

      case WeaveState.READY:
        // If coming from VALIDATING with VALIDATION_PASSED, advance to next batch
        if (previousState === WeaveState.VALIDATING && event === WeaveEvent.VALIDATION_PASSED) {
          const batch = this.context.batches[this.context.currentBatchIndex];
          batch.state = "completed";
          batch.completedAt = new Date().toISOString();
          this.context.currentBatchIndex++;
        }
        break;
    }
  }
}

/**
 * Create a new weave execution context
 */
export function createWeaveContext(
  plan: any,
  prHeads: any[],
  planHash: string,
  dryRun: boolean = false
): WeaveContext {
  return {
    runId: ulid(),
    state: WeaveState.IDLE,
    plan,
    prHeads,
    batches: [],
    currentBatchIndex: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    successfulMerges: 0,
    failedMerges: 0,
    metadata: {
      planHash,
      targetBranch: plan.target || "main",
      dryRun,
    },
  };
}

/**
 * Create state machine from existing context (for resume)
 */
export function createStateMachineFromContext(context: WeaveContext): WeaveStateMachine {
  return new WeaveStateMachine(context);
}

/**
 * Generate Mermaid diagram for state machine
 */
export function generateMermaidDiagram(): string {
  return `stateDiagram-v2
    [*] --> idle
    
    idle --> planning : START
    planning --> computing_order : PLAN_READY
    computing_order --> ready : ORDER_COMPUTED
    
    ready --> merging : BEGIN_MERGE
    merging --> validating : MERGE_SUCCESS
    merging --> failed : MERGE_FAILED
    
    validating --> ready : VALIDATION_PASSED
    validating --> completed : ALL_COMPLETE
    validating --> failed : VALIDATION_FAILED
    validating --> awaiting_fix : GATE_FAILED
    
    awaiting_fix --> fix_submitted : FIX_SUBMITTED
    fix_submitted --> verifying : BEGIN_VERIFICATION
    verifying --> verified : FIX_VERIFIED
    verifying --> trust_gap : TRUST_GAP_DETECTED
    verified --> validating : VALIDATION_PASSED
    trust_gap --> failed : VALIDATION_FAILED
    
    ready --> paused : PAUSE
    merging --> paused : PAUSE
    validating --> paused : PAUSE
    paused --> ready : RESUME
    
    failed --> idle : RESET
    completed --> idle : RESET
    paused --> idle : RESET
    trust_gap --> idle : RESET
    
    completed --> [*]
    failed --> [*]
    
    note right of idle
        Initial state
        No execution started
    end note
    
    note right of planning
        Analyzing PRs
        Loading dependencies
    end note
    
    note right of computing_order
        Computing merge batches
        Topological sort
    end note
    
    note right of ready
        Ready to execute
        Awaiting next batch
    end note
    
    note right of merging
        Executing git merges
        Batch in progress
    end note
    
    note right of validating
        Running gates
        Checking tests
    end note
    
    note right of awaiting_fix
        Gate failed
        Snapshot generated (ADR-007)
    end note
    
    note right of fix_submitted
        Receipt received
        Ready for verification
    end note
    
    note right of verifying
        Engine verification
        Trust-but-verify pattern
    end note
    
    note right of verified
        Fix verified
        Continuing weave
    end note
    
    note right of trust_gap
        Agent claim != verification
        Human review required
    end note
    
    note right of paused
        Execution suspended
        Can be resumed
    end note
    
    note right of completed
        All batches done
        Terminal state
    end note
    
    note right of failed
        Execution failed
        Terminal state
    end note`;
}
