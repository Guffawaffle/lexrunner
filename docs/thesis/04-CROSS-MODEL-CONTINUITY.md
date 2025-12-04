# 04 — Cross-Model Continuity: Shared Language as Session State

> **TL;DR:** The "state" of an agent session is the shared language, expectations, governance primitives, and receipts — not latent vectors or hidden cache.

---

## The Session State Problem

When you work with an AI agent across multiple interactions, something accumulates that feels like "state":

- The agent "knows" what you're working on
- It "remembers" decisions made earlier
- It "understands" your terminology
- It can "continue" interrupted work

This feels like memory. But what actually is it?

---

## What Session State Is Not

### Not Latent Vectors

Language models don't maintain persistent hidden state between API calls. Each request is independent. The "memory" you perceive is either:
- Context window (explicit tokens)
- Provider-specific features (conversation history, memory APIs)
- Your own re-explanation

### Not Hidden Cache

Some providers offer "memory" features, but these are:
- Provider-specific (not portable)
- Opaque (you can't inspect or edit them)
- Fragile (subject to provider changes)
- Limited (constrained by provider policies)

### Not Model Weights

The model doesn't learn from your session. Your preferences don't update the weights. A fresh session with the same model starts from zero.

---

## What Session State Actually Is

> **Session state = Shared language + Expectations + Governance primitives + Receipts**

### Shared Language

The vocabulary and concepts you've established:
- "When I say 'module', I mean ESM"
- "The auth system uses JWT with Redis session store"
- "`UserService` is the main entry point for user operations"

### Expectations

The implicit and explicit contracts:
- "Always run tests before committing"
- "Follow the existing code style"
- "Ask before making breaking changes"

### Governance Primitives

The rules and constraints:
- "Senior Dev role: implement, don't plan"
- "Maximum 3 files per PR"
- "Flag uncertainty above 30%"

### Receipts

The record of what happened:
- "Yesterday we implemented the login flow"
- "PR #42 added the caching layer"
- "The migration was rolled back due to timeout"

---

## Why This Matters

### Implication 1: State Is Portable

If session state is shared language + expectations + governance + receipts, then:

- **It can be written down** (not locked in provider memory)
- **It can be transferred** (hand off to different model)
- **It can be versioned** (track changes over time)
- **It can be inspected** (debug and improve)

### Implication 2: Model Switching Is Cheap

When governance is externalized:

```
Model A → [pause]
          [Shared state persists in contracts/receipts]
Model B → [resume]
          [Reads same contracts/receipts]
          [Continues with minimal re-orientation]
```

The handoff cost is the cost of reading the contracts, not the cost of rebuilding understanding.

### Implication 3: Different Models Can Collaborate

```
Task: Implement complex feature

GPT-4o: [reads contract] "I'll design the architecture"
        [creates design receipt]

Claude Sonnet: [reads design receipt] "I'll implement the core logic"
               [creates implementation receipt]

Claude Haiku: [reads implementation receipt] "I'll add linting and tests"
              [creates verification receipt]
```

Each model inherits the state through explicit artifacts.

---

## The Robert Theorem Demonstration

The Robert experiment demonstrated this directly:

### Setup
- Primary model: GPT-5 High Thinking
- Secondary models: Claude Sonnet 4.5, Claude Haiku
- State mechanism: On-disk memory + contracts file
- No LexRunner, no Frame schema, no policy engine

### Observation

> "Different models can take turns without full re-explanation when governance is established."

The models weren't sharing memory. They were reading the same:
- Contract definitions
- Decision receipts
- Shared vocabulary
- Established patterns

### Measurement

- Cross-model handoff cost: ~200 tokens (reading contracts)
- Same-model fresh session cost: ~800 tokens (re-establishing context)
- Same-model continuation: ~50 tokens (within context window)

**Cross-model handoff was cheaper than fresh same-model session.**

---

## Implementing Cross-Model Continuity

### Layer 1: Shared Vocabulary Registry

```yaml
# .lex/vocabulary.yaml

terms:
  module:
    definition: "ESM module with .js extension"
    not: "CommonJS require, Python module"
    example: "src/auth/index.js"

  frame:
    definition: "Episodic memory unit in Lex"
    schema: "canon/schemas/frame.schema.json"
    not: "Stack frame, window frame"

  gate:
    definition: "Verification step in merge pyramid"
    examples: ["lint", "typecheck", "test"]
    not: "Auth gate, feature gate"
```

### Layer 2: Expectation Contracts

```yaml
# .lex/contracts/development.yaml

expectations:
  code_style:
    typescript: "Follow tsconfig.json settings"
    imports: "Use .js extensions for ESM"
    naming: "camelCase for functions, PascalCase for types"

  workflow:
    commits: "Imperative mood, signed-off"
    tests: "Required before merge"
    review: "Required for changes to canon/"

  boundaries:
    no_modify: ["CONTRACT.md", "*.schema.json"]
    require_approval: ["migrations/", "canon/"]
```

### Layer 3: Governance Primitives

```yaml
# .lex/governance/roles.yaml

roles:
  senior-dev:
    can:
      - implement
      - refactor
      - test
    cannot:
      - force-push
      - merge-to-main
      - modify-contracts
    uncertainty:
      max: 0.3
      escalate_to: human

  junior-dev:
    can:
      - lint
      - format
      - verify
    cannot:
      - implement-new-features
      - modify-architecture
    uncertainty:
      max: 0.1
      escalate_to: senior-dev
```

### Layer 4: Receipt Chain

```yaml
# .lex/receipts/2025-12-01/session-001.yaml

session:
  id: "session-001"
  date: "2025-12-01"
  models_used:
    - "gpt-4o (design)"
    - "claude-sonnet (implement)"
    - "claude-haiku (verify)"

receipts:
  - id: "rcpt-001"
    model: "gpt-4o"
    action: "design_auth_flow"
    outputs:
      - "docs/design/auth-flow.md"
      - ".lex/decisions/auth-approach.yaml"

  - id: "rcpt-002"
    model: "claude-sonnet"
    action: "implement_auth_flow"
    inputs:
      - "rcpt-001"  # References design receipt
    outputs:
      - "src/auth/flow.ts"
      - "src/auth/flow.test.ts"

  - id: "rcpt-003"
    model: "claude-haiku"
    action: "verify_auth_flow"
    inputs:
      - "rcpt-002"  # References implementation receipt
    outputs:
      - ".lex/reports/lint-auth.json"
      - ".lex/reports/test-auth.json"
```

---

## The Handoff Protocol

When switching models (or sessions), the incoming agent should:

### Step 1: Load Governance

```typescript
async function loadGovernance(): Promise<Governance> {
  return {
    vocabulary: await loadYaml('.lex/vocabulary.yaml'),
    contracts: await loadYaml('.lex/contracts/*.yaml'),
    roles: await loadYaml('.lex/governance/roles.yaml'),
    currentRole: await determineRole(context)
  };
}
```

### Step 2: Load Recent Receipts

```typescript
async function loadRecentContext(): Promise<Receipt[]> {
  const recentReceipts = await loadReceipts({
    since: 'session-start',  // or last N receipts
    related: context.currentTask
  });
  return recentReceipts;
}
```

### Step 3: Verify Understanding

```typescript
async function verifyHandoff(governance: Governance, receipts: Receipt[]): Promise<boolean> {
  // Generate understanding summary
  const summary = await generateSummary(governance, receipts);

  // Verify key concepts
  const checks = [
    verifyVocabulary(summary, governance.vocabulary),
    verifyConstraints(summary, governance.contracts),
    verifyReceipts(summary, receipts)
  ];

  return checks.every(c => c.passed);
}
```

### Step 4: Acknowledge and Continue

```typescript
async function acknowledgeHandoff(): Promise<void> {
  await createReceipt({
    action: "session_handoff",
    from: previousSession?.id,
    understood: {
      vocabulary: vocabularyTermsLoaded,
      contracts: contractsLoaded,
      recentReceipts: receiptsLoaded
    },
    ready: true
  });
}
```

---

## Cross-Model Task Patterns

### Pattern 1: Capability Tiering

```
Complex Design Task
├── GPT-4o/Claude Opus (Senior)
│   └── Architecture decisions, trade-off analysis
│
├── Claude Sonnet/GPT-4 (Mid)
│   └── Implementation, refactoring
│
└── Claude Haiku/GPT-3.5 (Junior)
    └── Linting, formatting, verification
```

Each tier reads the output of the previous tier through receipts.

### Pattern 2: Parallel Specialization

```
Large Implementation Task
├── Model A: Core logic
├── Model B: Test coverage
├── Model C: Documentation
└── Merge: Human review of parallel outputs
```

All models read the same initial contract; outputs are reconciled.

### Pattern 3: Failure Recovery

```
Task: Implement Feature
├── Model A: Attempt 1 (fails)
│   └── Receipt: failure with preserved state
│
├── Model B: Attempt 2 (different approach)
│   └── Reads Model A's failure receipt
│   └── Avoids same failure mode
│   └── Succeeds
```

Failure receipts prevent repeated mistakes across models.

### Pattern 4: Review Chain

```
Task: Code Review
├── Author Model: Creates PR
├── Reviewer Model: Reviews PR
│   └── Different model reduces confirmation bias
│   └── Reads same contracts, applies same standards
└── Merge: Human approves
```

Different models can review each other's work.

---

## Benefits of Externalized State

### Debuggability

When something goes wrong:
- Inspect the contracts
- Read the receipts
- Trace the decision chain
- Identify where understanding diverged

### Reproducibility

To reproduce a session:
- Load the same contracts
- Replay the same receipts
- Apply the same governance

### Portability

To move to a new provider:
- Export contracts and receipts
- Import to new environment
- Continue work

### Auditability

For compliance or review:
- Every decision is recorded
- Every action has a receipt
- Every constraint is explicit

---

## Failure Modes

### Failure Mode 1: Vocabulary Drift

**Problem:** Models interpret terms differently over time.

**Symptom:** Increasing miscommunication, renegotiation.

**Solution:** Explicit vocabulary registry, regular reconciliation.

### Failure Mode 2: Receipt Overload

**Problem:** Too many receipts to process efficiently.

**Symptom:** Long context load, high handoff cost.

**Solution:** Receipt summarization, relevance filtering, hierarchical organization.

### Failure Mode 3: Governance Staleness

**Problem:** Contracts don't reflect current project state.

**Symptom:** Agents following outdated rules.

**Solution:** Contract versioning, staleness gates, regular audits.

### Failure Mode 4: Handoff Amnesia

**Problem:** Incoming agent doesn't fully load context.

**Symptom:** Repeated mistakes, re-asking questions.

**Solution:** Handoff verification, mandatory acknowledgment.

---

## Implementation Checklist

For adding cross-model continuity to a project:

- [ ] Create vocabulary registry with key terms
- [ ] Document expectations as explicit contracts
- [ ] Define role-based governance primitives
- [ ] Establish receipt format and storage
- [ ] Implement handoff protocol
- [ ] Create handoff verification gate
- [ ] Test with actual model switches
- [ ] Measure handoff cost (tokens, time)
- [ ] Set up receipt summarization for long sessions
- [ ] Document failure recovery patterns

---

## Summary

Session state is not magic — it's explicit artifacts.

**The formula:**
```
Session State = Shared Language + Expectations + Governance + Receipts
```

**Key insight:** Different models can collaborate effectively when they share the same external state artifacts.

**Implementation:**
- Vocabulary registries for shared terms
- Contracts for expectations
- Role definitions for governance
- Receipt chains for history

**Benefit:** Cross-model handoff becomes cheaper than fresh same-model sessions.

---

*Next: [05-RULE-FILE-SPEC.md](./05-RULE-FILE-SPEC.md) — Machine-consumable governance contracts*
