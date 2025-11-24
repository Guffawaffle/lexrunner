# AGENTS.md — lex-pr-runner

> **North Star**
> **Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks.
> Compute dependency order, run gates locally, and merge cleanly.**

This document orients all agents (human and automated) toward the same purpose and defines the
non‑negotiable operating rules for **lex-pr-runner**. It is intentionally **non task‑specific** and
should remain stable even as implementation details evolve.

---

## 0) Core Premise (Do Not Drift)

1. **Deterministic Program for Merges.** At **integration time**, the runner consumes a **single frozen input** (`plan.json`, Schema v1), executes a **deterministic merge plan**, and emits verifiable artifacts.
   **Important scope note:** This “single input” constraint applies **only to the integration runner**. It **does not** limit how issues are defined or how implementation work is done.
2. **Merge Pyramid.** Decompose work into many small PRs, compute a **dependency‑ordered pyramid** (topological order), and integrate bottom‑up.
3. **Uniform Gates.** Execute the same **gates** (lint/type/test, policy checks, etc.) **locally and in CI**, with the same inputs and expectations.
4. **Two‑Track Separation (Firm).**
   - **Core runner** lives in the repository root (`src/*`, CLI, MCP adapter, packaging, CI). It is **stateless** and **packageable**.
   - **`.smartergpt/` is a portable user workspace** and canonical profile. It is **not read at runtime** by the runner. It can contain example profiles, prompts, policies, and developer tooling.
5. **Reproducibility Over Magic.** No hidden state, no “auto inference.” Integration inputs are explicit; outputs are traceable.
6. **Auditability.** Every decision is inspectable (plan, gates, logs, outcomes).

> ### Clarification: Scope of “Only Runtime Truth”
> - **Integration-time (Runner):** `plan.json` is the **only** input the runner reads to compute order and merges.
> - **Development-time (Issues & Coding):** Implementation agents (humans/Copilot) are expected to use **Issue descriptions, specs, and project principles** to do the work. The runner does not constrain this phase.

---

## 1) Lifecycle & Surfaces (Who uses what, when)

**Stage A — Issue Definition**
- *Owners:* PM/Author
- *Surfaces:* GitHub Issues / ADRs / specs
- *Artifacts:* Clear acceptance criteria, rationale, links

**Stage B — Implementation Work**
- *Owners:* Humans & Copilot (implementation agents)
- *Surfaces:* Branches/PRs, tests, docs, `.smartergpt/` workspace tools
- *Inputs:* Issue descriptions + project principles (this document)
- *Outputs:* One or more focused PRs per task

**Stage C — Plan Synthesis (Out of Runner Scope)**
- *Owner:* Plan‑generator tool or workflow
- *Inputs:* Graph of PRs, declared dependencies, policy, optional metadata from Issues
- *Output:* **`plan.json` (Schema v1)** — the frozen integration input

**Stage D — Integration Runner (This Project)**
- *Owner:* lex‑pr‑runner (TS core)
- *Input:* `plan.json` only
- *Behavior:* Compute topo order, run gates uniformly, respect policy, merge cleanly
- *Artifacts:* Gate logs (JUnit/SARIF/etc.), status tables, PR comments

**Stage E — Merge & Release**
- *Owner:* Maintainers/automation
- *Artifacts:* Changelog, tags, release notes

---

## 2) Runner Contract (Integration-Time)

- **Single Runtime Input (Scoped):** `plan.json` (Schema v1) is the **only** integration input the runner reads.
  _Development agents remain free to use Issues, ADRs, or other docs._
- **Outputs:** Deterministic artifacts (gate results, merge decisions). Post as **PR comments or CI artifacts**, **not** as code changes in the runner path.
- **Side‑Effects:** Only those declared in `plan.json` (e.g., which PR to merge, in what order). No implicit network calls or mutations.
- **Idempotence:** Same `plan.json` → same decisions (modulo external state, e.g., a PR already merged).

---

## 3) Plan Model (Schema v1 — High Level Contract)

- **Nodes:** PRs/commits with identifiers, metadata, and **declared dependencies**.
- **Edges:** Dependencies only (no implicit ordering).
- **Gates:** Named checks per node (e.g., `lint`, `type`, `unit`, `e2e`, `policy`). Each gate has a command/adapter reference and expected status semantics.
- **Policy:** Merge rules (e.g., “all required gates green,” “no fast‑forward across failing siblings,” “block on security policy violations”).
- **Outputs:** Expected artifacts per gate (logs, JUnit, coverage, SARIF, etc.).



#### Policy Examples (Non-Normative)

```yaml
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
  # “All required gates green; optional gates ignored unless specified”
  type: "strict-required"
```
#### Schema Versioning
- Plans must include `"schemaVersion": "1.x.y"`.
- Versioning follows SemVer:
  - **Patch:** additive, optional fields or docs only.
  - **Minor:** additive required fields with safe defaults.
  - **Major:** breaking changes to structure or semantics.
- The runner refuses plans with unknown **major** versions.

_Anything not in the plan is out of scope for the runner._

---

## 4) Merge Pyramid & Ordering Rules

1. **Topological Sort:** Compute an order from leaves → root such that a node runs only after all dependencies are green.
2. **Parallelism:** Independent subgraphs may run concurrently **up to the concurrency limits** specified by policy/plan.
3. **Promotion:** A node is eligible to merge when all **required gates** pass and **policy** authorizes.
4. **Short‑Circuiting:** If a dependency fails on required gates, **do not** run dependents (mark as blocked).


### Runner State Model (Statuses)

| Status     | Meaning                                                | Merge Eligibility |
|------------|--------------------------------------------------------|-------------------|
| `pass`     | All required gates passed                              | Eligible          |
| `fail`     | One or more required gates failed                      | Not eligible      |
| `blocked`  | A dependency failed/blocked; node not executed         | Not eligible      |
| `skipped`  | Policy or config excludes gates for this node          | Not eligible      |
| `retrying` | Gate marked retryable; attempt in progress (bounded)   | Not eligible      |


---

## 5) Gates — Uniform Execution

- **Same Everywhere:** Gate execution logic and defaults must match **local and CI**.
- **Stable Interfaces:** Each gate produces structured results (status, duration, artifacts, logs). Prefer machine‑readable outputs (JUnit, SARIF) in addition to human logs.
- **Exit Codes & Semantics:** `0` = pass, `>0` = fail; distinguish “blocked” vs “failed” in the runner’s state model.
- **Caching (Optional):** Allowed, but must not change semantics. Cache keys should derive from inputs/artifacts so replays are consistent.

---

## 6) Two‑Track Separation (Enforced)

- **Core Runner (Track A):** `src/`, CLI, adapters (e.g., MCP), packaging, CI recipes. _Never_ hard‑link or read `.smartergpt/` at runtime.
- **Portable Workspace (Track B):** `.smartergpt/` contains examples, profiles, prompts, policies, local tooling, and deliverables for **humans and agents**. It is **replaceable** and **repo‑portable**.

**Why this matters:** Repos can adopt lex‑pr‑runner without inheriting your personal workspace, and your workspace can travel across repos without changing the runner. This is the foundation for determinism and portability.

---

## 7) Agent Roles

- **Implementation Agents (Humans/Copilot):** Build the code guided by Issues and project principles; produce small PRs with explicit dependencies.
- **Plan Generator (Out of Runner Scope):** Transforms Issues/PR graph into `plan.json`. May live in a separate tool or workflow.
- **Runner Core Agent:** Maintains the TS source of truth (Zod schemas, topo logic, CLI). Guards determinism and contracts.
- **Gate Executors:** Implement gate adapters/commands; ensure uniform behavior local/CI; publish structured artifacts.
- **MCP Adapter Agent:** Provides a clean interface for external tools/orchestrators; adheres to the runner contract.
- **Documentation Agent:** Keeps `README.md`, `AGENTS.md`, and policy docs current with behavior and contracts (not implementation churn).

---

## 8) Operational Rules (Do / Don’t)

**Do**
- Treat `plan.json` as the **only integration‑time input** for the runner.
- Keep the runner **stateless**; derive integration state from inputs and external APIs declared in the plan.
- Prefer **pure functions** and small modules. TS‑first with Zod schemas.
- Emit artifacts to **deliverables or PR comments**, not into source directories.
- Uphold **imperative commit messages** (e.g., “Add…”, “Fix…”, “Refactor…”).

**Don’t**
- Don’t read `.smartergpt/` at runtime.
- Don’t infer dependencies from file paths or heuristics. Only the plan decides.
- Don’t hide side‑effects behind environment variables. All effects must be declared in the plan or policy.
- Don’t fork logic between local and CI paths.

---

## 9) Failure Handling & Recovery

- **Gate Failure:** Mark node `failed`; propagate `blocked` status to dependents. Surface logs and artifacts.
- **Flakes:** If a gate is marked “retryable” by policy, bound the retries and always record attempts.
- **External Errors (API/outage):** Classify separately from test failures; do not merge on ambiguous state.
- **Manual Overrides:** Allowed only through explicit policy hooks (e.g., “admin green”). All overrides are logged with rationale.

---

## 10) Observability & Artifacts

- **Where:** Post structured results as PR comments and/or CI artifacts. Keep **diagnostics out of the runner’s source tree**.
- **What:** Status tables, dependency graphs, gate summaries, links to detailed logs (JUnit, SARIF, coverage, HTML reports).
- **Why:** Auditable paper trail and reproducible investigations.

---

## 11) CI Alignment & Least-Privilege

- **Same entrypoints:** CI invokes the same runner CLI as local.
- **Tokens:** Grant only what's needed for status + merges (`contents:read`, `pull_requests:write`, `statuses:write`); avoid admin scopes.
- **Isolation:** Run gates in containers where feasible for reproducibility.
- **Failure is final:** Required gate failure fails the job; no silent retries unless policy permits.
- **Compose/workflow skeleton:** Provide templates that spin up only what's needed for gates.
- **Contract compliance:** Fail the job if any required gate fails or if the plan contract is violated.
- CI must run the **same** CLI entry points as local.
- Provide a **compose/workflow skeleton** that spins up only what’s needed for gates.
- Fail the job if **any required gate** fails or if the **plan contract** is violated.

---

## 12) Coding Conventions (TS‑First)

- **Language:** TypeScript.
- **Schemas:** Zod. Export parse/validate helpers.
- **CLI:** Commander (or equivalent) with stable flags; avoid breaking changes.
- **Style:** Small, testable modules; deterministic pure logic around topo/gates; adapters isolate side‑effects.
- **Tests:** Unit tests for topo/gates; fixture‑based tests for plan parsing and policy.

---

## 13) Checklists

### PR Author
- [ ] Break work into small, independently reviewable PRs.
- [ ] Declare dependencies explicitly in PR descriptions and/or `plan.json` pre‑cursor metadata.
- [ ] Ensure required gates are defined and runnable.

### Agent (Runner/Gate)
- [ ] Validate `plan.json` against Schema v1.
- [ ] Compute topo order; verify DAG (no cycles).
- [ ] Execute gates uniformly; collect artifacts.
- [ ] Respect policy; merge only when eligible.
- [ ] Emit artifacts/logs outside source; post results back to PR.

### Release
- [ ] Tag runner version & schema version.
- [ ] Changelog: note contract changes explicitly.
- [ ] Verify CI template and local flows match.

---

## 14) FAQ

**Q: Why doesn’t the runner read Issues directly?**
A: To keep integration **deterministic and replayable**. Issues can change without a commit; `plan.json` freezes the intent for a run.

**Q: Can the plan generator ingest Issues?**
A: Yes. The generator (separate tool) may read Issues/PR metadata to **produce** `plan.json`. The runner still only consumes the plan.

**Q: Does this block exploratory or Copilot‑led development?**
A: No. Implementation agents use Issues/specs as usual. The constraint applies only at **integration time**.

---

**How do I declare PR dependencies?**
Use a `Depends-on: #<PR>` footer (or labels). The plan generator resolves these into `node.dependsOn`.

**What if my gates need secrets?**
Provide them via CI secrets/env; do not let secrets alter gate semantics. Prefer containerized gates.

**Can I use this with our existing CI?**
Yes. Keep your CI; point it at the runner CLI. The runner remains deterministic because it only consumes `plan.json`.

## 15) Invariants (Quick Reference)

- Runner reads **only `plan.json`** at integration time.
- `.smartergpt/` is never a runtime dependency.
- Local and CI gate semantics are identical.
- No hidden side‑effects; everything is declared.
- Same inputs → same outputs.

#### CI-Bound Resources & Environments

Some gates need secrets (e.g., databases, SaaS tokens) or services unavailable locally.

- **Runtime selector (suggested):** `gate.runtime = "local" | "container" | "ci-service"`
- **Containerization (recommended for parity):** If `runtime = container`, include `image`, `entrypoint`, and `mounts` in the plan or policy.
- **Secrets & env:** Gate adapters may read env vars **only** to locate credentials; secrets must not change gate semantics.
- **Example gate spec (non-normative):**
```json
{
  "name": "e2e",
  "runtime": "container",
  "image": "ghcr.io/acme/e2e:1.4.2",
  "command": ["npm", "run", "e2e"],
  "artifacts": ["junit.xml", "screenshots/"]
}
```


---

## Appendix C — Plan Generator Reference (Non-Normative)

**Purpose:** Show how teams can go from Issues/PRs → `plan.json` without constraining the runner.

### Dependency Declaration (PR metadata)
- Footer syntax (suggested): `Depends-on: #123, #456`
- Label-based (alternative): `dep:123`, `dep:456`
- The generator resolves PR numbers → node IDs.

### Field Mapping (example)

| Source               | Plan field             |
|----------------------|------------------------|
| PR number            | `node.id`              |
| PR title             | `node.title`           |
| PR labels            | `node.tags[]`          |
| `Depends-on:` footer | `node.dependsOn[]`     |
| Required checks label| `node.requiredGates[]` |

### Minimal `plan.json` example
```json
{
  "schemaVersion": "1.0.0",
  "policy": { "requiredGates": ["lint", "type", "unit"], "maxWorkers": 2 },
  "nodes": [
    { "id": "PR-101", "title": "Core utils", "dependsOn": [], "gates": ["lint", "type", "unit"] },
    { "id": "PR-202", "title": "Feature A", "dependsOn": ["PR-101"], "gates": ["lint", "type", "unit"] }
  ]
}
```


---

## Appendix D — Quick Start (Happy Path)

1. **Open Issues** with crisp acceptance criteria.
2. **Implement** in **small PRs**; add `Depends-on:` footers if needed.
3. **Generate plan:** Run your plan generator to emit `plan.json`.
4. **Dry run locally:** `lex-pr-runner --plan plan.json --dry-run`
5. **Run gates:** Same CLI locally and in CI; confirm artifacts appear under `<nodeId>/<gateName>/`.
6. **Merge pyramid:** Runner computes topo order, merges eligible nodes.
7. **Commit messages:** Imperative mood (e.g., “Add…”, “Fix…”).

## 16) Environment Stability (WSL2/CI)

- **Resource Limits:** Test runners (Vitest) must be configured with explicit concurrency limits (`maxWorkers: 1`) to prevent resource exhaustion in constrained environments like WSL2 or shared CI runners.
- **Crash Prevention:** Avoid unbounded recursion or excessive memory allocation in tests.
- **Process Isolation:** Ensure tests clean up temporary directories and processes.
- **Git Configuration:** Tests creating git repositories MUST explicitly disable GPG signing (`git config commit.gpgsign false`) to prevent interactive prompts that hang the test runner and crash the environment.
- **Git Tests:** Tests that perform git commits or require a git environment are EXCLUDED from the default `npm test` run. Run them explicitly with `npm run test:git`. These tests MUST NOT run in CI.
