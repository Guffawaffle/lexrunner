# 02 — Turn Cost: The Real Productivity Metric

> **TL;DR:** Productivity loss in agent workflows comes from turns, not tokens. Measure and minimize Turn Cost to maximize effective output.

---

## The Problem with Token-Centric Thinking

The AI industry measures everything in tokens:
- Cost per 1K tokens
- Context window in tokens
- Output quality per token

This made sense when the primary interface was chat. But for IDE-native agents doing real work, tokens are the wrong unit.

**What actually kills productivity:** The number of times the human has to intervene, re-orient, or wait.

---

## Defining "Turn"

A **Turn** is a complete cycle of:
1. Human provides input/context
2. Agent processes and acts
3. Human reviews and responds

A Turn is not:
- A single API call (an agent may make many calls per turn)
- A prompt/response pair (turns have semantic meaning beyond message exchange)
- A token count (turns can be token-light or token-heavy)

### Turn Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Semantic completeness** | A turn represents a coherent unit of work |
| **Bidirectional** | Requires both human input and agent output |
| **Bounded** | Has a clear beginning and end |
| **Measurable** | Duration, tokens, actions can be counted |

---

## Turn Cost Formula

```
TurnCost = Latency + ContextReset + PromptRenegotiation + TokenBloat + AttentionSwitch
```

### Component Definitions

#### Latency
The raw time waiting for the model to respond.

```yaml
latency:
  components:
    - network_roundtrip
    - inference_time
    - tool_execution
  measurement: milliseconds
  optimization: faster models, caching, parallelism
```

#### Context Reset
The cost of re-establishing context when switching sessions or models.

```yaml
context_reset:
  causes:
    - session expiry
    - model switch
    - context window overflow
    - platform context misalignment
  measurement: tokens_required_to_restore_context
  optimization: receipts, structured memory, governance contracts
```

#### Prompt Renegotiation
The cost of clarifying what you meant when the agent misunderstood.

```yaml
prompt_renegotiation:
  causes:
    - ambiguous instructions
    - missing context
    - unstated expectations
    - domain term confusion
  measurement: additional_turns_required
  optimization: explicit contracts, shared vocabulary, constraints
```

#### Token Bloat
Excessive tokens consumed due to poor coordination.

```yaml
token_bloat:
  causes:
    - repeating context already provided
    - verbose explanations of simple requirements
    - safety disclaimers irrelevant to task
    - generating code that already exists
  measurement: tokens_beyond_minimum_necessary
  optimization: tight context, codebase awareness, receipts
```

#### Attention Switch
The human cognitive cost of context-switching to manage the agent.

```yaml
attention_switch:
  causes:
    - waiting for agent (forced idle)
    - reviewing unexpected output
    - correcting misunderstandings
    - managing multiple agents
  measurement: human_time_overhead
  optimization: async workflows, high-confidence gates, clear escalation
```

---

## Why Turn Cost Matters More Than Token Cost

### Economic Argument

Consider two workflows:

**Workflow A: Low tokens, high turns**
- 10 turns per task
- 1,000 tokens per turn = 10,000 tokens total
- Token cost: $0.30 (at $0.03/1K)
- Human time: 50 minutes (5 min/turn)
- Effective cost: $0.30 + ($50/hr × 0.83 hr) = **$41.80**

**Workflow B: High tokens, low turns**
- 2 turns per task
- 8,000 tokens per turn = 16,000 tokens total
- Token cost: $0.48 (at $0.03/1K)
- Human time: 10 minutes (5 min/turn)
- Effective cost: $0.48 + ($50/hr × 0.17 hr) = **$8.98**

**Workflow B is 4.6x more economical despite using more tokens.**

### UX Argument

High-turn workflows feel terrible:
- Constant waiting
- Repeated explanations
- Endless corrections
- Mounting frustration

Low-turn workflows feel good:
- Agent works autonomously
- Human reviews completed chunks
- Corrections are rare
- Progress is visible

### Cognitive Load Argument

Each turn is an attention switch for the human. Attention switches have residue — mental state doesn't fully restore when you return. Many small turns accumulate cognitive debt faster than few large turns.

---

## Measuring Turn Cost

### RunReceipt Extension

We can extend the existing RunReceipt schema to capture Turn Cost:

```typescript
interface TurnCostMetrics {
  // Core timing
  turnCount: number;
  totalDuration: number;
  modelInferenceTime: number;

  // Component breakdown
  latencyMs: number;
  contextResetTokens: number;
  promptRenegotiationTurns: number;
  tokenBloatEstimate: number;
  attentionSwitchEvents: number;

  // Derived
  tokensPerTurn: number;
  effectiveTurnCost: number; // weighted sum of components
}
```

### Collection Points

| Metric | Collection Point | Method |
|--------|------------------|--------|
| Latency | API response | Timer start → Timer end |
| Context Reset | Session start | Tokens in system prompt |
| Prompt Renegotiation | Conversation history | Count of clarification messages |
| Token Bloat | Response analysis | Comparison to minimal response |
| Attention Switch | Human behavior | Idle time, edit frequency |

### Aggregation

```typescript
function computeTurnCost(metrics: TurnCostMetrics): number {
  // Weights can be tuned based on empirical data
  const weights = {
    latency: 0.2,
    contextReset: 0.25,
    promptRenegotiation: 0.3,
    tokenBloat: 0.1,
    attentionSwitch: 0.15
  };

  return (
    weights.latency * normalize(metrics.latencyMs) +
    weights.contextReset * normalize(metrics.contextResetTokens) +
    weights.promptRenegotiation * normalize(metrics.promptRenegotiationTurns) +
    weights.tokenBloat * normalize(metrics.tokenBloatEstimate) +
    weights.attentionSwitch * normalize(metrics.attentionSwitchEvents)
  );
}
```

---

## Optimizing Turn Cost

### Governance Reduces Context Reset

Without governance:
```
Turn 1: "I'm working on the auth system. We use OAuth2 with PKCE.
        The token store is in Redis. The API is REST-style..."
        [500 tokens of context]
```

With governance:
```
Turn 1: "Continue where we left off."
        [Agent reads Frame memory and contracts]
        [10 tokens from human, 200 tokens from memory]
```

**Context Reset reduction: 60%**

### Contracts Reduce Prompt Renegotiation

Without contracts:
```
Turn 1: Human: "Add a button"
Turn 2: Agent: "What kind of button?"
Turn 3: Human: "A submit button"
Turn 4: Agent: "What style?"
Turn 5: Human: "Just use our design system"
```

With contracts:
```yaml
# agent.contract.yaml
constraints:
  styling: "Follow existing patterns in components/ui/"
  components: "Import from @/components/ui"
```

```
Turn 1: Human: "Add a submit button"
        [Agent reads contract, applies constraints]
        [1 turn instead of 5]
```

**Prompt Renegotiation reduction: 80%**

### Receipts Reduce Token Bloat

Without receipts:
```
Turn 1: Agent: "I've completed the following changes:
        - Modified auth.ts (added login function)
        - Updated routes.ts (added /login route)
        - Created login.test.ts (unit tests)

        The login function works by taking a username and password,
        validating them against the database, generating a JWT token,
        and storing the session in Redis..."
        [1000 tokens of explanation]
```

With receipts:
```
Turn 1: Agent commits changes, creates receipt:
        {
          "action": "implement_login",
          "files_modified": ["auth.ts", "routes.ts"],
          "files_created": ["login.test.ts"],
          "receipt_id": "rcpt_abc123"
        }
        [100 tokens]
```

**Token Bloat reduction: 90%**

---

## Turn Cost as Esobench Target

Turn Cost is an ideal benchmark metric because it is:

### Measurable
Every component can be quantified in tokens, time, or counts.

### Economically Relevant
It directly correlates with real-world productivity costs.

### UX-Indicative
It captures the subjective experience of working with an agent.

### Model-Agnostic
Works across providers and model versions.

### Improvable
Clear optimization targets for each component.

### Proposed Esobench Dimensions

```yaml
esobench_turn_cost:
  dimensions:
    - name: context_efficiency
      description: "How well does the agent use existing context?"
      measurement: tokens_required_for_context_restoration

    - name: instruction_clarity
      description: "How few clarification turns are needed?"
      measurement: renegotiation_turn_count

    - name: output_efficiency
      description: "How concise is the agent's output?"
      measurement: output_tokens_vs_minimal_tokens

    - name: handoff_cost
      description: "How expensive is switching models mid-task?"
      measurement: context_reset_after_switch
```

---

## Implementation in LexRunner

### Telemetry Collection

```typescript
// src/metrics/turn-cost.ts

interface TurnEvent {
  turnId: string;
  sessionId: string;
  timestamp: Date;
  modelId: string;

  // Timing
  startTime: number;
  endTime: number;

  // Tokens
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;

  // Classification
  isRenegotiation: boolean;
  isContextReset: boolean;
  requiresHumanReview: boolean;
}

class TurnCostCollector {
  private events: TurnEvent[] = [];

  recordTurn(event: TurnEvent): void {
    this.events.push(event);
  }

  computeSessionMetrics(): TurnCostMetrics {
    // Aggregate events into session-level metrics
  }
}
```

### Gate Integration

```typescript
// Turn cost as a gate
const turnCostGate: Gate = {
  name: "turn-cost",
  run: async (context) => {
    const metrics = context.turnCostCollector.computeSessionMetrics();

    if (metrics.effectiveTurnCost > context.policy.turnCostThreshold) {
      return {
        status: "warn",
        message: `Turn cost ${metrics.effectiveTurnCost} exceeds threshold`,
        data: metrics
      };
    }

    return { status: "pass", data: metrics };
  }
};
```

### Reporting

```typescript
// PR comment format
function formatTurnCostReport(metrics: TurnCostMetrics): string {
  return `
## Turn Cost Report

| Metric | Value | Status |
|--------|-------|--------|
| Turn Count | ${metrics.turnCount} | ${status(metrics.turnCount, 'turns')} |
| Context Reset | ${metrics.contextResetTokens} tokens | ${status(...)} |
| Renegotiation | ${metrics.promptRenegotiationTurns} turns | ${status(...)} |
| Token Efficiency | ${(100 - metrics.tokenBloatEstimate).toFixed(1)}% | ${status(...)} |
| Attention Switches | ${metrics.attentionSwitchEvents} | ${status(...)} |
| **Effective Turn Cost** | **${metrics.effectiveTurnCost.toFixed(2)}** | ${status(...)} |
  `;
}
```

---

## Practical Guidelines

### Target Metrics

For a typical implementation task:

| Metric | Good | Acceptable | Poor |
|--------|------|------------|------|
| Turns per PR | 2-3 | 4-5 | 6+ |
| Tokens per turn | 2000-4000 | 4000-8000 | 8000+ |
| Renegotiation rate | <10% | 10-25% | >25% |
| Context reset | <300 tokens | 300-600 | >600 |

### Warning Signs

- **Rising renegotiation rate:** Contracts may be unclear or incomplete
- **High context reset:** Memory/receipts not being used effectively
- **Many short turns:** Agent may be under-powered for task complexity
- **Few long turns with errors:** Agent may be over-confident

### Optimization Priority

1. **First:** Reduce Prompt Renegotiation (biggest ROI)
2. **Second:** Reduce Context Reset (biggest long-term benefit)
3. **Third:** Reduce Token Bloat (easy wins)
4. **Fourth:** Reduce Latency (often out of our control)
5. **Fifth:** Reduce Attention Switch (hardest to measure)

---

## Summary

Turn Cost is the metric that actually matters for agent productivity.

**Formula:** `TurnCost = Latency + ContextReset + PromptRenegotiation + TokenBloat + AttentionSwitch`

**Insight:** High-token, low-turn workflows beat low-token, high-turn workflows economically and experientially.

**Optimization:** Governance, contracts, and receipts reduce every component of Turn Cost.

**Benchmark:** Turn Cost is ideal for Esobench because it's measurable, economically relevant, UX-indicative, and improvable.

---

*Next: [03-PERMISSION-TO-FAIL.md](./03-PERMISSION-TO-FAIL.md) — How to encode productive failure*
