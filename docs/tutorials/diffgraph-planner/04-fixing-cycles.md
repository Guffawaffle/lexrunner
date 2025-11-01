# Tutorial 4: Fixing Dependency Cycles

Learn how to identify and resolve circular dependencies in your PR dependency graph.

**Time to complete:** ~10 minutes

**Difficulty:** Intermediate

---

## Goal

Understand how dependency cycles occur, how to diagnose them, and how to break them effectively.

## Scenario

You have 4 PRs that accidentally create a circular dependency:

1. **PR-100:** Refactor core module
2. **PR-101:** Refactor types (depends on PR-100)
3. **PR-102:** Refactor utilities (depends on PR-101)
4. **PR-103:** Refactor validators (depends on PR-102, but PR-100 also depends on PR-103)

**Dependency graph (INVALID):**
```
PR-100 ──► PR-101 ──► PR-102 ──► PR-103
   ▲                                 │
   └─────────────────────────────────┘
```

**Cycle:** PR-100 → PR-101 → PR-102 → PR-103 → PR-100

## Prerequisites

- lex-pr-runner installed
- Basic understanding of dependency graphs
- Completed [Tutorial 1: Simple Stack](./01-simple-stack.md)

---

## Step 1: Create the Cycle (Don't Do This!)

First, let's understand how cycles happen by creating one.

### PR-100 Description (core refactor)

```markdown
# Refactor Core Module

Refactor core business logic.

## Dependencies
Depends-on: #103

## Changes
- Refactor core.ts
- Use new validators from PR-103
```

### PR-101 Description (types refactor)

```markdown
# Refactor Types

Update type definitions.

## Dependencies
Depends-on: #100

## Changes
- Refactor types.ts
- Use refactored core from PR-100
```

### PR-102 Description (utilities refactor)

```markdown
# Refactor Utilities

Update utility functions.

## Dependencies
Depends-on: #101

## Changes
- Refactor utils.ts
- Use updated types from PR-101
```

### PR-103 Description (validators refactor)

```markdown
# Refactor Validators

Update validation logic.

## Dependencies
Depends-on: #102

## Changes
- Refactor validators.ts
- Use updated utils from PR-102
```

**Problem:** PR-100 depends on PR-103, which depends on PR-102, which depends on PR-101, which depends on PR-100. **Circular dependency!**

---

## Step 2: Attempt to Generate Plan

```bash
lex-pr plan --from-github --output plan.json
```

**Expected output:**
```
🔍 Fetching open PRs from GitHub...
✓ Found 4 open PRs

📝 Parsing dependencies...
✓ Parsed dependencies: 4 explicit

🔍 Validating plan...
❌ Validation failed: Dependency cycle detected

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERROR: Dependency Cycle Detected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cycle path: PR-100 → PR-101 → PR-102 → PR-103 → PR-100

Detailed cycle:
  1. PR-100 (core) depends on PR-103 (validators)
  2. PR-103 (validators) depends on PR-102 (utils)
  3. PR-102 (utils) depends on PR-101 (types)
  4. PR-101 (types) depends on PR-100 (core)
  ↑                                            ↓
  └────────────────────────────────────────────┘

Suggestion: Remove one of the dependencies in the cycle to break it.
Consider removing the weakest or least critical dependency.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Plan generation failed!** The planner detected the cycle and prevented you from proceeding.

---

## Step 3: Diagnose the Cycle

### 3.1: Visualize the Cycle

```bash
# Generate cycle diagram (requires graphviz)
lex-pr plan --from-github --format=dot | dot -Tpng -o cycle.png
```

**Output (cycle.png):**
```
    ┌────────────────────────────┐
    │                            │
    ▼                            │
┌────────┐                  ┌────────┐
│ PR-100 │──────────────────► PR-103 │
│ (core) │                  │ (val.) │
└────┬───┘                  └────▲───┘
     │                           │
     │                           │
     ▼                           │
┌────────┐                  ┌────────┐
│ PR-101 │──────────────────► PR-102 │
│(types) │                  │(utils) │
└────────┘                  └────────┘
```

### 3.2: Identify Dependency Strengths

Review each dependency to determine which is the **weakest** or **least critical**:

```bash
# Generate dependency suggestions with confidence scores
lex-pr plan --suggest-deps --json | jq '.suggestions[] | select(.from == "PR-100" or .from == "PR-101" or .from == "PR-102" or .from == "PR-103")'
```

**Example output:**
```json
[
  {
    "from": "PR-100",
    "to": "PR-103",
    "reason": "explicit-footer",
    "confidence": 1.0,
    "evidence": { "explicit": ["Depends-on: #103"] }
  },
  {
    "from": "PR-101",
    "to": "PR-100",
    "reason": "explicit-footer + shared-files",
    "confidence": 1.0,
    "evidence": { "explicit": ["Depends-on: #100"], "files": ["src/core.ts", "src/types.ts"] }
  },
  {
    "from": "PR-102",
    "to": "PR-101",
    "reason": "explicit-footer + shared-files",
    "confidence": 1.0,
    "evidence": { "explicit": ["Depends-on: #101"], "files": ["src/types.ts", "src/utils.ts"] }
  },
  {
    "from": "PR-103",
    "to": "PR-102",
    "reason": "explicit-footer",
    "confidence": 1.0,
    "evidence": { "explicit": ["Depends-on: #102"] }
  }
]
```

**Analysis:**
- All dependencies are **explicit** (confidence 1.0)
- PR-101, PR-102 have **shared files** (stronger signal)
- PR-100 → PR-103 has **only explicit** dependency (weaker signal)

**Conclusion:** PR-100 → PR-103 is the **weakest link** (no file overlap evidence).

---

## Step 4: Break the Cycle

### Strategy 1: Remove the Weakest Dependency

Remove `Depends-on: #103` from PR-100.

**Updated PR-100 Description:**
```markdown
# Refactor Core Module

Refactor core business logic.

## Dependencies
(None - removed dependency on PR-103)

## Changes
- Refactor core.ts
- **Temporarily use old validators** (will update after PR-103 merges)
```

**Result:**
```
PR-100 (no deps)
   │
   ▼
PR-101 ──► PR-102 ──► PR-103
```

Now the cycle is broken! The dependency chain is:
- PR-100 (Layer 0, no dependencies)
- PR-101 → PR-100 (Layer 1)
- PR-102 → PR-101 (Layer 2)
- PR-103 → PR-102 (Layer 3)

### Strategy 2: Combine Circular PRs

If the cycle represents truly circular work, **merge the PRs into one**:

```bash
# Combine all 4 PRs into a single "mega refactor" PR
git checkout -b refactor/mega-refactor
git merge feature/core
git merge feature/types
git merge feature/utils
git merge feature/validators
git push origin refactor/mega-refactor
```

Then create a single PR for the combined work.

### Strategy 3: Use a Feature Branch

Merge all PRs to a feature branch first, then merge to main:

```bash
# Create feature branch
git checkout -b refactor/module-cleanup main

# Merge all PRs to feature branch (ignore dependencies)
git merge feature/core --no-ff
git merge feature/types --no-ff
git merge feature/utils --no-ff
git merge feature/validators --no-ff

# Then merge feature branch to main
git checkout main
git merge refactor/module-cleanup
```

---

## Step 5: Regenerate Plan

After breaking the cycle, regenerate the plan:

```bash
lex-pr plan --from-github --output plan.json
```

**Expected output:**
```
🔍 Fetching open PRs from GitHub...
✓ Found 4 open PRs

📝 Parsing dependencies...
✓ Parsed dependencies: 3 explicit (removed PR-100 → PR-103)

🔍 Validating plan...
✓ No cycles detected
✓ No orphan PRs

📊 Plan statistics:
  - 4 nodes
  - 3 edges
  - 4 layers (linear chain)

✓ Plan generated successfully
```

**Merge order:**
```
Layer 0: PR-100 (core)
Layer 1: PR-101 (types)
Layer 2: PR-102 (utils)
Layer 3: PR-103 (validators)
```

---

## Step 6: Execute the Fixed Plan

```bash
lex-pr execute --plan plan.json
```

**Expected output:**
```
📦 Executing plan: 4 items, 4 layers

Layer 0: PR-100 (core) ✓
Layer 1: PR-101 (types) ✓
Layer 2: PR-102 (utils) ✓
Layer 3: PR-103 (validators) ✓

✨ All items passed! Ready to merge.
```

---

## Step 7: Follow-Up PR (Optional)

If PR-100 needs to use the new validators from PR-103, create a follow-up PR:

**PR-104 Description:**
```markdown
# Update Core to Use New Validators

Update core module to use refactored validators from PR-103.

## Dependencies
Depends-on: #103

## Changes
- Replace old validator calls in core.ts
- Use new validation API
```

This completes the work without creating a cycle.

---

## Common Cycle Patterns

### Pattern 1: Mutual Dependencies

```
PR-A ←──► PR-B
```

**Solution:** Combine into one PR or make one-way dependency (A → B or B → A).

### Pattern 2: Three-Way Cycle

```
PR-A ──► PR-B
  ▲         │
  │         ▼
  └──── PR-C
```

**Solution:** Break weakest link (often the "convenience" dependency).

### Pattern 3: Long Cycle (4+ PRs)

```
PR-A → PR-B → PR-C → PR-D → PR-E → PR-A
```

**Solution:** Identify the weakest link (check file overlap) and remove it.

### Pattern 4: Implicit Cycle (File-Based)

```
PR-A ──explicit──► PR-B
  ▲                  │
  │                  ▼
  └───implicit── PR-C
```

**Solution:** Increase threshold to filter out the implicit dependency:
```bash
lex-pr plan --from-github --threshold=0.8
```

---

## Prevention Strategies

### 1. Review Dependencies Before Adding

Before adding `Depends-on:`, ask:
- Does the dependency already depend on me (directly or indirectly)?
- Can I accomplish the work without this dependency?
- Is this a "convenience" dependency or a hard requirement?

### 2. Use `plan --validate` Early

```bash
# Validate after each dependency addition
lex-pr plan --from-github --validate
```

Catch cycles **before** they become complex.

### 3. Prefer Linear Stacks

When possible, structure work as **linear chains** rather than complex graphs:

```
PR-1 → PR-2 → PR-3 → PR-4
```

Easier to reason about and less prone to cycles.

### 4. Use Feature Branches for Complex Work

For tightly-coupled changes:
```bash
# Create feature branch
git checkout -b feature/complex-refactor

# Create multiple PRs to feature branch
# Then create one PR: feature/complex-refactor → main
```

---

## Advanced: Detecting Cycles Programmatically

```typescript
import { validatePlan } from "./planner/validation.js";
import { loadPlan } from "./core/plan.js";

const plan = await loadPlan("plan.json");
const result = validatePlan(plan);

if (!result.valid) {
  const cycleErrors = result.errors.filter(e => e.type === "cycle");
  
  cycleErrors.forEach(err => {
    console.error(`Cycle detected: ${err.message}`);
    console.error(`Path: ${err.details.cyclePath?.join(" → ")}`);
    console.error(`Suggestion: ${err.suggestion}`);
  });
  
  process.exit(1);
}
```

---

## Next Steps

- **[Tutorial 5: Hybrid Workflow](./05-hybrid-workflow.md)** - Combining explicit + implicit dependencies
- **[Troubleshooting Guide](../../troubleshooting-planner.md)** - Complete error reference

## Related Documentation

- **[Diffgraph Planner Guide](../../diffgraph-planner.md)** - Complete feature documentation
- **[Validation](../../diffgraph-planner.md#validation--troubleshooting)** - Validation details
- **[Dependency Parser](../../dependency-parser.md)** - Parser documentation
