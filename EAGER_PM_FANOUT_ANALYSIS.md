# Eager PM Fanout Analysis - LexRunner

**Date:** December 16, 2025
**Status:** Ready for Coding Agent Assignment

---

## Executive Summary

**Current state:** 6 open draft PRs, 34 open issues, clean CI baseline (4028 tests passing)

**Recommendation:** Prioritize **Issue #589** (Ship one complete workflow) before fanning out additional work. This is the value proposition.

---

## 🎯 Priority 1: Critical Path to 1.0.0

### #589 - Ship one complete workflow: merge-weave-main end-to-end

**Status:** Just created (Dec 16, 2025)
**Priority:** CRITICAL
**Labels:** `1.0.0`, `priority:critical`

**Why this matters:**

> "A working merge-weave is the **value proposition** of LexRunner. Everything else is infrastructure. If merge-weave doesn't work end-to-end, nothing else matters."

**Definition of Done:**

- [ ] `lex-pr weave discover` works on any GitHub repo
- [ ] `lex-pr weave plan` generates valid plan.json
- [ ] `lex-pr weave apply --dry-run` shows correct execution order
- [ ] MCP tools work equivalently
- [ ] Documentation covers the happy path
- [ ] At least one integration test proves the flow

**Out of Scope (for now):**

- Executor canonicalization (#404 tree)
- Fan-out orchestration
- Policy enforcement hooks

**Recommendation:** ✅ **ASSIGN TO COPILOT FIRST**

This unblocks everything else. Once merge-weave works, the PRs become more valuable.

---

## 📊 Open PRs Analysis (6 total, all draft)

### Immediately Ready (No Blockers)

**PR #586 - Universal --json Flag Support** (ALN-004)

- **Ready:** ✅ No dependencies
- **Value:** Enables AI agent parsing of all CLI outputs
- **Effort:** Medium (13 tests, JSON envelope + schema docs)
- **Assign:** ✅ Yes, but AFTER #589

**PR #588 - Tool Budget Enforcement** (LPR-043)

- **Ready:** ✅ Foundation schemas exist in main
- **Value:** Runtime tool budget enforcement (24 unit tests)
- **Effort:** Medium
- **Assign:** ✅ Yes, but AFTER #589

### Has Dependencies

**PR #585 - Frame Emission Enforcement** (LPR-044)

- **Dependencies:** #405 (schema) - **MERGED** ✅
- **Ready:** ✅ Can proceed
- **Assign:** ✅ Yes, but AFTER #589

**PR #587 - Guardrail Runtime Enforcement** (LPR-047)

- **Dependencies:** #406 (types) - **MERGED** ✅, #407 (tool budget) - **PR #588**
- **Ready:** ⚠️ Needs #588 merged first
- **Assign:** After #588 merges

**PR #583 - Manifest Validation CI** (LPR-049)

- **Dependencies:** #405 (schema) - **MERGED** ✅, #412 (registry) - **NOT FOUND**
- **Ready:** ⚠️ Need to check if #412 is actually needed
- **Recommendation:** Review dependencies, may be ready

**PR #584 - CLI Category-Action Pattern** (ALN-003)

- **Status:** 🚫 **BLOCKED** - Firewall blocked GitHub API during Copilot execution
- **Dependencies:** #574 (naming conventions) - status unknown
- **Ready:** ❌ Needs firewall allowlist fix
- **Recommendation:** Create infrastructure ticket for firewall configuration

---

## 🎫 Fanout Ticket Recommendations

### Infrastructure Tickets (Create Now)

**CFG-001: Configure GITHUB_TOKEN for CLI discover command**

- **Priority:** High
- **Blocker for:** Merge-weave dogfooding
- **Description:** CLI `discover` command fails without GITHUB_TOKEN
- **Acceptance Criteria:**
  - [ ] GITHUB_TOKEN available in environment
  - [ ] `lex-pr weave discover` works without authentication errors
  - [ ] Document token setup in README

**CFG-002: Add GitHub API to Copilot firewall allowlist**

- **Priority:** High
- **Blocker for:** PR #584
- **Description:** Copilot coding agent cannot access GitHub API
- **Error:** `Firewall rules blocked me from connecting to https://api.github.com/`
- **Acceptance Criteria:**
  - [ ] GitHub API domains added to Copilot allowlist
  - [ ] PR #584 can be re-run or fixed
  - [ ] Document allowlist configuration

**EXE-012: Investigate #412 Executor Registry status**

- **Priority:** Medium
- **Blocks:** PR #583
- **Description:** PR #583 depends on #412 (Executor Registry & Loader) but registry code not found
- **Acceptance Criteria:**
  - [ ] Determine if #412 was merged under different name
  - [ ] Or: Create executor registry if missing
  - [ ] Update PR #583 dependencies

### Enhancement Tickets (After #589)

**ALN-005: Break CLI refactoring into smaller PRs**

- **Parent:** PR #584
- **Priority:** Low
- **Description:** PR #584 is large (weave + gate + workspace + fanout categories)
- **Recommendation:** Could be 4 separate PRs for easier review
- **Benefit:** Smaller blast radius, easier to merge incrementally

---

## 🏗️ Issue Priority Matrix

### Layer 0: Must Ship (1.0.0 Blockers)

| Issue | Title                          | Effort | Assigned | Status           |
| ----- | ------------------------------ | ------ | -------- | ---------------- |
| #589  | Ship one complete workflow     | L      | ❌       | **ASSIGN FIRST** |
| #578  | ALN-004: Universal --json flag | M      | PR #586  | Draft            |
| #576  | ALN-003: CLI category-action   | M      | PR #584  | Blocked          |

### Layer 1: Executor Canonicalization (Post-0.5.0)

| Issue | Title                           | Dependencies     | Status             |
| ----- | ------------------------------- | ---------------- | ------------------ |
| #407  | LPR-043: Tool budget            | #405 ✅          | PR #588 (draft)    |
| #408  | LPR-044: Frame emission         | #405 ✅          | PR #585 (draft)    |
| #411  | LPR-047: Guardrail enforcement  | #406 ✅, #407    | PR #587 (draft)    |
| #413  | LPR-049: Manifest validation CI | #405 ✅, #412 ⚠️ | PR #583 (draft)    |
| #415  | EXE-010: Senior Dev migration   | #412, #413       | Partially complete |
| #409  | LPR-045: Jordan-mode protocol   | #405 ✅, #406 ✅ | Not started        |

### Layer 2: Strategic/Future

| Issue | Title                           | Type        | Priority |
| ----- | ------------------------------- | ----------- | -------- |
| #486  | Epic: LexRunner 1.0.0 AX-Native | Epic        | Tracking |
| #389  | LPR-037: Guided workflow tracks | Enhancement | Medium   |
| #390  | LPR-038: Single issue runner    | Epic        | Vision   |
| #367  | Epic: Orchestrated fanout runs  | Epic        | Vision   |

---

## 🚦 Suggested Assignment Order

### Phase 1: Foundation (Week 1)

1. ✅ **#589** - Ship merge-weave end-to-end (CRITICAL)
2. Create **CFG-001** - GitHub token configuration
3. Create **CFG-002** - Firewall allowlist
4. Create **EXE-012** - Investigate #412 registry

### Phase 2: PR Cleanup (Week 2)

5. **PR #586** - Universal --json (after #589)
6. **PR #588** - Tool budget (after #589)
7. **PR #585** - Frame emission (after #589)
8. **PR #583** - Manifest validation (after EXE-012 resolves)

### Phase 3: Blockers (Week 2-3)

9. Fix **PR #584** (after CFG-002 resolves)
10. **PR #587** - Guardrails (after #588 merges)

### Phase 4: Polish (Week 3-4)

11. **#415** - Senior Dev migration
12. **#409** - Jordan-mode protocol

---

## 🎨 Epic Landscape

### Active Epics

- **#486** - LexRunner 1.0.0 (release tracking)
- **#335** - Merge-Weave Execute v1 (substantially complete)
- **#311** - Hook fanout/merge-weave events (substantially complete)

### Vision Epics (Don't Assign Yet)

- **#390** - Single issue runner mode
- **#389** - Guided workflow tracks
- **#367** - Orchestrated fanout runs
- **#376** - Token optimization suite

---

## 💡 Key Insights

### What's Working

- ✅ Copilot coding agent created well-structured PRs
- ✅ Comprehensive test coverage (24-59 tests per PR)
- ✅ Clear dependency declarations in issue bodies
- ✅ Foundation schemas (#405, #406) already merged

### What Needs Attention

- ⚠️ Missing GitHub token for CLI tooling
- ⚠️ Firewall configuration blocking Copilot agent
- ⚠️ #412 (Executor Registry) status unclear
- ⚠️ Large PRs (#584) could be broken down

### Strategic Recommendation

**Focus on value delivery:** Ship merge-weave end-to-end (#589) before expanding the executor framework. The executor work is infrastructure; merge-weave is the product.

---

## 📝 Next Actions for Eager PM

### Create These Tickets Now

1. **CFG-001** - Configure GITHUB_TOKEN
2. **CFG-002** - Add GitHub API to firewall allowlist
3. **EXE-012** - Investigate #412 Executor Registry

### Assign to Copilot (In Order)

1. **#589** - Ship one complete workflow (CRITICAL)
2. Wait for #589 to complete
3. Then assign PRs #586, #588, #585

### Review and Triage

1. Check if #574 (naming conventions) is merged
2. Verify #412 (Executor Registry) status
3. Consider breaking #584 into smaller PRs

---

## 🔄 Feedback Loop

### Dogfooding Observations

- ✅ MCP tools exist but need GitHub auth
- ✅ PR discovery works via GitHub API search
- ⚠️ CLI `discover` command needs token
- ⚠️ Plan creation tool needs better error messaging
- ⚠️ Should detect when foundation schemas are merged

### Tooling Improvements Needed

- Better error messages when GitHub auth fails
- Automatic dependency status detection
- Visualization of which PRs are ready vs blocked
- Integration with existing merge-weave plans

---

**End of Analysis**
