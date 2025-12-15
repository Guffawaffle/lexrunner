# Governance Metrics and Observability

This document describes the governance metrics export functionality in lexrunner (Wave 3).

## Overview

The governance model requires observability to be useful. Operators need dashboards to understand:
- Turn Cost trends
- Tier distribution
- Failure rates
- Budget consumption

## Available Metrics

### lex_turn_cost_total (Counter)

Total Turn Cost accumulated across merge-weave operations.

**Components tracked:**
- Latency (API response time, gate execution, merge time)
- Context Reset tokens
- Renegotiation (conflict resolution retries, clarification turns)
- Token Bloat (excess tokens beyond expected)
- Attention Switch (human interventions)

**Prometheus example:**
```
# HELP lex_turn_cost_total Total Turn Cost accumulated across merge-weave operations
# TYPE lex_turn_cost_total counter
lex_turn_cost_total 2.5
```

### lex_tier_distribution (Gauge)

Distribution of tasks by capability tier (senior, mid, junior).

**Labels:** `tier` (senior|mid|junior)

**Prometheus example:**
```
# HELP lex_tier_distribution Distribution of tasks by capability tier
# TYPE lex_tier_distribution gauge
lex_tier_distribution{tier="senior"} 3
lex_tier_distribution{tier="mid"} 5
lex_tier_distribution{tier="junior"} 2
```

### lex_tier_match_rate (Gauge)

Rate of tier matches vs mismatches (0-1). Higher is better.

**Target:** > 90% (0.9)

### lex_escalation_rate (Gauge)

Rate of tier escalations (0-1). Lower is better.

**Target:** < 10% (0.1)

### lex_failure_rate (Gauge)

Rate of failed gate operations (0-1). Lower is better.

**Prometheus example:**
```
# HELP lex_failure_rate Rate of failed gate operations (0-1)
# TYPE lex_failure_rate gauge
lex_failure_rate 0.1
```

### lex_budget_remaining (Gauge)

Remaining budget for tokens and prompts.

**Labels:** `type` (tokens|prompts)

**Prometheus example:**
```
# HELP lex_budget_remaining Remaining budget (tokens or prompts)
# TYPE lex_budget_remaining gauge
lex_budget_remaining{type="tokens"} 4000
lex_budget_remaining{type="prompts"} 2
```

## CLI Usage

### Show Metrics (JSON)

```bash
# Show all metrics as JSON
lex-pr metrics

# Filter specific metrics
lex-pr metrics --filter turn_cost
lex-pr metrics --filter tier
lex-pr metrics --filter budget
```

**Example output:**
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "sessionId": "01ABC123...",
  "metrics": {
    "turnCost": {
      "total": 2.5,
      "components": {
        "latencyMs": 1500,
        "contextResetTokens": 0,
        "renegotiationCount": 2,
        "tokenBloat": 100,
        "attentionSwitchCount": 1
      },
      "eventCount": 5
    },
    "tierDistribution": {
      "byTier": { "senior": 3, "mid": 4, "junior": 3 },
      "tierMatchRate": 0.9,
      "escalationRate": 0.1
    },
    "failureRate": {
      "gateFailures": 2,
      "totalGates": 10,
      "failureRate": 0.2
    },
    "budgetRemaining": {
      "tokensRemaining": 2000,
      "tokenBudget": 5000,
      "promptsRemaining": 3,
      "maxPrompts": 5,
      "tokenUtilization": 0.6,
      "promptUtilization": 0.4
    }
  }
}
```

### Export Prometheus Format

```bash
# Export for Prometheus scraping
lex-pr metrics --prometheus

# Save to file for HTTP endpoint
lex-pr metrics --prometheus --output /var/lib/prometheus/lex-pr.prom
```

### Load from Artifacts

```bash
# Load metrics from execution artifacts
lex-pr metrics --from-artifacts .smartergpt/runner/
```

### Show Metric Definitions

```bash
lex-pr metrics definitions
```

## MCP Server Integration

The MCP server exposes a `metrics` tool for AI agents:

```json
{
  "name": "metrics",
  "arguments": {
    "filter": "turn_cost",
    "format": "json"
  }
}
```

**Parameters:**
- `filter` (optional): Filter metrics by name pattern
- `format` (optional): Output format - "json" (default) or "prometheus"

## Programmatic Usage

```typescript
import {
  createMetricsCollector,
  getGlobalMetricsCollector,
  resetGlobalMetricsCollector,
} from 'lexrunner/metrics';

// Create a new collector
const collector = createMetricsCollector('my-session-id');

// Or use the global singleton
const global = getGlobalMetricsCollector();

// Record metrics
collector.recordTurnCost(turnCostSummary);
collector.recordTierDistribution(tierMetrics);
collector.recordFailureRate(2, 10); // 2 failures out of 10
collector.recordBudgetRemaining(budgetSummary);

// Get snapshot
const snapshot = collector.getSnapshot();

// Export Prometheus format
const prometheus = collector.exportPrometheus();

// Get filtered metrics
const filtered = collector.getMetricsByName('turn_cost');

// Get individual metric values
const values = collector.getMetricValues();

// Reset metrics
collector.reset();
resetGlobalMetricsCollector(); // Reset global singleton
```

## Grafana Dashboard Configuration

### Sample Dashboard JSON

```json
{
  "title": "LexRunner Governance Metrics",
  "panels": [
    {
      "title": "Turn Cost Trend",
      "type": "timeseries",
      "targets": [
        {
          "expr": "lex_turn_cost_total",
          "legendFormat": "Total Turn Cost"
        }
      ]
    },
    {
      "title": "Tier Distribution",
      "type": "piechart",
      "targets": [
        {
          "expr": "lex_tier_distribution",
          "legendFormat": "{{tier}}"
        }
      ]
    },
    {
      "title": "Failure Rate",
      "type": "gauge",
      "targets": [
        {
          "expr": "lex_failure_rate",
          "legendFormat": "Failure Rate"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "max": 1,
          "thresholds": {
            "steps": [
              { "value": 0, "color": "green" },
              { "value": 0.1, "color": "yellow" },
              { "value": 0.3, "color": "red" }
            ]
          }
        }
      }
    },
    {
      "title": "Budget Utilization",
      "type": "bargauge",
      "targets": [
        {
          "expr": "1 - (lex_budget_remaining / lex_budget_total)",
          "legendFormat": "{{type}} utilization"
        }
      ]
    }
  ]
}
```

## Alerting Thresholds

### Recommended Prometheus Alerting Rules

```yaml
groups:
  - name: lexrunner
    rules:
      - alert: HighTurnCost
        expr: lex_turn_cost_total > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High Turn Cost detected"
          description: "Turn Cost is {{ $value }}, above threshold of 10"

      - alert: HighFailureRate
        expr: lex_failure_rate > 0.3
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High gate failure rate"
          description: "Failure rate is {{ $value }}, above 30%"

      - alert: LowTierMatchRate
        expr: lex_tier_match_rate < 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low tier match rate"
          description: "Tier match rate is {{ $value }}, below 80%"

      - alert: BudgetNearlyExhausted
        expr: lex_budget_remaining{type="tokens"} < 500
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Token budget nearly exhausted"
          description: "Only {{ $value }} tokens remaining"
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
- name: Run merge-weave
  run: |
    lex-pr execute plan.json

- name: Export metrics
  run: |
    lex-pr metrics --output metrics.json

- name: Upload metrics artifact
  uses: actions/upload-artifact@v4
  with:
    name: governance-metrics
    path: metrics.json
```

### Prometheus Push Gateway

```bash
# Push metrics to Prometheus Push Gateway
lex-pr metrics --prometheus | curl --data-binary @- http://pushgateway:9091/metrics/job/lexrunner/instance/ci
```

## Session Tracking

Each metrics snapshot includes:
- `timestamp`: ISO 8601 timestamp of the snapshot
- `sessionId`: Unique identifier (ULID) for the session

This enables correlation across multiple metric snapshots and tracking of metrics over time within a single execution session.
