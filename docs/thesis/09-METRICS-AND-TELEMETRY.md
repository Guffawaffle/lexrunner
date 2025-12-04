# 09 — Metrics and Telemetry: What to Measure and How

> **TL;DR:** Measure what matters — Turn Cost, not just tokens. Track economic impact, not just technical metrics. Make governance decisions data-driven.

---

## The Metrics Philosophy

Traditional AI metrics focus on:
- Tokens consumed
- Latency per request
- Error rates

These are infrastructure metrics. They tell you if the system is working, not if it's working **well**.

We need metrics that answer:
- Is the agent productive?
- Is the governance effective?
- Are we getting value for cost?
- Where should we invest to improve?

---

## Core Metric Categories

### Category 1: Turn Cost Metrics

These measure the real productivity impact:

| Metric | Description | Target |
|--------|-------------|--------|
| `turn_count` | Number of turns per task | Lower is better |
| `renegotiation_rate` | % of turns that are clarifications | < 15% |
| `context_reset_tokens` | Tokens to restore context | < 300 |
| `effective_turn_cost` | Weighted composite score | < 1.0 |

### Category 2: Economic Metrics

These measure cost efficiency:

| Metric | Description | Target |
|--------|-------------|--------|
| `cost_per_pr` | Total model costs per PR | Track trend |
| `tier_distribution` | % of work by tier | 50% mid, 30% junior |
| `escalation_rate` | % of tasks escalating up | < 20% |
| `cost_per_feature` | Total cost for a feature | Track and compare |

### Category 3: Quality Metrics

These measure output quality:

| Metric | Description | Target |
|--------|-------------|--------|
| `first_pass_rate` | % of PRs merged without revision | > 70% |
| `review_cycles` | Average review cycles per PR | < 2 |
| `test_coverage` | Coverage of agent-written code | > 80% |
| `lint_violations` | Lint errors in agent output | 0 |

### Category 4: Governance Metrics

These measure governance effectiveness:

| Metric | Description | Target |
|--------|-------------|--------|
| `compliance_rate` | % of changes passing governance | > 95% |
| `uncertainty_expression_rate` | % of decisions with uncertainty markers | > 10% |
| `receipt_completeness` | % of actions with receipts | 100% |
| `contract_coverage` | % of task types with explicit contracts | > 80% |

---

## Telemetry Architecture

### Data Flow

```
Agent Action
     ↓
  Events → Collector → Store → Aggregator → Reports
                                    ↓
                              Dashboards/Alerts
```

### Event Schema

```typescript
// src/telemetry/events.ts

import { z } from 'zod';

export const TelemetryEventSchema = z.object({
  // Identification
  eventId: z.string(),
  eventType: z.string(),
  timestamp: z.date(),
  
  // Context
  sessionId: z.string(),
  workspaceId: z.string(),
  taskId: z.string().optional(),
  
  // Actor
  model: z.string().optional(),
  tier: z.enum(['senior', 'mid', 'junior']).optional(),
  
  // Timing
  durationMs: z.number().optional(),
  
  // Tokens
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  
  // Cost
  estimatedCost: z.number().optional(),
  
  // Classification
  tags: z.array(z.string()).optional(),
  
  // Arbitrary data
  data: z.record(z.unknown()).optional()
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
```

### Event Types

```typescript
// Event type constants
export const EventTypes = {
  // Turn events
  TURN_START: 'turn.start',
  TURN_END: 'turn.end',
  TURN_RENEGOTIATION: 'turn.renegotiation',
  
  // Model events
  MODEL_REQUEST: 'model.request',
  MODEL_RESPONSE: 'model.response',
  MODEL_ERROR: 'model.error',
  
  // Governance events
  COMPLIANCE_CHECK: 'governance.compliance_check',
  CONSTRAINT_VIOLATION: 'governance.constraint_violation',
  UNCERTAINTY_EXPRESSED: 'governance.uncertainty',
  
  // Tier events
  TIER_ESCALATION: 'tier.escalation',
  TIER_DELEGATION: 'tier.delegation',
  
  // Receipt events
  RECEIPT_CREATED: 'receipt.created',
  RECEIPT_FAILED: 'receipt.failed',
  
  // Gate events
  GATE_START: 'gate.start',
  GATE_PASS: 'gate.pass',
  GATE_FAIL: 'gate.fail',
  GATE_WARN: 'gate.warn',
  
  // Session events
  SESSION_START: 'session.start',
  SESSION_END: 'session.end'
} as const;
```

---

## Collection Implementation

### Event Collector

```typescript
// src/telemetry/collector.ts

export interface CollectorConfig {
  flushInterval: number;
  maxBatchSize: number;
  stores: TelemetryStore[];
}

export class TelemetryCollector {
  private buffer: TelemetryEvent[] = [];
  private config: CollectorConfig;
  private flushTimer: NodeJS.Timer | null = null;
  
  constructor(config: CollectorConfig) {
    this.config = config;
    this.startFlushTimer();
  }
  
  emit(event: Omit<TelemetryEvent, 'eventId' | 'timestamp'>): void {
    const fullEvent: TelemetryEvent = {
      ...event,
      eventId: generateEventId(),
      timestamp: new Date()
    };
    
    this.buffer.push(fullEvent);
    
    if (this.buffer.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }
  
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    const events = [...this.buffer];
    this.buffer = [];
    
    await Promise.all(
      this.config.stores.map(store => store.write(events))
    );
  }
  
  private startFlushTimer(): void {
    this.flushTimer = setInterval(
      () => this.flush(),
      this.config.flushInterval
    );
  }
  
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}
```

### Telemetry Stores

```typescript
// src/telemetry/stores/file.ts

export class FileTelemetryStore implements TelemetryStore {
  private baseDir: string;
  
  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }
  
  async write(events: TelemetryEvent[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const dir = join(this.baseDir, date);
    await mkdir(dir, { recursive: true });
    
    const filename = `events-${Date.now()}.ndjson`;
    const content = events.map(e => JSON.stringify(e)).join('\n');
    
    await writeFile(join(dir, filename), content);
  }
}

// src/telemetry/stores/memory.ts

export class MemoryTelemetryStore implements TelemetryStore {
  private events: TelemetryEvent[] = [];
  private maxEvents: number;
  
  constructor(maxEvents = 10000) {
    this.maxEvents = maxEvents;
  }
  
  async write(events: TelemetryEvent[]): Promise<void> {
    this.events.push(...events);
    
    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }
  
  query(filter: EventFilter): TelemetryEvent[] {
    return this.events.filter(e => matchesFilter(e, filter));
  }
}
```

---

## Aggregation

### Real-Time Aggregators

```typescript
// src/telemetry/aggregators/turn-cost.ts

export class TurnCostAggregator {
  private metrics: Map<string, TurnCostMetrics> = new Map();
  
  process(events: TelemetryEvent[]): void {
    for (const event of events) {
      if (!event.sessionId) continue;
      
      let metrics = this.metrics.get(event.sessionId);
      if (!metrics) {
        metrics = createEmptyMetrics(event.sessionId);
        this.metrics.set(event.sessionId, metrics);
      }
      
      switch (event.eventType) {
        case EventTypes.TURN_END:
          metrics.turnCount++;
          metrics.totalDurationMs += event.durationMs ?? 0;
          break;
          
        case EventTypes.TURN_RENEGOTIATION:
          metrics.renegotiationTurns++;
          break;
          
        case EventTypes.MODEL_RESPONSE:
          if (event.inputTokens) {
            metrics.totalInputTokens += event.inputTokens;
          }
          if (event.outputTokens) {
            metrics.totalOutputTokens += event.outputTokens;
          }
          break;
      }
    }
  }
  
  getMetrics(sessionId: string): TurnCostMetrics | null {
    return this.metrics.get(sessionId) ?? null;
  }
  
  getAllMetrics(): TurnCostMetrics[] {
    return Array.from(this.metrics.values());
  }
}
```

### Economic Aggregators

```typescript
// src/telemetry/aggregators/economic.ts

export class EconomicAggregator {
  private costByTier: Record<Tier, number> = { senior: 0, mid: 0, junior: 0 };
  private costByModel: Map<string, number> = new Map();
  private escalationCount = 0;
  private delegationCount = 0;
  
  process(events: TelemetryEvent[]): void {
    for (const event of events) {
      switch (event.eventType) {
        case EventTypes.MODEL_RESPONSE:
          if (event.estimatedCost && event.tier) {
            this.costByTier[event.tier] += event.estimatedCost;
          }
          if (event.estimatedCost && event.model) {
            const current = this.costByModel.get(event.model) ?? 0;
            this.costByModel.set(event.model, current + event.estimatedCost);
          }
          break;
          
        case EventTypes.TIER_ESCALATION:
          this.escalationCount++;
          break;
          
        case EventTypes.TIER_DELEGATION:
          this.delegationCount++;
          break;
      }
    }
  }
  
  getReport(): EconomicReport {
    const totalCost = Object.values(this.costByTier).reduce((a, b) => a + b, 0);
    
    return {
      totalCost,
      costByTier: this.costByTier,
      costByModel: Object.fromEntries(this.costByModel),
      tierDistribution: {
        senior: this.costByTier.senior / totalCost,
        mid: this.costByTier.mid / totalCost,
        junior: this.costByTier.junior / totalCost
      },
      escalationCount: this.escalationCount,
      delegationCount: this.delegationCount
    };
  }
}
```

---

## Reporting

### Session Report

```typescript
// src/telemetry/reports/session.ts

export interface SessionReport {
  sessionId: string;
  startTime: Date;
  endTime: Date | null;
  
  // Turn metrics
  turns: {
    total: number;
    renegotiations: number;
    renegotiationRate: number;
  };
  
  // Cost metrics
  cost: {
    total: number;
    byTier: Record<Tier, number>;
    tokensUsed: number;
  };
  
  // Quality metrics
  quality: {
    complianceViolations: number;
    gateFailures: number;
    uncertaintyExpressions: number;
  };
  
  // Tier metrics
  tiers: {
    escalations: number;
    delegations: number;
    tierDistribution: Record<Tier, number>;
  };
}

export function generateSessionReport(
  events: TelemetryEvent[],
  sessionId: string
): SessionReport {
  const sessionEvents = events.filter(e => e.sessionId === sessionId);
  
  // Find session bounds
  const startEvent = sessionEvents.find(e => e.eventType === EventTypes.SESSION_START);
  const endEvent = sessionEvents.find(e => e.eventType === EventTypes.SESSION_END);
  
  // Count events by type
  const turnEnds = sessionEvents.filter(e => e.eventType === EventTypes.TURN_END);
  const renegotiations = sessionEvents.filter(e => e.eventType === EventTypes.TURN_RENEGOTIATION);
  const violations = sessionEvents.filter(e => e.eventType === EventTypes.CONSTRAINT_VIOLATION);
  const gateFailures = sessionEvents.filter(e => e.eventType === EventTypes.GATE_FAIL);
  const uncertainties = sessionEvents.filter(e => e.eventType === EventTypes.UNCERTAINTY_EXPRESSED);
  const escalations = sessionEvents.filter(e => e.eventType === EventTypes.TIER_ESCALATION);
  const delegations = sessionEvents.filter(e => e.eventType === EventTypes.TIER_DELEGATION);
  
  // Calculate costs
  const modelResponses = sessionEvents.filter(e => e.eventType === EventTypes.MODEL_RESPONSE);
  const totalCost = modelResponses.reduce((sum, e) => sum + (e.estimatedCost ?? 0), 0);
  const totalTokens = modelResponses.reduce(
    (sum, e) => sum + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 
    0
  );
  
  // Tier distribution
  const tierCounts: Record<Tier, number> = { senior: 0, mid: 0, junior: 0 };
  for (const e of modelResponses) {
    if (e.tier) tierCounts[e.tier]++;
  }
  const totalTierCounts = Object.values(tierCounts).reduce((a, b) => a + b, 0);
  
  return {
    sessionId,
    startTime: startEvent?.timestamp ?? new Date(),
    endTime: endEvent?.timestamp ?? null,
    
    turns: {
      total: turnEnds.length,
      renegotiations: renegotiations.length,
      renegotiationRate: turnEnds.length > 0 
        ? renegotiations.length / turnEnds.length 
        : 0
    },
    
    cost: {
      total: totalCost,
      byTier: calculateCostByTier(modelResponses),
      tokensUsed: totalTokens
    },
    
    quality: {
      complianceViolations: violations.length,
      gateFailures: gateFailures.length,
      uncertaintyExpressions: uncertainties.length
    },
    
    tiers: {
      escalations: escalations.length,
      delegations: delegations.length,
      tierDistribution: {
        senior: totalTierCounts > 0 ? tierCounts.senior / totalTierCounts : 0,
        mid: totalTierCounts > 0 ? tierCounts.mid / totalTierCounts : 0,
        junior: totalTierCounts > 0 ? tierCounts.junior / totalTierCounts : 0
      }
    }
  };
}
```

### PR Report (For Comments)

```typescript
// src/telemetry/reports/pr.ts

export function formatPRReport(report: SessionReport): string {
  const renegoEmoji = report.turns.renegotiationRate > 0.15 ? '⚠️' : '✅';
  const costEmoji = report.cost.total > 1.0 ? '⚠️' : '✅';
  
  return `
## Agent Session Report

### Turn Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Total Turns | ${report.turns.total} | ${report.turns.total <= 5 ? '✅' : '⚠️'} |
| Renegotiations | ${report.turns.renegotiations} | ${renegoEmoji} |
| Renegotiation Rate | ${(report.turns.renegotiationRate * 100).toFixed(1)}% | ${renegoEmoji} |

### Cost Metrics
| Metric | Value |
|--------|-------|
| Total Cost | $${report.cost.total.toFixed(4)} |
| Tokens Used | ${report.cost.tokensUsed.toLocaleString()} |
| Senior Tier | $${report.cost.byTier.senior.toFixed(4)} |
| Mid Tier | $${report.cost.byTier.mid.toFixed(4)} |
| Junior Tier | $${report.cost.byTier.junior.toFixed(4)} |

### Quality Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Compliance Violations | ${report.quality.complianceViolations} | ${report.quality.complianceViolations === 0 ? '✅' : '❌'} |
| Gate Failures | ${report.quality.gateFailures} | ${report.quality.gateFailures === 0 ? '✅' : '❌'} |
| Uncertainty Markers | ${report.quality.uncertaintyExpressions} | ℹ️ |

### Tier Activity
| Tier | Distribution |
|------|--------------|
| Senior | ${(report.tiers.tierDistribution.senior * 100).toFixed(1)}% |
| Mid | ${(report.tiers.tierDistribution.mid * 100).toFixed(1)}% |
| Junior | ${(report.tiers.tierDistribution.junior * 100).toFixed(1)}% |
| Escalations | ${report.tiers.escalations} |
| Delegations | ${report.tiers.delegations} |
  `.trim();
}
```

---

## Dashboards

### CLI Dashboard

```typescript
// src/cli/commands/dashboard.ts

import { Command } from 'commander';

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Show real-time metrics dashboard')
    .option('--session <id>', 'Focus on specific session')
    .option('--refresh <ms>', 'Refresh interval', '5000')
    .action(async (options) => {
      const store = new MemoryTelemetryStore();
      const turnCostAggregator = new TurnCostAggregator();
      const economicAggregator = new EconomicAggregator();
      
      const refresh = async () => {
        console.clear();
        
        const events = store.query({});
        turnCostAggregator.process(events);
        economicAggregator.process(events);
        
        console.log('═══════════════════════════════════════════');
        console.log('               AGENT DASHBOARD              ');
        console.log('═══════════════════════════════════════════');
        console.log();
        
        // Turn Cost section
        const turnMetrics = turnCostAggregator.getAllMetrics();
        console.log('📊 TURN COST');
        console.log('─────────────────────────────────────');
        for (const m of turnMetrics.slice(-5)) {
          console.log(`  ${m.sessionId.slice(0, 12)}  Turns: ${m.turnCount}  Renego: ${m.renegotiationTurns}`);
        }
        console.log();
        
        // Economic section
        const economic = economicAggregator.getReport();
        console.log('💰 ECONOMICS');
        console.log('─────────────────────────────────────');
        console.log(`  Total Cost: $${economic.totalCost.toFixed(4)}`);
        console.log(`  Senior: ${(economic.tierDistribution.senior * 100).toFixed(1)}%`);
        console.log(`  Mid: ${(economic.tierDistribution.mid * 100).toFixed(1)}%`);
        console.log(`  Junior: ${(economic.tierDistribution.junior * 100).toFixed(1)}%`);
        console.log();
        
        console.log('═══════════════════════════════════════════');
        console.log(`  Last updated: ${new Date().toISOString()}`);
      };
      
      await refresh();
      setInterval(refresh, parseInt(options.refresh));
    });
}
```

---

## Alerting

### Alert Definitions

```typescript
// src/telemetry/alerts/definitions.ts

export interface AlertDefinition {
  id: string;
  name: string;
  condition: (metrics: any) => boolean;
  severity: 'info' | 'warning' | 'error';
  message: (metrics: any) => string;
}

export const ALERT_DEFINITIONS: AlertDefinition[] = [
  {
    id: 'high_renegotiation_rate',
    name: 'High Renegotiation Rate',
    condition: (m: TurnCostMetrics) => 
      m.turnCount > 3 && (m.renegotiationTurns / m.turnCount) > 0.25,
    severity: 'warning',
    message: (m) => 
      `Session ${m.sessionId} has ${((m.renegotiationTurns / m.turnCount) * 100).toFixed(1)}% renegotiation rate`
  },
  {
    id: 'high_cost_session',
    name: 'High Cost Session',
    condition: (m: EconomicReport) => m.totalCost > 5.0,
    severity: 'warning',
    message: (m) => `Total cost $${m.totalCost.toFixed(2)} exceeds threshold`
  },
  {
    id: 'compliance_violation',
    name: 'Compliance Violation',
    condition: (e: TelemetryEvent) => 
      e.eventType === EventTypes.CONSTRAINT_VIOLATION,
    severity: 'error',
    message: (e) => `Constraint violation in session ${e.sessionId}`
  },
  {
    id: 'excessive_escalation',
    name: 'Excessive Escalation',
    condition: (m: { escalations: number; tasks: number }) => 
      m.tasks > 0 && (m.escalations / m.tasks) > 0.3,
    severity: 'warning',
    message: (m) => 
      `Escalation rate ${((m.escalations / m.tasks) * 100).toFixed(1)}% exceeds 30%`
  }
];
```

### Alert Evaluator

```typescript
// src/telemetry/alerts/evaluator.ts

export interface Alert {
  alertId: string;
  definitionId: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error';
  message: string;
  acknowledged: boolean;
}

export class AlertEvaluator {
  private alerts: Alert[] = [];
  private definitions: AlertDefinition[];
  
  constructor(definitions: AlertDefinition[] = ALERT_DEFINITIONS) {
    this.definitions = definitions;
  }
  
  evaluate(metrics: Record<string, any>): Alert[] {
    const newAlerts: Alert[] = [];
    
    for (const def of this.definitions) {
      if (def.condition(metrics)) {
        const alert: Alert = {
          alertId: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          definitionId: def.id,
          timestamp: new Date(),
          severity: def.severity,
          message: def.message(metrics),
          acknowledged: false
        };
        
        newAlerts.push(alert);
        this.alerts.push(alert);
      }
    }
    
    return newAlerts;
  }
  
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }
  
  acknowledge(alertId: string): void {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }
}
```

---

## Best Practices

### What to Measure

**Always:**
- Turn count per task
- Renegotiation rate
- Cost by tier
- Compliance violations
- Gate results

**When debugging:**
- Token breakdown (input vs output)
- Context reset frequency
- Escalation chains
- Receipt completeness

**For optimization:**
- Time per tier
- Model distribution
- Failure patterns
- Uncertainty expression rate

### What Not to Measure

**Avoid:**
- Raw prompt content (privacy)
- Individual model responses (bloat)
- Sub-second timing (noise)
- Every file access (irrelevant)

### Retention Policy

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| Aggregated metrics | Forever | Small, valuable |
| Session reports | 90 days | Debugging window |
| Raw events | 7 days | Storage cost |
| Alerts | 30 days | Trend analysis |

---

## Summary

Measure what drives productivity, not just what's easy to count.

**Core metrics:**
- Turn Cost (the real productivity indicator)
- Economic efficiency (cost by tier)
- Quality (compliance, gates, first-pass rate)
- Governance effectiveness (uncertainty expression, receipt coverage)

**Architecture:**
- Events → Collector → Store → Aggregators → Reports
- Multiple stores (file, memory, external)
- Real-time and batch aggregation
- CLI and API access

**Best practices:**
- Measure for action (can this metric change a decision?)
- Avoid bloat (aggregate early)
- Respect privacy (no prompt logging)
- Alert on thresholds (catch problems early)

---

*Next: [10-FAILURE-MODES.md](./10-FAILURE-MODES.md) — Known risks, biases, and limitations*
