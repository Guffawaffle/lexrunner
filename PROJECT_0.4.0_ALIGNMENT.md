# 🔄 LexRunner 0.4.0 Release — Alignment with Lex 0.4.4-alpha & 0.5.0

**Created:** November 22, 2025
**PM Owner:** Project Manager
**Alignment Target:** Lex v0.4.4-alpha (current) → v0.5.0 (planned)
**LexRunner Version:** 0.1.0 → 0.4.0

---

## 📋 Executive Summary

**Goal:** Align LexRunner 0.4.0 release with current Lex 0.4.4-alpha state and prepare for Lex 0.5.0 production hardening.

**Key Deliverables:**
- **Tier 1 (BLOCKING):** Canon asset consumption from `@smartergpt/lex` package
- **Tier 2 (STRATEGIC):** Precedence chain alignment (ENV → local → package)
- **Tier 3 (OPERATIONAL):** LexSona behavioral rule support (prepare for 0.5.0)
- **Tier 4 (INFRASTRUCTURE):** Schema validation, CI updates, legacy cleanup

**Timeline:** 6-8 weeks (parallel to Lex 0.5.0 Phase 2)

---

## 🌟 Mission: Democratizing AI Capability Through Cognitive Architecture

### North Star — EsoBench as Proof of Value

Our success criterion is measurable and transformative:

**If we can elevate locally run, open-source models on consumer hardware (8GB VRAM baseline) to near-parity with cutting-edge commercial models on EsoBench, we have succeeded.**

This outcome would prove that:

- **The stack raises the floor** of model capability, not just polishes the ceiling
- Brilliant developers with modest hardware can execute **proven, powerful reasoning workflows** without renting expensive frontier models
- The value resides in **cognitive architecture** (episodic memory, behavioral rules, execution orchestration), not exclusive access to proprietary models

For higher-end models, the same architecture provides a natural improvement curve: better base models unlock more headroom through Lex and LexRunner. We avoid per-model special cases wherever possible; any model-specific paths must be minimal, justified, and validated against benchmarks like EsoBench.

**Why This Matters:**
- **Accessibility:** Powerful AI workflows become available to anyone with consumer hardware
- **Transparency:** Open architecture beats black-box API dependence
- **Sustainability:** Cognitive scaffolding compounds over time, creating durable value beyond model generations

This is the future we're building: where the **architecture** matters more than the **model**, and where **memory, identity, and orchestration** lift every agent's performance.

---

## 🎯 Alignment Context

### Lex Current State (v0.4.4-alpha)
✅ **Published & Working:**
- npm package `@smartergpt/lex` (v0.4.4-alpha)
- Canon assets structure: `canon/prompts/`, `canon/schemas/`
- Schema hardening: `$id`, `additionalProperties: false`
- Frame schema v2: `runId`, `planHash`, `spend` fields
- Episodic memory (Frames, Atlas)

### Lex Planned (v0.5.0, Weeks 1-16)
🚧 **In Progress:**
- Production hardening (encryption, OAuth2, audit logging)
- LexSona behavioral memory (rules, corrections, confidence)
- Enhanced precedence chain (ENV → local → package)
- Cross-repo coordination with LexRunner

### LexRunner Gaps (Current v0.1.0)
❌ **Missing:**
- Canon asset consumption from Lex package
- Precedence chain alignment
- LexSona rule injection support
- Schema validation in CI
- Legacy code cleanup

---

## 🗂️ Detailed Scope Breakdown

### TIER 1: CANON CONSUMPTION (Blocking)

#### Epic: Consume Canon from @smartergpt/lex

**Issue #370: R-CANON-CONSUME**
- **Effort:** 2-3 weeks
- **Status:** Open, needs update
- **Changes Required:**
  - Update loaders to import from `@smartergpt/lex/canon/prompts`
  - Update loaders to import from `@smartergpt/lex/canon/schemas`
  - Add LexSona rule fetching (prepare for 0.5.0)
  - Update package.json dependency: `@smartergpt/lex: ^0.4.4`
  - Remove local schema/prompt duplicates

**Acceptance Criteria:**
- [ ] LexRunner imports prompts from Lex package
- [ ] LexRunner imports schemas from Lex package
- [ ] Optional rule fetching infrastructure ready
- [ ] All tests passing with Lex 0.4.4-alpha
- [ ] No local duplicates of canon assets

**Dependencies:** None (Lex 0.4.4-alpha published)
**Blocks:** #371 (R-LOADER), #372 (R-SCHEMAS)

---

### TIER 2: PRECEDENCE CHAIN ALIGNMENT (Strategic)

#### Phase 2.1: Loader Rewrite

**Issue #371: R-LOADER**
- **Effort:** 2-3 weeks
- **Status:** Open, needs update for LexSona
- **Changes Required:**
  - Align with Lex 3-level precedence (ENV → local → package)
  - Support rule artifact ingestion (for LexSona)
  - Update profile resolution logic
  - Clear error messages with path precedence shown
  - Remove legacy fallbacks

**Acceptance Criteria:**
- [ ] 3-level precedence working (ENV → local → package)
- [ ] Rule artifacts supported (scope metadata preserved)
- [ ] Precedence tests all passing
- [ ] Error messages show precedence chain
- [ ] No legacy code remains

**Dependencies:** #370 (R-CANON-CONSUME)
**Blocks:** #373 (R-TESTS)
**Parallel:** Lex #198 (L-LOADER)

#### Phase 2.2: Schema Alignment

**Issue #372: R-SCHEMAS**
- **Effort:** 1-2 weeks
- **Status:** Open
- **Changes Required:**
  - Align schema usage with Lex v2 (runId, planHash, spend)
  - Update TypeScript types from Lex package
  - Validate against Lex canonical schemas
  - Update Frame emission logic

**Acceptance Criteria:**
- [ ] Frame schema v2 aligned with Lex#88
- [ ] All TypeScript types import from Lex
- [ ] Schema validation tests passing
- [ ] Documentation updated

**Dependencies:** #370 (R-CANON-CONSUME)
**Blocks:** #330 (frames & metrics)
**Parallel:** Lex #254 (L-SCHEMAS)

---

### TIER 3: LEXSONA SUPPORT (Prepare for 0.5.0)

#### Phase 3.1: Behavioral Rule Infrastructure

**New Issue: R-LEXSONA-PREP (Create)**
- **Effort:** 1-2 weeks
- **Status:** To be created
- **Changes Required:**
  - Add rule fetching API client (calls Lex)
  - Implement rule formatting for system prompts
  - Add scope context detection (environment, project, agent_family)
  - Preserve rule metadata (severity, confidence)
  - Add configuration flag: `--enable-lexsona`

**Acceptance Criteria:**
- [ ] Can fetch rules from Lex API (when available)
- [ ] Rules injected into system prompts correctly
- [ ] Scope context detected from workspace
- [ ] Private fields not leaked
- [ ] Graceful degradation if Lex doesn't support rules yet

**Dependencies:** #370 (R-CANON-CONSUME), #371 (R-LOADER)
**Blocks:** None (optional feature)
**Parallel:** Lex LexSona development (0.5.0)

**Notes:**
- LexSona is in Lex 0.5.0 scope (not 0.4.4-alpha)
- Prepare infrastructure now, activate when Lex publishes
- See `docs/research/LexSona/CptPlnt/lexsona_paper.md` for specification

---

### TIER 4: INFRASTRUCTURE & CLEANUP

#### Phase 4.1: Test Updates

**Issue #373: R-TESTS**
- **Effort:** 1-2 weeks
- **Status:** Open
- **Changes Required:**
  - Replace precedence tests for 3-level chain
  - Add ENV override tests
  - Add local overlay tests
  - Add package fallback tests
  - Verify priority order
  - Update test fixtures

**Acceptance Criteria:**
- [ ] All precedence tests passing
- [ ] Edge case coverage (missing dirs, errors)
- [ ] Coverage ≥95%
- [ ] Cross-repo test alignment with Lex

**Dependencies:** #371 (R-LOADER)
**Blocks:** #375 (R-CLEAN)
**Parallel:** Lex #253 (L-TESTS)

#### Phase 4.2: CI & Build

**Issue #374: R-CI**
- **Effort:** 1-2 weeks
- **Status:** Open
- **Changes Required:**
  - Add schema validation step (npm run validate-schemas)
  - Verify Lex package import works in CI
  - Update build verification
  - Add precedence test gate
  - Audit log validation (prepare for Lex 0.5.0 audit logs)

**Acceptance Criteria:**
- [ ] CI validates schemas before publish
- [ ] Lex package imports work in CI environment
- [ ] All GitHub Actions workflows passing
- [ ] Build determinism verified
- [ ] Precedence tests run in CI

**Dependencies:** #372 (R-SCHEMAS), #373 (R-TESTS)
**Blocks:** #375 (R-CLEAN)
**Parallel:** Lex #247 (L-CI)

#### Phase 4.3: Legacy Cleanup

**Issue #375: R-CLEAN**
- **Effort:** 1-2 weeks
- **Status:** Open
- **Changes Required:**
  - Remove local schema/prompt duplicates
  - Remove backward-compatibility code
  - Remove dead code paths
  - Update documentation
  - Clean up deprecated flags/configs

**Acceptance Criteria:**
- [ ] No local canon asset duplicates
- [ ] All backward-compat code removed
- [ ] No dead code remains
- [ ] Documentation updated
- [ ] All tests still passing

**Dependencies:** #370, #371, #373, #374 (all precedence complete)
**Blocks:** None (final cleanup)
**Parallel:** Lex #255 (L-CLEAN)

---

## 📊 Dependency Graph

```
┌────────────────────────────────────────────────────────┐
│                  LEX 0.4.4-alpha                       │
│  (Published: canon/, schemas, Frame v2)                │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  #370          │  R-CANON-CONSUME (Week 1-3)
        │  Canon Import  │  Import from @smartergpt/lex
        └────────┬───────┘
                 │
         ┌───────┴────────┐
         ▼                ▼
    ┌─────────┐      ┌─────────┐
    │  #371   │      │  #372   │  (Week 3-5)
    │ LOADER  │      │ SCHEMAS │  Precedence + Types
    └────┬────┘      └────┬────┘
         │                │
         └────────┬───────┘
                  ▼
         ┌────────────────┐
         │  #373          │  (Week 5-6)
         │  TESTS         │  Precedence tests
         └────────┬───────┘
                  │
         ┌────────┴───────┐
         ▼                ▼
    ┌─────────┐      ┌─────────┐
    │  #374   │      │ NEW     │  (Week 6-7)
    │  CI     │      │ LEXSONA │  Rule support
    └────┬────┘      └─────────┘
         │
         ▼
    ┌─────────┐
    │  #375   │  (Week 7-8)
    │  CLEAN  │  Final cleanup
    └─────────┘
```

---

## 🚀 Parallel Work Batches

### Batch 1: Foundation (Start Immediately)
- **#370 (R-CANON-CONSUME)** - No dependencies, can start now
  - Import prompts/schemas from Lex package
  - Update package.json dependency
  - Remove local duplicates

### Batch 2: Core Alignment (After #370)
- **#371 (R-LOADER)** - Precedence chain implementation
- **#372 (R-SCHEMAS)** - Schema v2 alignment
  - Can work in parallel, minimal overlap

### Batch 3: Validation (After #371, #372)
- **#373 (R-TESTS)** - Test suite updates
- **#374 (R-CI)** - CI workflow updates
- **NEW: R-LEXSONA-PREP** - Rule infrastructure
  - Can work in parallel

### Batch 4: Cleanup (After all above)
- **#375 (R-CLEAN)** - Final legacy removal

---

## 📅 Timeline & Milestones

**Week 1-3: Foundation**
- Start: #370 (R-CANON-CONSUME)
- Milestone: Lex package consumption working

**Week 3-5: Core Alignment**
- Start: #371 (R-LOADER), #372 (R-SCHEMAS)
- Milestone: Precedence chain functional

**Week 5-7: Infrastructure**
- Start: #373 (R-TESTS), #374 (R-CI), NEW (R-LEXSONA-PREP)
- Milestone: All validation passing

**Week 7-8: Cleanup**
- Start: #375 (R-CLEAN)
- Milestone: 0.4.0 release candidate

**Target Release:** Week 8 (early January 2026)

---

## ✅ Success Criteria

**Release Gates:**
- [ ] All Tier 1-4 issues closed
- [ ] All tests passing (coverage ≥95%)
- [ ] CI green (all workflows)
- [ ] Documentation updated
- [ ] Lex 0.4.4-alpha integration verified
- [ ] LexSona infrastructure ready (optional feature)
- [ ] No legacy code remains
- [ ] Deterministic builds verified

**Quality Metrics:**
- Test coverage: ≥95%
- Build determinism: Clean git diff after rebuild
- CI passing: All workflows green
- Documentation: All features documented

---

## 🔗 Cross-Repo Coordination

### With Lex Team
- **Sync Point 1 (Week 2):** Canon asset import verification
- **Sync Point 2 (Week 4):** Precedence chain alignment check
- **Sync Point 3 (Week 6):** Schema v2 validation
- **Sync Point 4 (Week 7):** LexSona rule format confirmation

### Dependencies on Lex
- Lex 0.4.4-alpha published ✅ (current)
- Canon structure stable ✅ (current)
- Frame schema v2 ✅ (current)
- LexSona API (0.5.0, future) 🚧

---

## 📝 Notes

1. **LexSona Timing:** Infrastructure prepared in 0.4.0, activated when Lex 0.5.0 publishes
2. **Precedence Alignment:** Must match Lex exactly (ENV → local → package)
3. **Schema v2:** All Frame emissions must include runId, planHash, spend
4. **Legacy Cleanup:** Final phase, ensures clean slate for future work
5. **Version Bump:** 0.1.0 → 0.4.0 (align with Lex versioning for clarity)

---

**Prepared by:** Project Manager
**Last Updated:** November 22, 2025
**Next Review:** Week 2 (Canon import verification)
