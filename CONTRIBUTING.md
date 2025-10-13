# Contributing to lex-pr-runner

Thanks for your interest in contributing! This project builds a deterministic CLI that fans out work across many PRs, computes a merge pyramid, runs gates uniformly, and merges cleanly.

This guide keeps contributions small, deterministic, and easy to review.

## Quick start

- Node.js: 20.x (see `.nvmrc` and `package.json` engines)
- npm: 10.x (see `package.json` packageManager)

Setup:
- npm ci
- npm run build
- npm test

Useful scripts:
- Dev CLI (ts): `npm run cli -- <command>`
- Build artifacts: `npm run build`
- Types: `npm run typecheck`
- Tests: `npm test`

## Project layout

- `src/**`: TypeScript source for the Runner CLI and MCP adapter
- `docs/**`: Documentation
- `.smartergpt/**`: Portable example workspace profile (not read at runtime)
- `tests/**`: Vitest unit/integration tests

Two-track separation (firm): The core runner never stores user/work artifacts. Portable example profiles live under `.smartergpt/**` only.

## Commit style

Use imperative, descriptive commit messages. Optional prefixes:
- `runner:` core CLI changes under `src/**`
- `mcp:` adapter changes
- `schema:` schema updates and regeneration
- `tests:` test-only changes
- `docs:` documentation
- `ci:` CI/workflow changes
- `workspace:` portable profile assets under `.smartergpt/**`

Examples:
- `runner: Add retry/backoff to gate executor`
- `docs: Document plan schema validation CLI`

## PR guidelines

Keep PRs small and focused. One PR = one chat/task. Include a "How to verify" section with exact commands and expected outcomes.

Acceptance checklist per PR:
- [ ] Clear scope and acceptance criteria
- [ ] Deterministic outputs (stable order, sorted keys)
- [ ] Scripts/types/tests green (`build`, `typecheck`, `test`)
- [ ] Docs updated (README/docs) when public behavior changes

## Running the CLI locally

Examples:
- `npm run cli -- plan --from-github --json` → prints plan JSON to stdout
- `npm run cli -- execute plan.json --json` → runs gates with policy
- `npm run cli -- report ./gate-results --out md` → aggregates gate results

See `docs/cli.md` for the full command reference.

## Tests

- Run all tests: `npm test`
- Run a specific file: `npm test -- tests/<file>.spec.ts`

If adding public behavior or fixing a bug, prefer tests first (happy path + 1-2 edge cases). Ensure outputs are deterministic.

## Code style & types

- TypeScript-first; strict types preferred
- Keep modules small and pure where possible; isolate side-effects
- Use Zod for schemas and validation in `src/schema.ts`
- **Never use `process.exit()` directly** - use `throwExit()` from `src/util/exit.ts` instead for clean error handling (enforced via ESLint)
  - Exception: Emergency handlers in MCP server, standalone scripts, and examples are allowed
  - See PR #154 for context on exit discipline pattern

## Opening an issue

Use the issue templates (Bug report / Feature request). Include acceptance criteria and reproduce steps. Link related docs/PRs.

## Security

Never commit secrets. See `docs/SECURITY_IMPLEMENTATION.md`. Use the `lex-pr security` subcommands for scanning and validation.

## Release determinism

After `npm run build && npm run format`, the tree should be clean (`git diff --exit-code`). If generation changes are intentional, include them in the PR.

---
Thank you for helping improve lex-pr-runner! 💙
