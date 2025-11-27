# ADR-002: Two-Track Separation

**Status:** Accepted
**Date:** 2025-11-25
**Authors:** lex-pr-runner team

---

## Context

The runner needs to be packageable and distributable. At the same time, users need a place to store local state, profiles, and deliverables. The question: how do we separate these concerns?

---

## Decision

We adopt **two-track separation**:

### Track A: Core Runner

Location: Repository root (`src/**`, CLI, MCP adapter, packaging, CI)

Characteristics:
- **Stateless** — Never stores user/work artifacts
- **Packageable** — Can be distributed via npm
- **Runtime-independent** — Never reads `.smartergpt/` at runtime

Contents:
- `src/` — TypeScript source
- `dist/` — Compiled output
- `package.json` — Dependencies
- CI recipes and packaging

### Track B: Portable Workspace

Location: `.smartergpt/**`

Characteristics:
- **Per-workspace** — Gitignored, not distributed
- **Replaceable** — Can be swapped between projects
- **Example profile** — The repo contains a canonical example

Tracked files:
- `intent.md`
- `scope.yml`
- `deps.yml`
- `gates.yml`
- `stack.yml`
- `pull-request-template.md`

Ignored directories:
- `.smartergpt/runner/`
- `.smartergpt/cache/`
- `.smartergpt/deliverables/`

**Deliverables are posted as PR comments, not committed.**

---

## Consequences

### Positive

- **Repos can adopt lex-pr-runner** without inheriting personal workspace
- **Workspace travels across repos** without changing the runner
- **Clean distribution** — npm package contains only code
- **Portable profiles** — Users can share profiles as templates

### Negative

- **Two directories to understand** — Learning curve
- **No default workspace** — Users must set up `.smartergpt/`

---

## References

- `/AGENTS.md` — Section 6: Two-Track Separation
- `/docs/TERMS.md` — Workspace profile definition
