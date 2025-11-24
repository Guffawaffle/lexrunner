# AGENTS.md - lex-pr-runner

> North Star
> Fan-out work into multiple PRs in parallel, then build a dependency-aware merge pyramid.
> Consume a single frozen plan, run uniform gates, and merge cleanly and deterministically.

This document orients all agents (human and automated) toward the same purpose and defines the
non-negotiable operating rules for lex-pr-runner (LexRunner). It is intentionally non task-specific
and should remain stable even as implementation details evolve.

LexRunner is the execution body in the Lex stack:

- Lex (OSS): policy-aware memory and frames.
- LexRunner (this repo): deterministic merge pyramid engine that executes a plan.json.
- LexSona (future): scoped behavioral memory layered on Lex; out of scope for this codebase but
  relevant to how external agents behave when they call the runner.

The rest of this file defines the contract those agents must honor.

---------------------------------------------------------------------
## Commit Signing Policy (Mandatory)

All commits in this repository MUST be GPG-signed.

Before committing, ensure:

1. Configure your signing key:

   git config user.signingkey <YOUR_KEY_ID>

2. Set GPG_TTY in your shell:

   export GPG_TTY=$(tty)

3. Sign commits by default (recommended):

   git config commit.gpgsign true

   or sign individual commits with:

   git commit -S

Verification:

- Run:

  git log --show-signature -1

Troubleshooting:

- If you see "gpg failed to sign the data":
  - Check gpg --list-secret-keys
  - Verify git config user.signingkey is correct
- If key is unset:
  - git config user.signingkey <YOUR_KEY_ID>

---------------------------------------------------------------------
## 0) Core Premise (Do Not Drift)

1. Deterministic program for merges. At integration time, the runner consumes a single frozen
   input (plan.json, Schema v1), executes a deterministic merge plan, and emits verifiable artifacts.

   Important scope note: this "single input" constraint applies only to the integration runner.
   It does not limit how Issues are defined or how implementation work is done.

2. Merge pyramid. Decompose work into many small PRs, compute a dependency-ordered pyramid
   (topological order), and integrate bottom-up.

3. Uniform gates. Execute the same gates (lint, type, tests, policy checks, etc.) locally and in CI,
   with the same inputs and expectations.

4. Two-track separation (firm).
   - Core runner lives in the repository root (src/, CLI, MCP adapter, packaging, CI workflows).
     It is stateless and packageable.
   - .smartergpt.local/ (and any older .smartergpt/ layout) is a portable user workspace and
     profile directory. It is not read at runtime by the runner. It can contain example profiles,
     prompts, policies, and developer tooling for humans and external orchestrators.

5. Reproducibility over magic. No hidden state, no "auto inference". Integration inputs are
   explicit; outputs are traceable.

6. Auditability. Every decision is inspectable (plan, gates, logs, outcomes).

Clarification: scope of "only runtime truth":

- Integration-time (runner): plan.json is the only input the runner reads to compute order and
  merges.
- Development-time (issues and coding): implementation agents (humans or tools) are expected
  to use Issues, specs, Lex policies, and project principles to do the work. The runner does not
  constrain this phase.

---------------------------------------------------------------------
## 1) Lifecycle and Surfaces (Who uses what, when)

Stage A - Issue definition
- Owners: PM / author
- Surfaces: GitHub Issues, ADRs, specs
- Artifacts: clear acceptance criteria, rationale, links

Stage B - Implementation work
- Owners: humans and Copilot-style implementation agents
- Surfaces: branches, PRs, tests, docs, .smartergpt.local/ workspace tools and Lex profiles
- Inputs: Issue descriptions plus project principles (this document)
- Outputs: one or more focused PRs per task

Stage C - Plan synthesis (out of runner scope)
- Owner: plan-generator tool or workflow
- Inputs: graph of PRs, declared dependencies, policy, and optional metadata from Issues
- Output: plan.json (Schema v1) - the frozen integration input

Stage D - Integration runner (this project)
- Owner: lex-pr-runner (TypeScript core)
- Input: plan.json only
- Behavior: compute topological order, run gates uniformly, respect policy, and decide what to merge
- Artifacts: gate logs (JUnit, SARIF, JSON), status tables, PR comments, and deliverables

Stage E - Merge and release
- Owner: maintainers / automation
- Artifacts: changelog, tags, release notes

---------------------------------------------------------------------
## 2) Runner Contract (Integration-Time)

- Single runtime input (scoped). plan.json (Schema v1) is the only integration input the runner
  reads. Development agents remain free to use Issues, ADRs, or other docs.
- Outputs. Deterministic artifacts (gate results, status model, merge decisions). Post as PR
  comments or CI artifacts, not as code changes in the runner path.
- Side-effects. Only those declared in plan.json (for example, which PR to merge, in what order).
  No implicit network calls or mutations.
- Idempotence. Same plan.json, same decisions (modulo external state such as "PR already merged").
- Status model. The runner exposes a small, fixed status vocabulary that downstream tools and
  humans can rely on (for example: pass, fail, blocked, skipped, retrying).

---------------------------------------------------------------------
## 3) Plan Model (Schema v1 - High Level Contract)

- Nodes: PRs or commits with identifiers, metadata, and declared dependencies.
- Edges: dependencies only (no implicit ordering).
- Gates: named checks per node (for example: lint, type, unit, e2e, policy). Each gate has
  a command or adapter reference and expected status semantics.
- Policy: merge rules such as "all required gates green", "no fast-forward across failing siblings",
  "block on security policy violations".
- Outputs: expected artifacts per gate (logs, JUnit, coverage, SARIF, JSON, etc.).

Policy example (non-normative):

requiredGates: ["lint", "type", "unit"]
optionalGates: ["e2e"]
maxWorkers: 2
retries:
  e2e: { maxAttempts: 2, backoffSeconds: 30 }
overrides:
  adminGreen:
    allowedUsers: ["repo-admins"]
    requireReason: true
blockOn:
  - "security:critical"
mergeRule:
  type: "strict-required"

Schema versioning:

- Plans must include "schemaVersion": "1.x.y".
- Versioning follows SemVer:
  - Patch: additive, optional fields or docs only.
  - Minor: additive required fields with safe defaults.
  - Major: breaking changes to structure or semantics.
- The runner refuses plans with unknown major versions.

Anything not in the plan is out of scope for the runner.

---------------------------------------------------------------------
## 4) Merge Pyramid and Ordering Rules

1. Topological sort. Compute an order from leaves to root such that a node runs only after all
   dependencies are green.
2. Parallelism. Independent subgraphs may run concurrently up to the concurrency limits
   specified by policy or plan.
3. Promotion. A node is eligible to merge when all required gates pass and policy authorizes it.
4. Short-circuiting. If a dependency fails on required gates, do not run dependents (mark them
   as blocked).

Runner status model (example):

Status table:

- pass: all required gates passed, eligible to merge.
- fail: one or more required gates failed, not eligible.
- blocked: a dependency failed or is blocked; node not executed.
- skipped: policy or config excluded gates for this node.
- retrying: gate marked retryable; attempt in progress (bounded).

---------------------------------------------------------------------
## 5) Gates - Uniform Execution

- Same everywhere. Gate execution logic and defaults must match local and CI environments.
- Stable interfaces. Each gate produces structured results (status, duration, artifacts, logs).
  Prefer machine-readable outputs (JUnit, SARIF, JSON) in addition to human logs.
- Exit codes and semantics. Exit code 0 means pass; any non-zero exit means fail. The runner
  distinguishes "blocked" versus "failed" in its status model.
- Caching (optional). Allowed, but must not change semantics. Cache keys should derive from
  inputs and artifacts so replays are consistent.

---------------------------------------------------------------------
## 6) Two-Track Separation (Enforced)

Track A - Core runner:
- src/, CLI, adapters (for example MCP), packaging, CI recipes.
- Never hard-link or read .smartergpt.local/ (or .smartergpt/) at runtime.
- Stateless with respect to any particular workspace or profile.

Track B - Portable workspace:
- .smartergpt.local/ contains examples, profiles, prompts, policies, local tooling, and
  deliverables for humans and external agents.
- It is replaceable and repo-portable.

Why this matters:

- Repos can adopt lex-pr-runner without inheriting your personal workspace.
- Your workspace can travel across repos without changing the runner.
- This is a foundation for determinism and portability.

---------------------------------------------------------------------
## 7) Agent Roles

- Implementation agents (humans or tools): build the code guided by Issues and project
  principles, and produce small PRs with explicit dependencies.
- Plan generator (out of runner scope): transforms Issues and PR graph into plan.json. It may
  live in a separate tool or workflow.
- Orchestrator: coordinates Lex, LexRunner, and possibly LexSona. Calls the runner CLI or MCP
  adapter with a concrete plan and collects artifacts.
- Runner core agent: maintains the TypeScript source of truth (Zod schemas, topo logic, CLI).
  Guards determinism and contracts.
- Gate executors: implement gate adapters and commands, ensure uniform behavior local and CI,
  and publish structured artifacts.
- MCP adapter agent: provides a clean interface for external tools and orchestrators; adheres
  to the runner contract and does not add new runtime inputs beyond plan.json and allowed env.
- Documentation agent: keeps README.md, AGENTS.md, and policy docs current with behavior
  and contracts (not implementation churn).

---------------------------------------------------------------------
## 8) Operational Rules (Do and Do Not)

Do:

- Treat plan.json as the only integration-time input for the runner.
- Keep the runner stateless; derive integration state from inputs and external APIs declared
  in the plan.
- Prefer pure functions and small modules. TypeScript first with Zod schemas.
- Emit artifacts to deliverables folders or PR comments, not into source directories. A common
  pattern is .smartergpt.local/deliverables/<run-id>/...
- Use imperative commit messages (for example: "Add ...", "Fix ...", "Refactor ...").

Do not:

- Do not read .smartergpt.local/ or .smartergpt/ at runtime.
- Do not infer dependencies from file paths or heuristics. Only the plan decides.
- Do not hide side-effects behind environment variables. All effects must be declared in the
  plan or policy.
- Do not fork logic between local and CI paths.

---------------------------------------------------------------------
## 9) Failure Handling and Recovery

- Gate failure. Mark the node as failed and propagate blocked status to dependents. Surface logs
  and artifacts clearly.
- Flakes. If a gate is marked retryable by policy, bound the retries and always record all
  attempts.
- External errors (API or outage). Classify separately from test failures; do not merge on
  ambiguous state.
- Manual overrides. Allowed only through explicit policy hooks (for example "admin green").
  All overrides are logged with rationale.

---------------------------------------------------------------------
## 10) Observability and Artifacts

Where:

- Post structured results as PR comments and/or CI artifacts.
- Keep diagnostics out of the runner source tree.

What:

- Status tables, dependency graphs, gate summaries, and links to detailed logs such as JUnit,
  SARIF, coverage reports, and HTML reports.

Why:

- Auditable paper trail and reproducible investigations.

---------------------------------------------------------------------
## 11) CI Alignment and Least-Privilege

- Same entry points. CI invokes the same runner CLI as local.
- Tokens. Grant only what is needed for status and merges (for example contents:read,
  pull_requests:write, statuses:write). Avoid admin scopes.
- Isolation. Run gates in containers where feasible for reproducibility.
- Failure is final. Required gate failure fails the job; no silent retries unless policy
  explicitly permits.
- Workflow skeletons. Provide templates that spin up only what is needed for gates.
- Contract compliance. Fail the job if any required gate fails or if the plan contract is
  violated.

CI-bound resources and environments:

- Some gates need secrets (databases, SaaS tokens, etc.) or services unavailable locally.
- A gate may declare a runtime selector such as "local", "container", or "ci-service".
- If runtime is "container", include image, entrypoint, and mounts in the plan or policy.
- Gate adapters may read env vars only to locate credentials; secrets must not change gate
  semantics.

---------------------------------------------------------------------
## 12) Coding Conventions (TypeScript-First)

- Language: TypeScript.
- Schemas: Zod. Export parse and validate helpers.
- CLI: Commander (or equivalent) with stable flags; avoid breaking changes.
- Style: small, testable modules; deterministic pure logic around topo and gates; adapters
  isolate side-effects.
- Tests: unit tests for topo and gates; fixture-based tests for plan parsing and policy.

---------------------------------------------------------------------
## 13) Checklists

PR author:

- [ ] Break work into small, independently reviewable PRs.
- [ ] Declare dependencies explicitly in PR descriptions and/or plan.json precursor metadata.
- [ ] Ensure required gates are defined and runnable.

Runner or gate agent:

- [ ] Validate plan.json against Schema v1.
- [ ] Compute topo order; verify the graph is a DAG (no cycles).
- [ ] Execute gates uniformly; collect artifacts.
- [ ] Respect policy; mark nodes eligible or ineligible to merge.
- [ ] Emit artifacts and logs outside source; post results back to PR.

Release:

- [ ] Tag runner version and schema version.
- [ ] In the changelog, note any contract changes explicitly.
- [ ] Verify CI templates and local flows still match.

---------------------------------------------------------------------
## 14) FAQ

Why does the runner not read Issues directly?
- To keep integration deterministic and replayable. Issues can change without a commit; plan.json
  freezes the intent for a run.

Can the plan generator ingest Issues?
- Yes. The generator (separate tool) may read Issues and PR metadata to produce plan.json.
  The runner still only consumes the plan.

Does this block exploratory or tool-led development?
- No. Implementation agents use Issues and specs as usual. The constraint applies only at
  integration time.

How do I declare PR dependencies?
- Use a "Depends-on: #<PR>" footer (or labels). The plan generator resolves these into
  node.dependsOn entries.

What if my gates need secrets?
- Provide them via CI secrets and env variables; do not let secrets alter gate semantics.
  Prefer containerized gates for repeatability.

Can I use this with our existing CI?
- Yes. Keep your CI, point it at the runner CLI. The runner remains deterministic because it
  only consumes plan.json.

---------------------------------------------------------------------
## 15) Invariants (Quick Reference)

- Runner reads only plan.json at integration time.
- .smartergpt.local/ (or .smartergpt/) is never a runtime dependency.
- Local and CI gate semantics are identical.
- No hidden side-effects; everything is declared.
- Same inputs produce the same outputs.

---------------------------------------------------------------------
## 16) Quick Start (Happy Path)

1. Open Issues with crisp acceptance criteria.
2. Implement in small PRs; add "Depends-on:" footers if needed.
3. Generate a plan: run your plan generator to emit plan.json.
4. Dry run locally: lex-pr-runner --plan plan.json --dry-run
5. Run gates: same CLI locally and in CI; confirm artifacts appear under
   <nodeId>/<gateName>/ and in deliverables.
6. Merge pyramid: runner computes topo order and merges eligible nodes.
7. Commit messages: imperative mood (for example "Add ...", "Fix ...").
