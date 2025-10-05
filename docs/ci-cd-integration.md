# CI/CD Integration Guide for Deliverables Management

## Overview

This guide provides practical examples for integrating lex-pr-runner's deliverables management system with various CI/CD platforms and monitoring tools.

## Quick Start

### Basic Workflow

```bash
# 1. Run autopilot to generate deliverables
lex-pr autopilot plan.json

# 2. Access latest deliverables
cd .smartergpt/deliverables/latest

# 3. Process artifacts
cat manifest.json
cat analysis.json
```

## Platform-Specific Integration

### GitHub Actions

#### Complete Autopilot Workflow

```yaml
name: Autopilot Merge Weave

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

jobs:
  autopilot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install lex-pr-runner
        run: npm install -g lex-pr-runner
      
      - name: Generate Plan from GitHub
        run: lex-pr plan --from-github > plan.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Run Autopilot Level 1
        run: lex-pr autopilot plan.json --level 1
      
      - name: Upload Deliverables
        uses: actions/upload-artifact@v4
        with:
          name: autopilot-deliverables-${{ github.run_id }}
          path: .smartergpt/deliverables/latest/
          retention-days: 30
      
      - name: Comment PR with Results
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const manifest = JSON.parse(
              fs.readFileSync('.smartergpt/deliverables/latest/manifest.json', 'utf8')
            );
            const report = fs.readFileSync(
              '.smartergpt/deliverables/latest/weave-report.md', 'utf8'
            );
            
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Autopilot Analysis\n\n${report}\n\n---\nPlan Hash: \`${manifest.planHash}\``
            });
      
      - name: Cleanup Old Deliverables
        if: always()
        run: lex-pr deliverables:cleanup --max-age 7
```

#### Matrix Strategy for Multiple Levels

```yaml
jobs:
  autopilot:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        level: [0, 1, 2]
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Autopilot Level ${{ matrix.level }}
        run: |
          lex-pr autopilot plan.json \
            --level ${{ matrix.level }} \
            --deliverables-dir ./deliverables/level-${{ matrix.level }}
      
      - name: Upload Level ${{ matrix.level }} Deliverables
        uses: actions/upload-artifact@v4
        with:
          name: level-${{ matrix.level }}-deliverables
          path: ./deliverables/level-${{ matrix.level }}/latest/
```

### GitLab CI/CD

#### Pipeline with Deliverables Management

```yaml
variables:
  DELIVERABLES_DIR: $CI_PROJECT_DIR/.smartergpt/deliverables

stages:
  - plan
  - autopilot
  - report
  - cleanup

generate-plan:
  stage: plan
  script:
    - lex-pr plan --from-github > plan.json
  artifacts:
    paths:
      - plan.json
    expire_in: 1 hour

run-autopilot:
  stage: autopilot
  script:
    - lex-pr autopilot plan.json --level 1
  artifacts:
    paths:
      - .smartergpt/deliverables/latest/
    reports:
      dotenv: .smartergpt/deliverables/latest/manifest.json
    expire_in: 1 week

publish-report:
  stage: report
  script:
    - |
      MANIFEST=.smartergpt/deliverables/latest/manifest.json
      PLAN_HASH=$(jq -r '.planHash' $MANIFEST)
      
      echo "Plan Hash: $PLAN_HASH"
      
      # Post to merge request
      curl --request POST \
        --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
        --data "body=$(cat .smartergpt/deliverables/latest/weave-report.md)" \
        "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes"

cleanup-deliverables:
  stage: cleanup
  when: always
  script:
    - lex-pr deliverables:cleanup --max-age 30 --max-count 50
  allow_failure: true
```

### Jenkins

#### Declarative Pipeline

```groovy
pipeline {
    agent any
    
    environment {
        DELIVERABLES_DIR = "${WORKSPACE}/.smartergpt/deliverables"
    }
    
    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g lex-pr-runner'
            }
        }
        
        stage('Generate Plan') {
            steps {
                withCredentials([string(credentialsId: 'github-token', variable: 'GITHUB_TOKEN')]) {
                    sh 'lex-pr plan --from-github > plan.json'
                }
            }
        }
        
        stage('Run Autopilot') {
            steps {
                sh 'lex-pr autopilot plan.json --level 1'
            }
        }
        
        stage('Archive Results') {
            steps {
                script {
                    def manifest = readJSON file: "${DELIVERABLES_DIR}/latest/manifest.json"
                    currentBuild.description = "Plan: ${manifest.planHash.take(8)}"
                }
                
                archiveArtifacts artifacts: "${DELIVERABLES_DIR}/latest/**/*", fingerprint: true
                
                publishHTML([
                    reportDir: "${DELIVERABLES_DIR}/latest",
                    reportFiles: 'weave-report.md',
                    reportName: 'Autopilot Report'
                ])
            }
        }
        
        stage('Cleanup') {
            steps {
                sh 'lex-pr deliverables:cleanup --max-age 14 --max-count 20'
            }
        }
    }
    
    post {
        always {
            sh 'lex-pr deliverables:list --json > deliverables-inventory.json'
            archiveArtifacts 'deliverables-inventory.json'
        }
    }
}
```

### CircleCI

#### Configuration

```yaml
version: 2.1

jobs:
  autopilot:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      
      - run:
          name: Install lex-pr-runner
          command: npm install -g lex-pr-runner
      
      - run:
          name: Generate Plan
          command: lex-pr plan --from-github > plan.json
      
      - run:
          name: Run Autopilot
          command: |
            lex-pr autopilot plan.json \
              --deliverables-dir /tmp/deliverables
      
      - store_artifacts:
          path: /tmp/deliverables/latest
          destination: autopilot-deliverables
      
      - run:
          name: Extract Plan Hash
          command: |
            PLAN_HASH=$(jq -r '.planHash' /tmp/deliverables/latest/manifest.json)
            echo "export PLAN_HASH=$PLAN_HASH" >> $BASH_ENV
      
      - persist_to_workspace:
          root: /tmp/deliverables
          paths:
            - latest

workflows:
  autopilot-workflow:
    jobs:
      - autopilot
```

## Monitoring Integration

### Prometheus Metrics Export

```bash
#!/bin/bash
# export-metrics.sh

MANIFEST=.smartergpt/deliverables/latest/manifest.json

# Extract metrics from manifest
LEVEL=$(jq -r '.levelExecuted' $MANIFEST)
ARTIFACT_COUNT=$(jq -r '.artifacts | length' $MANIFEST)
PLAN_HASH=$(jq -r '.planHash' $MANIFEST)

# Write Prometheus metrics
cat > /var/lib/node_exporter/autopilot.prom <<EOF
# HELP autopilot_level Autopilot execution level
# TYPE autopilot_level gauge
autopilot_level{plan_hash="$PLAN_HASH"} $LEVEL

# HELP autopilot_artifacts_total Total artifacts generated
# TYPE autopilot_artifacts_total gauge
autopilot_artifacts_total{plan_hash="$PLAN_HASH"} $ARTIFACT_COUNT

# HELP autopilot_execution_timestamp Last execution timestamp
# TYPE autopilot_execution_timestamp gauge
autopilot_execution_timestamp $(date +%s)
EOF
```

### Datadog Integration

```python
#!/usr/bin/env python3
# datadog-reporter.py

import json
from datadog import initialize, api

with open('.smartergpt/deliverables/latest/manifest.json') as f:
    manifest = json.load(f)

options = {
    'api_key': os.environ['DD_API_KEY'],
    'app_key': os.environ['DD_APP_KEY']
}
initialize(**options)

# Send metrics
api.Metric.send(
    metric='autopilot.level',
    points=manifest['levelExecuted'],
    tags=[f"plan_hash:{manifest['planHash'][:8]}"]
)

api.Metric.send(
    metric='autopilot.artifacts',
    points=len(manifest['artifacts']),
    tags=[
        f"plan_hash:{manifest['planHash'][:8]}",
        f"environment:{manifest['executionContext']['environment']}"
    ]
)

# Send event
api.Event.create(
    title='Autopilot Execution Complete',
    text=f"Level {manifest['levelExecuted']} completed\nPlan: {manifest['planHash'][:12]}",
    tags=[f"plan_hash:{manifest['planHash'][:8]}"]
)
```

### ELK Stack Integration

```bash
#!/bin/bash
# elk-shipper.sh

MANIFEST=.smartergpt/deliverables/latest/manifest.json
ANALYSIS=.smartergpt/deliverables/latest/analysis.json

# Combine manifest and analysis
jq -s '.[0] * .[1]' $MANIFEST $ANALYSIS | \
curl -X POST "http://elasticsearch:9200/autopilot-deliverables/_doc" \
  -H 'Content-Type: application/json' \
  -d @-
```

### Grafana Dashboard Query Examples

```promql
# Autopilot execution rate
rate(autopilot_execution_timestamp[5m])

# Average artifacts per execution
avg_over_time(autopilot_artifacts_total[1h])

# Latest autopilot level
autopilot_level

# Execution success rate (requires custom metric)
rate(autopilot_success_total[5m]) / rate(autopilot_execution_total[5m])
```

## Custom Automation Scripts

### Plan Hash Tracking

```bash
#!/bin/bash
# track-plan-hash.sh

# Calculate expected plan hash
EXPECTED_HASH=$(jq -c . plan.json | sha256sum | cut -d' ' -f1)

# Get actual hash from deliverables
ACTUAL_HASH=$(jq -r '.planHash' .smartergpt/deliverables/latest/manifest.json)

if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
    echo "✓ Plan hash verified"
    exit 0
else
    echo "✗ Plan hash mismatch"
    echo "  Expected: $EXPECTED_HASH"
    echo "  Actual: $ACTUAL_HASH"
    exit 1
fi
```

### Artifact Integrity Verification

```bash
#!/bin/bash
# verify-artifacts.sh

MANIFEST=.smartergpt/deliverables/latest/manifest.json
DELIVERABLES_DIR=.smartergpt/deliverables/latest

# Verify each artifact
jq -r '.artifacts[] | "\(.name) \(.hash)"' $MANIFEST | while read name hash; do
    actual_hash=$(sha256sum "$DELIVERABLES_DIR/$name" | cut -d' ' -f1)
    
    if [ "$hash" = "$actual_hash" ]; then
        echo "✓ $name"
    else
        echo "✗ $name (corrupted)"
        exit 1
    fi
done
```

### Automated Reporting

```bash
#!/bin/bash
# generate-summary.sh

MANIFEST=.smartergpt/deliverables/latest/manifest.json

cat <<EOF
# Autopilot Execution Summary

**Timestamp**: $(jq -r '.timestamp' $MANIFEST)
**Level**: $(jq -r '.levelExecuted' $MANIFEST)
**Plan Hash**: $(jq -r '.planHash' $MANIFEST | cut -c1-12)...
**Environment**: $(jq -r '.executionContext.environment' $MANIFEST)
**Artifacts**: $(jq -r '.artifacts | length' $MANIFEST)

## Artifacts Generated

$(jq -r '.artifacts[] | "- \(.name) (\(.size) bytes)"' $MANIFEST)

## Execution Context

- **Working Directory**: $(jq -r '.executionContext.workingDirectory' $MANIFEST)
- **Actor**: $(jq -r '.executionContext.actor // "unknown"' $MANIFEST)
- **Correlation ID**: $(jq -r '.executionContext.correlationId // "none"' $MANIFEST)
EOF
```

## Best Practices

### 1. Correlation ID Tracking

Always set correlation IDs for distributed tracing:

```yaml
# GitHub Actions
- name: Set Correlation ID
  run: echo "CORRELATION_ID=${{ github.run_id }}" >> $GITHUB_ENV

- name: Run Autopilot
  run: lex-pr autopilot plan.json
```

### 2. Environment-Specific Directories

Use different directories per environment:

```bash
# Development
lex-pr autopilot plan.json \
  --deliverables-dir .smartergpt.local/deliverables

# Staging
lex-pr autopilot plan.json \
  --deliverables-dir /var/staging/deliverables

# Production
lex-pr autopilot plan.json \
  --deliverables-dir /var/production/deliverables
```

### 3. Scheduled Cleanup

```yaml
# GitHub Actions - Scheduled Cleanup
name: Cleanup Deliverables
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: lex-pr deliverables:cleanup --max-age 30 --max-count 100
```

### 4. Artifact Retention by Environment

```bash
case "$ENVIRONMENT" in
  production)
    # Keep longer in production
    lex-pr deliverables:cleanup --max-age 90 --max-count 200
    ;;
  staging)
    # Moderate retention in staging
    lex-pr deliverables:cleanup --max-age 30 --max-count 50
    ;;
  development)
    # Aggressive cleanup in development
    lex-pr deliverables:cleanup --max-age 7 --max-count 10
    ;;
esac
```

## Troubleshooting

### Missing Deliverables

```bash
# List all deliverables with details
lex-pr deliverables:list --json | jq '.'

# Check if latest symlink exists
ls -la .smartergpt/deliverables/latest

# Recreate symlink if needed
cd .smartergpt/deliverables
ln -sfn $(ls -t weave-* | head -1) latest
```

### Corrupted Artifacts

```bash
# Verify all artifacts
./verify-artifacts.sh

# If corrupted, re-run autopilot
lex-pr autopilot plan.json --level 1
```

### Disk Space Issues

```bash
# Check deliverables size
du -sh .smartergpt/deliverables/*

# Preview cleanup (dry-run)
lex-pr deliverables:cleanup --max-count 5 --dry-run

# Apply cleanup
lex-pr deliverables:cleanup --max-count 5
```

## Related Documentation

- [Deliverables Management](./deliverables-management.md)
- [Monitoring Implementation](./monitoring-implementation.md)
- [Autopilot Levels](./autopilot-levels.md)
