# Migration Guide: From Manual Merge to lexrunner

This guide helps teams migrate from manual PR merge processes to automated merge pyramids with lexrunner.

## Why Migrate?

### Problems with Manual Merging

**Time Consuming:**

- Manual coordination of PR merge order
- Waiting for CI to pass on each PR
- Resolving merge conflicts one by one

**Error Prone:**

- Missing dependencies between PRs
- Merging PRs in wrong order
- Breaking builds due to incompatible changes

**Not Scalable:**

- Bottleneck when many PRs are ready
- Team members blocked waiting for merges
- Integration issues discovered late

### Benefits of lexrunner

**Automated:**

- Discovers PRs automatically
- Computes optimal merge order
- Executes gates in parallel

**Safe:**

- Dependency-aware execution
- Quality gates before merge
- Rollback on failures

**Scalable:**

- Handles 100+ PRs
- Parallel gate execution
- CI/CD integration

## Migration Paths

### Path 1: Gradual Migration (Recommended)

Start with manual oversight, gradually increase automation.

#### Phase 1: Discovery & Planning (Week 1)

**Goal:** Use lexrunner for visibility only.

```bash
# Install
npm install -g lexrunner

# Initialize workspace
lex-pr init

# Discover PRs
lex-pr discover

# Generate plan (no execution)
lex-pr plan --from-github
```

**Outcome:** Team sees PR dependencies and merge order.

#### Phase 2: Gate Execution (Week 2-3)

**Goal:** Run quality gates automatically, merge manually.

```bash
# Configure gates
cat > .smartergpt.local/gates.yml << 'EOF'
gates:
  - name: test
    command: npm test
  - name: lint
    command: npm run lint
EOF

# Execute gates
lex-pr plan --from-github
lex-pr execute plan.json

# Review results
lex-pr report gate-results --out md

# Merge manually based on results
```

**Outcome:** Automated quality checks, manual merge decisions.

#### Phase 3: Dry-Run Merges (Week 4)

**Goal:** Test merge automation without actual merges.

```bash
# Dry-run merge (no actual changes)
lex-pr merge plan.json --dry-run

# Review what would happen
# No git operations executed
```

**Outcome:** Team confidence in automation.

#### Phase 4: Automated Merges (Week 5+)

**Goal:** Full automation with oversight.

```bash
# Full automation
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute  # Requires explicit flag

# Monitor via dashboard
lex-pr status
```

**Outcome:** Fully automated merge pipeline.

### Path 2: Big Bang Migration

For teams ready to adopt immediately.

#### Prerequisites

- [ ] All team members trained on lexrunner
- [ ] Quality gates defined and tested
- [ ] Rollback procedures documented
- [ ] Emergency manual merge process available

#### Migration Day

```bash
# 1. Final manual merge of existing PRs
# (Clean slate)

# 2. Initialize lexrunner
lex-pr init

# 3. Configure workspace
# Edit .smartergpt.local/{scope,gates,deps}.yml

# 4. Add to CI/CD pipeline
# (See CI/CD integration examples)

# 5. Announce to team
# All new PRs use lexrunner

# 6. First automated run
lex-pr plan --from-github
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

## From Manual to Automated: Mapping

### Manual Process → lexrunner Commands

| Manual Step           | lexrunner Equivalent               |
| --------------------- | ---------------------------------- |
| List open PRs         | `lex-pr discover`                  |
| Check PR dependencies | `lex-pr plan --from-github`        |
| Determine merge order | `lex-pr merge-order plan.json`     |
| Run tests on PR       | `lex-pr execute plan.json`         |
| Merge PR              | `lex-pr merge plan.json --execute` |
| Check merge status    | `lex-pr status`                    |

### Manual Coordination → Configuration Files

| Manual Coordination           | Configuration File           |
| ----------------------------- | ---------------------------- |
| "This PR depends on #123"     | `deps.yml` or PR body syntax |
| "Only merge PRs with label X" | `scope.yml` filters          |
| "Run tests before merge"      | `gates.yml` definitions      |
| "Merge to main"               | `scope.yml` target branch    |

### Example: Before/After

**Before (Manual):**

1. Developer posts in Slack: "PR #123 ready, depends on #122"
2. Team lead checks #122 status
3. Team lead manually merges #122
4. Waits for CI on main branch
5. Manually merges #123
6. Hopes no conflicts

**After (lexrunner):**

```yaml
# In PR #123 body:
Depends-On: #122
```

```bash
# Automation runs:
lex-pr plan --from-github  # Detects dependency
lex-pr execute plan.json   # Runs gates on both
lex-pr merge plan.json --execute  # Merges in order
```

## Common Migration Scenarios

### Scenario 1: Monorepo with Multiple Teams

**Challenge:** Different teams working on different parts.

**Solution:** Scope filters per team.

```yaml
# Team A scope (.smartergpt.local/scope-team-a.yml)
target: main
filters:
  labels: ["team-a"]
  path_prefix: "services/team-a/"

# Team B scope (.smartergpt.local/scope-team-b.yml)
target: main
filters:
  labels: ["team-b"]
  path_prefix: "services/team-b/"
```

```bash
# Team A pipeline
lex-pr plan --profile-dir .smartergpt.local/team-a
lex-pr execute plan.json
lex-pr merge plan.json --execute

# Team B pipeline (parallel)
lex-pr plan --profile-dir .smartergpt.local/team-b
lex-pr execute plan.json
lex-pr merge plan.json --execute
```

### Scenario 2: Feature Flags + Staged Rollout

**Challenge:** Some PRs behind feature flags, others not.

**Solution:** Multiple merge pipelines.

```yaml
# Scope for feature-flagged PRs
filters:
  labels: ["feature-flag", "ready"]

# Scope for direct releases
filters:
  labels: ["direct-release", "ready"]
```

```bash
# Safe to merge anytime (feature-flagged)
lex-pr plan --from-github --scope feature-flagged
lex-pr merge plan.json --execute

# Merge during release window (direct)
lex-pr plan --from-github --scope direct
lex-pr merge plan.json --execute
```

### Scenario 3: Hotfix Process

**Challenge:** Urgent fixes need to bypass normal flow.

**Solution:** Dedicated hotfix pipeline.

```yaml
# hotfix-scope.yml
target: main
filters:
  labels: ["hotfix"]
  # No dependency requirements
```

```bash
# Hotfix automation (fast path)
lex-pr plan --from-github --scope hotfix
lex-pr execute plan.json --timeout 60000  # 60-second operation fallback
lex-pr merge plan.json --execute
```

### Scenario 4: PR Stacks (Dependent PRs)

**Challenge:** Developer has stack of 5 dependent PRs.

**Before (Manual):**

1. Merge PR 1
2. Wait for CI
3. Merge PR 2
4. Wait for CI
5. Repeat 3 more times (30+ minutes)

**After (lexrunner):**

```markdown
<!-- In each PR body -->

PR 1: (no deps)
PR 2: Depends-On: #1
PR 3: Depends-On: #2
PR 4: Depends-On: #3
PR 5: Depends-On: #4
```

```bash
# Merge entire stack (5 minutes)
lex-pr plan --from-github --stack
lex-pr execute plan.json  # Parallel where possible
lex-pr merge plan.json --execute
```

## Integration with Existing Tools

### GitHub Actions

Add to `.github/workflows/merge-automation.yml`:

```yaml
name: Automated PR Merge

on:
  schedule:
    - cron: "0 */2 * * *" # Every 2 hours
  workflow_dispatch: # Manual trigger

jobs:
  merge-prs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: Install lexrunner
        run: npm install -g lexrunner

      - name: Run merge automation
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          lex-pr init --non-interactive
          lex-pr plan --from-github
          lex-pr execute plan.json
          lex-pr merge plan.json --execute
```

### Jenkins

Add to `Jenkinsfile`:

```groovy
pipeline {
  agent any

  stages {
    stage('Install') {
      steps {
        sh 'npm install -g lexrunner'
      }
    }

    stage('Plan') {
      steps {
        sh 'lex-pr plan --from-github --out artifacts/'
      }
    }

    stage('Execute Gates') {
      steps {
        sh 'lex-pr execute artifacts/plan.json'
      }
    }

    stage('Merge') {
      steps {
        sh 'lex-pr merge artifacts/plan.json --execute'
      }
    }
  }
}
```

### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
merge-automation:
  stage: merge
  script:
    - npm install -g lexrunner
    - lex-pr init --non-interactive
    - lex-pr plan --from-github
    - lex-pr execute plan.json
    - lex-pr merge plan.json --execute
  only:
    - schedules
```

## Team Training

### Onboarding Checklist

- [ ] Install lexrunner
- [ ] Complete quickstart guide
- [ ] Understand dependency syntax
- [ ] Know how to check merge status
- [ ] Practice dry-run merges
- [ ] Review troubleshooting guide

### Training Exercises

**Exercise 1: Basic Workflow**

1. Create 2 PRs (no dependencies)
2. Run: `lex-pr discover`
3. Run: `lex-pr plan --from-github`
4. Review: `cat plan.json`
5. Run: `lex-pr merge plan.json --dry-run`

**Exercise 2: Dependent PRs**

1. Create PR A (base feature)
2. Create PR B with "Depends-On: #A"
3. Run: `lex-pr plan --from-github`
4. Verify: `lex-pr merge-order plan.json`
5. Expected: A merges before B

**Exercise 3: Quality Gates**

1. Add test gate to `gates.yml`
2. Create PR with failing test
3. Run: `lex-pr execute plan.json`
4. Observe: Merge blocked by gate
5. Fix test, re-run

## Rollback Strategy

### If Automation Fails

```bash
# 1. Stop automation
# Cancel CI/CD pipeline

# 2. Assess damage
git log --oneline -10  # Recent merges
lex-pr status  # Current state

# 3. Rollback if needed
git revert <merge-commit>
git push origin main

# 4. Return to manual process
# Resume manual merging while investigating
```

### Emergency Manual Merge

```bash
# Bypass automation temporarily
git checkout main
git pull origin main
git merge --no-ff feature-branch
git push origin main

# Document the manual merge
echo "Manual merge: feature-branch (emergency)" >> merge-log.txt
```

## Success Metrics

Track these metrics to validate migration success:

### Before Migration (Baseline)

- Average time from "ready to merge" to merged
- Number of broken builds per week
- Manual coordination overhead (hours/week)
- Merge conflict resolution time

### After Migration (Target)

- 50% reduction in merge time
- 80% reduction in broken builds
- 90% reduction in coordination overhead
- Automated conflict detection

### Monitoring

```bash
# Generate weekly report
lex-pr report gate-results --out md > weekly-report.md

# Track metrics
cat weekly-report.md | grep "Success Rate"
cat weekly-report.md | grep "Average Duration"
```

## Next Steps

1. **Start Small:** Begin with Path 1 (Gradual Migration)
2. **Measure:** Track baseline metrics before migration
3. **Train:** Ensure team understands new workflow
4. **Monitor:** Watch for issues during early adoption
5. **Iterate:** Refine configuration based on experience

## Related Documentation

- [Quickstart Guide](./quickstart.md) - Get started in 5 minutes
- [CLI Reference](./cli.md) - Complete command documentation
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [CI/CD Integrations](./integrations/) - Platform-specific examples
- [Workflows](./workflows/) - Team size and project type examples
