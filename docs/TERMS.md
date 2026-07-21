# lexrunner — Canonical Terms

## Project & Components

- **lexrunner (project/repo)**: The repository you're reading.
- **Runner CLI**: TypeScript command-line adapter under `src/**`. Shorthand: "the runner".
- **Stateless integration core**: Plan, gate, status, and weave application services. It consumes a
  frozen plan and never reads coordination state as integration authority.
- **Stateful coordination service**: ADR-010 application services backed by `CoordinationStore` and
  workspace lifecycle stores. It owns implementation-time WorkItems, Runs, Attempts, leases,
  receipts, and verification; it does not alter a frozen integration plan.
- **MCP server (adapter)**: Optional adapter that exposes selected runner operations over MCP. Shorthand:
  "lex-pr MCP".
- **Workspace profile**: Portable examples and developer tooling under `.smartergpt/**`. It is not the app,
  is never a core-runner runtime dependency, and is not an editor workspace, project root, or execution root.
- **Project root**: Repository root that owns the task, policy, and run state.
- **Execution root**: Runtime-local path where an operation executes. A single project root may have different
  Windows, WSL, container, or remote execution roots.
- **Merge pyramid**: The plan → gates → weave/merge process the runner executes.

## Process & Artifacts

- **Gate**: A deterministic check (lint, typecheck, test, determinism) run locally and/or in CI.
- **Plan**: The resolved set of items to merge (eventually `plan.json`, schema-versioned).
- **Stack**: User-authored prioritization/dependency hints (e.g., `.smartergpt/stack.yml`).
- **Item**: A unit in the plan (often a PR).
- **Integration branch**: Temporary branch used to weave/verify a batch of items before merging to `main`.

## Agent Work & Control

- **WorkItem**: Source-neutral, normalized statement of requested work and acceptance criteria.
- **Run**: LexRunner's coordinated effort to deliver one WorkItem. Exactly one active controller lease may
  advance a Run.
- **Attempt**: One bounded worker try within a Run. A retry normally creates a new Attempt.
- **Controller lease**: Exclusive, expiring authority for one controller instance to advance a Run.
- **Workspace lease**: Exclusive ownership of one branch and worktree by one live Attempt. It does not grant
  authority over GitHub, releases, credentials, or external runtime state.
- **AgentTaskPacket**: Portable, immutable, canonically hashed instructions for an Attempt. It contains no
  machine-local absolute paths.
- **ExecutionEnvelope**: Attempt-local execution details such as execution root, branch, workspace lease,
  worker runtime, and sandbox policy. It is not part of the portable task-packet hash.
- **WorkerSession**: Runtime-specific handle for a worker process or native background agent.
- **AgentTaskReceipt**: Attempt-bound claims about what a worker did. A receipt is evidence to inspect, not
  operational truth.
- **EngineVerification**: LexRunner-owned evidence collected independently from worker claims. Verification
  may pass, fail, be inconclusive, encounter infrastructure failure, or be cancelled.
- **Delivery**: Coordinator-owned creation and publication of verified work, including final commits, signing,
  pushing, PR operations, gates, weave, and merge under explicit authority policy.
- **Assisted control**: A foreground developer-chat controller dispatches native background agents.
- **Headless control**: A supervised CLI controller dispatches and recovers external worker runtimes.

**Maturity:** Assisted Attempt control is implemented. A headless reconciliation application
boundary is implemented against controlled adapters, but public headless launch, native/reboot
recovery, and Stage 5 fault-injection/authority expansion are not production guarantees.

## Repo Rules (Firm)

- **Two-track separation**
  - **Core runner** (`src/**`, CLI, MCP, packaging). **Never** store user/work artifacts.
  - **`.smartergpt/**` = portable example profile only.
    - **Track:** `intent.md`, `scope.yml`, `deps.yml`, `gates.yml`, `stack.yml`, `pull-request-template.md`
    - **Ignore:** `.smartergpt/runner/`, `cache/`, `deliverables/` (deliverables are posted as PR comments, not committed).

## Commit Style

- Imperative mood: "Add…", "Fix…", "Update…"
- Optional prefixes: `runner:`, `mcp:`, `schema:`, `tests:`, `ci:`, `docs:`, `workspace:`

## Tagline (use verbatim)

**Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly.**
