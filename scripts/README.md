# lex-pr-runner Scripts

This directory contains utility scripts for lex-pr-runner development and adoption tracking.

## Dogfood Merge-Weave Workflow

### dogfood-merge-weave.sh

A parameterized, repo-agnostic script for executing merge-weave workflows. This script automates the complete workflow from plan generation to merge execution and reporting.

**Documentation:** [docs/dogfood-merge-weave-script.md](../docs/dogfood-merge-weave-script.md)

**Quick Start:**

```bash
# Dry run with existing plan
./scripts/dogfood-merge-weave.sh --plan merge-weave-dogfood.json --dry-run

# Execute from GitHub discovery
./scripts/dogfood-merge-weave.sh \
  --from-github \
  --owner myorg \
  --repo-name myrepo \
  --labels "ready-to-merge" \
  --execute

# Show help
./scripts/dogfood-merge-weave.sh --help
```

**Features:**
- Load plan from file or discover PRs from GitHub
- Automated workflow: validation → gates → analysis → merge → report
- Configurable artifacts directory with timestamps
- Rich output: JSON, Markdown reports, colored console output
- Graceful error handling for schema validation failures

## Adoption Metrics

### metrics-template.ts

Generate adoption metrics template with deterministic output for tracking lex-pr-runner usage.

**Usage:**

```bash
# Generate metrics template
npx tsx scripts/metrics-template.ts

# Save to file
npx tsx scripts/metrics-template.ts > metrics.json
```

**Output:**

```json
{
  "metrics": {
    "schemaVersion": "1.0.0",
    "period": { "start": "2024-01-08", "end": "2024-01-15" },
    "prMetrics": { "totalMerged": 0, "averageTimeToMerge": 0, "successRate": 0 },
    "gateMetrics": { "totalExecutions": 0, "passRate": 0, "averageExecutionTime": 0 },
    "dependencyMetrics": { "totalResolved": 0, "cyclesDetected": 0, "accuracyRate": 0 },
    "timeSavings": { "totalHoursSaved": 0, "automationRate": 0 },
    "badges": { "status": "testing", "prsPerWeek": 0, "successRate": 0 }
  },
  "badges": {
    "status": "https://img.shields.io/badge/status-testing-yellow",
    "prsPerWeek": "https://img.shields.io/badge/PRs%2Fweek-0-blue",
    "successRate": "https://img.shields.io/badge/success%20rate-0%25-red"
  }
}
```

**Features:**

- Deterministic output with canonical JSON key ordering
- Badge-ready URLs for README
- Placeholder values for tracking adoption metrics
- See [Issue #134](https://github.com/Guffawaffle/LexRunner/issues/134) for adoption tracking initiative

## Schema Generation

### generate-plan-schema.ts

Generate JSON schema from Zod plan schema definition.

```bash
npx tsx scripts/generate-plan-schema.ts
```

### generate-gate-schema.ts

Generate JSON schema from Zod gate schema definition.

```bash
npx tsx scripts/generate-gate-schema.ts
```

## Sample Repository Creation

### create-sample-repo.sh

Creates a sample Git repository with multiple feature branches and dependencies for testing the merge pyramid workflow.

### Usage

```bash
# Create sample repo with default name
./scripts/create-sample-repo.sh

# Create with custom name
./scripts/create-sample-repo.sh --name my-test-repo

# Create in custom directory
./scripts/create-sample-repo.sh --dir /path/to/repo
```

### Repository Structure

The script creates a repository with the following structure:

```
main (initial commit)
├── feature-a (independent)
├── feature-b (independent)
├── feature-c (depends on: feature-a)
├── bugfix/critical (depends on: feature-b)
└── feature-d (depends on: feature-c, bugfix/critical)
```

### Dependency Graph

```
feature-a ← feature-c ← feature-d
feature-b ← bugfix/critical ← feature-d
```

### Expected Merge Order

When processed by lex-pr-runner, the expected merge order is:

1. **Level 1**: `feature-a`, `feature-b` (independent, can merge in parallel)
2. **Level 2**: `feature-c`, `bugfix/critical` (depend on Level 1)
3. **Level 3**: `feature-d` (depends on Level 2)

### Testing Workflow

After creating the sample repository, follow these steps to test lex-pr-runner:

```bash
# 1. Navigate to the sample repo
cd /tmp/lex-pr-test-repo

# 2. Initialize lex-pr-runner workspace
lex-pr init --non-interactive

# 3. Verify environment
lex-pr doctor

# 4. Create deps.yml with branch dependencies
cat > .smartergpt.local/deps.yml <<EOF
version: 1
target: main
items:
  - id: feature-a
    branch: feature-a
    deps: []
    strategy: merge-weave
  
  - id: feature-b
    branch: feature-b
    deps: []
    strategy: merge-weave
  
  - id: feature-c
    branch: feature-c
    deps: [feature-a]
    strategy: merge-weave
  
  - id: bugfix-critical
    branch: bugfix/critical
    deps: [feature-b]
    strategy: merge-weave
  
  - id: feature-d
    branch: feature-d
    deps: [feature-c, bugfix-critical]
    strategy: merge-weave
EOF

# 5. Generate merge plan
lex-pr plan --out plan.json

# 6. View merge order
lex-pr merge-order plan.json

# 7. Execute quality gates
lex-pr execute plan.json

# 8. Preview merge operations
lex-pr merge plan.json --dry-run

# 9. Execute merge (when ready)
# lex-pr merge plan.json
```

### Files Created

The sample repository includes:

- `package.json`: Node.js project with test/lint/build scripts
- `README.md`: Project documentation
- `src/index.js`: Main application file
- `src/feature-a.js`: Feature A implementation
- `src/feature-b.js`: Feature B implementation
- `src/feature-c.js`: Feature C (depends on A)
- `src/bugfix.js`: Critical bugfix (depends on B)
- `src/feature-d.js`: Feature D (depends on C and bugfix)

### Commit Messages

Each branch has a properly formatted commit message with:
- Conventional commit prefix (`feat:`, `fix:`)
- Clear description
- Dependency declaration using `Depends-On:` syntax

This demonstrates how lex-pr-runner parses dependency information from commit messages.

### Cleanup

To remove the sample repository:

```bash
rm -rf /tmp/lex-pr-test-repo
```

Or if using a custom name/location:

```bash
rm -rf /path/to/your/repo
```
