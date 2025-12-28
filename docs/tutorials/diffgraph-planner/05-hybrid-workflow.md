# Tutorial 5: Hybrid Workflow

Learn how to combine explicit dependencies (from PR descriptions) with implicit dependencies (from file analysis) for optimal planning.

**Time to complete:** ~12 minutes

**Difficulty:** Advanced

---

## Goal

Master the hybrid workflow that combines team discipline (explicit dependencies) with automated discovery (file-based suggestions) to create accurate, maintainable dependency graphs.

## Scenario

You're on a **large team (10+ developers)** working on a feature with **15 open PRs**:

- **5 PRs** have explicit `Depends-on:` footers (team discipline)
- **10 PRs** are missing dependencies (developers forgot or didn't realize)
- **File analysis** detects **8 implicit dependencies**
- **Goal:** Combine both sources to generate a complete, accurate plan

## Prerequisites

- lexrunner installed
- GitHub repository with 10+ open PRs
- GitHub token set: `export GITHUB_TOKEN=your_token_here`
- Completed [Tutorial 1-4](./01-simple-stack.md)

---

## Step 1: Initial State Assessment

List all open PRs and their declared dependencies:

```bash
lex-pr discover --labels "epic:feature-x"
```

**Example output:**

```
🔍 Discovering open PRs...
Found 15 PRs:

With explicit dependencies (5 PRs):
  #100: Foundation API (no deps)
  #101: Auth service (Depends-on: #100) ✓
  #105: User service (Depends-on: #100) ✓
  #110: Dashboard UI (Depends-on: #101, #105) ✓
  #115: E2E tests (Depends-on: #110) ✓

Without explicit dependencies (10 PRs):
  #102: Validation utilities
  #103: Error handling
  #104: Logging module
  #106: Profile service
  #107: Settings service
  #108: Search service
  #111: Admin UI
  #112: Reporting UI
  #113: Integration tests
  #114: Performance tests
```

**Problem:** 10 PRs have no declared dependencies, but likely have real dependencies based on their code changes.

---

## Step 2: Generate Implicit Dependency Suggestions

Use file analysis to discover missing dependencies:

```bash
# Generate suggestions with high threshold (reduce noise)
lex-pr plan --suggest-deps --threshold=0.7 --format=markdown > suggestions.md
```

**Example output (suggestions.md):**

```markdown
# Dependency Suggestions (8 found)

## High Confidence (≥0.7)

### PR-102 → PR-100 (Confidence: 0.92)

- **Heuristic:** shared-files
- **Reason:** Both modify src/validation.ts
- **Shared files:** src/validation.ts, src/schema.ts
- **File overlap:** 2 files
- **Recommendation:** ✅ Add `Depends-on: #100` to PR-102

### PR-103 → PR-102 (Confidence: 0.88)

- **Heuristic:** shared-files + directory-proximity
- **Reason:** Both modify src/errors/ directory
- **Shared files:** src/errors/handler.ts, src/errors/types.ts
- **File overlap:** 2 files
- **Recommendation:** ✅ Add `Depends-on: #102` to PR-103

### PR-104 → PR-100 (Confidence: 0.85)

- **Heuristic:** test-overlap
- **Reason:** Tests for core module
- **Shared files:** tests/core.spec.ts, src/core.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #100` to PR-104

### PR-106 → PR-101 (Confidence: 0.82)

- **Heuristic:** shared-files
- **Reason:** Both modify src/auth/ directory
- **Shared files:** src/auth/session.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #101` to PR-106

### PR-111 → PR-101 (Confidence: 0.78)

- **Heuristic:** shared-files
- **Reason:** Admin UI uses auth service
- **Shared files:** src/auth/client.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #101` to PR-111

### PR-112 → PR-105 (Confidence: 0.75)

- **Heuristic:** shared-files
- **Reason:** Reporting UI uses user service
- **Shared files:** src/users/api.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #105` to PR-112

### PR-113 → PR-110 (Confidence: 0.73)

- **Heuristic:** test-overlap
- **Reason:** Integration tests for dashboard
- **Shared files:** tests/integration/dashboard.spec.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #110` to PR-113

### PR-114 → PR-100 (Confidence: 0.71)

- **Heuristic:** test-overlap
- **Reason:** Performance tests for core API
- **Shared files:** tests/perf/api.bench.ts
- **File overlap:** 1 file
- **Recommendation:** ✅ Add `Depends-on: #100` to PR-114
```

**Analysis:**

- **8 high-confidence suggestions** (≥0.7)
- All have clear **file overlap** evidence
- **Recommendations:** Add explicit dependencies for all 8

---

## Step 3: Review Suggestions (Human Oversight)

Review each suggestion to verify it's valid:

### Review Template

For each suggestion, ask:

1. **Does the file overlap make sense?**
   - ✅ YES: PR-102 modifies `validation.ts` created by PR-100
   - ❌ NO: Both modify `utils.ts` but for unrelated reasons

2. **Is there a logical dependency?**
   - ✅ YES: PR-106 (Profile service) needs auth from PR-101
   - ❌ NO: Both modify the same file but work is independent

3. **Will this PR fail without the dependency merged?**
   - ✅ YES: PR-113 tests dashboard from PR-110
   - ❌ NO: Tests are mocked and don't need the actual code

### Example Review: PR-102 → PR-100

**Suggestion:**

```markdown
### PR-102 → PR-100 (Confidence: 0.92)

- Shared files: src/validation.ts, src/schema.ts
```

**Check PR-102's changes:**

```bash
gh pr diff 102 | grep -A5 "validation.ts"
```

**Output:**

```diff
--- a/src/validation.ts
+++ b/src/validation.ts
@@ -1,5 +1,8 @@
+import { Schema } from './schema.js';  // ← From PR-100!
+
 export function validateInput(data: unknown) {
-  // Old validation logic
+  // New validation using Schema from PR-100
+  return Schema.validate(data);
 }
```

**Verdict:** ✅ **Valid dependency** - PR-102 imports code from PR-100.

**Action:** Add `Depends-on: #100` to PR-102 description.

---

## Step 4: Add Explicit Dependencies

Update PR descriptions based on approved suggestions:

### PR-102 (Validation Utilities)

**Before:**

```markdown
# Validation Utilities

Add validation helpers.

## Changes

- Add validateInput()
- Add validateOutput()
```

**After:**

```markdown
# Validation Utilities

Add validation helpers using schema from PR-100.

## Dependencies

Depends-on: #100

## Changes

- Add validateInput()
- Add validateOutput()
```

**Repeat for all approved suggestions:**

- PR-102: Add `Depends-on: #100`
- PR-103: Add `Depends-on: #102`
- PR-104: Add `Depends-on: #100`
- PR-106: Add `Depends-on: #101`
- PR-111: Add `Depends-on: #101`
- PR-112: Add `Depends-on: #105`
- PR-113: Add `Depends-on: #110`
- PR-114: Add `Depends-on: #100`

---

## Step 5: Generate Final Plan (Hybrid)

After adding explicit dependencies, regenerate the plan:

```bash
lex-pr plan --from-github --output plan.json
```

**Expected output:**

```
🔍 Fetching open PRs from GitHub...
✓ Found 15 open PRs

📝 Parsing dependencies...
✓ Parsed dependencies: 13 explicit (5 original + 8 added from suggestions)

🔍 Analyzing file changes...
✓ File analysis: 2 implicit suggestions (low confidence)

🔍 Validating plan...
✓ No cycles detected
✓ No orphan PRs

📊 Plan statistics:
  - 15 nodes
  - 15 edges (13 explicit + 2 implicit)
  - 5 layers
  - Max layer size: 4 items (Layer 2)

✓ Plan generated successfully
```

**Observations:**

- **13 explicit dependencies** (5 original + 8 from reviewed suggestions)
- **2 implicit dependencies** (low confidence, <0.7)
- **5 layers** (reduced from 15, thanks to discovered dependencies)

---

## Step 6: Review Implicit Dependencies (Optional)

Check the 2 remaining implicit dependencies:

```bash
lex-pr plan --suggest-deps --threshold=0.3 --json | jq '.suggestions[] | select(.confidence < 0.7)'
```

**Example output:**

```json
[
  {
    "from": "PR-107",
    "to": "PR-105",
    "reason": "directory-proximity",
    "confidence": 0.52,
    "sharedFiles": ["src/services/"],
    "heuristic": "directory-proximity"
  },
  {
    "from": "PR-108",
    "to": "PR-100",
    "reason": "shared-files",
    "confidence": 0.48,
    "sharedFiles": ["src/utils.ts"],
    "heuristic": "shared-files"
  }
]
```

**Analysis:**

- PR-107 → PR-105: Medium confidence (0.52), directory proximity
- PR-108 → PR-100: Low confidence (0.48), shared utility file

**Decision:**

- **PR-107:** Review manually - might be valid
- **PR-108:** Likely false positive (common utility file)

**Action:** Keep the threshold at 0.7, ignore low-confidence suggestions.

---

## Step 7: Execute the Hybrid Plan

```bash
lex-pr execute --plan plan.json --max-workers 4
```

**Expected output:**

```
📦 Executing plan: 15 items, 5 layers
⚙️  Max workers: 4 (parallel execution enabled)

Layer 0 (1 item):
  → PR-100 (foundation-api) ✓

Layer 1 (4 items, parallel):
  → PR-101 (auth-service) ✓
  → PR-102 (validation) ✓
  → PR-104 (logging) ✓
  → PR-105 (user-service) ✓

Layer 2 (4 items, parallel):
  → PR-103 (error-handling) ✓
  → PR-106 (profile-service) ✓
  → PR-107 (settings-service) ✓
  → PR-108 (search-service) ✓

Layer 3 (4 items, parallel):
  → PR-110 (dashboard-ui) ✓
  → PR-111 (admin-ui) ✓
  → PR-112 (reporting-ui) ✓
  → PR-114 (perf-tests) ✓

Layer 4 (2 items, parallel):
  → PR-113 (integration-tests) ✓
  → PR-115 (e2e-tests) ✓

✨ All 15 items passed! Ready to merge.
```

**Performance:**

- **Without dependencies:** Would take ~180s (15 PRs × 12s)
- **With hybrid plan:** ~60s (5 layers × 12s)
- **Speedup:** 3x faster

---

## Workflow Summary

```
┌──────────────────────────────────────┐
│ 1. Team adds explicit dependencies  │ ← Discipline
│    (5 PRs with Depends-on)          │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 2. Generate file-based suggestions   │ ← Automation
│    (8 high-confidence suggestions)   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 3. Human reviews suggestions         │ ← Human oversight
│    (approve all 8)                   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 4. Add approved deps to PR bodies    │ ← Make explicit
│    (13 total explicit dependencies)  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 5. Generate final plan               │ ← Deterministic
│    (combines explicit + implicit)    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 6. Execute plan                      │ ← Automated
└──────────────────────────────────────┘
```

---

## Best Practices for Hybrid Workflow

### 1. Set Appropriate Thresholds

```bash
# High confidence only (reduce false positives)
lex-pr plan --suggest-deps --threshold=0.7
```

**Guideline:**

- **≥0.8:** Very high confidence, almost always valid
- **≥0.7:** High confidence, good for hybrid workflow
- **≥0.5:** Medium confidence, requires manual review
- **<0.5:** Low confidence, likely false positive

### 2. Review Suggestions as a Team

```bash
# Generate suggestions as markdown for team review
lex-pr plan --suggest-deps --threshold=0.7 --format=markdown > suggestions.md

# Share in PR review or team chat
```

**Team discussion:**

- Which suggestions are valid?
- Which are false positives?
- What threshold works best for our codebase?

### 3. Make Implicit Dependencies Explicit

**Don't rely on implicit dependencies long-term:**

```markdown
# ❌ Bad: Rely on file-based suggestions

(No Depends-on in PR description)

# ✅ Good: Make it explicit after review

Depends-on: #100 # Added from file analysis suggestion
```

**Why:** Explicit dependencies are:

- **Deterministic** - won't change if files change
- **Documented** - clear intent in PR description
- **Reviewable** - team can validate

### 4. Document the Process

Add to your team's PR template:

```markdown
## Dependencies

<!-- List any PRs this depends on -->
<!-- Run `lex-pr plan --suggest-deps` to discover missing dependencies -->

Depends-on: #XXX
```

### 5. Validate Early and Often

```bash
# After each PR description update
lex-pr plan --from-github --validate
```

Catch issues **before** creating complex dependency graphs.

---

## Common Pitfalls

### Pitfall 1: Trusting Low-Confidence Suggestions

**Problem:** Adding dependencies with <0.5 confidence.

**Solution:** Use high thresholds (≥0.7) and review manually.

### Pitfall 2: Not Making Suggestions Explicit

**Problem:** Relying on implicit dependencies in the plan.

**Solution:** Always add approved suggestions to PR descriptions.

### Pitfall 3: Ignoring File Overlap

**Problem:** Skipping file analysis entirely.

**Solution:** Always run `--suggest-deps` to catch missing dependencies.

### Pitfall 4: No Team Discipline

**Problem:** Team never adds explicit dependencies.

**Solution:** Update PR template, educate team, enforce in code review.

---

## Next Steps

Congratulations! You've mastered the hybrid workflow. Continue learning:

- **[Diffgraph Planner Guide](../../diffgraph-planner.md)** - Complete feature reference
- **[Troubleshooting Guide](../../troubleshooting-planner.md)** - Error solutions
- **[CI/CD Integration](../../ci-cd-integration.md)** - Automate the workflow

## Related Documentation

- **[Dependency Scoring](../../diffgraph-planner.md#file-change-heuristics)** - How confidence is calculated
- **[Workflows & Best Practices](../../diffgraph-planner.md#workflows--best-practices)** - All three workflows
- **[CLI Reference](../../cli.md)** - Complete command documentation
