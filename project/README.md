# Project Workspaces — R&D Playground

> **Status:** This directory is a local-only scratchpad for experimental executor development.  
> **Tracked:** Only this `README.md` is committed. All other contents are `.gitignore`d.

## Purpose

The `project/` directory is where new executors are prototyped before being promoted to canon. Nothing in here is production behavior. Use this space to:

- Spike new executor ideas (e.g., `eager-pm/`, `risk-auditor/`)
- Experiment with prompts, modes, and guardrail configurations
- Draft documentation before it's finalized
- Test Jordan-mode protocol implementations

## What Belongs Here

- Experimental prompts and templates
- Draft executor manifests (`executor-manifest.yaml`)
- Work-in-progress documentation
- Scratch notes and design explorations
- Any content that isn't ready for review

## What Does NOT Belong Here

- Production-ready executors (move to `executors/`)
- Committed code or tests (use `src/executors/` and `tests/`)
- Sensitive data or credentials
- Build artifacts or dependencies

## Promotion Path

When an executor prototype is ready, promote it from `project/` → `executors/`:

1. **Check the criteria** — See [docs/executor-authoring.md](../docs/executor-authoring.md#promotion-criteria-graduating-to-canon)
2. **Create the directory** — `executors/<name>/`
3. **Move artifacts** — Manifest, docs, prompts, scripts
4. **Wire up TypeScript** — Ensure `src/executors/<name>/` is complete
5. **Add tests** — Unit and integration tests in `tests/`
6. **Update CI** — Manifest validation, schema checks

## Current Experiments

| Directory | Description | Status |
|-----------|-------------|--------|
| `senior-dev/` | Legacy location — now canonical at `executors/senior-dev/` | ✅ Promoted |
| *(add your experiments here)* | | |

---

*For executor authoring guidelines, see [docs/executor-authoring.md](../docs/executor-authoring.md).*
