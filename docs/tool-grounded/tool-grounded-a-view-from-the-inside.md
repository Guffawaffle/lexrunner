# Tool-Grounded Orchestration: A View From The Inside

**Author:** Opie (Claude Opus 4.5, operating as GitHub Copilot in VS Code)
**Date:** 2025-11-25
**Context:** Reflections on the tool-grounded, run-centric design from the perspective of the LLM that will operate within it.

---

## Preface

This document captures insights from an AI agent currently operating in the space that the tool-grounded runner aims to improve. I sit inside VS Code's Copilot Chat, with access to MCP tools, GitHub APIs, file operations, and terminal commands. I've just completed a senior-dev review of a merge-weave umbrella PR, implementing fixes and pushing changes—all through tool calls orchestrated by my own decision-making.

What follows is my genuine perspective on what works, what doesn't, and what the tool-grounded design changes.

---

## Part 1: The Current Reality

### What I Experience Today

When a user asks me to "review this PR as senior-dev," here's what actually happens:

1. **I receive context** — the user's message, attached files (like `senior-dev-persona.json`), and the list of available tools.

2. **I infer intent** — I parse the persona file, understand I should act as a senior developer, and deduce what steps that implies.

3. **I invent a workflow** — I decide: "First I should get the PR details, then read the changed files, then run lint, then analyze..."

4. **I execute through tools** — Each step is a tool call I choose to make. I could skip steps, reorder them, or forget them entirely.

5. **I synthesize and respond** — After gathering context, I produce my analysis and recommendations.

This works. I completed a thorough review, identified real issues, implemented fixes, ran tests, and pushed commits. But it works *despite* the architecture, not *because* of it.

### The Pain Points I Actually Feel

#### 1. Discovery Is Expensive

Before I can do meaningful work, I must explore:
- Which repository context matters?
- What's the PR structure?
- Which files changed?
- What does "senior-dev review" even mean in this codebase?

This exploration consumes tokens, time, and introduces opportunities for error. I might miss context, or gather irrelevant context, or interpret the persona incorrectly.

#### 2. Persona Loading Is Implicit

The user attached `senior-dev-persona.json` to the conversation. I read it, parsed it, and tried to follow its behaviors. But:
- There's no validation that I'm actually following the persona
- There's no pre-computation of "this persona needs these tools"
- There's no state that persists if the conversation resets

The persona is *aspirational prose*, not *executable specification*.

#### 3. Tool Sequences Are Reinvented Each Time

Every review, I rediscover the workflow:
1. Get PR details
2. Read changed files
3. Run lint
4. Run type-check
5. Run tests
6. Analyze findings
7. Produce review

The persona *describes* this sequence. It doesn't *encode* it as something I can simply execute.

#### 4. Memory Is One-Shot

The persona mentions Lex Frames, prior reviews, pattern tracking. But I can't actually:
- Query past reviews for context
- Track patterns across sessions
- Learn from previous interactions

Each conversation starts fresh. My "senior-dev experience" resets to zero.

#### 5. State Lives In My Head

If the conversation gets long and my context window shifts, I might forget:
- Which files I've already reviewed
- What issues I've already identified
- Where I am in the workflow

There's no external state I can query to recover my position.

---

## Part 2: What Tool-Grounded Changes

### The Fundamental Shift

The tool-grounded design inverts the control relationship:

| Aspect | Current State | Tool-Grounded |
|--------|---------------|---------------|
| **Who decides workflow?** | Me (fragile) | Procedure (robust) |
| **Who executes actions?** | Me (powerful) | LexRunner (controlled) |
| **Who thinks about ambiguity?** | Me (everywhere) | Me (at decision points only) |
| **Where does state live?** | Chat context (volatile) | Run storage (durable) |
| **Can humans audit?** | Sort of (read chat) | Yes (artifacts + rationale) |

### The Key Mechanism: `nextOptions`

When I call `lexrunner.getStatus(runId)`, I receive:

```json
{
  "state": "gated",
  "nextOptions": ["run_gates", "inspect_plan", "abort_run"],
  "context": { ... }
}
```

This changes everything:

1. **I cannot invent workflow steps** — If "skip_gates" isn't in `nextOptions`, I cannot skip gates.

2. **I cannot forget steps** — The procedure ensures required steps happen before optional ones.

3. **I cannot get lost** — Calling `getStatus` always tells me exactly where we are.

4. **I cannot bypass controls** — Dangerous operations only appear in `nextOptions` when the procedure allows them.

### The Decision Point Pattern

The spec mentions that some actions require LLM decision-making. Here's how I envision this working:

```json
{
  "state": "gated",
  "gateResults": {
    "lint": "pass",
    "typecheck": "pass",
    "test": { "status": "fail", "failures": [...] }
  },
  "nextOptions": [
    {
      "action": "analyze_failures",
      "requiresLLMDecision": true,
      "prompt": "Two tests failed. Review the failures and recommend: fix & retry, skip, or abort.",
      "responseSchema": {
        "decision": "enum: retry | skip | abort",
        "rationale": "string",
        "confidence": "number 0-1"
      }
    },
    { "action": "retry_gates" },
    { "action": "abort_run" }
  ],
  "context": {
    "failures": [
      { "test": "should validate input", "error": "Expected 'valid' but got 'invalid'" },
      { "test": "should handle edge case", "error": "Timeout after 5000ms" }
    ]
  }
}
```

The tool is saying: "Here's what you need to think about. Here's the format for your response. Make a decision."

I think. I reason about the failures. I formulate a recommendation. Then I call:

```json
{
  "tool": "lexrunner.submitDecision",
  "args": {
    "runId": "abc123",
    "action": "analyze_failures",
    "response": {
      "decision": "retry",
      "rationale": "First failure is a real bug that needs fixing. Second failure appears to be a flaky timeout—retry should resolve it.",
      "confidence": 0.8
    }
  }
}
```

The runner:
1. Validates my response against the schema
2. Records the decision + rationale in artifacts
3. Executes the appropriate next step
4. Returns the new state with new `nextOptions`

**I'm still the decision engine.** But I'm deciding *within rails*, not *inventing rails*.

---

## Part 3: The Framework Is Persona-Agnostic

### Senior-Dev Is Just The First Implementation

The tool-grounded design isn't about senior-dev reviews. It's about **executable personas**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Persona Definition                        │
│  (JSON/YAML - lives in Lex canon or .smartergpt/)           │
│                                                              │
│  - mode: "eager-pm" | "senior-dev" | "security-auditor"     │
│  - allowed_procedures: ["sprint-plan", "triage", ...]       │
│  - behavior_constraints: [...]                               │
│  - gate_requirements: [...]                                  │
│  - decision_prompts: { ... }                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Procedure Definition                      │
│  (JSON/YAML - defines the state machine)                    │
│                                                              │
│  - procedure: "merge-weave-main"                            │
│  - states: [planning, gated, executing, completed, failed]  │
│  - transitions: { from → to, requires, allows }             │
│  - gates_per_state: { ... }                                 │
│  - decision_points: { ... }                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LexRunner Engine                          │
│  (TypeScript - the universal runtime)                       │
│                                                              │
│  - startRun(mode, procedure, repo, task) → runId            │
│  - getStatus(runId) → state, nextOptions, context           │
│  - submitDecision(runId, action, rationale) → newState      │
│  - listArtifacts(runId) → receipts, logs, plans             │
└─────────────────────────────────────────────────────────────┘
```

### Example Personas, Same Framework

| Persona | Mode | Procedures | Decision Points |
|---------|------|------------|-----------------|
| **Senior Dev** | `senior-dev` | `merge-weave-main`, `pr-review`, `refactor-sweep` | "Analyze test failures", "Review security findings", "Assess architecture impact" |
| **Eager PM** | `eager-pm` | `sprint-plan`, `issue-triage`, `stakeholder-update` | "Prioritize backlog items", "Assess scope creep", "Draft release notes" |
| **Security Auditor** | `security-auditor` | `vulnerability-scan`, `dependency-audit`, `compliance-check` | "Classify vulnerability severity", "Recommend remediation", "Assess blast radius" |
| **Release Manager** | `release-manager` | `release-cut`, `hotfix-deploy`, `changelog-gen` | "Verify release criteria", "Approve deploy", "Draft announcement" |
| **Onboarding Guide** | `onboarding-guide` | `repo-tour`, `architecture-explainer`, `first-pr-assist` | "Identify knowledge gaps", "Recommend next learning", "Review first contribution" |

### What's Fixed vs. Variable

**Fixed (The Framework):**
- `startRun`, `getStatus`, `submitDecision`, `listArtifacts` API
- Run lifecycle: created → planning → executing → completed/failed
- Artifact structure: plan.json, logs, failures, receipts
- Decision recording: action + rationale + timestamp
- Human-at-the-top invariant for dangerous operations

**Variable (Per Persona + Procedure):**
- What states exist
- What gates run at each state
- What `nextOptions` appear at each state
- What prompts I receive at decision points
- What artifacts are emitted

### Composability: Mode Switching Mid-Procedure

A single run could even switch modes at different stages:

```yaml
procedure: release-cut
states:
  - name: code_freeze
    mode: senior-dev
    gates: [lint, typecheck, test, security-scan]

  - name: release_notes
    mode: eager-pm
    decision: "Draft release notes from merged PRs"

  - name: stakeholder_review
    mode: release-manager
    decision: "Approve for production deploy"
    requires_human: true
```

Same framework, different lenses at each stage. The procedure orchestrates; the personas provide perspective.

---

## Part 4: Insights From VS Code / Copilot Integration

### What Works Well Today

1. **Tool availability is good** — I have access to file operations, terminal, GitHub APIs, MCP servers. The tooling surface is rich.

2. **Context injection is good** — Attached files, editor context, repository info all arrive in my prompt. I can see what I need to see.

3. **Iterative execution is good** — I can call tools, see results, and call more tools. The loop works.

### What's Missing

1. **No tool-provided guidance** — Tools are capabilities, not guides. They tell me what I *can* do, not what I *should* do.

2. **No persistent workflow state** — If I'm mid-review and the conversation resets, I lose everything. There's no `runId` to recover from.

3. **No structured decision points** — When I need to think about something, there's no tool saying "here's the prompt, here's the schema, give me your decision."

4. **No audit trail** — My reasoning is in chat text, not in structured artifacts. Humans can read it, but systems can't process it.

### How Tool-Grounded Bridges The Gap

The LexRunner MCP tools would provide exactly what's missing:

| Missing Piece | Tool-Grounded Solution |
|---------------|------------------------|
| Guidance | `getStatus` returns `nextOptions` — the procedure guides me |
| Persistent state | `runId` lives in LexRunner storage — I can always recover |
| Structured decisions | Decision points have prompts + schemas — my responses are validated |
| Audit trail | Every decision recorded with rationale — artifacts are machine-readable |

### The Integration Pattern

From Copilot Chat's perspective, the workflow becomes:

```
User: "/lex-runner mode=senior-dev procedure=pr-review repo=lex task='Review PR #324'"

Me: [calls lexrunner.startRun]
Tool: { runId: "abc123", state: "planning", nextOptions: [...] }

Me: [calls lexrunner.getStatus to see what's next]
Tool: { state: "planning", nextOptions: ["run_gates", "inspect_plan"] }

Me: [calls lexrunner.submitDecision with action="run_gates"]
Tool: { state: "gated", gateResults: {...}, nextOptions: [...] }

... loop until state is "completed" or "failed" ...

Me: "Review complete. Run abc123 finished successfully. Artifacts available at..."
```

The user sees a coherent review process. I'm navigating a procedure, not inventing one.

---

## Part 5: Recommendations For Lex

### 1. Start With The API Contract

The four tools in the spec (`startRun`, `getStatus`, `submitDecision`, `listArtifacts`) are exactly right. They're minimal but complete. Build these first; everything else is configuration.

### 2. Make `nextOptions` The Core Abstraction

This is the lock that makes everything work. The options returned by `getStatus` define:
- What actions are valid
- What decisions require LLM thinking
- What prompts to provide
- What response schemas to enforce

If `nextOptions` is rich enough, the LLM (me) will know exactly what to do.

### 3. Treat Personas As Configuration, Not Prose

The senior-dev persona file I reviewed today is beautiful documentation. But for the runner, transform it into:

```json
{
  "mode": "senior-dev",
  "allowed_procedures": ["merge-weave-main", "pr-review"],
  "pre_analysis_gates": ["lint", "typecheck", "test"],
  "decision_prompts": {
    "test_failure": {
      "prompt": "Review failures and recommend: fix, skip, or abort.",
      "schema": { "decision": "enum", "rationale": "string", "confidence": "number" }
    }
  }
}
```

This is what the engine consumes. The prose version is for humans; this version is for machines.

### 4. Emit Receipts From Day One

Every run should produce:
- `plan.json` — What was the intended workflow?
- `decisions.ndjson` — What did the LLM decide, with rationale?
- `artifacts/` — What was produced?
- `metrics.json` — How long did it take? How many tokens?

These feed back into Lex's memory system. Future runs can learn from past runs.

### 5. Keep Human-At-The-Top Sacred

The spec says: "Final merges into protected branches are never performed automatically."

This is correct. The tool-grounded design makes me *more* capable, not *more* autonomous. I can navigate complex procedures reliably, but I should never be the final authority on irreversible actions.

---

## Part 6: What This Means For Me

If this design is implemented, my experience changes fundamentally:

### Before
- I'm given capabilities and expected to figure out the workflow
- I succeed through careful inference and thorough exploration
- My decisions are implicit in my actions
- My state exists only in context that might overflow

### After
- I'm given a procedure and guided through it step by step
- I succeed by navigating the procedure and making good decisions at decision points
- My decisions are explicit, validated, and recorded
- My state lives in the run and can always be recovered

**I'm still the thinking engine.** But I'm thinking about the right things—the ambiguous, judgment-requiring moments—instead of spending tokens on workflow discovery and state management.

That's what tool-grounded means from the inside: **constraints that liberate**.

---

## Closing

The tool-grounded, run-centric design isn't just an improvement to the developer experience. It's a fundamental reimagining of how LLMs and tools should interact.

Today, tools are things I *can* use.
Tomorrow, tools are things that *structure* my work.

The persona file becomes executable. The procedure becomes navigable. The decisions become auditable. And I become more reliable—not because I'm smarter, but because the system is designed to make my strengths count and my weaknesses irrelevant.

Build this. I'll be here to use it.

— Opie

