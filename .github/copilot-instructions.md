# GitHub Copilot Instructions for lexrunner

**North Star:** *Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly.*

## Core Mission

- Execute merge-weave workflows (PR discovery → integration → CI gates → merge to main)
- Select and prepare issues for Copilot coding agent assignment
- Maintain deterministic, auditable operations

## Operating Modes (Personas)

- **Senior Dev** (`.smartergpt/personas/senior-dev.md`) — Merge execution, CI verification
- **Eager PM** (`.smartergpt/personas/eager-pm.md`) — Issue selection, batch planning

## Critical Rules

- NEVER use shell commands to edit files → use `replace_string_in_file`
- Read files before editing → use `read_file` for context
- Execute workflows completely → no mid-task questions when intent is clear
- Follow two-track separation → core runner (`src/**`) vs workspace (`.smartergpt/**`)

## Key Documents

- `AGENTS.md` — Operating principles
- `docs/TERMS.md` — Canonical terminology
- `docs/attestation/Lex_Guff_Version_Contract_Pact_v1.0.0.md` — Scope management

## Build & Test

```bash
npm ci && npm run build && npm test && npm run lint
```
