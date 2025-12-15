# Production Monitoring Examples

This file demonstrates the complete monitoring capabilities of lexrunner.

## Example 1: Structured Logging with Correlation IDs

```typescript
import { createLogger, generateCorrelationId } from './monitoring';

const correlationId = generateCorrelationId();
const logger = createLogger({ 
  format: 'json',
  correlationId 
});

// Log gate execution flow
logger.info('gate_start', { 
  gateType: 'lint', 
  prId: 'PR-101' 
});

logger.info('gate_running', { 
  gateType: 'lint',
  command: 'npm run lint'
});

logger.info('gate_complete', { 
  gateType: 'lint',
  status: 'pass',
  duration: 2.5
});
```

**Output (JSON):**
```json
{"timestamp":"2024-10-02T10:30:00Z","level":"info","correlationId":"abc123","event":"gate_start","gateType":"lint","prId":"PR-101"}
{"timestamp":"2024-10-02T10:30:01Z","level":"info","correlationId":"abc123","event":"gate_running","gateType":"lint","command":"npm run lint"}
{"timestamp":"2024-10-02T10:30:03Z","level":"info","correlationId":"abc123","event":"gate_complete","gateType":"lint","status":"pass","duration":2.5}
```

## Example 2: Performance Profiling

```typescript
import { profiler, profileAsync } from './monitoring';

// Async profiling with helper
const result = await profileAsync('gate_test', async () => {
  return await executeTests();
}, { gateType: 'test', prId: 'PR-101' });

// Manual profiling for complex operations
profiler.start('merge_pyramid', { level: 1, items: 3 });
try {
  await executeMergePyramid();
  const profile = profiler.end('merge_pyramid');
  console.log(`Merge completed in ${profile.duration}s`);
  console.log(`Memory delta: ${profile.memoryDelta?.heapUsed} bytes`);
} catch (error) {
  profiler.end('merge_pyramid');
  throw error;
}
```

## Example 3: Metrics Collection and Export

```typescript
import { metrics, METRICS } from './monitoring';

// Record gate results
metrics.incrementCounter(METRICS.GATE_SUCCESS_TOTAL, { 
  gateType: 'lint' 
});

metrics.observeHistogram(METRICS.GATE_EXECUTION_TIME, 2.5, { 
  gateType: 'lint',
  prId: 'PR-101'
});

// Calculate percentiles
const p95 = metrics.calculatePercentile(
  METRICS.GATE_EXECUTION_TIME, 
  0.95,
  { gateType: 'lint' }
);

console.log(`p95 execution time: ${p95}s`);

// Export for Prometheus
const prometheus = metrics.exportPrometheus();
console.log(prometheus);
```

**Prometheus Output:**
```
# TYPE lex_pr_gate_success_total counter
lex_pr_gate_success_total{gateType="lint"} 5
# TYPE lex_pr_gate_execution_seconds histogram
lex_pr_gate_execution_seconds_bucket{gateType="lint",le="0.1"} 0
lex_pr_gate_execution_seconds_bucket{gateType="lint",le="0.5"} 0
lex_pr_gate_execution_seconds_bucket{gateType="lint",le="1"} 0
lex_pr_gate_execution_seconds_bucket{gateType="lint",le="2.5"} 1
lex_pr_gate_execution_seconds_sum{gateType="lint"} 2.5
lex_pr_gate_execution_seconds_count{gateType="lint"} 1
```

## Example 4: Error Aggregation

```typescript
import { errorAggregator } from './monitoring';

// Record errors with context
try {
  await executeGate(gate);
} catch (error) {
  errorAggregator.recordError(error, {
    gateType: gate.name,
    prId: 'PR-101',
    attempt: 1
  });
  throw error;
}

// Get error summary
const summary = errorAggregator.getSummary();
console.log(`Total errors: ${summary.totalErrors}`);
console.log(`Unique errors: ${summary.uniqueErrors}`);

// Show top errors
summary.topErrors.forEach(group => {
  console.log(`${group.errorType}: ${group.message}`);
  console.log(`  Count: ${group.count}`);
  console.log(`  First seen: ${group.firstSeen}`);
  console.log(`  Last seen: ${group.lastSeen}`);
});
```

## Example 5: Audit Trail

```typescript
import { auditTrail } from './monitoring';

const correlationId = generateCorrelationId();

// Log decision-making process
auditTrail.log(
  'merge_eligibility',
  'evaluated',
  { 
    prId: 'PR-101',
    eligible: true,
    gates: ['lint', 'test', 'build'],
    allPassed: true
  },
  correlationId
);

auditTrail.log(
  'merge_decision',
  'approved',
  { 
    prId: 'PR-101',
    approver: 'automated',
    reason: 'all gates passed'
  },
  correlationId
);

auditTrail.log(
  'merge_execution',
  'success',
  { 
    prId: 'PR-101',
    commit: 'abc123def',
    branch: 'integration/level-1'
  },
  correlationId
);

// Export for compliance
const entries = auditTrail.getEntriesByCorrelationId(correlationId);
console.log(JSON.stringify(entries, null, 2));

// Export as JSONL for log aggregation
const jsonl = auditTrail.exportJSONL();
fs.writeFileSync('audit-trail.jsonl', jsonl);
```

## Example 6: Health Monitoring

```typescript
import { healthChecker } from './monitoring';

// Basic health check
const health = healthChecker.getHealth();
console.log(`Status: ${health.status}`);
console.log(`Uptime: ${health.uptime}s`);

// Detailed health with metrics
const detailedHealth = healthChecker.getHealth(true);

if (detailedHealth.status === 'degraded') {
  console.warn('System is degraded');
  
  if (detailedHealth.checks.memory.status === 'warn') {
    console.warn(`Memory warning: ${detailedHealth.checks.memory.message}`);
  }
  
  if (detailedHealth.checks.errorRate.status === 'warn') {
    console.warn(`Error rate warning: ${detailedHealth.checks.errorRate.message}`);
  }
}

// Expose health endpoint
app.get('/health', (req, res) => {
  const health = healthChecker.getHealth(true);
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

## Example 7: CLI Integration

```bash
# Use JSON logging in CI
lex-pr --log-format json plan --github --query "is:pr is:open label:ready-to-merge"

# Use JSON logging for merge execution
lex-pr --log-format json merge plan.json --execute

# Human-readable output for local development
lex-pr --log-format human merge plan.json --dry-run
```

## Example 8: MCP Server Health Endpoint

```json
// MCP tool call
{
  "name": "health",
  "arguments": {
    "includeMetrics": true
  }
}

// Response
{
  "status": "healthy",
  "timestamp": "2024-10-02T10:30:00Z",
  "uptime": 3600,
  "version": "0.1.0",
  "checks": {
    "memory": {
      "status": "pass",
      "message": "Memory usage normal: 50.2MB / 100MB (50.2%)"
    },
    "activeOperations": {
      "status": "pass",
      "message": "2 active operation(s)"
    },
    "errorRate": {
      "status": "pass",
      "message": "Error count normal: 5 errors (3 unique)"
    }
  },
  "metrics": {
    "memory": {
      "heapUsed": 52647936,
      "heapTotal": 104857600,
      "rss": 157286400
    },
    "activeProfiles": 2,
    "errorSummary": {
      "totalErrors": 5,
      "uniqueErrors": 3
    }
  }
}
```

## Example 9: Complete Integration

```typescript
import { 
  createLogger, 
  generateCorrelationId,
  metrics,
  METRICS,
  profiler,
  errorAggregator,
  auditTrail,
  healthChecker
} from './monitoring';

async function executeGateWithMonitoring(gate: Gate, prId: string) {
  const correlationId = generateCorrelationId();
  const logger = createLogger({ format: 'json', correlationId });
  
  // Log start
  logger.info('gate_start', { 
    gateType: gate.name, 
    prId 
  });
  
  // Audit trail
  auditTrail.log('gate_execution', 'initiated', {
    gateType: gate.name,
    prId
  }, correlationId);
  
  // Start profiling
  profiler.start(`gate_${gate.name}`, { prId });
  
  try {
    const result = await executeGate(gate);
    
    // Record success
    metrics.incrementCounter(METRICS.GATE_SUCCESS_TOTAL, {
      gateType: gate.name
    });
    
    // End profiling
    const profile = profiler.end(`gate_${gate.name}`, {
      gateType: gate.name
    });
    
    // Log completion
    logger.info('gate_complete', {
      gateType: gate.name,
      prId,
      status: 'pass',
      duration: profile?.duration
    });
    
    // Audit success
    auditTrail.log('gate_execution', 'passed', {
      gateType: gate.name,
      prId,
      duration: profile?.duration
    }, correlationId);
    
    return result;
    
  } catch (error) {
    // Record failure
    metrics.incrementCounter(METRICS.GATE_FAILURE_TOTAL, {
      gateType: gate.name
    });
    
    // Aggregate error
    errorAggregator.recordError(error, {
      gateType: gate.name,
      prId
    });
    
    // End profiling (still capture timing)
    profiler.end(`gate_${gate.name}`, {
      gateType: gate.name
    });
    
    // Log error
    logger.error('gate_failed', {
      gateType: gate.name,
      prId,
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Audit failure
    auditTrail.log('gate_execution', 'failed', {
      gateType: gate.name,
      prId,
      error: error instanceof Error ? error.message : String(error)
    }, correlationId);
    
    throw error;
  }
}

// Check system health periodically
setInterval(() => {
  const health = healthChecker.getHealth();
  if (health.status !== 'healthy') {
    console.error(`System health: ${health.status}`);
    // Alert or take action
  }
}, 60000); // Every minute
```

## Integration with Monitoring Stacks

### Prometheus + Grafana

1. **Expose metrics endpoint:**
```typescript
import { metrics } from './monitoring';

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.exportPrometheus());
});
```

2. **Configure Prometheus scraping:**
```yaml
scrape_configs:
  - job_name: 'lexrunner'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
```

3. **Import Grafana dashboard:**
   - Use `src/monitoring/dashboards/grafana-dashboard.json`
   - Configure data source to Prometheus
   - Visualize all key metrics

### ELK Stack (Elasticsearch, Logstash, Kibana)

1. **Use JSON logging:**
```bash
lex-pr --log-format json merge plan.json --execute > logs.jsonl
```

2. **Configure Logstash:**
```
input {
  file {
    path => "/var/log/lexrunner/*.jsonl"
    codec => "json"
  }
}

filter {
  if [correlationId] {
    mutate {
      add_field => { "trace_id" => "%{correlationId}" }
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "lexrunner-%{+YYYY.MM.dd}"
  }
}
```

3. **Create Kibana dashboards:**
   - Filter by correlationId for request tracing
   - Visualize error rates by gateType
   - Track execution times
