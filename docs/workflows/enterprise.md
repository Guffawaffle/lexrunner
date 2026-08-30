# Enterprise Workflow

Enterprise-grade workflow for large organizations with multiple repositories, teams, and compliance requirements.

## Organization Profile

- **Size:** 100+ developers, multiple teams
- **Repositories:** Multiple repos, monorepo, or hybrid
- **Coordination:** Cross-team dependencies
- **PR Volume:** 100+ PRs per week
- **Compliance:** SOC 2, ISO 27001, regulatory requirements
- **Automation Goal:** Scale while maintaining governance

## Key Challenges

1. **Coordination at scale** - Multiple teams, repos, time zones
2. **Compliance** - Audit trails, approval workflows, security
3. **Governance** - Standards, policies, quality gates
4. **Integration** - Existing tools, SSO, reporting
5. **Reliability** - High availability, disaster recovery

## Architecture

```
┌─────────────────────────────────────────┐
│         Central Automation Hub          │
│  (Orchestrates across repos/teams)      │
└─────────────────────────────────────────┘
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Team A  │  │  Team B  │  │  Team C  │
│  Repo 1  │  │  Repo 2  │  │  Repo 3  │
└──────────┘  └──────────┘  └──────────┘
      │             │             │
      ▼             ▼             ▼
┌──────────────────────────────────────┐
│     Compliance & Audit Layer         │
│  (Logs, metrics, approval tracking)  │
└──────────────────────────────────────┘
```

## Setup

### 1. Central Configuration Repository

**Structure:**

```
enterprise-automation/
├── config/
│   ├── teams/
│   │   ├── team-a.yml
│   │   ├── team-b.yml
│   │   └── team-c.yml
│   ├── policies/
│   │   ├── security.yml
│   │   ├── compliance.yml
│   │   └── quality.yml
│   └── global.yml
├── scripts/
│   ├── orchestrate.sh
│   ├── audit-report.sh
│   └── compliance-check.sh
└── workflows/
    ├── scheduled-merge.yml
    └── manual-approval.yml
```

### 2. Team-Specific Configuration

**`config/teams/team-a.yml`:**

```yaml
team:
  name: team-a
  repos:
    - owner/service-auth
    - owner/service-users

scope:
  target: main
  filters:
    labels: ["team-a", "ready-to-merge"]
    required_approvals: 2
    required_reviewers: ["team-lead-a"]
    exclude_labels: ["security-review-pending"]

gates:
  - name: security-scan
    command: npm run security:scan
    required: true

  - name: compliance-check
    command: ./scripts/compliance-check.sh
    required: true

  - name: tests
    command: npm test
    required: true

  - name: integration-tests
    command: npm run test:integration
    required: true

policies:
  max_prs_per_batch: 10
  require_audit_log: true
  notify_on_failure: true
  rollback_on_gate_failure: true
```

### 3. Global Policies

**`config/global.yml`:**

```yaml
organization:
  name: AcmeCorp
  compliance:
    - SOC2
    - ISO27001

global_gates:
  - name: license-check
    command: npm run check:licenses
    required: true

  - name: dependency-audit
    command: npm audit --audit-level=high
    required: true

notifications:
  slack:
    webhook: ${SLACK_WEBHOOK_ENTERPRISE}
    channels:
      success: "#deployments"
      failure: "#incidents"
      audit: "#compliance-audit"

  email:
    smtp_server: ${SMTP_SERVER}
    recipients:
      - platform-team@acmecorp.com
      - compliance@acmecorp.com

audit:
  enabled: true
  retention_days: 365
  storage:
    type: s3
    bucket: acmecorp-audit-logs
    region: us-east-1
```

## Orchestration

### Central Orchestrator Script

**`scripts/orchestrate.sh`:**

```bash
#!/bin/bash
set -euo pipefail

# Enterprise merge orchestration
TEAMS=("team-a" "team-b" "team-c")
LOG_DIR="./audit-logs/$(date +%Y%m%d)"
mkdir -p "$LOG_DIR"

for team in "${TEAMS[@]}"; do
  echo "Processing $team..."

  # Load team config
  TEAM_CONFIG="./config/teams/${team}.yml"

  # Run automation per team
  for repo in $(yq '.team.repos[]' "$TEAM_CONFIG"); do
    echo "  Repository: $repo"

    # Clone/update repo
    REPO_DIR="./repos/$repo"
    if [ ! -d "$REPO_DIR" ]; then
      gh repo clone "$repo" "$REPO_DIR"
    else
      cd "$REPO_DIR" && git pull && cd -
    fi

    # Run lexrunner
    cd "$REPO_DIR"

    # Use team-specific profile
    export LEX_PR_PROFILE_DIR="../../config/teams/$team"

    # Execute automation
    lex-pr plan --from-github --out "$LOG_DIR/$repo/" 2>&1 | tee "$LOG_DIR/$repo/plan.log"
    lex-pr execute "$LOG_DIR/$repo/plan.json" 2>&1 | tee "$LOG_DIR/$repo/execute.log"

    # Audit before merge
    ./../../scripts/audit-report.sh "$LOG_DIR/$repo" "$team" "$repo"

    # Merge if approved
    if [ -f "$LOG_DIR/$repo/approved" ]; then
      lex-pr merge "$LOG_DIR/$repo/plan.json" --execute 2>&1 | tee "$LOG_DIR/$repo/merge.log"
    fi

    cd -
  done
done

# Generate enterprise-wide report
./scripts/compliance-report.sh "$LOG_DIR"
```

### Compliance Check Script

**`scripts/compliance-check.sh`:**

```bash
#!/bin/bash
set -euo pipefail

# Compliance validation
PLAN_FILE="${1:-plan.json}"

# Check 1: Ensure required approvals
REQUIRED_APPROVALS=$(jq -r '.items[] | select(.approvals < 2)' "$PLAN_FILE")
if [ -n "$REQUIRED_APPROVALS" ]; then
  echo "❌ Compliance failure: Insufficient approvals"
  exit 1
fi

# Check 2: Security review label
SECURITY_PENDING=$(jq -r '.items[] | select(.labels | contains(["security-review-pending"]))' "$PLAN_FILE")
if [ -n "$SECURITY_PENDING" ]; then
  echo "❌ Compliance failure: Security review pending"
  exit 1
fi

# Check 3: Audit trail exists
for item in $(jq -r '.items[].name' "$PLAN_FILE"); do
  if [ ! -f "audit/$item.log" ]; then
    echo "❌ Compliance failure: Missing audit trail for $item"
    exit 1
  fi
done

echo "✅ Compliance checks passed"
```

## GitHub Actions Enterprise Integration

**`.github/workflows/enterprise-merge.yml`:**

```yaml
name: Enterprise Merge Automation

on:
  schedule:
    - cron: "0 */6 * * *" # Every 6 hours
  workflow_dispatch:
    inputs:
      team:
        description: "Team to process"
        required: false
        type: choice
        options:
          - all
          - team-a
          - team-b
          - team-c

jobs:
  orchestrate:
    runs-on: self-hosted # Enterprise runner
    environment: production

    steps:
      - name: Checkout automation repo
        uses: actions/checkout@v7
        with:
          repository: acmecorp/enterprise-automation
          token: ${{ secrets.AUTOMATION_PAT }}

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: Install dependencies
        run: |
          npm install -g lexrunner
          npm install -g yq

      - name: Run orchestration
        env:
          GITHUB_TOKEN: ${{ secrets.AUTOMATION_PAT }}
          SLACK_WEBHOOK_ENTERPRISE: ${{ secrets.SLACK_WEBHOOK }}
          SMTP_SERVER: ${{ secrets.SMTP_SERVER }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          if [ "${{ github.event.inputs.team }}" == "all" ]; then
            ./scripts/orchestrate.sh
          else
            ./scripts/orchestrate.sh "${{ github.event.inputs.team }}"
          fi

      - name: Upload audit logs
        uses: actions/upload-artifact@v7
        with:
          name: audit-logs-${{ github.run_number }}
          path: audit-logs/
          retention-days: 365

      - name: Send compliance report
        if: always()
        run: |
          ./scripts/send-compliance-report.sh

      - name: Notify on failure
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_INCIDENTS }}
          payload: |
            {
              "text": "🚨 Enterprise merge automation failed",
              "blocks": [{
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "Run: ${{ github.run_id }}\nTeam: ${{ github.event.inputs.team }}"
                }
              }]
            }
```

## Compliance & Audit

### Audit Report Generation

**`scripts/audit-report.sh`:**

```bash
#!/bin/bash
set -euo pipefail

LOG_DIR=$1
TEAM=$2
REPO=$3

# Generate comprehensive audit report
cat > "$LOG_DIR/audit-report.md" << EOF
# Audit Report

**Date:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Team:** $TEAM
**Repository:** $REPO

## Summary

$(lex-pr report "$LOG_DIR/gate-results" --out md)

## Approvals

$(cat "$LOG_DIR/approvals.json" | jq -r '.[] | "- PR #\(.number): \(.approvers | join(", "))"')

## Security Checks

$(cat "$LOG_DIR/security-scan.log")

## Compliance Validation

$(./scripts/compliance-check.sh "$LOG_DIR/plan.json")

## Audit Trail

All operations logged to: s3://acmecorp-audit-logs/$(date +%Y/%m/%d)/$TEAM/$REPO/

## Approver Signatures

Required for SOC2 compliance:
- Platform Lead: _________________
- Security Lead: _________________
- Compliance Officer: _________________

EOF

# Upload to S3 for retention
aws s3 cp "$LOG_DIR/audit-report.md" \
  "s3://acmecorp-audit-logs/$(date +%Y/%m/%d)/$TEAM/$REPO/audit-report.md"

# Generate signed approval if all checks pass
if ./scripts/compliance-check.sh "$LOG_DIR/plan.json"; then
  touch "$LOG_DIR/approved"
fi
```

## Metrics & Monitoring

### Enterprise Dashboard

**`scripts/metrics-dashboard.sh`:**

```bash
#!/bin/bash

# Aggregate metrics across all teams
METRICS_DIR="./metrics/$(date +%Y%m%d)"
mkdir -p "$METRICS_DIR"

# Collect metrics
for team in team-a team-b team-c; do
  cat > "$METRICS_DIR/$team.json" << EOF
{
  "team": "$team",
  "prs_merged": $(gh pr list --repo acmecorp/$team --state merged --json number --jq 'length'),
  "avg_merge_time": $(./scripts/calc-avg-merge-time.sh $team),
  "gate_success_rate": $(./scripts/calc-gate-success.sh $team),
  "compliance_score": 100
}
EOF
done

# Generate dashboard
cat > "$METRICS_DIR/dashboard.html" << EOF
<!DOCTYPE html>
<html>
<head>
  <title>Enterprise Merge Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h1>Enterprise Merge Automation Dashboard</h1>
  <div id="charts"></div>
  <script>
    // Load metrics and render charts
    // (Implementation details...)
  </script>
</body>
</html>
EOF
```

## Security Considerations

### 1. Token Management

```bash
# Use organization secrets
# Rotate every 90 days
# Minimum permissions (repo scope only)

# Vault integration example
export GITHUB_TOKEN=$(vault kv get -field=token secret/github/automation)
```

### 2. Access Control

```yaml
# Team-based permissions
teams:
  team-a:
    repos: [service-auth, service-users]
    approvers: [alice, bob]

  team-b:
    repos: [service-api, service-data]
    approvers: [charlie, diana]
```

### 3. Audit Logging

```bash
# All operations logged
# 365-day retention
# Immutable storage (S3 with object lock)
# Real-time alerts on anomalies
```

## Disaster Recovery

### Rollback Procedure

```bash
#!/bin/bash
# scripts/rollback.sh

INCIDENT_ID=$1
AFFECTED_TEAM=$2

# 1. Identify affected PRs
AFFECTED_PRS=$(aws s3 cp "s3://audit-logs/$INCIDENT_ID/affected-prs.json" -)

# 2. Revert merges
for pr in $(echo "$AFFECTED_PRS" | jq -r '.[]'); do
  git revert "$pr" --no-edit
done

# 3. Create rollback PR
gh pr create \
  --title "Rollback: Incident $INCIDENT_ID" \
  --body "Automated rollback for incident $INCIDENT_ID" \
  --label "rollback" \
  --reviewer "$AFFECTED_TEAM-lead"

# 4. Notify
./scripts/notify-incident.sh "$INCIDENT_ID" "Rollback initiated"
```

## Best Practices

1. **Gradual Rollout**
   - Start with 1 team
   - Validate for 2 weeks
   - Expand to all teams

2. **Regular Audits**
   - Weekly compliance reviews
   - Monthly security assessments
   - Quarterly policy updates

3. **Team Training**
   - Mandatory training for all teams
   - Runbooks for common scenarios
   - Escalation procedures

4. **Continuous Improvement**
   - Track metrics
   - Gather feedback
   - Iterate on policies

## Related Documentation

- Large Team Workflow - Scaling patterns guide planned
- [CI/CD Integrations](../integrations/) - Platform setup
- [Troubleshooting](../troubleshooting.md) - Issue resolution
