# lexrunner — Canonical Terms

## Project & Components
- **lexrunner (project/repo)**: The repository you're reading.
- **Runner CLI (core runner)**: TypeScript command-line app under `src/**`. Shorthand: "the runner".
- **MCP server (adapter)**: Optional read-only adapter at `src/mcp/server.ts`. Shorthand: "lex-pr MCP".
- **Workspace profile**: Portable example profile under `.smartergpt/**`. Not the app; it's inputs the runner consumes.
- **Merge pyramid**: The plan → gates → weave/merge process the runner executes.

## Process & Artifacts
- **Gate**: A deterministic check (lint, typecheck, test, determinism) run locally and/or in CI.
- **Plan**: The resolved set of items to merge (eventually `plan.json`, schema-versioned).
- **Stack**: User-authored prioritization/dependency hints (e.g., `.smartergpt/stack.yml`).
- **Item**: A unit in the plan (often a PR).
- **Integration branch**: Temporary branch used to weave/verify a batch of items before merging to `main`.

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
