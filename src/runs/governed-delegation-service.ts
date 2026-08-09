import type {
  AuthorizeGovernedDelegationInvocationInput,
  AuthorizeGovernedDelegationInvocationResult,
  CreateGovernedDelegationInput,
  CreateGovernedDelegationResult,
  GovernedDelegationEvent_v1,
  GovernedDelegationRecord_v1,
  GovernedDelegationStore,
  RecordGovernedDelegationDecisionInput,
  RecordGovernedDelegationDecisionResult,
} from "../store/governed-delegation-store.js";

export interface GovernedDelegationStatusProjection {
  record: GovernedDelegationRecord_v1 | null;
  events: GovernedDelegationEvent_v1[];
}

/** Application boundary for Delegation protocol state; it never launches an executor. */
export class GovernedDelegationService {
  constructor(private readonly store: GovernedDelegationStore) {}

  create(input: CreateGovernedDelegationInput): Promise<CreateGovernedDelegationResult> {
    return this.store.createDelegation(input);
  }

  decide(
    input: RecordGovernedDelegationDecisionInput
  ): Promise<RecordGovernedDelegationDecisionResult> {
    return this.store.recordDelegationDecision(input);
  }

  authorize(
    input: AuthorizeGovernedDelegationInvocationInput
  ): Promise<AuthorizeGovernedDelegationInvocationResult> {
    return this.store.authorizeDelegationInvocation(input);
  }

  async status(delegationId: string): Promise<GovernedDelegationStatusProjection> {
    const record = await this.store.getDelegation(delegationId);
    if (!record) return { record: null, events: [] };
    const events = await this.store.listDelegationEvents(delegationId);
    return { record, events: events.slice(-64) };
  }
}
