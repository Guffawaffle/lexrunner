# Deliverables Management System

## Overview

The Deliverables Management System provides comprehensive artifact tracking, versioning, cleanup, and CI/CD integration for autopilot operations in lex-pr-runner.

## Key Features

- **Artifact Tracking**: Automatic registration and tracking of all generated artifacts
- **Plan Hash Linking**: Each deliverable is linked to its originating plan via SHA-256 hash
- **Latest Symlink**: Always points to the most recent execution for easy access
- **Retention Policies**: Configurable cleanup based on age, count, or custom policies
- **CI/CD Integration**: Structured manifest format for external system integration
- **Execution Context**: Captures environment, actor, and correlation ID for traceability

## Directory Structure

```
.smartergpt/
└── deliverables/
    ├── latest -> weave-2024-10-04T10-30-00/  # Symlink to latest
    ├── weave-2024-10-04T10-30-00/
    │   ├── manifest.json                      # Deliverables manifest
    │   ├── analysis.json                      # Analysis data
    │   ├── weave-report.md                    # Execution report
    │   ├── gate-predictions.json              # Gate predictions
    │   ├── execution-log.md                   # Execution log
    │   └── metadata.json                      # Runtime metadata
    └── weave-2024-10-04T09-15-00/
        └── ...
```

## Manifest Schema

Each deliverables directory contains a `manifest.json` file that links artifacts to the originating plan:

```json
{
  "schemaVersion": "1.0.0",
  "timestamp": "2024-10-04T10:30:00Z",
  "planHash": "a7f3b2c1d4e5f6g7h8i9j0k1l2m3n4o5",
  "runnerVersion": "0.1.0",
  "levelExecuted": 1,
  "profilePath": "/path/to/.smartergpt",
  "artifacts": [
    {
      "name": "analysis.json",
      "path": "analysis.json",
      "type": "json",
      "size": 1024,
      "hash": "sha256:abc123..."
    }
  ],
  "executionContext": {
    "workingDirectory": "/path/to/repo",
    "environment": "ci",
    "actor": "github-actions[bot]",
    "correlationId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

## CLI Commands

### Autopilot with Custom Deliverables Directory

Override the default deliverables location:

```bash
lex-pr autopilot plan.json --deliverables-dir ./custom-deliverables
```

### List Deliverables

View all deliverables with metadata:

```bash
lex-pr deliverables:list

# JSON output
lex-pr deliverables:list --json
```

Example output:

```
📦 Deliverables in /path/to/.smartergpt/deliverables

1. 2024-10-04T10:30:00Z
   Level: 1
   Plan Hash: a7f3b2c1d4e5...
   Artifacts: 5
   Environment: ci
   Actor: github-actions[bot]

2. 2024-10-04T09:15:00Z
   Level: 1
   Plan Hash: b8g4c3d2e6f7...
   Artifacts: 5
   Environment: local

📍 Latest: weave-2024-10-04T10-30-00
```

### Cleanup Old Deliverables

Remove old deliverables based on retention policies:

```bash
# Keep only the latest 5 deliverables
lex-pr deliverables:cleanup --max-count 5

# Remove deliverables older than 30 days
lex-pr deliverables:cleanup --max-age 30

# Combine policies
lex-pr deliverables:cleanup --max-count 10 --max-age 7

# Preview changes without deleting (dry-run)
lex-pr deliverables:cleanup --max-count 5 --dry-run
```

The `--keep-latest` option (enabled by default) ensures the most recent deliverable is always retained.

## CI/CD Integration

### Accessing Latest Deliverables

Always use the `latest` symlink to access the most recent artifacts:

```bash
# GitHub Actions example
- name: Access latest deliverables
  run: |
    cd .smartergpt/deliverables/latest
    cat manifest.json
    cat analysis.json
```

### Finding Deliverables by Plan Hash

Match deliverables to specific plans using the plan hash:

```bash
# Calculate plan hash
PLAN_HASH=$(jq -c . plan.json | sha256sum | cut -d' ' -f1)

# Find matching deliverable
lex-pr deliverables:list --json | \
  jq -r ".[] | select(.planHash == \"$PLAN_HASH\") | ._dirName"
```

### Artifact Verification

Verify artifact integrity using stored hashes:

```bash
# Extract artifact hash from manifest
EXPECTED_HASH=$(jq -r '.artifacts[] | select(.name == "analysis.json") | .hash' manifest.json)

# Verify actual file
ACTUAL_HASH=$(sha256sum analysis.json | cut -d' ' -f1)

if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
  echo "Artifact verified"
else
  echo "Artifact corrupted"
  exit 1
fi
```

## Retention Policy Configuration

### Policy Options

- **maxCount**: Maximum number of deliverables to keep (oldest removed first)
- **maxAge**: Maximum age in days (older deliverables removed)
- **keepLatest**: Always keep the latest deliverable (default: true)

### Example Policies

**Development Environment**:
```bash
# Keep last 3 runs
lex-pr deliverables:cleanup --max-count 3
```

**CI Environment**:
```bash
# Keep 7 days of deliverables
lex-pr deliverables:cleanup --max-age 7
```

**Production**:
```bash
# Keep last 30 deliverables AND remove anything older than 90 days
lex-pr deliverables:cleanup --max-count 30 --max-age 90
```

## Integration Examples

### GitHub Actions - Publish Deliverables

```yaml
- name: Run Autopilot
  run: lex-pr autopilot plan.json

- name: Upload Deliverables
  uses: actions/upload-artifact@v3
  with:
    name: autopilot-deliverables
    path: .smartergpt/deliverables/latest/
```

### Jenkins - Archive Artifacts

```groovy
stage('Autopilot') {
    steps {
        sh 'lex-pr autopilot plan.json'
        archiveArtifacts artifacts: '.smartergpt/deliverables/latest/**/*'
    }
}
```

### GitLab CI - Store in Cache

```yaml
autopilot:
  script:
    - lex-pr autopilot plan.json
  artifacts:
    paths:
      - .smartergpt/deliverables/latest/
    expire_in: 1 week
```

### Custom Monitoring Integration

```bash
#!/bin/bash
# Send deliverables metadata to monitoring system

MANIFEST=.smartergpt/deliverables/latest/manifest.json

curl -X POST https://monitoring.example.com/api/autopilot \
  -H "Content-Type: application/json" \
  -d @$MANIFEST
```

## Programmatic Access

### TypeScript/JavaScript

```typescript
import { DeliverablesManager } from 'lex-pr-runner/autopilot';

const manager = new DeliverablesManager('/path/to/.smartergpt');

// List all deliverables
const deliverables = await manager.listDeliverables();
console.log(`Found ${deliverables.length} deliverables`);

// Get latest
const latest = manager.getLatestPath();
console.log(`Latest: ${latest}`);

// Cleanup
const result = await manager.cleanup({
  maxCount: 5,
  keepLatest: true
});
console.log(`Removed ${result.removed.length} deliverables`);
```

### Shell Script

```bash
#!/bin/bash
# Get execution context from latest deliverable

LATEST=.smartergpt/deliverables/latest/manifest.json

PLAN_HASH=$(jq -r '.planHash' $LATEST)
LEVEL=$(jq -r '.levelExecuted' $LATEST)
ENVIRONMENT=$(jq -r '.executionContext.environment' $LATEST)

echo "Plan Hash: $PLAN_HASH"
echo "Level: $LEVEL"
echo "Environment: $ENVIRONMENT"
```

## Best Practices

### 1. Regular Cleanup

Set up automated cleanup in CI:

```yaml
# .github/workflows/cleanup.yml
name: Cleanup Old Deliverables
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: lex-pr deliverables:cleanup --max-age 30
```

### 2. Plan Hash Verification

Always verify deliverables match the expected plan:

```bash
EXPECTED_HASH="abc123..."
ACTUAL_HASH=$(jq -r '.planHash' .smartergpt/deliverables/latest/manifest.json)

if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
  echo "Error: Plan hash mismatch"
  exit 1
fi
```

### 3. Environment-Specific Directories

Use custom directories for different environments:

```bash
# Development
lex-pr autopilot plan.json --deliverables-dir .smartergpt.local/deliverables

# CI
lex-pr autopilot plan.json --deliverables-dir /tmp/ci-deliverables

# Production
lex-pr autopilot plan.json --deliverables-dir /var/autopilot/deliverables
```

### 4. Correlation ID Tracking

Use correlation IDs for distributed tracing:

```bash
export CORRELATION_ID=$(uuidgen)
lex-pr autopilot plan.json

# Correlation ID is stored in manifest
jq -r '.executionContext.correlationId' .smartergpt/deliverables/latest/manifest.json
```

## Troubleshooting

### Symlink Issues

If the `latest` symlink is broken:

```bash
# Recreate from most recent deliverable
cd .smartergpt/deliverables
NEWEST=$(ls -t weave-* | head -1)
ln -sfn $NEWEST latest
```

### Manifest Not Found

If manifest is missing from a deliverable:

```bash
# Check directory contents
ls -la .smartergpt/deliverables/weave-*/

# Verify directory was created by autopilot
# Manually created directories won't have manifests
```

### Cleanup Not Working

If cleanup doesn't remove expected deliverables:

```bash
# Check what would be removed (dry-run)
lex-pr deliverables:cleanup --max-count 5 --dry-run

# Verify timestamps are being read correctly
lex-pr deliverables:list --json | jq -r '.[].timestamp'
```

## Migration Guide

### Migrating from Old Deliverables

If you have deliverables from before this system:

1. Old deliverables without manifests will be ignored by list/cleanup
2. Run autopilot again to create new deliverables with manifests
3. Manually archive or remove old deliverables:

```bash
# Archive old deliverables
cd .smartergpt/deliverables
tar czf old-deliverables-backup.tar.gz weave-2024-*
rm -rf weave-2024-*  # Remove after verifying backup
```

## API Reference

See [DeliverableManager API](../src/autopilot/deliverables.ts) for detailed programmatic interface documentation.

## Related Documentation

- [Autopilot Levels](./autopilot-levels.md)
- [Monitoring Integration](./monitoring-implementation.md)
- [Schema Management](./schema-management.md)
