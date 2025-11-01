# Tutorial 3: Large Batch Planning

Learn how to manage 20+ PRs with mixed explicit and implicit dependencies using the diffgraph planner.

**Time to complete:** ~15 minutes

**Difficulty:** Advanced

---

## Goal

Generate and execute a plan for a large batch of PRs (20+) with complex dependencies, using a hybrid workflow that combines explicit dependencies with file-based suggestions.

## Scenario

You have **25 open PRs** for a major refactoring project:

- **5 foundation PRs** (no dependencies)
- **10 feature PRs** (depend on foundation)
- **8 test PRs** (depend on features)
- **2 documentation PRs** (depend on everything)

**Challenge:** Some dependencies are explicit in PR descriptions, others must be discovered via file analysis.

## Prerequisites

- lex-pr-runner installed
- GitHub repository with 20+ open PRs
- GitHub token set: `export GITHUB_TOKEN=your_token_here`
- Completed [Tutorial 1](./01-simple-stack.md) and [Tutorial 2](./02-diamond-pattern.md)

---

## Step 1: Initial Discovery

List all open PRs to understand the scope:

```bash
# Discover PRs with specific label
lex-pr discover --labels "epic:refactor,ready-to-merge"
```

**Expected output:**
```
🔍 Discovering open PRs...
Found 25 PRs matching labels: epic:refactor, ready-to-merge

Foundation Layer (no Depends-on):
  #100: Refactor core schema
  #101: Refactor validation logic
  #102: Refactor error handling
  #103: Refactor logging system
  #104: Refactor config management

Feature Layer (some Depends-on):
  #110: Add schema migration tool (Depends-on: #100)
  #111: Add validation UI (Depends-on: #101)
  #112: Add error reporter
  #113: Add log viewer (Depends-on: #103)
  #114: Add config editor (Depends-on: #104)
  #115: Add batch processor
  #116: Add analytics module
  #117: Add export feature
  #118: Add import feature
  #119: Add search indexer

Test Layer (minimal Depends-on):
  #120: Add schema tests
  #121: Add validation tests
  #122: Add error handling tests
  #123: Add logging tests
  #124: Add config tests
  #125: Add integration tests
  #126: Add E2E tests
  #127: Add performance tests

Docs Layer:
  #130: Update API documentation
  #131: Update user guide
```

**Observation:**
- Only **5 explicit dependencies** declared
- Many PRs likely have **implicit dependencies** (e.g., tests depend on features)

---

## Step 2: Generate Dependency Suggestions

Use the planner to suggest missing dependencies:

```bash
lex-pr plan --suggest-deps --threshold=0.6 --format=markdown > suggestions.md
```

**Expected output (suggestions.md):**
```markdown
# Dependency Suggestions (15 found)

## High Confidence (≥0.7)

### PR-112 → PR-102 (Confidence: 0.92)
- **Heuristic:** shared-files
- **Reason:** Both modify src/errors.ts
- **Shared files:** src/errors.ts, src/error-types.ts
- **Recommendation:** Add `Depends-on: #102` to PR-112

### PR-120 → PR-100 (Confidence: 0.88)
- **Heuristic:** test-overlap
- **Reason:** Tests for schema module
- **Shared files:** tests/schema.spec.ts, src/schema.ts
- **Recommendation:** Add `Depends-on: #100` to PR-120

### PR-121 → PR-101 (Confidence: 0.85)
- **Heuristic:** test-overlap
- **Reason:** Tests for validation module
- **Shared files:** tests/validation.spec.ts, src/validation.ts
- **Recommendation:** Add `Depends-on: #101` to PR-121

...

## Medium Confidence (0.5-0.7)

### PR-115 → PR-110 (Confidence: 0.65)
- **Heuristic:** directory-proximity
- **Reason:** Both modify files in src/batch/
- **Shared directories:** src/batch
- **Recommendation:** Review code and add dependency if needed

...

## Low Confidence (<0.5)

(Filtered out by threshold=0.6)
```

**Analysis:**
- **15 suggestions** found
- **8 high-confidence** (≥0.7) - should add these
- **7 medium-confidence** (0.5-0.7) - review manually

---

## Step 3: Review and Add Dependencies

Review each high-confidence suggestion and add explicit dependencies to PR descriptions.

### Example: PR-120 (schema tests)

**Before:**
```markdown
# Add Schema Tests

Comprehensive test suite for schema module.

## Changes
- Add unit tests
- Add integration tests
```

**After (add dependency):**
```markdown
# Add Schema Tests

Comprehensive test suite for schema module.

## Dependencies
Depends-on: #100

## Changes
- Add unit tests
- Add integration tests
```

**Repeat for all high-confidence suggestions:**
- PR-112: Add `Depends-on: #102`
- PR-120: Add `Depends-on: #100`
- PR-121: Add `Depends-on: #101`
- PR-122: Add `Depends-on: #102`
- PR-123: Add `Depends-on: #103`
- PR-124: Add `Depends-on: #104`
- PR-125: Add `Depends-on: #110, #111, #112, #113, #114`
- PR-126: Add `Depends-on: #125`

---

## Step 4: Generate Final Plan

After updating PR descriptions, regenerate the plan:

```bash
lex-pr plan --from-github --output plan.json
```

**Expected output:**
```
🔍 Fetching open PRs from GitHub...
✓ Found 25 open PRs

📝 Parsing dependencies...
✓ Parsed dependencies: 23 explicit, 2 implicit (medium confidence)

🔍 Validating plan...
✓ No cycles detected
✓ No orphan PRs
✓ No invalid references

📊 Plan statistics:
  - 25 nodes
  - 27 edges
  - 6 layers
  - Max layer size: 10 items (Layer 1)

✓ Plan generated successfully
```

**Observations:**
- **6 layers** (not 25, thanks to parallelism)
- **Layer 1 has 10 items** (feature PRs, can run in parallel)
- **23 explicit + 2 implicit** dependencies

---

## Step 5: Review Merge Order

```bash
lex-pr merge-order plan.json
```

**Expected output:**
```
📊 Merge order for 25 items (6 layers):

Layer 0 (ready to merge, 5 items):
  → PR-100 (schema)
  → PR-101 (validation)
  → PR-102 (errors)
  → PR-103 (logging)
  → PR-104 (config)

Layer 1 (after Layer 0, 10 items):
  → PR-110 (schema-migration)
  → PR-111 (validation-ui)
  → PR-112 (error-reporter)
  → PR-113 (log-viewer)
  → PR-114 (config-editor)
  → PR-115 (batch-processor)
  → PR-116 (analytics)
  → PR-117 (export)
  → PR-118 (import)
  → PR-119 (search)

Layer 2 (after Layer 1, 5 items):
  → PR-120 (schema-tests)
  → PR-121 (validation-tests)
  → PR-122 (error-tests)
  → PR-123 (logging-tests)
  → PR-124 (config-tests)

Layer 3 (after Layer 2, 3 items):
  → PR-125 (integration-tests)
  → PR-126 (e2e-tests)
  → PR-127 (perf-tests)

Layer 4 (after Layer 3, 1 item):
  → PR-126 (e2e-tests) [if PR-125 still pending]

Layer 5 (after Layer 4, 2 items):
  → PR-130 (api-docs)
  → PR-131 (user-guide)
```

**Performance:**
- **Without parallelism:** ~300 seconds (25 PRs × 12s each)
- **With parallelism (max 10 workers):** ~72 seconds (6 layers × 12s)
- **Speedup:** ~4.2x faster

---

## Step 6: Execute with Parallel Workers

```bash
# Use 10 parallel workers
lex-pr execute --plan plan.json --max-workers 10
```

**Expected output:**
```
📦 Executing plan: 25 items, 6 layers
⚙️  Max workers: 10 (parallel execution enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 0: 5 items (parallel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Worker 1] Running gates for PR-100 (schema)...
[Worker 2] Running gates for PR-101 (validation)...
[Worker 3] Running gates for PR-102 (errors)...
[Worker 4] Running gates for PR-103 (logging)...
[Worker 5] Running gates for PR-104 (config)...

[Progress: ████████████████████████████] 5/5 items

All Layer 0 gates passed ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 1: 10 items (parallel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Worker 1] Running gates for PR-110...
[Worker 2] Running gates for PR-111...
...
[Worker 10] Running gates for PR-119...

[Progress: ████████████████████████████] 10/10 items

All Layer 1 gates passed ✓

...

✨ All 25 items passed! Ready to merge.
```

**Execution time:**
- Layer 0: ~12s (5 items in parallel)
- Layer 1: ~12s (10 items in parallel)
- Layer 2: ~12s (5 items in parallel)
- Layer 3: ~12s (3 items in parallel)
- Layer 4: ~12s (1 item)
- Layer 5: ~12s (2 items in parallel)
- **Total:** ~72 seconds

---

## Step 7: Execute Merge in Batches

For large batches, consider merging in smaller batches to reduce risk:

### Option A: Merge Layer by Layer

```bash
# Merge Layer 0 only
lex-pr merge --plan plan.json --layers 0 --execute

# Wait for validation, then merge Layer 1
lex-pr merge --plan plan.json --layers 1 --execute

# Continue for remaining layers...
```

### Option B: Merge All at Once

```bash
# Merge all 25 PRs in dependency order
lex-pr merge --plan plan.json --execute
```

**Recommendation:** For large batches, use **Option A** (layer-by-layer) to:
- Catch integration issues early
- Allow manual validation between layers
- Reduce risk of cascading failures

---

## Step 8: Monitor Progress

```bash
# Check merge status
lex-pr status plan.json
```

**Expected output:**
```
✅ Merged (10 items):
  PR-100, PR-101, PR-102, PR-103, PR-104 (Layer 0)
  PR-110, PR-111, PR-112, PR-113, PR-114 (Layer 1)

⏳ In Progress (5 items):
  PR-115, PR-116, PR-117, PR-118, PR-119 (Layer 1)

⏸️  Pending (10 items):
  PR-120-127 (Layer 2-3)
  PR-130-131 (Layer 5)
```

---

## Best Practices for Large Batches

### 1. Use Labels for Organization

```bash
# Tag PRs by layer
gh pr edit 100 --add-label "layer:foundation"
gh pr edit 110 --add-label "layer:feature"
gh pr edit 120 --add-label "layer:test"
```

Then filter:
```bash
lex-pr plan --from-github --labels "layer:foundation,layer:feature"
```

### 2. Set Appropriate Thresholds

```bash
# High threshold for large batches (reduce noise)
lex-pr plan --suggest-deps --threshold=0.7
```

### 3. Review Suggestions in Stages

```bash
# Step 1: Add only high-confidence deps (≥0.8)
lex-pr plan --suggest-deps --threshold=0.8 > high-confidence.md

# Step 2: Review and add to PR descriptions

# Step 3: Add medium-confidence deps (≥0.6)
lex-pr plan --suggest-deps --threshold=0.6 > medium-confidence.md

# Step 4: Review and add selectively
```

### 4. Use Dry-Run Mode

```bash
# Preview the entire plan before executing
lex-pr execute --plan plan.json --dry-run
```

### 5. Enable Parallel Execution

```bash
# Use max workers based on your CI capacity
lex-pr execute --plan plan.json --max-workers 10
```

---

## Common Issues

### Issue: GitHub API rate limiting

**Symptom:**
```
❌ Error: GitHub API rate limit exceeded
Remaining: 0/5000
```

**Solution:**
```bash
# Use authenticated token (higher rate limit)
export GITHUB_TOKEN=your_token_here

# Or reduce batch size
lex-pr plan --from-github --labels "priority:high" --output plan-p1.json
lex-pr plan --from-github --labels "priority:medium" --output plan-p2.json
```

### Issue: Too many layers (slow execution)

**Symptom:** Plan has 10+ layers.

**Solution:** Add missing dependencies to increase parallelism:
```bash
# Generate suggestions to find missing deps
lex-pr plan --suggest-deps --threshold=0.6

# Add deps to flatten the graph
```

### Issue: Large layer sizes (>20 items in one layer)

**Warning:**
```
⚠️  Warning: Large merge layer detected
Layer 1 contains 22 PRs (threshold: 10)
```

**Solution:** This is often valid, but verify:
1. Check if PRs truly have no dependencies
2. Consider splitting into sub-batches if they do

---

## Next Steps

- **[Tutorial 4: Fixing Cycles](./04-fixing-cycles.md)** - Resolving circular dependencies
- **[Tutorial 5: Hybrid Workflow](./05-hybrid-workflow.md)** - Combining explicit + implicit deps

## Related Documentation

- **[Diffgraph Planner Guide](../../diffgraph-planner.md)** - Complete feature documentation
- **[Parallel Execution](../../advanced-cli.md#parallel-execution)** - Tuning parallelism
- **[CI/CD Integration](../../ci-cd-integration.md)** - Automation patterns
