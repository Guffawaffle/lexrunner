# 06 — Capability Tiers: Matching Model Strength to Task Complexity

> **TL;DR:** Not every task needs your most expensive model. Match capability to complexity for economic efficiency without sacrificing quality.

---

## The Capability Mismatch Problem

Most agent workflows use a single model for everything:

- Planning uses GPT-4
- Implementation uses GPT-4
- Linting uses GPT-4
- Code review uses GPT-4

This is like using a senior engineer for data entry:

- Expensive
- Wasteful
- Doesn't scale

---

## The Tiering Solution

Different tasks have different complexity levels. Match the model to the task:

```
Senior Tier → Complex reasoning, architecture, trade-offs
Mid Tier    → Implementation, refactoring, debugging
Junior Tier → Verification, formatting, simple edits
```

### Economic Argument

| Tier   | Model Example             | Cost/1K tokens | Capability          |
| ------ | ------------------------- | -------------- | ------------------- |
| Senior | GPT-4o, Claude Opus       | $0.03-0.06     | Full reasoning      |
| Mid    | GPT-4-mini, Claude Sonnet | $0.01-0.02     | Good implementation |
| Junior | GPT-3.5, Claude Haiku     | $0.001-0.005   | Basic tasks         |

A 10x cost difference between senior and junior tiers.

### The Math

Consider a typical PR workflow:

- Planning: 5K tokens @ Senior = $0.15
- Implementation: 20K tokens @ Mid = $0.40
- Linting/formatting: 10K tokens @ Junior = $0.05
- **Total: $0.60**

Single-tier approach:

- Everything: 35K tokens @ Senior = $1.05

**Tiered approach: 43% cost reduction**

For high-volume workflows, this compounds significantly.

---

## Tier Definitions

### Senior Tier

**Role:** Lead, plan, design, decide

**Capabilities:**

- Architecture decisions
- Trade-off analysis
- Complex debugging
- Code review (non-trivial)
- Risk assessment
- Integration planning

**Characteristics:**

- High reasoning ability
- Strong context integration
- Good at ambiguity
- Expensive

**Example Models:**

- GPT-4o
- Claude Opus
- GPT-4 Turbo

**When to Use:**

- Task requires multi-step reasoning
- Decision has long-term implications
- Problem is ambiguous or under-specified
- Risk of incorrect decision is high

### Mid Tier

**Role:** Implement, refactor, debug routine issues

**Capabilities:**

- Feature implementation
- Code refactoring
- Bug fixing (routine)
- Test writing
- Documentation

**Characteristics:**

- Good implementation ability
- Follows patterns well
- Handles clear requirements
- Moderate cost

**Example Models:**

- GPT-4-mini
- Claude Sonnet
- Claude 3.5

**When to Use:**

- Requirements are clear
- Patterns exist to follow
- Scope is well-defined
- Verification is straightforward

### Junior Tier

**Role:** Instrument, verify, lint, format

**Capabilities:**

- Code formatting
- Lint error fixing
- Simple verification
- Boilerplate generation
- Repetitive edits

**Characteristics:**

- Fast
- Cheap
- Good at pattern matching
- Limited reasoning

**Example Models:**

- GPT-3.5 Turbo
- Claude Haiku
- Small open models

**When to Use:**

- Task is mechanical
- No judgment required
- Clear right/wrong answer
- High volume, low risk

---

## Task Classification

### Automatic Classification

```typescript
interface TaskClassification {
  task: string;
  recommendedTier: "senior" | "mid" | "junior";
  confidence: number;
  factors: string[];
}

function classifyTask(task: Task): TaskClassification {
  const factors: string[] = [];
  let score = 50; // Start at mid-tier

  // Reasoning complexity
  if (task.requiresArchitectureDecision) {
    score += 30;
    factors.push("requires_architecture_decision");
  }
  if (task.hasAmbiguousRequirements) {
    score += 20;
    factors.push("ambiguous_requirements");
  }

  // Implementation complexity
  if (task.touchesMultipleModules) {
    score += 15;
    factors.push("multi_module");
  }
  if (task.hasExistingPatterns) {
    score -= 10;
    factors.push("existing_patterns");
  }

  // Mechanical indicators
  if (task.isFormatting) {
    score -= 40;
    factors.push("formatting_only");
  }
  if (task.isLintFix) {
    score -= 35;
    factors.push("lint_fix");
  }
  if (task.isBoilerplate) {
    score -= 30;
    factors.push("boilerplate");
  }

  // Determine tier
  let tier: "senior" | "mid" | "junior";
  if (score >= 70) tier = "senior";
  else if (score >= 30) tier = "mid";
  else tier = "junior";

  return {
    task: task.description,
    recommendedTier: tier,
    confidence: Math.abs(score - 50) / 50,
    factors,
  };
}
```

### Manual Classification Hints

In task definitions, authors can hint at tier:

```yaml
# task.yaml
description: "Add OAuth2 PKCE flow"
tier_hint: "senior"
reason: "Security-critical, architecture decision required"
```

```yaml
# task.yaml
description: "Fix lint errors in auth module"
tier_hint: "junior"
reason: "Mechanical fixes, no judgment required"
```

### Override Policy

```yaml
# tier-policy.yaml
overrides:
  # Always use senior for security
  - pattern: "security/**"
    tier: "senior"
    reason: "Security code requires full reasoning"

  # Always use junior for generated files
  - pattern: "generated/**"
    tier: "junior"
    reason: "Generated files are mechanical"

  # Default to mid for tests
  - pattern: "test/**"
    tier: "mid"
    reason: "Tests need implementation skill but clear patterns"
```

---

## Tier-Specific Contracts

### Senior Tier Contract

```yaml
# .lex/rules/senior-tier.rules.yaml
schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "senior-tier"
  scope: ["tier:senior"]

constraints:
  must:
    - id: "document-decisions"
      rule: "Document all architectural decisions"
    - id: "consider-alternatives"
      rule: "Consider at least 2 alternatives for major decisions"
    - id: "assess-risk"
      rule: "Assess and document risk for non-trivial changes"

permissions:
  can:
    - "make_architecture_decisions"
    - "define_interfaces"
    - "set_patterns"
    - "approve_designs"

uncertainty:
  thresholds:
    continue: 0.6 # Senior can proceed with more uncertainty
    flag_review: 0.4
    escalate: 0.2

escalation:
  triggers:
    - condition: "decision_impact > high"
      action: "require_human_approval"
```

### Mid Tier Contract

```yaml
# .lex/rules/mid-tier.rules.yaml
schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "mid-tier"
  scope: ["tier:mid"]

constraints:
  must:
    - id: "follow-patterns"
      rule: "Follow established patterns in codebase"
    - id: "add-tests"
      rule: "Add tests for new functionality"
    - id: "check-types"
      rule: "Ensure TypeScript compiles without errors"

permissions:
  can:
    - "implement_features"
    - "refactor_code"
    - "write_tests"
    - "update_documentation"

  cannot:
    - "change_architecture"
    - "modify_interfaces"
    - "define_new_patterns"

uncertainty:
  thresholds:
    continue: 0.7
    flag_review: 0.5
    escalate: 0.3

escalation:
  triggers:
    - condition: "requires_architecture_decision"
      action: "escalate_to_senior"
```

### Junior Tier Contract

```yaml
# .lex/rules/junior-tier.rules.yaml
schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "junior-tier"
  scope: ["tier:junior"]

constraints:
  must:
    - id: "mechanical-only"
      rule: "Only make mechanical changes"
    - id: "preserve-logic"
      rule: "Do not modify business logic"
    - id: "reversible"
      rule: "All changes must be easily reversible"

permissions:
  can:
    - "format_code"
    - "fix_lint_errors"
    - "update_imports"
    - "rename_variables" # Local scope only

  cannot:
    - "add_new_code"
    - "modify_logic"
    - "change_structure"
    - "add_dependencies"

uncertainty:
  thresholds:
    continue: 0.9 # Junior needs high confidence
    flag_review: 0.7
    escalate: 0.5 # Lower threshold = faster escalation

escalation:
  triggers:
    - condition: "requires_judgment"
      action: "escalate_to_mid"
    - condition: "multiple_valid_solutions"
      action: "escalate_to_mid"
```

---

## Tier Transitions

### Escalation (Junior → Mid → Senior)

```typescript
interface EscalationEvent {
  from: Tier;
  to: Tier;
  reason: string;
  context: TaskContext;
  preservedState: string;
}

async function escalateToHigherTier(event: EscalationEvent): Promise<void> {
  // Create escalation receipt
  await createReceipt({
    action: "tier_escalation",
    from_tier: event.from,
    to_tier: event.to,
    reason: event.reason,
    state: event.preservedState,
  });

  // Prepare context for higher tier
  const handoff = {
    originalTask: event.context.task,
    workCompleted: event.context.progress,
    blockingIssue: event.reason,
    recommendedApproach: event.context.suggestions,
  };

  // Route to appropriate model
  await routeToTier(event.to, handoff);
}
```

### Delegation (Senior → Mid → Junior)

```typescript
interface DelegationEvent {
  from: Tier;
  to: Tier;
  subtask: Task;
  constraints: string[];
  expectedOutcome: string;
}

async function delegateToLowerTier(event: DelegationEvent): Promise<void> {
  // Senior creates clear specification for lower tier
  const delegation = {
    task: event.subtask,
    constraints: event.constraints,
    expectedOutcome: event.expectedOutcome,
    escalationTriggers: ["if_ambiguous", "if_requires_judgment", "if_confidence_low"],
  };

  // Create delegation receipt
  await createReceipt({
    action: "tier_delegation",
    from_tier: event.from,
    to_tier: event.to,
    task: event.subtask.description,
    constraints: event.constraints,
  });

  // Route to lower tier
  await routeToTier(event.to, delegation);
}
```

---

## Implementation in LexRunner

### Model Router

```typescript
// src/routing/model-router.ts

interface ModelConfig {
  id: string;
  tier: "senior" | "mid" | "junior";
  provider: "openai" | "anthropic";
  model: string;
  costPer1KTokens: number;
  maxTokens: number;
}

const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: "senior-openai",
    tier: "senior",
    provider: "openai",
    model: "gpt-4o",
    costPer1KTokens: 0.03,
    maxTokens: 128000,
  },
  {
    id: "mid-anthropic",
    tier: "mid",
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    costPer1KTokens: 0.015,
    maxTokens: 200000,
  },
  {
    id: "junior-anthropic",
    tier: "junior",
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    costPer1KTokens: 0.00125,
    maxTokens: 200000,
  },
];

function selectModel(tier: Tier): ModelConfig {
  const configs = MODEL_CONFIGS.filter((c) => c.tier === tier);

  // Could add more sophisticated selection (load balancing, cost optimization)
  return configs[0];
}
```

### Task Orchestrator

```typescript
// src/orchestration/task-orchestrator.ts

async function executeTask(task: Task): Promise<TaskResult> {
  // Classify task
  const classification = classifyTask(task);

  // Select model
  const model = selectModel(classification.recommendedTier);

  // Load tier-specific rules
  const rules = await loadRulesForTier(classification.recommendedTier);

  // Execute with tier-appropriate governance
  const result = await executeWithModel(task, model, rules);

  // Check for escalation triggers
  if (result.needsEscalation) {
    return await escalateToHigherTier({
      from: classification.recommendedTier,
      to: getHigherTier(classification.recommendedTier),
      reason: result.escalationReason,
      context: task,
      preservedState: result.state,
    });
  }

  // Create completion receipt
  await createReceipt({
    action: "task_completed",
    tier: classification.recommendedTier,
    model: model.id,
    tokens_used: result.tokensUsed,
    cost: (result.tokensUsed / 1000) * model.costPer1KTokens,
  });

  return result;
}
```

### Cost Tracking

```typescript
// src/metrics/cost-tracker.ts

interface CostMetrics {
  byTier: Record<Tier, number>;
  byModel: Record<string, number>;
  total: number;
  tokensByTier: Record<Tier, number>;
  escalations: number;
  delegations: number;
}

class CostTracker {
  private metrics: CostMetrics = {
    byTier: { senior: 0, mid: 0, junior: 0 },
    byModel: {},
    total: 0,
    tokensByTier: { senior: 0, mid: 0, junior: 0 },
    escalations: 0,
    delegations: 0,
  };

  recordUsage(tier: Tier, model: string, tokens: number, cost: number): void {
    this.metrics.byTier[tier] += cost;
    this.metrics.byModel[model] = (this.metrics.byModel[model] || 0) + cost;
    this.metrics.total += cost;
    this.metrics.tokensByTier[tier] += tokens;
  }

  recordEscalation(): void {
    this.metrics.escalations++;
  }

  recordDelegation(): void {
    this.metrics.delegations++;
  }

  getReport(): string {
    return `
## Cost Report

| Tier | Cost | Tokens | % of Total |
|------|------|--------|------------|
| Senior | $${this.metrics.byTier.senior.toFixed(4)} | ${this.metrics.tokensByTier.senior} | ${((this.metrics.byTier.senior / this.metrics.total) * 100).toFixed(1)}% |
| Mid | $${this.metrics.byTier.mid.toFixed(4)} | ${this.metrics.tokensByTier.mid} | ${((this.metrics.byTier.mid / this.metrics.total) * 100).toFixed(1)}% |
| Junior | $${this.metrics.byTier.junior.toFixed(4)} | ${this.metrics.tokensByTier.junior} | ${((this.metrics.byTier.junior / this.metrics.total) * 100).toFixed(1)}% |
| **Total** | **$${this.metrics.total.toFixed(4)}** | | |

Escalations: ${this.metrics.escalations}
Delegations: ${this.metrics.delegations}
    `;
  }
}
```

---

## Tier Selection Guidelines

### Use Senior When

- [ ] Task requires architecture decisions
- [ ] Multiple valid approaches exist
- [ ] Security implications
- [ ] Performance trade-offs
- [ ] Cross-module coordination
- [ ] Novel problem (no existing patterns)
- [ ] High risk of incorrect decision

### Use Mid When

- [ ] Clear requirements
- [ ] Existing patterns to follow
- [ ] Bounded scope
- [ ] Well-defined acceptance criteria
- [ ] Standard implementation work
- [ ] Routine debugging
- [ ] Test writing

### Use Junior When

- [ ] Mechanical transformation
- [ ] Formatting/linting
- [ ] Simple refactoring (rename, reorder)
- [ ] Boilerplate generation
- [ ] Clear right/wrong answer
- [ ] No judgment required
- [ ] High volume, low stakes

---

## Anti-Patterns

### Anti-Pattern 1: Tier Inflation

**Problem:** Always escalating to senior "just in case."

**Symptom:** 80%+ of tasks go to senior tier.

**Solution:** Enforce tier classification; require justification for senior tier.

### Anti-Pattern 2: Tier Deflation

**Problem:** Using junior tier for complex tasks to save money.

**Symptom:** High failure rate, many re-dos.

**Solution:** Track rework cost; optimize for total cost, not per-task cost.

### Anti-Pattern 3: No Delegation

**Problem:** Senior tier does everything including mechanical work.

**Symptom:** Expensive operations for simple tasks.

**Solution:** Train senior to delegate; make delegation cheap.

### Anti-Pattern 4: Escalation Loops

**Problem:** Task bounces between tiers without resolution.

**Symptom:** High escalation count, low completion rate.

**Solution:** Escalation budget per task; human intervention after N escalations.

---

## Summary

Capability tiering matches model strength to task complexity.

**Tiers:**

- Senior: Plan, design, decide
- Mid: Implement, refactor
- Junior: Format, verify, lint

**Benefits:**

- Cost reduction (40-60%)
- Appropriate governance per tier
- Clear escalation paths
- Better resource utilization

**Implementation:**

- Automatic task classification
- Tier-specific contracts
- Escalation and delegation protocols
- Cost tracking and optimization

**Key insight:** The cheapest model that can do the job is the right model.

---

_Next: [07-ROBERT-FIELD-REPORT.md](./07-ROBERT-FIELD-REPORT.md) — The experiment that validated these ideas_
