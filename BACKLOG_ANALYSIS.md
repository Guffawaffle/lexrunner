# Backlog Analysis & Prioritization

**Date:** 2025-11-18
**Total Open Issues:** 48 (closed #269 only; kept #389, #390 open with reframing)
**Issues Analyzed:** All open issues
**Assigned to Copilot:** #346 (main branch guard), #342 (conflict counter fix)
**Conceptual R&D:** #390 (single issue runner - needs validation), #389 (workflow guidance - start with prompts)

## Executive Summary

### Issue Distribution by Category

| Category | Count | % of Total |
|----------|-------|------------|
| **LexRunner↔Lex Integration** | 21 | 42% |
| **Token Optimization** | 5 | 10% |
| **.smartergpt Structure Alignment** | 16 | 32% |
| **Merge-Weave Execute** | 11 | 22% |
| **Core Infrastructure** | 4 | 8% |
| **Other** | 3 | 6% |

**Note:** Issues can belong to multiple categories (epics overlap)

### Key Findings

1. **Recent Activity Spike:** 46/50 issues created in November 2025 (last 2 weeks)
2. **Epic-Heavy:** 9 epic parent issues organizing ~40 sub-issues
3. **Cross-Repo Dependencies:** 21 issues depend on Lex 0.4.0 features
4. **Conceptual vs Actionable:** ~30% are design/RFC issues, 70% are implementable

---

## Epic Structure Analysis

### Active Epics (9)

| Epic # | Title | Sub-Issues | Status | Priority |
|--------|-------|------------|--------|----------|
| **#335** | Merge-Weave Execute v1 (minimal-prompt, low-token) | 11 | 🔵 Active | **P1** |
| **#376** | Token Optimization Suite (80% cost reduction) | 5 | 🔵 Active | **P1** |
| **#347** | .smartergpt.local/.smartergpt structure v1 | 6 | 🔵 Active | **P1** |
| **#307** | Bundle Lex with public API | 3 | 🟢 Foundation | **P1** |
| **#311** | Hook fanout/merge-weave to emit Frames | 4 | 🟢 Integration | P2 |
| **#354** | Front-end capture pipeline (/idea → /create-project) | 3 | 🟡 Conceptual | P2 |
| **#390** | Single Issue Runner (autonomous execution) | 0 | 🟡 Conceptual | P3 |
| **#389** | Guided workflow tracks (MCP evolution) | 0 | 🟡 Conceptual | P3 |
| **#297** | Epic Umbrella Branches | 0 | 🟡 Planning | P3 |

**Legend:**
- 🔵 Active: Implementation in progress or ready
- 🟢 Foundation: Foundational work for other epics
- 🟡 Conceptual: Design/RFC stage, not yet actionable

### Parent Issues (Non-Epic)

| Issue # | Title | Sub-Issues | Status |
|---------|-------|------------|--------|
| **#91** | Enhanced Configuration Management | 2 (#298, #299) | Partially complete |
| **#92** | Test Infrastructure Improvements | 2 (#300, #301) | Partially complete |
| **#77** | Rollout Infrastructure & Production Readiness | 0 (not decomposed) | Planned |

---

## Relevance Scoring System

### Scoring Criteria (0-100 points)

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Strategic Alignment** | 30 pts | Aligns with North Star, core mission |
| **Dependencies Cleared** | 25 pts | No external blockers (Lex 0.4.0, etc.) |
| **Implementation Ready** | 20 pts | Clear AC, design complete, not RFC |
| **Business Impact** | 15 pts | ROI, user value, cost savings |
| **Technical Risk** | 10 pts | Low complexity, well-understood |

### Score Interpretation

- **90-100:** 🔥 **CRITICAL** - Work immediately
- **70-89:** 🚀 **HIGH** - Next sprint priority
- **50-69:** 📋 **MEDIUM** - Backlog, schedule when ready
- **30-49:** 🤔 **LOW** - Nice-to-have, revisit later
- **0-29:** ❄️ **ICE** - Defer indefinitely or close

---

## Scored Issue Priority List

### 🔥 CRITICAL (90-100 points)

**Ready to Work Now:**

1. **#394** - Add preflight conflict detection (98 pts)
   - ✅ Dependencies: None (just completed!)
   - ✅ Implementation: PR merged, tests passing
   - ✅ Impact: Saves time on merge failures, enables dry-run validation
   - **Status:** JUST COMPLETED - Close after validation

2. **#346** - CRITICAL: Merge-weave must NEVER merge to main (95 pts)
   - ✅ Dependencies: None
   - ✅ Implementation: Clear requirement, simple guard check
   - ✅ Impact: **SAFETY** - Prevents production data corruption
   - **Recommendation:** Work next

3. **#342** - Bug: Result.conflicts remains 0 despite failures (92 pts)
   - ✅ Dependencies: None
   - ✅ Implementation: Fix conflict counter logic
   - ✅ Impact: Accurate reporting for automation
   - **Recommendation:** Work after #346

### 🚀 HIGH (70-89 points)

**Ready When Dependencies Clear:**

4. **#329, #333, #334, #337** - Token Optimization Suite (Epic #376) (85 pts avg)
   - ⏳ Dependencies: None (can start immediately)
   - ✅ Implementation: Clear designs, ROI metrics defined
   - ✅ Impact: **80% cost reduction** = $800-1200/month savings
   - **Recommendation:** Start after critical fixes

5. **#370-375** - .smartergpt structure alignment (R-* series) (80 pts avg)
   - ⏳ Dependencies: Lex Epic #196 (in progress)
   - ✅ Implementation: Well-defined refactor tasks
   - ✅ Impact: Determinism, portability, clean precedence
   - **Recommendation:** Wait for Lex #196 completion

6. **#322-328, #330-332** - Merge-Weave Execute v1 (Epic #335) (78 pts avg)
   - ⏳ Dependencies: Some on Lex 0.4.0 (Frame schema)
   - ✅ Implementation: Mostly clear, some design work
   - ✅ Impact: Non-interactive execution, budget controls
   - **Recommendation:** Start #322-323 (no deps), wait for Lex 0.4.0 for #330

### 📋 MEDIUM (50-69 points)

**Backlog for Future Sprints:**

7. **#307-310** - Bundle Lex with public API (Epic #307) (65 pts)
   - ⏳ Dependencies: Lex packaging readiness
   - 🟡 Implementation: ADR needed, packaging strategy decision
   - ✅ Impact: Foundation for integration
   - **Recommendation:** Coordinate with Lex team

8. **#312-315** - Hook fanout/merge-weave to emit Frames (Epic #311) (62 pts)
   - ⏳ Dependencies: #307 (packaging), Lex #79 (Frame API)
   - ✅ Implementation: Event schema defined
   - ✅ Impact: Automatic memory/Atlas updates
   - **Recommendation:** Wait for #307 + Lex #79

9. **#298, #299, #300, #301** - Config/Test Infrastructure (#91, #92) (58 pts avg)
   - ✅ Dependencies: None (#300 for #301 only)
   - ✅ Implementation: Clear requirements
   - 🟡 Impact: DX improvements, good but not urgent
   - **Recommendation:** Fill-in work between major initiatives

10. **#340** - Merge-weave end-to-end example docs (55 pts)
    - ✅ Dependencies: None
    - ✅ Implementation: Documentation task
    - ✅ Impact: User onboarding, adoption
    - **Recommendation:** Good first issue, assign when ready

### 🤔 LOW (30-49 points)

**Nice-to-Have, Revisit Later:**

11. **#355-358** - Front-end capture pipeline (#354 Epic) (45 pts avg)
    - ⏳ Dependencies: Lex #191 (schemas), #359 (validation)
    - 🟡 Implementation: Requires Lex schemas first
    - 🟡 Impact: Workflow improvement, not critical path
    - **Recommendation:** Defer until Lex dependencies ready

12. **#317-319** - Paid-vs-free split, CI gates, release notes (Epic #316) (42 pts avg)
    - ⏳ Dependencies: #307, #311 (other epics must complete first)
    - ✅ Implementation: Straightforward
    - 🟡 Impact: Release polish, not blocking
    - **Recommendation:** Final epic before v0.1 release

13. **#339** - Improve conflict reporting structure (38 pts)
    - ✅ Dependencies: None
    - 🟡 Implementation: Enhancement, not critical
    - 🟡 Impact: Better UX, but conflicts already reported
    - **Recommendation:** Low priority enhancement

14. **#77** - Epic: Rollout Infrastructure & Production Readiness (35 pts)
    - ⚠️ Dependencies: Not decomposed yet
    - 🟡 Implementation: Needs sub-issues created
    - 🟡 Impact: Production readiness (post-v0.1)
    - **Recommendation:** Decompose when v0.1 features complete

### ❄️ ICE (0-29 points)

**Defer or Close:**

15. **#390** - Single Issue Runner (autonomous execution) (25 pts)
    - 🟡 Status: Conceptual R&D, needs Phase 0 validation
    - 🔴 Dependencies: Architecture reframing needed (extend runner, don't build parallel)
    - 🟡 Impact: Cost optimization potential (10-20x with mini models), needs proof
    - **Recommendation:** **KEEP OPEN** - Reframe as extensions to existing runner (issue-to-plan tool + LLM gate adapter + regression gates). Validate with real issues before implementation. Long-term R&D project (6-12 months), not near-term feature.
    - **Next step:** Phase 0 validation (2-4 weeks) - prove concept with 3 manual issues

16. **#389** - Guided workflow tracks (MCP evolution) (22 pts)
    - 🟡 Status: Conceptual UX research
    - ✅ Dependencies: None (can start with prompt library)
    - 🟡 Impact: Agent DX improvement, reduces token waste from trial-and-error
    - **Recommendation:** **KEEP OPEN** - Pivot from "guided MCP responses" to "layered guidance system". Start with prompt library (zero code), add workflow_guide() helper if useful, build orchestrator if needed. Keep MCP simple/deterministic.
    - **Next step:** Create prompt library for merge-weave workflow, test with agent (1-2 weeks)

17. **#297** - Epic Umbrella Branches (18 pts)
    - 🔴 Status: Design phase, transferred from lex repo
    - 🔴 Dependencies: Unclear, may need GitHub API changes
    - 🔴 Impact: Nice workflow improvement, not critical
    - **Recommendation:** **DEFER** - Revisit after core features stable

18. **#344, #345** - Cross-repo Frame validation/aliasing (15 pts avg)
    - ⏳ Dependencies: **Blocked** by Lex #88, #82-85
    - 🔴 Status: Validation tasks, no work until Lex ready
    - **Recommendation:** **DEFER** - Wait for Lex 0.4.0 release

---

## Recommendations

### Immediate Actions (This Week)

1. **Close #394** - Preflight conflict detection (just completed, validate and close)
2. **Work #346** - Add main branch protection guard (CRITICAL safety)
3. **Work #342** - Fix conflict counter bug (high value, clear fix)

### Short-Term (Next 2 Weeks)

4. **Start Token Optimization** (#329, #333, #334, #337 from Epic #376)
   - Massive ROI: 80% cost reduction
   - No dependencies, ready to work
   - High business value

5. **Monitor Lex #196** (.smartergpt structure epic)
   - Once complete, start R-* series (#370-375)
   - Critical for determinism and clean precedence

### Medium-Term (1-2 Months)

6. **Complete Merge-Weave Execute** (Epic #335)
   - Start with no-dependency issues (#322-328)
   - Wait for Lex 0.4.0 for Frame integration (#330)

7. **Lex Integration** (Epics #307, #311)
   - Coordinate with Lex team on packaging
   - Start public API definition (#308)
   - Frame emission hooks after packaging ready

### Long-Term (Post-v0.1)

8. **Release Prep** (Epic #316)
   - License compliance gates
   - CI for Frame emission
   - Migration guide

9. **Decompose #77** (Rollout Infrastructure)
   - Break into sub-issues when v0.1 features complete
   - Production monitoring, performance, ecosystem

### Issues to Close

**~~Recommend closing as not planned:~~** *(Updated: Keeping open with constructive reframing)*

- **#390** - Single Issue Runner - **KEEPING OPEN** with reframed approach (extend runner, validate first)
- **#389** - Guided workflow tracks - **KEEPING OPEN** with pivot to prompt library approach

**Recommend deferring:**

- **#297** - Epic Umbrella Branches (nice-to-have, revisit post-v0.1)
- **#344, #345** - Frame validation (blocked by Lex 0.4.0, can't work yet)

---

## Epic Dependency Graph

```
Foundation Layer (Must Complete First):
├─ #307 Bundle Lex with public API
│  ├─ #308 Define public API
│  ├─ #309 Package as npm dependency
│  └─ #310 Smoke test
│
└─ #376 Token Optimization Suite
   ├─ #329 Conflict templates
   ├─ #333 Gate reasoning cache
   ├─ #334 Dependency graph cache
   └─ #337 Token budget tracking

Integration Layer (Depends on Foundation):
├─ #311 Hook fanout/merge-weave (depends on #307)
│  ├─ #312 Event schema
│  ├─ #313 Fanout hook
│  ├─ #314 Merge-weave hook
│  └─ #315 Backfill command
│
├─ #335 Merge-Weave Execute (depends on #376, partial on #311)
│  ├─ #322 Spec + state machine
│  ├─ #323 Plan lock
│  ├─ #324 Conflict clustering
│  ├─ #325 AI-micro prompts
│  ├─ #326 Context diet
│  ├─ #327 Budget guards (uses #337)
│  ├─ #328 Gates + rollback
│  ├─ #330 Frames + metrics (depends on #311)
│  ├─ #331 CLI surface
│  └─ #332 E2E test
│
└─ #347 .smartergpt structure v1 (depends on Lex #196)
   ├─ #348 Move config to runner/
   ├─ #349 Logging, locks, cache
   ├─ #350 Deliverables retention
   ├─ #351 CI safety + env aliasing
   ├─ #352 Prompts precedence
   └─ #353 Documentation

Polish Layer (Final):
└─ #316 Paid-vs-free split (depends on #307, #311)
   ├─ #317 License compliance
   ├─ #318 CI gates for Frames
   └─ #319 Migration guide
```

---

## Work Stream Recommendations

### Stream 1: Critical Fixes & Safety (Start Immediately)

- **Week 1:** #346 (main branch guard), #342 (conflict counter fix)
- **Week 2:** #340 (merge-weave docs)

### Stream 2: Token Optimization (High ROI, No Blockers)

- **Weeks 1-3:** #329, #333, #334, #337 (Epic #376)
- **Expected Savings:** $800-1200/month

### Stream 3: .smartergpt Structure (Wait for Lex #196)

- **Weeks 3-6:** #370-375 (R-* series from Epic #347)
- **Start When:** Lex #196 merges (track status)

### Stream 4: Merge-Weave Execute (Parallel with Stream 3)

- **Weeks 3-8:** #322-328, #331-332 (no Lex deps)
- **Week 9+:** #330 (after Lex 0.4.0 Frame schema)

### Stream 5: Lex Integration (Foundation for Streams 6-7)

- **Weeks 4-8:** #307-310 (Epic #307)
- **Coordinate with:** Lex team on packaging strategy

### Stream 6: Frame Emission (Depends on Stream 5)

- **Weeks 9-12:** #311-315 (depends on #307 + Lex #79)

### Stream 7: Release Polish (Final)

- **Weeks 13-15:** #316-319 (depends on #307, #311)

---

## Metrics & Goals

### Issue Closure Targets

- **This Week:** ~~Close 2 (validate #394, close #390 or #389)~~ → **Updated:** Validate #394 only, kept #389/#390 open with guidance
- **Next 2 Weeks:** Close or defer 5-10 (speculative/blocked issues)
- **By End of Month:** Reduce open issues from 48 → 35-40 (via validation/completion, not just closures)

### Epic Completion Targets

- **This Month:** Complete #376 (Token Optimization) - 80% cost savings
- **Next Month:** Complete #335 (Merge-Weave Execute), #347 (.smartergpt structure)
- **Q1 2026:** Complete #307 (Lex integration), #311 (Frame hooks), #316 (Release prep)

### Health Metrics

- **Issue Age:** Keep 90% of issues \u003c 30 days old
- **Blocked Ratio:** Keep \u003c 20% of issues blocked by external dependencies
- **Epic Progress:** Complete 2-3 epics per month

---

## Next Steps

1. **Validate and close #394** (preflight conflict detection complete)
2. ~~**Close #390 and #389** as not planned (too speculative)~~ → **Updated:** Keep open with constructive reframing (see issue comments)
3. **Assign #346 and #342** to next work batch (critical fixes) → **Done:** Assigned to Copilot 2025-11-18
4. **Start #376 sub-issues** (#329, #333, #334, #337) - token optimization
5. **Monitor Lex #196** for .smartergpt structure readiness
6. **Create fresh roadmap** after backlog cleanup (replace old #269)

---

**Analysis Complete:** 2025-11-18
**Next Review:** After critical fixes + token optimization complete (~2 weeks)
