# Tutorial 2: Diamond Pattern Planning

Learn how to manage fan-out/fan-in dependencies where one PR depends on multiple independent PRs.

**Time to complete:** ~8 minutes

**Difficulty:** Intermediate

---

## Goal

Generate and execute a plan for a diamond-shaped dependency pattern, where a UI PR depends on both auth and API systems that can be developed in parallel.

## Scenario

You have 3 open PRs forming a diamond pattern:

1. **PR-100:** `feature/auth-system` - Add authentication system (independent)
2. **PR-101:** `feature/api-endpoints` - Add API endpoints (independent)
3. **PR-102:** `feature/dashboard-ui` - Add dashboard UI (depends on BOTH PR-100 and PR-101)

**Dependency graph:**

```
        PR-102 (UI)
        /        \
    PR-100      PR-101
    (auth)      (API)
```

**Key insight:** PR-100 and PR-101 are **independent** and can be merged in **parallel**.

## Prerequisites

- lexrunner installed
- GitHub repository with 3 open PRs
- GitHub token set: `export GITHUB_TOKEN=your_token_here`
- Completed [Tutorial 1: Simple Stack](./01-simple-stack.md)

---

## Step 1: Prepare PR Descriptions

### PR-100 (auth-system) Description

```markdown
# Add Authentication System

Implement core authentication:

- User login/logout
- Session management
- Password hashing

## Changes

- Add auth module
- Add session store
- Add security utilities

(No dependencies - independent work)
```

### PR-101 (api-endpoints) Description

```markdown
# Add API Endpoints

Implement REST API endpoints:

- GET /api/users
- POST /api/data
- DELETE /api/data/:id

## Changes

- Add API routes
- Add controllers
- Add validators

(No dependencies - independent work)
```

### PR-102 (dashboard-ui) Description

```markdown
# Add Dashboard UI

Implement dashboard interface that uses both auth and API:

- Login-protected dashboard
- Data visualization
- User profile display

## Dependencies

Depends-on: #100, #101

## Changes

- Add Dashboard component
- Add DataView component
- Add UserProfile component
```

**Key points:**

- PR-100 and PR-101 have **no dependencies** (parallel work)
- PR-102 **depends on both** PR-100 and PR-101
- PR-102 can only merge **after both** dependencies are merged

---

## Step 2: Generate Plan

```bash
lex-pr plan --from-github --output plan.json
```

**Expected output:**

```
🔍 Fetching open PRs from GitHub...
✓ Found 3 open PRs

📝 Parsing dependencies...
✓ Parsed dependencies: 2 explicit (PR-102 → PR-100, PR-102 → PR-101)

🔍 Validating plan...
✓ No cycles detected
✓ No orphan PRs

📊 Plan statistics:
  - 3 nodes
  - 2 edges
  - 2 layers (Layer 0: 2 items, Layer 1: 1 item)

✓ Plan generated successfully
```

**What happened:**

- Planner identified 2 **independent** PRs (PR-100, PR-101)
- Planner identified 1 **dependent** PR (PR-102 depends on both)
- Computed 2 layers (not 3, because PR-100 and PR-101 are parallel)

---

## Step 3: Review Merge Order

```bash
lex-pr merge-order plan.json
```

**Expected output:**

```
📊 Merge order for 3 items:

Layer 0 (ready to merge, 2 items can run in parallel):
  → PR-100 (auth-system)
  → PR-101 (api-endpoints)

Layer 1 (after Layer 0 completes):
  → PR-102 (dashboard-ui)
```

**Key insight:**

- **Layer 0** has **2 items** (PR-100 and PR-101)
- Both can merge **in any order** or **in parallel**
- **Layer 1** (PR-102) only merges **after both** Layer 0 items complete

**Parallelism:**
If your setup supports parallel execution (e.g., multiple CI runners), PR-100 and PR-101 can run gates **simultaneously**.

---

## Step 4: Execute Gates (Parallel)

```bash
lex-pr execute --plan plan.json --max-workers 2
```

**Expected output:**

```
📦 Executing plan: 3 items, 2 layers
⚙️  Max workers: 2 (parallel execution enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 0: 2 items (parallel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Worker 1] Running gates for PR-100 (auth-system)...
[Worker 2] Running gates for PR-101 (api-endpoints)...

[Worker 1]   ✓ lint: passed (1.1s)
[Worker 2]   ✓ lint: passed (1.3s)
[Worker 1]   ✓ typecheck: passed (2.4s)
[Worker 2]   ✓ typecheck: passed (2.6s)
[Worker 1]   ✓ test: passed (7.9s)
[Worker 2]   ✓ test: passed (8.2s)

[Worker 1] All gates passed for PR-100 ✓
[Worker 2] All gates passed for PR-101 ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 1: 1 item
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Running gates for PR-102 (dashboard-ui)...
  ✓ lint: passed (1.2s)
  ✓ typecheck: passed (2.7s)
  ✓ test: passed (12.5s)

All gates passed for PR-102 ✓

✨ All gates passed! Ready to merge.
```

**Observations:**

- PR-100 and PR-101 ran **simultaneously** (Worker 1 and Worker 2)
- Total time for Layer 0: ~8.2s (not 16s if sequential)
- PR-102 waited for **both** to complete before starting

**Performance gain:**

- Sequential: 8s + 8s + 12s = **28 seconds**
- Parallel: max(8s, 8s) + 12s = **20 seconds** (~28% faster)

---

## Step 5: Execute Merge

```bash
lex-pr merge --plan plan.json --execute
```

**Expected output:**

```
🚀 Executing merge plan...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 0: Merging 2 items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Merging PR-100 (auth-system)...
  ✓ Merged to main (sha: abc123)

Merging PR-101 (api-endpoints)...
  ✓ Merged to main (sha: def456)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 1: Merging 1 item
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Merging PR-102 (dashboard-ui)...
  ✓ Rebased onto main (includes PR-100 and PR-101)
  ✓ Merged to main (sha: ghi789)

✨ All PRs merged successfully!
```

**What happened:**

1. PR-100 and PR-101 merged to `main` (order doesn't matter)
2. PR-102 rebased onto `main` (now includes changes from both PR-100 and PR-101)
3. PR-102 merged to `main`

---

## Step 6: Verify Success

```bash
git log --oneline --graph -10
```

**Expected output:**

```
*   abc1234 Merge PR #102: Add dashboard UI
|\
| * def5678 Add Dashboard component (depends on auth + API)
*   ghi9012 Merge PR #101: Add API endpoints
|\
| * jkl3456 Add API routes
*   mno7890 Merge PR #100: Add authentication system
|\
| * pqr1234 Add auth module
* stu5678 Previous commit on main
```

**Verification:**

- ✅ All 3 PRs merged
- ✅ PR-102 includes changes from both PR-100 and PR-101
- ✅ No conflicts occurred

---

## Advanced: Visualize the Dependency Graph

```bash
# Generate visual graph (requires graphviz)
lex-pr plan --from-github --format=dot | dot -Tpng -o graph.png
```

**Output (graph.png):**

```
    ┌─────────┐
    │ PR-102  │
    │   (UI)  │
    └────┬────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼────┐
│PR-100 │ │PR-101 │
│(auth) │ │(API)  │
└───────┘ └───────┘
```

---

## Common Issues

### Issue: PR-102 gates fail due to missing dependencies

**Symptom:**

```
❌ test: failed for PR-102
Error: Cannot connect to auth system
```

**Cause:** PR-102's tests try to use auth/API features that don't exist yet.

**Solution:**
This is **expected** in the diamond pattern. The planner will:

1. Merge PR-100 and PR-101 first
2. Re-run gates for PR-102 (which should now pass)
3. Merge PR-102

**Alternative:** Use mocks in PR-102's tests so they pass before dependencies merge.

### Issue: Merge conflict when merging PR-102

**Symptom:**

```
❌ Merge conflict in src/dashboard.ts
```

**Cause:** PR-100 and PR-101 both modified the same file in incompatible ways.

**Solution:**

1. Resolve the conflict manually in PR-102:
   ```bash
   git checkout feature/dashboard-ui
   git merge main
   # Resolve conflicts
   git add .
   git commit
   git push
   ```
2. Re-run the planner (it will use the updated PR-102 branch)

---

## Variations

### Variation 1: Triple Dependencies

```
        PR-103 (final)
       /      |      \
   PR-100  PR-101  PR-102
```

PR-103 description:

```markdown
Depends-on: #100, #101, #102
```

Result: **3 layers** (Layer 0: 3 items, Layer 1: 1 item)

### Variation 2: Cascade Dependencies

```
        PR-103
          |
        PR-102
       /      \
   PR-100  PR-101
```

PR-102 description:

```markdown
Depends-on: #100, #101
```

PR-103 description:

```markdown
Depends-on: #102
```

Result: **3 layers** (Layer 0: 2 items, Layer 1: 1 item, Layer 2: 1 item)

---

## Next Steps

- **[Tutorial 3: Large Batch](./03-large-batch.md)** - Managing 20+ PRs
- **[Tutorial 4: Fixing Cycles](./04-fixing-cycles.md)** - Resolving circular dependencies
- **[Tutorial 5: Hybrid Workflow](./05-hybrid-workflow.md)** - Explicit + implicit dependencies

## Related Documentation

- **[Diffgraph Planner Guide](../../diffgraph-planner.md)** - Complete feature documentation
- **[Parallel Execution](../../advanced-cli.md#parallel-execution)** - Parallel gate execution
- **[Merge Strategies](../../cli.md#merge-strategies)** - Rebase vs merge vs squash
