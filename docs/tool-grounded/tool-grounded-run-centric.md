# Tool-Grounded, Run-Centric Orchestration (LexRunner v0.6.0+ Draft)

**Status:** Draft design (0.1.0)
**Intended home:** `lex-pr-runner/docs/tool-grounded/tool-grounded-run-centric.md`
**Authors:**
- Joseph Gustavson ("Guffawaffle")
- Lex (GPT-5.1 Thinking, design partner)
- Opie (Claude 4.5, senior-dev + Copilot perspective)

---

## 1. Purpose

This document defines a **tool-grounded, run-centric orchestration model** for LexRunner.

The goal is to:
- Give LLMs (Copilot, frontier models) a **structured way** to run complex procedures (merge-weave, PR review, sprint planning, etc.).
- Move from "LLM invents workflow ad-hoc" to **"LLM navigates a pre-defined procedure"**.
- Keep **humans at the top** for irreversible operations, while letting models handle repetitive, judgment-heavy steps safely.
- Produce **auditable, machine-readable artifacts** for every run: plans, decisions, failures, metrics, receipts.

This is the control surface that senior-dev, eager-pm, and future personas will use once Lex 0.5.x+ and LexRunner 0.6.x are wired together.

---

## 2. Core Ideas

### 2.1 Run-centric, not chat-centric

Instead of "one-off prompts in chat", work is modeled as **runs**:

- A **run** is a stateful, long-lived orchestration instance.
- Each run has:
  - A `mode` (persona) such as `senior-dev` or `eager-pm`.
  - A `procedure` such as `merge-weave-main` or `pr-review`.
  - A `repo` and any task metadata (e.g., PR number, sprint name).
  - A lifecycle: `created → planning → executing → completed/failed`.
  - Artifacts: plans, logs, failure records, receipts, metrics.

The LLM does not have to re-discover the workflow each time. The **procedure** encodes the steps; the run tracks progress.

---

### 2.2 Tool-grounded orchestration

In this design, orchestration is **tool-grounded**:

- LexRunner exposes a small set of MCP tools (`lexrunner.*`) that represent the **only** way to:
  - Start a new run.
  - Observe current run state.
  - Make orchestration decisions.
  - Inspect artifacts.
- The model **does not invent steps**; it chooses from `nextOptions` returned by `getStatus`.
- The model is still the **decision engine**, but only at well-defined decision points.

This is the core shift:

> Today: tools are things the model *can* use.
> Tool-grounded: tools are things that *structure* the model's work.

---

### 2.3 Personas and procedures

We separate behavior into two layers:

1. **Persona (`mode`)** – the role and guardrails (e.g., `senior-dev`, `eager-pm`, `security-auditor`).
   - Defines `forbidden` actions, required gates, decision style, output format, and exploration hints.
   - Loaded from config (JSON/YAML) and optionally backed by Lex canon later.

2. **Procedure** – the state machine for a specific kind of run.
   - Example: `merge-weave-main`, `pr-review`, `sprint-plan`, etc.
   - Defines states, transitions, gates per state, and where decision points occur.

The same **framework** supports multiple personas and procedures. Senior-dev and eager-pm are first implementations.

---

## 3. MCP Surface: `lexrunner.*`

LexRunner exposes a small, flat MCP surface.

### 3.1 Design principles

- **Flat, namespaced tools**, not a single tool with subcommands.
- **Verb-first, short descriptions** (<= 20 words).
- Clear mapping: one operation → one tool.

### 3.2 Tools

#### 3.2.1 `lexrunner.startRun`

- **Description:** `Start a new LexRunner procedure run and return a runId.`
- **Args (conceptual):**
  - `mode: string` – persona mode (`"senior-dev"`, `"eager-pm"`, etc.).
  - `procedure: string` – procedure id (`"merge-weave-main"`, `"pr-review"`, ...).
  - `repo: string` – repository identifier (e.g., `"Guffawaffle/lex-pr-runner"`).
  - `task?: string` – human-readable task description.
  - `params?: object` – procedure-specific parameters (PR numbers, branch names, etc.).
- **Returns:** `{ runId: string, initialStatus: StatusResponse }` (optional convenience).

Once `startRun` returns a `runId`, the model is **inside** a run and must use `lexrunner.*` for orchestration.

---

#### 3.2.2 `lexrunner.getStatus`

- **Description:** `Get current run state, summary, and next available actions.`
- **Args:**
  - `runId: string`
- **Returns:** `StatusResponse` (see section 4).

This is the **canonical control surface** for a run. The model calls `getStatus` whenever it needs to know:

- Where am I? (`state`, `summary`)
- What has already been done? (`progress`, `context`)
- What can I do next? (`nextOptions`)

---

#### 3.2.3 `lexrunner.submitDecision`

- **Description:** `Submit an LLM decision for a pending action in a run.`
- **Args:**
  - `runId: string`
  - `action: string` – must match a `nextOptions[x].action` that requires a decision.
  - `response: unknown` – validated against `nextOptions[x].responseSchema`.
- **Returns:** Updated `StatusResponse` or an error if validation fails.

This is how the model **commits** a choice at a decision point. Examples:

- "Given these test failures, should we retry, skip, or abort?"
- "Which additional files should we inspect before reviewing this PR?"

The engine validates `response` against the `responseSchema` defined by the procedure/persona, and records it in a structured decision log.

---

#### 3.2.4 `lexrunner.listArtifacts`

- **Description:** `List and inspect artifacts and receipts for a run.`
- **Args:**
  - `runId: string`
  - Optional filters: `type`, `path`, `latestOnly`, etc.
- **Returns:** A list of artifact descriptors (paths, types), and optionally inline content for small artifacts.

This gives both humans and models access to:

- `plan.json` – overall plan for the run.
- `decisions.ndjson` – sequence of decisions with rationale.
- `weave_log.ndjson` or similar – per-step execution logs.
- `failures.ndjson` – structured failure records.
- Reports (e.g., `ac_verification_report.md`, `lint_report.json`, etc.).

---

## 4. `StatusResponse` and `NextOption`

### 4.1 StatusResponse

`lexrunner.getStatus` returns a `StatusResponse` object that anchors the model's behavior.

**Conceptual shape:**

```ts
export interface StatusResponse {
  runId: string;

  // core run identity
  state: string;      // e.g. "planning" | "gated" | "executing" | "completed" | "failed"
  mode: string;       // persona mode, e.g. "senior-dev"
  procedure: string;  // procedure id, e.g. "merge-weave-main"

  // human-readable recap
  summary: string;    // e.g. "Gates passed. Reviewing 3 changed files in git module."

  // optional but strongly recommended
  progress?: {
    completed: string[];    // e.g. ["lint", "typecheck", "test"]
    current: string | null; // e.g. "code-analysis"
    remaining: string[];    // e.g. ["produce-review", "await-decision"]
  };

  // what the model can do next (canonical action set)
  nextOptions: NextOption[];

  // context specific to this state (run metadata, PR details, gate results, etc.)
  context?: Record<string, unknown>;

  // optional safety hints
  riskFlags?: string[]; // e.g. ["protected-branch"]
  blockers?: string[];  // e.g. ["PR-315 has merge conflicts"]

  // snapshot of persona config relevant for this run
  persona?: PersonaSnapshot;
}
```

**Invariants:**

- `nextOptions` is the **only** canonical source of allowed next actions.
- The model should never invent new orchestration actions outside of `nextOptions`.
- `summary` must be a single sentence that orients the model and human quickly.

---

### 4.2 NextOption

Each `NextOption` describes a possible next step. Some are simple actions; some are decision points.

```ts
export interface NextOption {
  action: string;        // e.g. "merge_next", "abort_run", "analyze_failures"
  description: string;   // short, verb-first, <= 1 sentence

  // if true, this option requires an LLM decision via submitDecision
  requiresLLMDecision?: boolean;

  // present iff requiresLLMDecision === true
  prompt?: string;           // focused text prompt for this decision
  responseSchema?: object;   // JSON-schema-ish validation structure

  // additional guidance for the model
  objective?: string;        // e.g. "Determine if failures are flaky or real bugs"
  constraints?: string[];    // e.g. ["Do not recommend rewriting tests"]
  style?: "brief" | "detailed";
  riskLevel?: "low" | "medium" | "high";
}
```

**Patterns:**

- Ordinary actions: `requiresLLMDecision` is false or omitted; the model can choose them directly.
- Decision points: `requiresLLMDecision` is true; the model must call `submitDecision` with a `response` matching `responseSchema`.
- `objective`, `constraints`, and `style` help models like Opie/GPT focus and keep answers tight.

---

## 5. Persona-as-config (Modes)

Personas (modes) should be defined as **machine-readable config**, not just prose.

### 5.1 PersonaConfig

```ts
export interface PersonaConfig {
  mode: string;   // "senior-dev", "eager-pm", ...

  // hard barriers; runner and LLM must both respect these
  forbidden: string[];   // ["merge to protected branches without human approval", ...]

  // gates that must be green before this persona can say "done"
  completionGates: string[];   // ["lint", "typecheck", "test"]

  // style and behavior knobs that affect recommendations
  decisionStyle?: {
    preferSmallDiffs?: boolean;
    requireRationaleForSkips?: boolean;
    escalateSecurityFindings?: boolean;
  };

  // hints for exploration when more context is needed
  explorationHints?: {
    relatedPaths?: string[];    // ["src/shared/**", "tests/**"]
    ignorePatterns?: string[];  // ["node_modules/**", "dist/**"]
    configFiles?: string[];     // ["tsconfig.json", "package.json"];
  };

  // expected output shape for human-readable findings
  outputFormat?: {
    severityLevels?: string[];          // ["blocker", "must-fix", "should-fix", "nit", "praise"];
    requireSeverityOnFindings?: boolean;
  };
}
```

### 5.2 Persona snapshots in StatusResponse

For convenience, `StatusResponse.persona` may include a **snapshot** of the persona config relevant to the run, so the LLM does not have to re-read persona files every time:

```ts
export type PersonaSnapshot = PersonaConfig;
```

The full persona prose file (e.g. `senior-dev-persona.json` / `.md`) can still exist for human readers, but the engine acts on `PersonaConfig`.

---

## 6. Failure Handling

Failures are treated as **first-class decision points**, not one-off exceptions.

### 6.1 Error shape

```ts
export interface LexrunnerError {
  code: string;         // "GATE_TIMEOUT", "TOOL_UNAVAILABLE", etc.
  message: string;
  retryable: boolean;
  hint?: string;        // concrete suggestion when possible
}
```

### 6.2 FailureHandlingPayload

When a gate or step fails, the procedure can return an error payload that plugs directly into the `nextOptions` pattern:

```ts
export interface FailureHandlingPayload {
  error: LexrunnerError;

  // specific next options, same shape as NextOption
  recommendedActions: NextOption[];

  // schema for logging this failure as a structured record
  failureRecordSchema: object;
}
```

Examples of `recommendedActions`:

- `retry_gates` (if `retryable === true`)
- `retry_with_options` (e.g. `--maxWorkers=1`)
- `skip_gate` (requires rationale and low risk)
- `abort_run`

The LLM sees **another decision point** instead of an unstructured error, and uses `submitDecision` to select and justify an action.

### 6.3 Failure logs

Every failure should be logged in `failures.ndjson` (or similar) with a shape that corresponds to `failureRecordSchema`, including:
- `timestamp`
- `gate`
- `error`
- `actionTaken`
- `rationale`

These records feed back into Lex and future analysis.

---

## 7. Model Behavior Expectations

Once a run exists, tool-grounded modes come with **hard constraints**.

### 7.1 System-level instructions (conceptual)

For modes like `senior-dev` or `tool-grounded`:

- Once `lexrunner.startRun` has been called and a `runId` is obtained, you MUST:
  - Use `lexrunner.getStatus` to understand run state and available actions.
  - Use `lexrunner.submitDecision` for all orchestration-related decisions.
  - Use `lexrunner.listArtifacts` to inspect artifacts instead of re-running equivalent commands ad-hoc.
- You MUST NOT:
  - Call `git`, `gh`, or other tools directly to perform merges, pushes, or branch orchestration while a run is active.
  - Modify CI configuration, acceptance criteria, or protected-branch state from within a run.
- Violations MAY be logged into `failures.json` or similar audit artifacts.

Generic tools (file read, lightweight `git diff`, etc.) may still be allowed for inspection, but **orchestration flows through LexRunner**.

### 7.2 How a model experiences this

From the LLM's perspective:

1. **Run is started** – it sees `runId`, `state`, and `summary`.
2. **It calls `getStatus`** – sees `nextOptions` and rich context.
3. **It chooses an action** – either directly (simple option) or via `submitDecision` (decision point).
4. **LexRunner updates state** – progression, gates, logs, artifacts.
5. **Loop continues** until `state` becomes `completed` or `failed`.

There is no need for the LLM to invent workflow steps; the procedure does that. The LLM focuses on ambiguous, judgment-heavy choices.

---

## 8. Integration with VS Code / Copilot

### 8.1 Typical flow from Copilot Chat

1. User invokes a command (example):

   ```text
   /lex-runner mode=senior-dev procedure=pr-review repo=Guffawaffle/lex-pr-runner task="Review PR #324"
   ```

2. Copilot calls `lexrunner.startRun(...)` with these parameters.

3. Copilot calls `lexrunner.getStatus(runId)` and receives a `StatusResponse`.

4. Copilot loops:
   - Chooses from `nextOptions` (calling `submitDecision` if needed).
   - Calls `getStatus` after each step.
   - Optionally calls `listArtifacts` for reports.

5. When `state === "completed"` or `"failed"`, Copilot:
   - Summarizes outcome to the user.
   - Provides links or paths to artifacts.

### 8.2 Why this is better than "freestyle"

- The model no longer has to:
  - Discover which tools to use.
  - Invent the workflow order.
  - Reconstruct state from chat scrollback.
- The user gets:
  - A **repeatable procedure** instead of bespoke hand-tuned prompts.
  - A clear audit trail (plan, decisions, logs, failures).
  - Stronger guarantees about what models can and cannot do.

---

## 9. Artifacts and Receipts

Every run should emit a minimal set of artifacts:

- `plan.json` – planned sequence of steps, dependencies, risk scores.
- `decisions.ndjson` – all `submitDecision` calls, responses, timestamps.
- `weave_log.ndjson` (or procedure-specific logs) – step-by-step execution records.
- `failures.ndjson` – structured failure entries.
- `metrics.json` – duration, tool calls, token estimates (when available).
- Procedure-specific reports, e.g.:
  - `reports/ac_verification_report.md`
  - `reports/pr_review.md`

These feed into Lex for long-term memory, analysis, and future automation.

---

## 10. Implementation Roadmap (v0.6.x+)

High-level milestones for LexRunner 0.6.x:

1. **LR-060 – MCP surface**
   - Implement `lexrunner.startRun`, `lexrunner.getStatus`, `lexrunner.submitDecision`, `lexrunner.listArtifacts`.

2. **LR-061 – Status + options**
   - Implement `StatusResponse` and `NextOption` contracts.
   - Ensure `nextOptions` is the single source of truth for allowed actions.

3. **LR-062 – Decision points**
   - Add support for `requiresLLMDecision`, `prompt`, `responseSchema`, `objective`, `constraints`, `style`.
   - Validate `submitDecision` payloads and emit `decisions.ndjson`.

4. **LR-063 – Persona config**
   - Load `PersonaConfig` for modes (senior-dev, eager-pm, etc.).
   - Inline persona snapshots into `StatusResponse`.

5. **LR-064 – Failure handling**
   - Implement `LexrunnerError` and `FailureHandlingPayload`.
   - Normalize gate/tool errors into structured decision points.
   - Emit `failures.ndjson`.

6. **LR-065 – Tool-grounded mode wiring**
   - Add strong system-level instructions for tool-grounded modes.
   - Ensure violations can be logged.

7. **LR-066 – Procedure library**
   - Implement core procedures using this framework (e.g., `merge-weave-main`, `pr-review`, `sprint-plan`).
   - Dogfood with senior-dev and eager-pm modes.

---

## 11. Closing Note

This design is intentionally **model-first**: it was shaped using direct feedback from a frontier model (Opie) actively working as senior-dev in VS Code.

The invariant we are working toward:

> Models do not need to be perfect.
> They need a system that makes their strengths count and their weaknesses irrelevant.

Tool-grounded, run-centric LexRunner is that system. This spec is the first step toward making it real.
