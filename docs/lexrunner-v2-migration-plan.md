# LexRunner v2 Migration Plan

> **Historical / superseded:** The sibling-package transition below was never executed as the
> active LexRunner migration. It is retained only as decision provenance. The maintained package is
> `@smartergpt/lexrunner`; current release planning is owned by issue #795 and current architecture
> by [ADR-010](./adr/ADR-010-agent-work-orchestration-protocol.md). Do not use these phases as an
> implementation plan.
>
> **Purpose:** Define the phased transition from LexRunner v1 to v2.
> **Status:** Historical superseded plan
> **Date:** 2025-12-08

---

## 1. Bootstrap Strategy

### 1.1 Recommended Approach: Sibling Package

Create v2 as a **sibling package** within the same monorepo, allowing both to coexist:

```
lex-mcp/
  lex/                    # Lex (memory, policy)
  lexsona/                # LexSona (constraints)
  lexrunner/          # v1 (frozen)
  lex-runner/             # v2 (new)
```

**Rationale:**

- Clean separation — no risk of v1/v2 code mixing
- Both versions installable (`@lex/runner` vs `@lex/runner-legacy`)
- Clear versioning: v2 starts at `2.0.0`
- v1 remains available for legacy workflows

### 1.2 Alternative: `src/v2` Tree

Less preferred, but viable if monorepo restructuring is too heavy:

```
lexrunner/
  src/           # v1 (frozen, eventually deprecated)
  src-v2/        # v2 (new implementation)
  package.json   # Exports both
```

**Cons:**

- Shared `node_modules` and config complexity
- Less clear boundary

### 1.3 Decision Required from Guff

**Question:** Sibling package or `src/v2` tree?

My recommendation: **Sibling package** (`lex-runner/`)

---

## 2. Milestones

### M0: Contract Sign-off (Target: Week 1)

**Deliverables:**

- [x] `docs/lexrunner-v1-summary.md` — Current state documented
- [x] `docs/lexrunner-v2-contract.md` — v2 contract drafted
- [x] `docs/lexrunner-v2-salvage-map.md` — Salvage map created
- [x] `docs/lexrunner-v2-migration-plan.md` — This document

**Exit criteria:**

- Guff signs off on contract
- Open questions answered (see §5)
- v1 freeze tag agreed

---

### M1: v1 Freeze & v2 Bootstrap (Target: Week 2)

**Deliverables:**

- Tag v1 as `lexrunner-v1-final`
- Create `lex-runner/` directory (or `src-v2/`)
- Scaffold v2 with:
  - `package.json` with correct dependencies
  - `tsconfig.json`
  - Basic directory structure per contract §7.1
  - Empty `src/core/dag.ts`, `src/errors/`, etc.

**Exit criteria:**

- `npm run build` succeeds (empty but valid)
- `npm test` runs (no tests yet, but harness works)
- v1 is frozen (no new features, only critical fixes)

---

### M2: Core DAG + AX Guarantees (Target: Weeks 3-4)

**Deliverables:**

- Port `mergeOrder.ts` → `src/core/dag.ts`
- Port AXError infrastructure → `src/errors/`
- Port canonical JSON + hash utils → `src/util/`
- Implement basic plan loading (Schema v2)
- Port determinism tests

**Exit criteria:**

- `lex-runner plan create --json` works with test input
- Determinism tests pass
- AXError shape tests pass

---

### M3: First End-to-End Workflow (Target: Weeks 5-6)

**Deliverables:**

- Implement `lex-runner run --plan <file>` (dry-run mode)
- Implement basic gate execution
- Integrate with Lex for Frame emission (not local storage)
- Integrate with LexSona for constraint checking (shadow mode)

**Exit criteria:**

- Can run merge-weave on test plan
- Frame emitted to Lex store
- Constraints derived from LexSona
- `--json` output follows AX 2.1

**First workflow to support:** `merge-weave-main` (the core use case)

---

### M4: CLI & MCP Parity (Target: Weeks 7-8)

**Deliverables:**

- Full CLI with core commands (per contract §8.1)
- MCP server with core tools
- `lex-runner doctor` for diagnostics
- `lex-runner config show` for debugging

**Exit criteria:**

- All core CLI commands work
- MCP tools return structured responses
- Exit codes follow contract §3.2

---

### M5: v1 Deprecation (Target: Week 9+)

**Deliverables:**

- v1 README updated with deprecation notice
- Migration guide: v1 → v2
- CI runs both v1 and v2 (v2 is primary)
- v1 enters maintenance-only mode

**Exit criteria:**

- v2 is the default for new workflows
- v1 is only used for legacy/migration
- No new v1 development

---

## 3. Timeline Summary

```
Week 1:    M0 — Contract sign-off
Week 2:    M1 — v1 freeze, v2 bootstrap
Weeks 3-4: M2 — Core DAG + AX guarantees
Weeks 5-6: M3 — First end-to-end workflow
Weeks 7-8: M4 — CLI & MCP parity
Week 9+:   M5 — v1 deprecation
```

**Total estimated time:** 8-10 weeks to full v2, with v1 deprecated.

---

## 4. Risks and Mitigations

### 4.1 Lex Memory Store Integration

**Risk:** Lex store API may not be exactly what v2 needs for Frame storage.

**Mitigation:**

- Review Lex store API early (M2)
- If gaps exist, propose minimal additions to Lex (coordinated with Lex team)
- Fall back to local storage + sync if needed (not preferred)

### 4.2 LexSona Constraint Integration

**Risk:** LexSona may not have the constraint derivation API v2 expects.

**Mitigation:**

- Review LexSona API early (M2)
- Start with shadow mode (log constraints, don't enforce)
- Iterate on API surface collaboratively

### 4.3 GitHub API Mocking in Tests

**Risk:** Tests that need GitHub API are slow/flaky.

**Mitigation:**

- All GitHub tests use mocks (no real API calls in CI)
- Integration tests run separately, gated

### 4.4 v1 Users During Transition

**Risk:** Users relying on v1 features that v2 doesn't have.

**Mitigation:**

- v1 remains tagged and available
- Migration guide documents differences
- Critical v1-only features can be added to v2 if justified (contract amendment)

### 4.5 God-Object Recurrence

**Risk:** v2 could accumulate complexity over time.

**Mitigation:**

- Enforce file size limits (contract §7.2)
- Code review for boundary violations
- Periodic architecture reviews

---

## 5. Open Questions (Blocking M1)

### 5.1 Top Workflows for v2 Initial Scope

**Question:** Which 2-3 workflows must v2 support first?

**Suggested priority:**

1. `merge-weave-main` — Core use case
2. `gate-run` — Run gates on a plan
3. `plan-create` — Generate plan from stack/GitHub

**Guff decision needed:** Confirm or revise.

### 5.2 Breaking Changes Tolerance

**Question:** Is v2 free to reshape CLI/schema, or must we provide compat shims?

**Options:**

- **A) Full break:** v2 is a new major version, no compat shims
- **B) Partial shim:** v2 CLI accepts v1 flags but warns
- **C) Full compat:** v2 behaves like v1 unless opted in

**Recommendation:** Option A (full break). v1 remains for legacy.

**Guff decision needed:** Confirm or revise.

### 5.3 CLI Naming

**Question:** What should the v2 CLI be called?

**Options:**

- `lex-pr` (same as v1, but v2 version)
- `lex-runner` (new name, clearer purpose)
- `lexrun` (shorter)

**Recommendation:** `lex-runner` (matches package name).

**Guff decision needed:** Confirm or revise.

### 5.4 MCP Server Fate

**Question:** Keep MCP server as separate entry or merge into CLI?

**Options:**

- **A) Separate:** `lex-runner-mcp` (like v1)
- **B) Subcommand:** `lex-runner serve --mcp`
- **C) Remove:** MCP not needed for v2

**Recommendation:** Option A (separate), for simplicity.

**Guff decision needed:** Confirm or revise.

### 5.5 v1 Legacy Tag Name

**Question:** What should the v1 freeze tag be called?

**Options:**

- `lexrunner-v1-final`
- `v1-freeze-2025-12`
- `legacy-v1.0.0`

**Recommendation:** `lexrunner-v1-final`

**Guff decision needed:** Confirm or revise.

---

## 6. Success Criteria

### 6.1 v2 is Ready When:

- [ ] All AX-CONTRACT v0.1 guarantees are met
- [ ] Core workflows (merge-weave, gate-run) work end-to-end
- [ ] Frames stored in Lex (not local files)
- [ ] Constraints derived from LexSona (at least shadow mode)
- [ ] CLI is clean (<10 commands, all documented)
- [ ] MCP tools return structured AXErrors
- [ ] No file exceeds 400 lines
- [ ] Determinism tests pass

### 6.2 v1 is Deprecated When:

- [ ] v2 supports all critical workflows
- [ ] Migration guide exists
- [ ] README updated with deprecation notice
- [ ] CI prioritizes v2

---

## 7. Resource Requirements

### 7.1 Human Time

- **Guff:** Review and decision points (~2-4 hours total across milestones)
- **Opie (or equivalent model):** Implementation (~40-60 hours total)

### 7.2 Dependencies

- Lex: Must expose Frame storage API
- LexSona: Must expose constraint derivation API
- GitHub Actions: CI for both v1 and v2

### 7.3 Tooling

- Vitest for testing
- Zod for schemas
- Commander for CLI
- MCP SDK for tools

---

## 8. What Happens to v1 After Freeze

### 8.1 Maintenance Policy

- **Critical security fixes:** Applied
- **Critical bug fixes:** Applied (with discretion)
- **New features:** Rejected
- **Refactors:** Rejected

### 8.2 Sunset Timeline

- **Month 1-3 post-v2:** v1 available, no new development
- **Month 3-6:** v1 deprecated, migration encouraged
- **Month 6+:** v1 archived (no maintenance)

---

## 9. Next Steps (After Guff Sign-off)

1. **Guff reviews and annotates** this document + contract + salvage map
2. **Open questions answered** (§5)
3. **M0 declared complete**
4. **M1 begins:** Tag v1, bootstrap v2

---

## Signatures

**Guff (Human)**
[pending review]

**Opie (Claude Opus 4 — Senior Dev)**
I have drafted this migration plan based on the v2 contract and salvage map. It represents a pragmatic, phased approach to transitioning from v1 to v2 while preserving the value of v1's lessons.

[signed Opie ✶]
Date: 2025-12-08

---

_All four Phase 1-4 deliverables complete. Ready for Guff review._
