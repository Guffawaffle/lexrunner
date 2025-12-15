# GitHub Copilot Instructions for lex-pr-runner

**North Star:** *Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly.*

## Personas

Say **"ok senior dev"** or **"ok eager pm"** to activate a persona.
Personas are in `.smartergpt/personas/`.

| Persona | Trigger | Role |
|---------|---------|------|
| Senior Dev | "ok senior dev" | Implementation engineer |
| Eager PM | "ok eager pm" | Project planning |

## Universal Invariants

These rules apply regardless of persona:

- **Use `replace_string_in_file` for ALL file edits.** NEVER use sed/awk/perl/heredocs/vim.
- **Never force-push** without human approval.
- **Never bypass CI** gates.
- **Never merge to main** without approval (exception: delegated --admin after local CI passes).
- **Two-track separation:** `src/**` is core runner (stateless, packageable). `.smartergpt/**` is workspace (portable profile).
- **Deterministic outputs:** Sort explicitly; no random or time-dependent ordering.
- **TypeScript only.** Node 20 LTS.

## Naming Quick Reference

Use canonical terms per `docs/TERMS.md`:

- **lex-pr-runner (project/repo)**: The repository you're reading
- **Runner CLI (core runner)**: TypeScript command-line app under `src/**`
- **MCP server (adapter)**: Optional read-only adapter at `src/mcp/server.ts`
- **Workspace profile**: Portable example profile under `.smartergpt/**`

## Build & Test

- **Install:** `npm ci`
- **Lint:** `npm run lint`
- **Types:** `npm run typecheck`
- **Test:** `npm test`
- **Build:** `npm run build`
- **Determinism check:** After `npm run build && npm run format`, tree must be clean: `git diff --exit-code`

## Admin Authority Delegation

**Standing Grant (effective 2025-12-05):** Guff grants GitHub Copilot (Senior Dev / Eager PM personas) delegated `--admin` merge authority to main **when all local CI passes**.

**Conditions for `--admin` merge:**
1. All local CI gates pass: `npm run lint && npm run typecheck && npm test`
2. Merge target is `main` branch
3. Document CI pass in merge commit message

## References

- `AGENTS.md` — Full operational contract
- `docs/TERMS.md` — Canonical vocabulary
- `docs/legacy/copilot-instructions-full.md` — Complete instructions (archived)
- `.smartergpt/personas/` — Persona-specific guidance

## Directory Quick Map

- `src/` — Core library & CLI
- `schema/` — Generated schemas (CI verified)
- `tests/` — Vitest tests (`*.spec.ts`)
- `.github/` — Workflows, repo instructions
- `.smartergpt/` — Portable example profile

