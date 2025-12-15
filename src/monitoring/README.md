# Monitoring Module

Production-ready observability and metrics for lexrunner.

## Features

### 1. Structured Logging
- JSON and human-readable formats
- Correlation IDs for request tracing
- Environment-aware (dev/prod detection)
- Configurable log levels

### 2. Prometheus Metrics
- Counter, Gauge, and Histogram metrics
- Prometheus text format export
- Percentile calculations (p50, p95, p99)
- Key operational metrics

### 3. Performance Profiling
- Operation duration tracking
- Memory usage monitoring
- Automatic metric recording
- Async/sync operation helpers

### 4. Error Aggregation
- Group similar errors intelligently
- Track error frequency and context
- Normalized error messages
- Top errors summary

### 5. Audit Trail
- Immutable log of decisions and actions
- Correlation ID support
- Actor tracking (CI/GitHub user)
- JSONL export for log aggregation

### 6. Health Checks
- System health status endpoint
- Memory, operations, and error rate checks
- Detailed metrics on demand
- Degraded/unhealthy status detection

## Usage

### Structured Logging

```typescript
import { createLogger, generateCorrelationId } from './monitoring';

const logger = createLogger({ 
  format: 'json',
  correlationId: generateCorrelationId()
});

logger.info('gate_start', { 
  gateType: 'lint', 
  prId: 'PR-101' 
});
```

### Metrics Collection

```typescript
import { metrics, METRICS } from './monitoring';

// Record gate execution
metrics.incrementCounter(METRICS.GATE_SUCCESS_TOTAL, { gateType: 'lint' });
metrics.observeHistogram(METRICS.GATE_EXECUTION_TIME, 2.5, { gateType: 'lint' });

// Export for Prometheus
console.log(metrics.exportPrometheus());
```

### Performance Profiling

```typescript
import { profiler, profileAsync } from './monitoring';

// Manual profiling
profiler.start('gate_execution');
await executeGate();
const profile = profiler.end('gate_execution', { gateType: 'test' });

// Helper profiling
const result = await profileAsync('gate_lint', async () => {
  return await runLint();
}, { gateType: 'lint' });
```

### Error Aggregation

```typescript
import { errorAggregator } from './monitoring';

try {
  await riskyOperation();
} catch (error) {
  errorAggregator.recordError(error, { 
    operation: 'gate_execution',
    prId: 'PR-101' 
  });
}

const summary = errorAggregator.getSummary();
console.log(`${summary.totalErrors} errors, ${summary.uniqueErrors} unique`);
```

### Audit Trail

```typescript
import { auditTrail } from './monitoring';

auditTrail.log(
  'merge_decision', 
  'approved', 
  { prId: 'PR-101', eligible: true },
  correlationId
);

// Export for compliance
const entries = auditTrail.exportJSON();
const jsonl = auditTrail.exportJSONL();
```

### Health Checks

```typescript
import { healthChecker } from './monitoring';

const health = healthChecker.getHealth(true); // with metrics
console.log(health.status); // 'healthy', 'degraded', or 'unhealthy'
```

## CLI Integration

Use the `--log-format json` flag for structured logging:

```bash
lex-pr plan --log-format json
lex-pr merge plan.json --log-format json --execute
```

## MCP Server Health Endpoint

The MCP server includes a `health` tool for monitoring:

```typescript
// MCP tool call
{
  "name": "health",
  "arguments": {
    "includeMetrics": true
  }
}
```

## Key Metrics

### Execution Metrics
- `lex_pr_plan_execution_seconds` - Plan execution time histogram
- `lex_pr_gate_execution_seconds` - Gate execution time histogram
- `lex_pr_merge_execution_seconds` - Merge execution time histogram

### Success Rates
- `lex_pr_gate_success_total` - Gate success counter
- `lex_pr_gate_failure_total` - Gate failure counter
- `lex_pr_merge_success_total` - Merge success counter
- `lex_pr_merge_failure_total` - Merge failure counter

### Resource Utilization
- `lex_pr_memory_usage_bytes` - Memory usage gauge
- `lex_pr_active_workers` - Active workers gauge

### Dependency Resolution
- `lex_pr_dependency_resolution_seconds` - Resolution time histogram
- `lex_pr_dependency_accuracy_ratio` - Accuracy gauge

## Grafana Dashboard

A Grafana dashboard template is available at `src/monitoring/dashboards/grafana-dashboard.json`:

- Plan execution time percentiles (p50, p95, p99)
- Gate success rate by type
- Merge success rate
- Memory usage trends
- Active workers
- Dependency resolution metrics
- Error rate tracking

## Environment Detection

The monitoring module automatically detects the environment:

- **CI=true**: Enables JSON logging
- **LOG_FORMAT=json**: Forces JSON format
- **GITHUB_ACTOR**: Captured in audit trail

## Testing

Comprehensive test coverage in `tests/monitoring-*.spec.ts`:

```bash
npm test -- --run monitoring
```

## Design Principles

1. **Zero configuration defaults** - Works out of the box
2. **Environment aware** - Detects CI/dev/prod
3. **Performance first** - Minimal overhead
4. **Standard formats** - Prometheus, JSON, JSONL
5. **Correlation tracking** - Trace requests end-to-end
6. **Immutable audit** - Compliance-ready logging
