# Merge-Weave Intervention Catalog

> **Purpose:** Document every intervention type Senior Dev performs during merge-weave,
> categorized by determinism level for progressive model handoff.

## Determinism Levels

| Level | Name | Definition | Model Requirement |
|-------|------|------------|-------------------|
| D1 | Deterministic | Pure logic, explicit rules, no judgment | Any model (or script) |
| D2 | Bounded | Judgment within defined parameters | Mid-tier+ model |
| D3 | Stochastic | Requires reasoning about intent/quality | Frontier model only |

---

## Discovery Phase Interventions

### INT-001: PR Discovery
**Level:** D1
**Description:** List open PRs across configured repos
**Policy:** `discovery.repos`, `discovery.filters`
**Handoff Ready:** ✅ Yes - pure API call

### INT-002: Draft PR Handling
**Level:** D1 (with prefix match) / D2 (judgment on readiness)
**Description:** Decide whether to undraft PRs before merge
**Policy:** `discovery.draft_policy`
**Handoff Ready:** ✅ D1 portion (Copilot PRs, prefix match)

### INT-003: PR Filtering
**Level:** D1
**Description:** Include/exclude Dependabot, Copilot, human PRs
**Policy:** `discovery.filters`
**Handoff Ready:** ✅ Yes

---

## Dependency Resolution Interventions

### INT-004: Explicit Dependency Parsing
**Level:** D1
**Description:** Parse `Depends-on: #123` footer from PR body
**Policy:** `dependencies.resolution.depends_on_footer`
**Handoff Ready:** ✅ Yes - regex match

### INT-005: Cross-Repo Ordering
**Level:** D1
**Description:** Apply implicit order (lex → lexsona → lexrunner)
**Policy:** `discovery.repos.priority`
**Handoff Ready:** ✅ Yes - static config

### INT-006: Heuristic Dependency Detection
**Level:** D3
**Description:** Infer dependencies from file overlap, imports
**Policy:** `dependencies.resolution.heuristic_detection`
**Handoff Ready:** ❌ No - requires semantic understanding
**Status:** Disabled for now

---

## Quality Gate Interventions

### INT-007: Base Branch Verification
**Level:** D1
**Description:** Run install/build/test on main before merging
**Policy:** `gates.base_branch.required`
**Handoff Ready:** ✅ Yes - execute commands, check exit codes

### INT-008: CI Status Check
**Level:** D1
**Description:** Verify PR CI is green before merge
**Policy:** `gates.per_pr.require_ci_green`
**Handoff Ready:** ✅ Yes - API check

### INT-009: Conventional Commit Validation
**Level:** D1
**Description:** Verify PR title follows conventional commits
**Policy:** `gates.per_pr.review_checklist.conventional_commit_title`
**Handoff Ready:** ✅ Yes - regex match

### INT-010: Code Quality Assessment
**Level:** D3
**Description:** Review diff for bugs, patterns, security issues
**Policy:** `gates.per_pr.quality_assessment`
**Handoff Ready:** ❌ No - requires code understanding
**Mitigation:** Define explicit patterns to check (D1) vs general review (D3)

---

## Merge Execution Interventions

### INT-011: Squash Merge
**Level:** D1
**Description:** Execute squash merge with PR title as commit
**Policy:** `merge.method`, `merge.commit_title`
**Handoff Ready:** ✅ Yes - API call

### INT-012: Admin Authority Decision
**Level:** D2
**Description:** Decide whether to use admin merge (bypassing protection)
**Policy:** `merge.admin_authority.conditions`
**Handoff Ready:** ✅ If conditions are explicit and verifiable

### INT-013: Conflict Resolution
**Level:** D1 (file-pattern) / D3 (semantic)
**Description:** Resolve merge conflicts per merge-policy.yml
**Policy:** `merge-policy.yml`
**Handoff Ready:** ✅ D1 portion (glob-based resolution)

---

## Post-Merge Interventions

### INT-014: Pull and Verify
**Level:** D1
**Description:** Git pull, rebuild, run tests
**Policy:** `post_merge.pull_and_verify`
**Handoff Ready:** ✅ Yes

### INT-015: Tool Count Assertion Fix
**Level:** D2
**Description:** Update test assertions when MCP tools added
**Policy:** `post_merge.auto_fix.patterns`
**Example:** `assert.strictEqual(tools.length, 6)` → `7`
**Handoff Ready:** ✅ If pattern is explicit

### INT-016: Environment-Dependent Test Fix
**Level:** D2
**Description:** Add explicit paths to avoid env-specific behavior
**Policy:** `post_merge.auto_fix.patterns`
**Example:** `LexSona.connect()` → `LexSona.connect({ lexDb: "/nonexistent/..." })`
**Handoff Ready:** ⚠️ Partially - pattern match is D1, correct fix is D2

### INT-017: Fix Commit and Push
**Level:** D1 (commit) / D2 (message quality)
**Description:** Commit post-merge fixes and push to main
**Policy:** `post_merge.commit_fixes`
**Handoff Ready:** ✅ D1 portion

---

## Fanout Interventions

### INT-018: Follow-up Work Suggestion
**Level:** D1 (with templates) / D2 (without templates)
**Description:** Identify what new work is needed based on merged features
**Policy:** `fanout.suggestions.triggers`, `.smartergpt/fanout-templates.yml`
**Handoff Ready:** ✅ Yes - with fanout templates (see [fanout-templates.md](fanout-templates.md))

### INT-019: Issue Creation
**Level:** D1 (with templates) / D2 (without templates)
**Description:** Create well-formed GitHub issues for follow-up work
**Policy:** `.smartergpt/fanout-templates.yml`
**Handoff Ready:** ✅ Yes - template-based issue generation

**Implementation:** See `src/weave/fanout/` module for:
- `schema.ts` - Template schema and types
- `matcher.ts` - Pattern matching against PR diffs
- `generator.ts` - Issue generation with placeholder substitution

---

## Summary: Handoff Readiness

| Level | Interventions | Ready for Handoff | Blocking Factor |
|-------|---------------|-------------------|-----------------|
| D1 | 14 | ✅ All | None |
| D2 | 3 | ⚠️ With policy | Need explicit parameters |
| D3 | 2 | ❌ No | Requires semantic reasoning |

### Path to Full D1/D2 Coverage

1. **Define explicit patterns** for INT-010 (quality checks)
2. ~~**Create issue templates** for INT-019 (fanout issues)~~ ✅ Done (#611)
3. **Add test fixture patterns** for INT-015, INT-016 (auto-fixes)
4. **Track success rate** to validate D2 handoff readiness

### Metrics to Track

```yaml
handoff_metrics:
  - intervention_id
  - determinism_level
  - model_tier_used
  - success: boolean
  - required_human_override: boolean
  - time_to_complete_ms
```

When D2 interventions hit 95%+ success rate over 10 runs, they're ready for mid-tier handoff.
