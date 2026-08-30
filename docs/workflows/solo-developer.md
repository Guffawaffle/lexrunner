# Solo Developer Workflow

Streamlined workflow for individual developers working on personal or side projects.

## Developer Profile

- **Size:** 1 developer
- **Coordination:** Self-managed
- **PR Volume:** 3-10 PRs per week
- **Complexity:** Moderate feature dependencies
- **Automation Goal:** Save time on repetitive tasks

## Why Use lexrunner Solo?

Even as a solo developer, lexrunner helps:

- **Save time** - Automate repetitive merge tasks
- **Track dependencies** - Manage PR stacks easily
- **Ensure quality** - Run gates before merge
- **Learn automation** - Practice for team environments

## Quick Setup (5 minutes)

### 1. Install

```bash
npm install -g lexrunner
```

### 2. Initialize in Your Project

```bash
cd your-project
lex-pr init
```

### 3. Configure (Minimal)

**`.smartergpt.local/scope.yml`:**

```yaml
target: main
filters:
  # No label requirements for solo work
  state: open
```

**`.smartergpt.local/gates.yml`:**

```yaml
gates:
  - name: test
    command: npm test
```

That's it! You're ready to go.

## Daily Workflow

### Creating PR Stacks

Common scenario: You have 3 related features to build.

**Traditional approach (30+ minutes):**

1. Create PR 1, wait for CI, merge
2. Create PR 2, wait for CI, merge
3. Create PR 3, wait for CI, merge

**With lexrunner (5 minutes):**

```bash
# Create all PRs first
gh pr create --title "Part 1: Refactor database" --body "Base changes"
gh pr create --title "Part 2: Add caching" --body "Depends-On: #101"
gh pr create --title "Part 3: Optimize queries" --body "Depends-On: #102"

# Merge entire stack at once
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

### Simple Workflow (No Dependencies)

```bash
# Daily routine
lex-pr discover                    # See what's ready
lex-pr plan --from-github          # Generate plan
lex-pr execute plan.json           # Run tests
lex-pr merge plan.json --execute   # Merge if all pass
```

### With Dependencies

```markdown
<!-- In PR description -->

Depends-On: #123
Depends-On: #124
```

```bash
# Same commands, dependencies handled automatically
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

## Example Scenarios

### Scenario 1: Feature Branch Stack

You're building a new feature across 4 PRs:

```bash
# PR #101: Database schema changes
# PR #102: API layer (depends on #101)
# PR #103: Business logic (depends on #102)
# PR #104: UI components (depends on #103)
```

**Add dependencies:**

```markdown
<!-- PR #102 -->

Depends-On: #101

<!-- PR #103 -->

Depends-On: #102

<!-- PR #104 -->

Depends-On: #103
```

**Merge stack:**

```bash
$ lex-pr plan --from-github
✓ Detected stack: #101 → #102 → #103 → #104

$ lex-pr merge-order plan.json
Level 0: database-schema
Level 1: api-layer
Level 2: business-logic
Level 3: ui-components

$ lex-pr execute plan.json
✓ All gates passed

$ lex-pr merge plan.json --execute
✓ Merged #101, #102, #103, #104
```

**Time saved:** 25+ minutes vs manual merging

### Scenario 2: Parallel Features

You have 3 independent features ready:

```bash
# PR #201: Add dark mode
# PR #202: Add search
# PR #203: Add analytics
```

**No dependencies needed, just merge:**

```bash
$ lex-pr plan --from-github
✓ Found 3 independent PRs

$ lex-pr merge-order plan.json
Level 0: dark-mode, search, analytics

$ lex-pr execute plan.json
✓ Tests passed for all

$ lex-pr merge plan.json --execute
✓ Merged all 3 PRs
```

### Scenario 3: Experiment Branch

Testing multiple approaches:

```bash
# PR #301: Approach A (Redis cache)
# PR #302: Approach B (In-memory cache)
# PR #303: Approach C (No cache, optimize queries)
```

**Merge winner, close others:**

```bash
# Decided on Approach B
lex-pr plan --from-github --filter "#302"
lex-pr execute plan.json
lex-pr merge plan.json --execute

# Close others
gh pr close 301
gh pr close 303
```

## Automation Options

### Manual (Level 0)

Run commands yourself when ready:

```bash
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

### Semi-Automated (Level 1)

Use alias for quick execution:

```bash
# Add to ~/.bashrc or ~/.zshrc
alias merge-stack='lex-pr plan --from-github && lex-pr execute plan.json && lex-pr merge plan.json --execute'

# Usage
merge-stack
```

### Fully Automated (Level 2)

GitHub Action triggered by label:

**`.github/workflows/auto-merge.yml`:**

```yaml
name: Auto-Merge

on:
  pull_request:
    types: [labeled]

jobs:
  merge:
    if: github.event.label.name == 'ready'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"
      - name: Install and run
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npm install -g lexrunner
          lex-pr plan --from-github
          lex-pr execute plan.json
          lex-pr merge plan.json --execute
```

**Usage:** Just add "ready" label to PR

## Tips & Tricks

### 1. Shell Aliases

```bash
# ~/.bashrc or ~/.zshrc
alias lp='lex-pr'
alias lpd='lex-pr discover'
alias lpp='lex-pr plan --from-github'
alias lpe='lex-pr execute plan.json'
alias lpm='lex-pr merge plan.json'

# Usage
lpp && lpe && lpm --execute
```

### 2. Git Hooks

Auto-discover after pushing:

```bash
# .git/hooks/post-push
#!/bin/bash
lex-pr discover
```

### 3. Status Dashboard

Check status anytime:

```bash
# Create dashboard script
cat > ~/bin/pr-status << 'EOF'
#!/bin/bash
echo "📋 Open PRs:"
lex-pr discover

echo -e "\n📊 Merge Plan:"
lex-pr plan --from-github --json | jq '.items[] | {name, deps}'
EOF

chmod +x ~/bin/pr-status

# Usage
pr-status
```

### 4. Dry-Run by Default

Always check before merging:

```bash
# Safe by default
lex-pr merge plan.json --dry-run

# Review output, then execute
lex-pr merge plan.json --execute
```

## Troubleshooting

### Issue: "No PRs found"

```bash
# Check what GitHub shows
gh pr list

# Verify scope configuration
cat .smartergpt.local/scope.yml

# Discover without filters
lex-pr discover --state all
```

### Issue: Gate failures

```bash
# Check which gate failed
lex-pr report gate-results --out md

# View error details
cat gate-results/feature-name/test.stderr.log

# Run gate manually
npm test
```

### Issue: Dependency not detected

```markdown
<!-- Ensure correct syntax in PR body -->

Depends-On: #123

<!-- Not: -->
<!-- Requires: #123 ❌ -->
<!-- Needs: #123 ❌ -->
```

## Next Steps

Once comfortable with solo workflow:

1. **Add more gates** - Lint, type-check, build
2. **Experiment with stacks** - Complex dependencies
3. **Try CI/CD integration** - Fully automate
4. **Explore advanced features** - Custom strategies

## Related Workflows

- [Small Team](./small-team.md) - When you add teammates
- Trunk-Based Development - Continuous integration guide planned
- Open Source - Public project management guide planned

## Example Configuration

Complete example for solo developer:

**`.smartergpt.local/scope.yml`:**

```yaml
target: main
filters:
  state: open
```

**`.smartergpt.local/gates.yml`:**

```yaml
gates:
  - name: test
    command: npm test

  - name: lint
    command: npm run lint

  - name: build
    command: npm run build
```

**`.smartergpt.local/profile.yml`:**

```yaml
role: local
version: 1
```

That's all you need!
