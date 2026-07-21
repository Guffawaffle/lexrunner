# Small Team Workflow (2-5 developers)

Recommended workflow for small teams working together on a single codebase.

## Team Profile

- **Size:** 2-5 developers
- **Coordination:** Informal, direct communication
- **PR Volume:** 5-15 PRs per week
- **Complexity:** Medium dependencies between features
- **Automation Goal:** Reduce manual coordination

## Workflow Overview

```
Developer → Create PR → Label "ready"
                ↓
         Automation checks dependencies
                ↓
         Run quality gates
                ↓
         Auto-merge if all pass
                ↓
         Notify team in Slack
```

## Setup

### 1. Install and Initialize

```bash
# One-time setup (team lead)
npm install -g lexrunner
cd your-repo
lex-pr init

# Commit configuration
git add .smartergpt.local/
git commit -m "Add lexrunner configuration"
git push
```

### 2. Configure Scope

**`.smartergpt.local/scope.yml`:**

```yaml
target: main
filters:
  labels: ["ready-to-merge"]
  exclude_labels: ["wip", "blocked"]
  # Only consider PRs approved by at least 1 reviewer
  min_approvals: 1
```

### 3. Configure Quality Gates

**`.smartergpt.local/gates.yml`:**

```yaml
gates:
  - name: tests
    command: npm test
    timeout: 300

  - name: lint
    command: npm run lint
    timeout: 60

  - name: build
    command: npm run build
    timeout: 120

  # Optional: type check
  - name: typecheck
    command: npm run typecheck
    timeout: 60
```

### 4. Set Up Team Process

**PR Creation Checklist:**

- [ ] Code reviewed by at least one teammate
- [ ] All CI checks pass
- [ ] Add "ready-to-merge" label when approved
- [ ] Add dependency info if needed

**Dependency Syntax in PR Body:**

```markdown
## Dependencies

Depends-On: #123
Depends-On: #124
```

## Daily Workflow

### Morning Sync (10 minutes)

```bash
# Check current PR status
lex-pr discover

# Review discovered PRs with team
# Identify any blockers or missing dependencies
```

### Automated Merge (runs every 2 hours)

```bash
# CI/CD pipeline runs:
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute

# Results posted to Slack
```

### Manual Trigger (as needed)

```bash
# Developer can trigger manually
lex-pr plan --from-github
lex-pr execute plan.json

# Review results
lex-pr report gate-results --out md

# Merge if satisfied
lex-pr merge plan.json --execute
```

## Example Scenarios

### Scenario 1: Independent Features

**Team State:**

- Alice's PR #101: "Add user profile"
- Bob's PR #102: "Add search feature"
- Both ready to merge, no dependencies

**Automation:**

```bash
$ lex-pr discover
Found 2 PRs: #101, #102

$ lex-pr plan --from-github
✓ Generated plan with 2 items

$ lex-pr merge-order plan.json
Level 0: user-profile, search-feature

$ lex-pr execute plan.json
✓ All gates passed

$ lex-pr merge plan.json --execute
✓ Merged #101
✓ Merged #102
```

**Outcome:** Both PRs merged in parallel, 5 minutes total

### Scenario 2: Dependent Features

**Team State:**

- Alice's PR #103: "Add authentication API"
- Bob's PR #104: "Add auth UI" (depends on #103)

**PR #104 Body:**

```markdown
Implements authentication UI.

Depends-On: #103
```

**Automation:**

```bash
$ lex-pr plan --from-github
✓ Detected dependency: #104 → #103

$ lex-pr merge-order plan.json
Level 0: auth-api
Level 1: auth-ui

$ lex-pr execute plan.json
✓ auth-api: tests passed
✓ auth-ui: tests passed (ran after #103)

$ lex-pr merge plan.json --execute
✓ Merged #103 (auth-api)
✓ Merged #104 (auth-ui)
```

**Outcome:** Correct merge order, dependencies respected

### Scenario 3: PR Stack

**Team State:**

- Alice has 3 dependent PRs:
  - PR #105: "Refactor database layer"
  - PR #106: "Add caching" (depends on #105)
  - PR #107: "Optimize queries" (depends on #106)

**Automation:**

```bash
$ lex-pr plan --from-github
✓ Detected PR stack: #105 → #106 → #107

$ lex-pr execute plan.json
✓ #105 gates passed
✓ #106 gates passed
✓ #107 gates passed

$ lex-pr merge plan.json --execute
✓ Merged in order: #105, #106, #107
```

**Outcome:** Entire stack merged in 10 minutes (vs 30+ manually)

## GitHub Actions Integration

**`.github/workflows/auto-merge.yml`:**

```yaml
name: Auto-Merge Ready PRs

on:
  schedule:
    # Run every 2 hours during work hours
    - cron: "0 9-17/2 * * 1-5"

  # Allow manual trigger
  workflow_dispatch:

  # Trigger when PR labeled "ready-to-merge"
  pull_request:
    types: [labeled]

jobs:
  auto-merge:
    if: github.event.label.name == 'ready-to-merge' || github.event_name != 'pull_request'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: Install lexrunner
        run: npm install -g lexrunner

      - name: Discover and plan
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          lex-pr plan --from-github --out artifacts/

      - name: Execute gates
        run: |
          lex-pr execute artifacts/plan.json

      - name: Generate report
        if: always()
        run: |
          lex-pr report gate-results --out md > report.md

      - name: Merge PRs
        if: success()
        run: |
          lex-pr merge artifacts/plan.json --execute

      - name: Post to Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          payload: |
            {
              "text": "Merge automation completed",
              "attachments": [{
                "color": "${{ job.status == 'success' && 'good' || 'danger' }}",
                "text": "${{ job.status }}"
              }]
            }
```

## Slack Notifications

**Post-merge notification:**

```bash
#!/bin/bash
# scripts/notify-slack.sh

REPORT=$(lex-pr report gate-results --out md)
MERGED=$(cat report.md | grep "Successfully merged" | wc -l)

curl -X POST $SLACK_WEBHOOK \
  -H 'Content-Type: application/json' \
  -d "{
    \"text\": \"🎉 Auto-merged ${MERGED} PRs\",
    \"blocks\": [
      {
        \"type\": \"section\",
        \"text\": {
          \"type\": \"mrkdwn\",
          \"text\": \"${REPORT}\"
        }
      }
    ]
  }"
```

## Troubleshooting

### Issue: PRs not being discovered

**Check:**

```bash
# Verify labels
lex-pr discover --json | jq '.[] | {number, labels}'

# Ensure PR has "ready-to-merge" label
```

### Issue: Gate failures blocking merges

**Debug:**

```bash
# Check which gate failed
lex-pr report gate-results --out md

# View failure details
cat gate-results/item-name/test.stderr.log

# Run gate manually
npm test
```

### Issue: Wrong merge order

**Verify:**

```bash
# Check detected dependencies
lex-pr plan --from-github --json | jq '.items[] | {name, deps}'

# Ensure PR bodies have correct "Depends-On" syntax
```

## Best Practices

1. **Label Consistently**
   - Use "ready-to-merge" when approved
   - Remove label if changes needed
   - Use "blocked" for known issues

2. **Document Dependencies**
   - Always use "Depends-On: #123" syntax
   - Review dependency graph before merging
   - Discuss complex dependencies in team sync

3. **Monitor Automation**
   - Check Slack notifications daily
   - Review weekly merge reports
   - Address recurring gate failures

4. **Gradual Rollout**
   - Week 1: Discovery only (no auto-merge)
   - Week 2: Auto-merge with manual approval
   - Week 3+: Full automation

## Metrics to Track

- **Merge Time:** From "ready" to merged (target: <30 min)
- **Gate Success Rate:** Percentage of PRs passing all gates (target: >90%)
- **Dependency Accuracy:** Correct merge order (target: 100%)
- **Team Satisfaction:** Weekly survey (target: 4/5 stars)

## Related Workflows

- [Solo Developer](./solo-developer.md) - Simpler setup for individuals
- [Medium Team](./medium-team.md) - More advanced coordination
- [Trunk-Based Development](./trunk-based.md) - Alternative branching strategy
