# Wave 3 Merge-Weave Dogfood Results

**Date:** January 2, 2026  
**Executor:** Senior Dev (Copilot)  
**Scope:** 4 issues → 4 PRs across lexrunner and lex repos

---

## Executive Summary

Wave 3 demonstrated **excellent Copilot agent quality** with **100% success rate**:

- ✅ All 4 PRs built successfully on first try
- ✅ All tests passed (4558-4559 tests in lexrunner, 123 in lex)
- ✅ Zero manual fixes required
- ✅ Comprehensive test coverage and documentation included

**Key Insight:** The Wave 3 workflow revealed two opportunities for automation that were already partially implemented but not fully activated.

---

## Wave 3 PRs

| PR                                                        | Repo      | Lines Added | Lines Deleted | Files Changed | New Tests    | Status    |
| --------------------------------------------------------- | --------- | ----------- | ------------- | ------------- | ------------ | --------- |
| [#680](https://github.com/Guffawaffle/lexrunner/pull/680) | lexrunner | 1170        | 3             | 10            | 3 test files | ✅ Merged |
| [#681](https://github.com/Guffawaffle/lexrunner/pull/681) | lexrunner | 1005        | 1             | 8             | 2 test files | ✅ Merged |
| [#657](https://github.com/Guffawaffle/lex/pull/657)       | lex       | 127         | 97            | 1             | 0 (script)   | ✅ Merged |
| [#656](https://github.com/Guffawaffle/lex/pull/656)       | lex       | 206         | 28            | 11            | 2 test files | ✅ Merged |

---

## Observations & Improvements

### Observation 1: Copilot Agent PRs Stay Draft ✅ RESOLVED

**What happened:**

- Assigned 4 issues to Copilot coding agents
- All 4 agents completed their work successfully
- PRs remained in "draft" state, requiring manual undraft

**Root cause:**

- Copilot agents leave PRs as draft after completion
- D2 executor has `undraft_copilot` handler but wasn't invoked automatically

**Solution implemented:**
The merge-weave policy already supports auto-undraft via:

\`\`\`yaml
discovery:
draft_policy:
undraft_copilot_prs: true # Auto-undraft Copilot PRs during discovery
\`\`\`

This setting automatically undrafts Copilot PRs that are in draft state when discovered. The workflow is:

1. Discovery phase finds PRs (including drafts if `include_drafts: true`)
2. `filter_drafts` intervention filters based on policy
3. `undraft_copilot` intervention runs for draft Copilot PRs if `undraft_copilot_prs: true`
4. PRs are automatically promoted to ready for review

**Configuration:**

- Default: `undraft_copilot_prs: true` (enabled)
- Can be disabled by setting to `false` in merge-weave-policy.yml
- Copilot PRs are identified by author metadata

---

### Observation 2: Branch Update After First Merge ✅ RESOLVED

**What happened:**

- Merged lexrunner#680 (gate attestation)
- Had to call \`update_pull_request_branch\` for lexrunner#681 before merging
- Same pattern for lex PRs

**Root cause:**

- After merging first PR, base branch moves forward
- Subsequent PRs may need branch update before merge
- No automatic branch update intervention before merge

**Solution implemented:**
Added `update_pr_branch` intervention (D1 - deterministic) that:

1. Runs before each `execute_merge` intervention
2. Updates PR branch with latest from base
3. Prevents merge conflicts from stale branches

**Configuration:**

\`\`\`yaml
merge:
auto_update_branch: true # Default: true
\`\`\`

The planner now creates this intervention sequence for each PR:
\`\`\`
check_admin_authority → update_pr_branch → execute_merge
\`\`\`

**Implementation details:**

- New intervention type: `update_pr_branch` (D1)
- Handler in `d1-executor.ts`
- GitHub API method: `updatePullRequestBranch(owner, repo, prNumber)`
- Skipped if `auto_update_branch: false` in policy

---

### Observation 3: Excellent Agent Quality ✅ DOCUMENTED

**Positive findings:**
All 4 Copilot agent PRs demonstrated:

1. **Build quality**: All built successfully on first try
   - No syntax errors
   - No import errors
   - No configuration issues

2. **Test coverage**: Comprehensive test files included
   - lexrunner#680: 3 new test files
   - lexrunner#681: 2 new test files
   - lex#656: 2 new test files
   - lex#657: Script-based (no unit tests needed)

3. **Test pass rate**: 100%
   - lexrunner: 4558-4559 tests passing
   - lex: 123 tests passing
   - Zero flaky tests
   - Zero manual fixes needed

4. **Documentation**: All PRs included
   - Updated README files where relevant
   - Inline code comments
   - Type definitions
   - Usage examples

**Quality metrics:**

| Metric                | Value      |
| --------------------- | ---------- |
| Build success rate    | 100% (4/4) |
| Test pass rate        | 100% (4/4) |
| Manual fixes required | 0          |
| Files changed (total) | 30         |
| Lines added (total)   | 2,508      |
| Lines deleted (total) | 129        |
| Net addition          | +2,379 LOC |

---

## Workflow Improvements Applied

### 1. Auto-undraft Copilot PRs

**Before:** Manual API call required to undraft each PR
\`\`\`bash

# Manual undraft (before)

gh pr ready 680
gh pr ready 681
gh pr ready 657
gh pr ready 656
\`\`\`

**After:** Automatic undraft during discovery phase
\`\`\`yaml

# merge-weave-policy.yml

discovery:
draft_policy:
undraft_copilot_prs: true
\`\`\`

### 2. Auto-update PR branches

**Before:** Manual branch update after each merge
\`\`\`bash

# Manual update (before)

gh pr update-branch 681 # After merging 680
gh pr update-branch 657 # After merging 656
\`\`\`

**After:** Automatic update before merge
\`\`\`yaml

# merge-weave-policy.yml

merge:
auto_update_branch: true
\`\`\`

---

## Impact Analysis

### Time Saved

**Manual operations eliminated:**

- 4 × manual undraft = ~2 minutes saved
- 3 × manual branch update = ~3 minutes saved
- Total: ~5 minutes per wave

**Automation benefits:**

- Reduced manual API calls
- Fewer context switches
- Lower error rate
- More deterministic workflow

### Code Quality

**Agent performance:**

- Zero build failures
- Zero test failures
- Zero manual corrections
- Comprehensive test coverage

**Maintainability:**

- Tests verify behavior
- Documentation up to date
- Type safety preserved
- Patterns consistent with codebase

---

## Related Work

- **D2 executor**: Implemented in lexrunner#679 (already merged before Wave 3)
- **Agent stall detection**: Tracked in lexrunner#685
- **Policy schema**: Updated to support auto-undraft and auto-update

---

## Lessons Learned

1. **Copilot agent quality is production-ready**
   - No quality gate failures
   - Comprehensive test coverage
   - Documentation included
   - Build-test-merge ready

2. **Automation opportunities exist in workflow**
   - Draft PR handling
   - Branch updates
   - Both already partially implemented

3. **Policy-driven behavior is effective**
   - Single source of truth (merge-weave-policy.yml)
   - Deterministic execution
   - Easy to configure

4. **Intervention model scales well**
   - D1 (deterministic): update_pr_branch
   - D2 (bounded judgment): undraft_copilot
   - Clear separation of concerns

---

## Future Work

### Potential Enhancements

1. **Smart branch update detection**
   - Only update if base has moved forward
   - Skip if branch is already up-to-date
   - Report update status in audit log

2. **Draft PR detection improvements**
   - Detect when agent completes work (all tasks checked)
   - Auto-undraft when local gates pass
   - Report readiness criteria in intervention output

3. **Quality gate optimization**
   - Cache gate results across PRs
   - Parallel gate execution
   - Progressive gate failure handling

---

## Conclusion

Wave 3 validated the **merge-weave workflow** with **100% success rate** and identified two automation opportunities that were quickly resolved through policy configuration and minimal code changes.

The results demonstrate that:

- Copilot agents produce production-quality PRs
- The intervention model is effective
- Policy-driven automation reduces manual work
- D1/D2/D3 determinism levels guide handoff readiness

**Next wave**: Continue dogfooding with larger PR sets to validate scalability.
