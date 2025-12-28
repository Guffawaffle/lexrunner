# 08 — Implementation Guide: Building These Primitives in LexRunner

> **TL;DR:** Concrete implementation guidance for adding governance primitives, turn cost tracking, and capability tiering to LexRunner.

---

## Overview

This document provides implementation guidance for the concepts described in this thesis. It's organized by feature area with code examples, file locations, and integration points.

---

## Part 1: Governance Primitives

### 1.1 Rule File Loading

**Location:** `src/governance/rules.ts`

```typescript
import { z } from "zod";
import { readFile, exists } from "fs/promises";
import { parse as parseYaml } from "yaml";
import { join } from "path";

// Schema (abbreviated - see 05-RULE-FILE-SPEC.md for full)
export const RuleFileSchema = z.object({
  schemaVersion: z.string(),
  kind: z.literal("AgentRule"),
  metadata: z.object({
    name: z.string(),
    version: z.string(),
    scope: z.array(z.string()).optional(),
  }),
  constraints: z
    .object({
      must: z.array(z.object({ id: z.string(), rule: z.string() })).optional(),
      must_not: z.array(z.object({ id: z.string(), rule: z.string() })).optional(),
    })
    .optional(),
  permissions: z
    .object({
      can: z.array(z.string()).optional(),
      cannot: z.array(z.string()).optional(),
    })
    .optional(),
  uncertainty: z
    .object({
      thresholds: z.object({
        continue: z.number(),
        flag_review: z.number(),
        escalate: z.number(),
      }),
    })
    .optional(),
});

export type RuleFile = z.infer<typeof RuleFileSchema>;

export async function loadRuleFile(path: string): Promise<RuleFile> {
  const content = await readFile(path, "utf-8");
  const data = parseYaml(content);
  return RuleFileSchema.parse(data);
}

export async function loadRulesForContext(
  workspaceRoot: string,
  context: { role?: string; languages?: string[] }
): Promise<RuleFile[]> {
  const rulesDir = join(workspaceRoot, ".lex", "rules");
  const rules: RuleFile[] = [];

  // Always load base rules
  const basePath = join(rulesDir, "base.rules.yaml");
  if (await exists(basePath)) {
    rules.push(await loadRuleFile(basePath));
  }

  // Load role-specific rules
  if (context.role) {
    const rolePath = join(rulesDir, `${context.role}.rules.yaml`);
    if (await exists(rolePath)) {
      rules.push(await loadRuleFile(rolePath));
    }
  }

  // Load language-specific rules
  for (const lang of context.languages ?? []) {
    const langPath = join(rulesDir, `${lang}.rules.yaml`);
    if (await exists(langPath)) {
      rules.push(await loadRuleFile(langPath));
    }
  }

  return rules;
}
```

### 1.2 Rule Merging

**Location:** `src/governance/merge.ts`

```typescript
import { RuleFile } from "./rules.js";

export interface MergedRules {
  constraints: {
    must: Array<{ id: string; rule: string }>;
    must_not: Array<{ id: string; rule: string }>;
  };
  permissions: {
    can: string[];
    cannot: string[];
  };
  uncertainty?: {
    thresholds: {
      continue: number;
      flag_review: number;
      escalate: number;
    };
  };
}

export function mergeRules(ruleFiles: RuleFile[]): MergedRules {
  const merged: MergedRules = {
    constraints: { must: [], must_not: [] },
    permissions: { can: [], cannot: [] },
  };

  for (const rf of ruleFiles) {
    // Union constraints
    if (rf.constraints?.must) {
      merged.constraints.must.push(...rf.constraints.must);
    }
    if (rf.constraints?.must_not) {
      merged.constraints.must_not.push(...rf.constraints.must_not);
    }

    // Union permissions (additive)
    if (rf.permissions?.can) {
      merged.permissions.can.push(...rf.permissions.can);
    }
    if (rf.permissions?.cannot) {
      merged.permissions.cannot.push(...rf.permissions.cannot);
    }

    // Last uncertainty wins (most specific)
    if (rf.uncertainty) {
      merged.uncertainty = rf.uncertainty;
    }
  }

  // Deduplicate
  merged.constraints.must = dedupeById(merged.constraints.must);
  merged.constraints.must_not = dedupeById(merged.constraints.must_not);
  merged.permissions.can = [...new Set(merged.permissions.can)];
  merged.permissions.cannot = [...new Set(merged.permissions.cannot)];

  return merged;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
```

### 1.3 Compliance Checking

**Location:** `src/governance/compliance.ts`

```typescript
import { MergedRules } from "./merge.js";
import minimatch from "minimatch";

export interface Change {
  path: string;
  type: "create" | "modify" | "delete";
  content?: string;
}

export interface Violation {
  type: "constraint" | "permission";
  ruleId?: string;
  message: string;
  severity: "error" | "warning";
}

export interface ComplianceResult {
  passed: boolean;
  violations: Violation[];
}

export function checkCompliance(changes: Change[], rules: MergedRules): ComplianceResult {
  const violations: Violation[] = [];

  for (const change of changes) {
    // Check "cannot" permissions
    for (const pattern of rules.permissions.cannot) {
      const [, filePattern] = pattern.split(":").map((s) => s.trim());
      if (minimatch(change.path, filePattern)) {
        violations.push({
          type: "permission",
          message: `Cannot ${change.type} ${change.path} (matches "${pattern}")`,
          severity: "error",
        });
      }
    }

    // Check "can" permissions (if any are specified, must match at least one)
    if (rules.permissions.can.length > 0) {
      const allowed = rules.permissions.can.some((pattern) => {
        const [action, filePattern] = pattern.split(":").map((s) => s.trim());
        const actionMatches =
          action === "*" ||
          action.includes(change.type) ||
          (action.includes("files") && ["create", "modify"].includes(change.type));
        return actionMatches && minimatch(change.path, filePattern);
      });

      if (!allowed) {
        violations.push({
          type: "permission",
          message: `No permission to ${change.type} ${change.path}`,
          severity: "error",
        });
      }
    }
  }

  return {
    passed: violations.filter((v) => v.severity === "error").length === 0,
    violations,
  };
}
```

---

## Part 2: Turn Cost Tracking

### 2.1 Turn Event Schema

**Location:** `src/metrics/turn-cost.ts`

```typescript
import { z } from "zod";

export const TurnEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.date(),
  model: z.string(),
  tier: z.enum(["senior", "mid", "junior"]),

  // Timing
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),

  // Tokens
  inputTokens: z.number(),
  outputTokens: z.number(),
  contextTokens: z.number(),

  // Classification
  isRenegotiation: z.boolean(),
  isContextReset: z.boolean(),
  requiresHumanReview: z.boolean(),

  // Metadata
  taskId: z.string().optional(),
  parentTurnId: z.string().optional(),
});

export type TurnEvent = z.infer<typeof TurnEventSchema>;

export const TurnCostMetricsSchema = z.object({
  sessionId: z.string(),
  turnCount: z.number(),
  totalDurationMs: z.number(),

  // Component breakdown
  latencyMs: z.number(),
  contextResetTokens: z.number(),
  renegotiationTurns: z.number(),
  tokenBloatEstimate: z.number(),
  attentionSwitchCount: z.number(),

  // Derived
  tokensPerTurn: z.number(),
  effectiveTurnCost: z.number(),
});

export type TurnCostMetrics = z.infer<typeof TurnCostMetricsSchema>;
```

### 2.2 Turn Cost Collector

**Location:** `src/metrics/collector.ts`

```typescript
import { TurnEvent, TurnCostMetrics } from "./turn-cost.js";

export class TurnCostCollector {
  private events: TurnEvent[] = [];
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(event: Omit<TurnEvent, "id" | "sessionId">): void {
    this.events.push({
      ...event,
      id: `turn_${this.events.length + 1}`,
      sessionId: this.sessionId,
    });
  }

  computeMetrics(): TurnCostMetrics {
    if (this.events.length === 0) {
      return this.emptyMetrics();
    }

    const totalDuration = this.events.reduce((sum, e) => sum + e.durationMs, 0);
    const totalInputTokens = this.events.reduce((sum, e) => sum + e.inputTokens, 0);
    const totalOutputTokens = this.events.reduce((sum, e) => sum + e.outputTokens, 0);

    const renegotiations = this.events.filter((e) => e.isRenegotiation);
    const contextResets = this.events.filter((e) => e.isContextReset);
    const attentionSwitches = this.events.filter((e) => e.requiresHumanReview);

    // Estimate token bloat (tokens beyond minimum necessary)
    // Heuristic: output tokens > 2x input tokens suggests bloat
    const bloatEvents = this.events.filter((e) => e.outputTokens > 2 * e.inputTokens);
    const tokenBloat = bloatEvents.reduce(
      (sum, e) => sum + (e.outputTokens - 2 * e.inputTokens),
      0
    );

    // Compute effective turn cost (normalized, weighted)
    const weights = {
      latency: 0.2,
      contextReset: 0.25,
      renegotiation: 0.3,
      tokenBloat: 0.1,
      attentionSwitch: 0.15,
    };

    const normalized = {
      latency: totalDuration / 1000 / this.events.length, // avg seconds
      contextReset: contextResets.reduce((sum, e) => sum + e.contextTokens, 0) / 1000,
      renegotiation: renegotiations.length / this.events.length,
      tokenBloat: tokenBloat / 10000,
      attentionSwitch: attentionSwitches.length / this.events.length,
    };

    const effectiveCost =
      weights.latency * normalized.latency +
      weights.contextReset * normalized.contextReset +
      weights.renegotiation * normalized.renegotiation +
      weights.tokenBloat * normalized.tokenBloat +
      weights.attentionSwitch * normalized.attentionSwitch;

    return {
      sessionId: this.sessionId,
      turnCount: this.events.length,
      totalDurationMs: totalDuration,
      latencyMs: totalDuration,
      contextResetTokens: contextResets.reduce((sum, e) => sum + e.contextTokens, 0),
      renegotiationTurns: renegotiations.length,
      tokenBloatEstimate: tokenBloat,
      attentionSwitchCount: attentionSwitches.length,
      tokensPerTurn: (totalInputTokens + totalOutputTokens) / this.events.length,
      effectiveTurnCost: effectiveCost,
    };
  }

  private emptyMetrics(): TurnCostMetrics {
    return {
      sessionId: this.sessionId,
      turnCount: 0,
      totalDurationMs: 0,
      latencyMs: 0,
      contextResetTokens: 0,
      renegotiationTurns: 0,
      tokenBloatEstimate: 0,
      attentionSwitchCount: 0,
      tokensPerTurn: 0,
      effectiveTurnCost: 0,
    };
  }
}
```

### 2.3 Turn Cost Gate

**Location:** `src/gates/turn-cost.gate.ts`

```typescript
import { Gate, GateResult } from "../types/gate.js";
import { TurnCostCollector } from "../metrics/collector.js";

export interface TurnCostPolicy {
  maxTurnsPerTask: number;
  maxRenegotiationRate: number;
  maxEffectiveCost: number;
}

export const defaultTurnCostPolicy: TurnCostPolicy = {
  maxTurnsPerTask: 5,
  maxRenegotiationRate: 0.25,
  maxEffectiveCost: 1.0,
};

export const turnCostGate: Gate = {
  name: "turn-cost",

  async run(context: {
    collector: TurnCostCollector;
    policy: TurnCostPolicy;
  }): Promise<GateResult> {
    const metrics = context.collector.computeMetrics();
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check turn count
    if (metrics.turnCount > context.policy.maxTurnsPerTask) {
      warnings.push(
        `Turn count ${metrics.turnCount} exceeds threshold ${context.policy.maxTurnsPerTask}`
      );
    }

    // Check renegotiation rate
    const renego = metrics.renegotiationTurns / (metrics.turnCount || 1);
    if (renego > context.policy.maxRenegotiationRate) {
      warnings.push(
        `Renegotiation rate ${(renego * 100).toFixed(1)}% exceeds threshold ${context.policy.maxRenegotiationRate * 100}%`
      );
    }

    // Check effective cost
    if (metrics.effectiveTurnCost > context.policy.maxEffectiveCost) {
      errors.push(
        `Effective turn cost ${metrics.effectiveTurnCost.toFixed(2)} exceeds threshold ${context.policy.maxEffectiveCost}`
      );
    }

    return {
      status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
      message: [...errors, ...warnings].join("; ") || "Turn cost within acceptable range",
      data: metrics,
    };
  },
};
```

---

## Part 3: Capability Tiering

### 3.1 Model Configuration

**Location:** `src/routing/models.ts`

```typescript
import { z } from "zod";

export const TierSchema = z.enum(["senior", "mid", "junior"]);
export type Tier = z.infer<typeof TierSchema>;

export const ModelConfigSchema = z.object({
  id: z.string(),
  tier: TierSchema,
  provider: z.enum(["openai", "anthropic", "google"]),
  model: z.string(),
  costPer1KInputTokens: z.number(),
  costPer1KOutputTokens: z.number(),
  maxContextTokens: z.number(),
  enabled: z.boolean().default(true),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "senior-claude-opus",
    tier: "senior",
    provider: "anthropic",
    model: "claude-opus-4-0-20250514",
    costPer1KInputTokens: 0.015,
    costPer1KOutputTokens: 0.075,
    maxContextTokens: 200000,
    enabled: true,
  },
  {
    id: "senior-gpt4o",
    tier: "senior",
    provider: "openai",
    model: "gpt-4o",
    costPer1KInputTokens: 0.005,
    costPer1KOutputTokens: 0.015,
    maxContextTokens: 128000,
    enabled: true,
  },
  {
    id: "mid-claude-sonnet",
    tier: "mid",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    costPer1KInputTokens: 0.003,
    costPer1KOutputTokens: 0.015,
    maxContextTokens: 200000,
    enabled: true,
  },
  {
    id: "mid-gpt4-mini",
    tier: "mid",
    provider: "openai",
    model: "gpt-4o-mini",
    costPer1KInputTokens: 0.00015,
    costPer1KOutputTokens: 0.0006,
    maxContextTokens: 128000,
    enabled: true,
  },
  {
    id: "junior-claude-haiku",
    tier: "junior",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    costPer1KInputTokens: 0.0008,
    costPer1KOutputTokens: 0.004,
    maxContextTokens: 200000,
    enabled: true,
  },
];
```

### 3.2 Task Classifier

**Location:** `src/routing/classifier.ts`

```typescript
import { Tier } from "./models.js";

export interface TaskFeatures {
  requiresArchitecture: boolean;
  hasAmbiguousRequirements: boolean;
  touchesMultipleModules: boolean;
  hasExistingPatterns: boolean;
  isFormatting: boolean;
  isLintFix: boolean;
  isBoilerplate: boolean;
  securityRelevant: boolean;
  hasComplexTradeoffs: boolean;
}

export interface Classification {
  tier: Tier;
  confidence: number;
  factors: string[];
  score: number;
}

export function classifyTask(features: TaskFeatures): Classification {
  const factors: string[] = [];
  let score = 50; // Start at mid

  // Senior indicators
  if (features.requiresArchitecture) {
    score += 30;
    factors.push("requires_architecture");
  }
  if (features.hasAmbiguousRequirements) {
    score += 20;
    factors.push("ambiguous_requirements");
  }
  if (features.securityRelevant) {
    score += 25;
    factors.push("security_relevant");
  }
  if (features.hasComplexTradeoffs) {
    score += 20;
    factors.push("complex_tradeoffs");
  }

  // Mid indicators
  if (features.touchesMultipleModules) {
    score += 10;
    factors.push("multi_module");
  }
  if (features.hasExistingPatterns) {
    score -= 10;
    factors.push("existing_patterns");
  }

  // Junior indicators
  if (features.isFormatting) {
    score -= 40;
    factors.push("formatting");
  }
  if (features.isLintFix) {
    score -= 35;
    factors.push("lint_fix");
  }
  if (features.isBoilerplate) {
    score -= 30;
    factors.push("boilerplate");
  }

  // Clamp and determine tier
  score = Math.max(0, Math.min(100, score));

  let tier: Tier;
  if (score >= 70) tier = "senior";
  else if (score >= 30) tier = "mid";
  else tier = "junior";

  // Confidence is distance from decision boundary
  const confidence = Math.abs(score - 50) / 50;

  return { tier, confidence, factors, score };
}
```

### 3.3 Model Router

**Location:** `src/routing/router.ts`

```typescript
import { ModelConfig, DEFAULT_MODELS, Tier } from "./models.js";

export interface RoutingContext {
  tier: Tier;
  preferredProvider?: "openai" | "anthropic" | "google";
  maxCostPer1K?: number;
  fallbackEnabled?: boolean;
}

export interface RoutingResult {
  model: ModelConfig;
  fallbacks: ModelConfig[];
}

export function selectModel(context: RoutingContext): RoutingResult {
  const enabledModels = DEFAULT_MODELS.filter((m) => m.enabled);
  const tierModels = enabledModels.filter((m) => m.tier === context.tier);

  if (tierModels.length === 0) {
    throw new Error(`No enabled models for tier: ${context.tier}`);
  }

  let candidates = tierModels;

  // Filter by provider preference
  if (context.preferredProvider) {
    const providerModels = candidates.filter((m) => m.provider === context.preferredProvider);
    if (providerModels.length > 0) {
      candidates = providerModels;
    }
  }

  // Filter by cost
  if (context.maxCostPer1K !== undefined) {
    const affordableModels = candidates.filter(
      (m) => m.costPer1KInputTokens + m.costPer1KOutputTokens <= context.maxCostPer1K!
    );
    if (affordableModels.length > 0) {
      candidates = affordableModels;
    }
  }

  // Select primary (prefer lower cost among candidates)
  candidates.sort(
    (a, b) =>
      a.costPer1KInputTokens +
      a.costPer1KOutputTokens -
      (b.costPer1KInputTokens + b.costPer1KOutputTokens)
  );

  const primary = candidates[0];
  const fallbacks = context.fallbackEnabled ? tierModels.filter((m) => m.id !== primary.id) : [];

  return { model: primary, fallbacks };
}
```

---

## Part 4: Receipt System

### 4.1 Receipt Schema

**Location:** `src/receipts/schema.ts`

```typescript
import { z } from "zod";

export const ReceiptSchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  sessionId: z.string(),

  // What happened
  action: z.string(),
  status: z.enum(["completed", "failed", "uncertain", "escalated"]),

  // Context
  task: z.string().optional(),
  model: z.string().optional(),
  tier: z.enum(["senior", "mid", "junior"]).optional(),

  // Details
  filesAffected: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),

  // Uncertainty handling
  uncertainty: z
    .object({
      reason: z.string(),
      alternatives: z.array(z.string()),
      reversibility: z.enum(["full", "partial", "none"]),
    })
    .optional(),

  // Failure handling
  failure: z
    .object({
      cause: z.string(),
      statePreserved: z.boolean(),
      stateLocation: z.string().optional(),
      recoveryProposal: z.string().optional(),
    })
    .optional(),

  // References
  parentReceiptId: z.string().optional(),
  relatedReceiptIds: z.array(z.string()).optional(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
```

### 4.2 Receipt Store

**Location:** `src/receipts/store.ts`

```typescript
import { Receipt, ReceiptSchema } from "./schema.js";
import { writeFile, readFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

export class ReceiptStore {
  private baseDir: string;

  constructor(workspaceRoot: string) {
    this.baseDir = join(workspaceRoot, ".lex", "receipts");
  }

  async create(receipt: Omit<Receipt, "id" | "timestamp">): Promise<Receipt> {
    const fullReceipt: Receipt = {
      ...receipt,
      id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
    };

    // Validate
    ReceiptSchema.parse(fullReceipt);

    // Determine path
    const date = fullReceipt.timestamp.toISOString().split("T")[0];
    const dir = join(this.baseDir, date);
    await mkdir(dir, { recursive: true });

    const filename = `${fullReceipt.id}.yaml`;
    const path = join(dir, filename);

    // Write
    await writeFile(path, yamlStringify(fullReceipt));

    return fullReceipt;
  }

  async get(receiptId: string): Promise<Receipt | null> {
    // Search for receipt by ID (could be in any date directory)
    const dates = await readdir(this.baseDir);

    for (const date of dates) {
      const path = join(this.baseDir, date, `${receiptId}.yaml`);
      try {
        const content = await readFile(path, "utf-8");
        return ReceiptSchema.parse(yamlParse(content));
      } catch {
        continue;
      }
    }

    return null;
  }

  async query(options: {
    sessionId?: string;
    since?: Date;
    status?: Receipt["status"];
    limit?: number;
  }): Promise<Receipt[]> {
    const receipts: Receipt[] = [];
    const dates = await readdir(this.baseDir);

    // Sort dates descending (most recent first)
    dates.sort().reverse();

    for (const date of dates) {
      if (options.since && date < options.since.toISOString().split("T")[0]) {
        break;
      }

      const dir = join(this.baseDir, date);
      const files = await readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".yaml")) continue;

        const content = await readFile(join(dir, file), "utf-8");
        const receipt = ReceiptSchema.parse(yamlParse(content));

        // Apply filters
        if (options.sessionId && receipt.sessionId !== options.sessionId) continue;
        if (options.status && receipt.status !== options.status) continue;

        receipts.push(receipt);

        if (options.limit && receipts.length >= options.limit) {
          return receipts;
        }
      }
    }

    return receipts;
  }
}
```

---

## Part 5: Integration Points

### 5.1 Session Initialization

**Location:** `src/session/init.ts`

```typescript
import { loadRulesForContext, mergeRules } from "../governance/index.js";
import { TurnCostCollector } from "../metrics/collector.js";
import { ReceiptStore } from "../receipts/store.js";
import { classifyTask } from "../routing/classifier.js";
import { selectModel } from "../routing/router.js";

export interface Session {
  id: string;
  workspaceRoot: string;
  rules: MergedRules;
  collector: TurnCostCollector;
  receipts: ReceiptStore;
  model: ModelConfig;
}

export async function initSession(options: {
  workspaceRoot: string;
  role?: string;
  languages?: string[];
  tier?: Tier;
  preferredProvider?: string;
}): Promise<Session> {
  const sessionId = `session_${Date.now()}`;

  // Load governance
  const ruleFiles = await loadRulesForContext(options.workspaceRoot, {
    role: options.role,
    languages: options.languages,
  });
  const rules = mergeRules(ruleFiles);

  // Initialize metrics
  const collector = new TurnCostCollector(sessionId);

  // Initialize receipts
  const receipts = new ReceiptStore(options.workspaceRoot);

  // Select model
  const tier = options.tier ?? "mid";
  const { model } = selectModel({
    tier,
    preferredProvider: options.preferredProvider as any,
  });

  // Create session start receipt
  await receipts.create({
    sessionId,
    action: "session_start",
    status: "completed",
    rationale: `Initialized with tier=${tier}, role=${options.role}`,
    model: model.id,
  });

  return {
    id: sessionId,
    workspaceRoot: options.workspaceRoot,
    rules,
    collector,
    receipts,
    model,
  };
}
```

### 5.2 Pre-Commit Hook

**Location:** `src/hooks/pre-commit.ts`

```typescript
import { checkCompliance } from "../governance/compliance.js";
import { turnCostGate } from "../gates/turn-cost.gate.js";
import { Session } from "../session/init.js";

export async function preCommitHook(
  session: Session,
  changes: Change[]
): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // Check governance compliance
  const compliance = checkCompliance(changes, session.rules);
  if (!compliance.passed) {
    for (const v of compliance.violations) {
      reasons.push(`[${v.severity}] ${v.message}`);
    }
  }

  // Check turn cost
  const turnCostResult = await turnCostGate.run({
    collector: session.collector,
    policy: defaultTurnCostPolicy,
  });

  if (turnCostResult.status === "fail") {
    reasons.push(`[turn-cost] ${turnCostResult.message}`);
  } else if (turnCostResult.status === "warn") {
    reasons.push(`[turn-cost warning] ${turnCostResult.message}`);
  }

  // Create receipt
  await session.receipts.create({
    sessionId: session.id,
    action: "pre_commit_check",
    status: compliance.passed ? "completed" : "failed",
    filesAffected: changes.map((c) => c.path),
    rationale: reasons.length > 0 ? `Blocked: ${reasons.join("; ")}` : "All checks passed",
  });

  return {
    allowed: compliance.passed,
    reasons,
  };
}
```

---

## Part 6: CLI Commands

### 6.1 Governance Commands

**Location:** `src/cli/commands/governance.ts`

```typescript
import { Command } from "commander";
import { loadRulesForContext, mergeRules } from "../../governance/index.js";
import { checkCompliance } from "../../governance/compliance.js";

export function registerGovernanceCommands(program: Command): void {
  const governance = program.command("governance");

  governance
    .command("show")
    .description("Show merged governance rules")
    .option("--role <role>", "Role context")
    .option("--lang <languages...>", "Language contexts")
    .action(async (options) => {
      const rules = await loadRulesForContext(process.cwd(), {
        role: options.role,
        languages: options.lang,
      });
      const merged = mergeRules(rules);
      console.log(JSON.stringify(merged, null, 2));
    });

  governance
    .command("check")
    .description("Check changes against governance rules")
    .option("--staged", "Check staged changes")
    .action(async (options) => {
      // Get changes from git
      const changes = await getChanges(options.staged);

      // Load rules
      const rules = await loadRulesForContext(process.cwd(), {});
      const merged = mergeRules(rules);

      // Check compliance
      const result = checkCompliance(changes, merged);

      if (result.passed) {
        console.log("✅ All changes comply with governance rules");
      } else {
        console.log("❌ Governance violations:");
        for (const v of result.violations) {
          console.log(`  [${v.severity}] ${v.message}`);
        }
        process.exit(1);
      }
    });
}
```

### 6.2 Metrics Commands

**Location:** `src/cli/commands/metrics.ts`

```typescript
import { Command } from "commander";
import { ReceiptStore } from "../../receipts/store.js";

export function registerMetricsCommands(program: Command): void {
  const metrics = program.command("metrics");

  metrics
    .command("turn-cost")
    .description("Show turn cost metrics for recent sessions")
    .option("--session <id>", "Specific session ID")
    .option("--since <date>", "Show metrics since date")
    .action(async (options) => {
      const store = new ReceiptStore(process.cwd());
      const receipts = await store.query({
        sessionId: options.session,
        since: options.since ? new Date(options.since) : undefined,
      });

      // Aggregate metrics
      const sessions = groupBySession(receipts);

      console.log("## Turn Cost Report\n");
      console.log("| Session | Turns | Duration | Renegotiations | Cost |");
      console.log("|---------|-------|----------|----------------|------|");

      for (const [sessionId, sessionReceipts] of Object.entries(sessions)) {
        const turns = sessionReceipts.length;
        const duration = computeDuration(sessionReceipts);
        const renegotiations = sessionReceipts.filter((r) => r.action === "renegotiation").length;
        const cost = computeCost(sessionReceipts);

        console.log(
          `| ${sessionId.slice(0, 12)}... | ${turns} | ${duration}ms | ${renegotiations} | $${cost.toFixed(4)} |`
        );
      }
    });
}
```

---

## Summary

This implementation guide covers:

1. **Governance:** Rule file loading, merging, and compliance checking
2. **Turn Cost:** Event collection, metrics computation, and gating
3. **Capability Tiering:** Model configuration, task classification, and routing
4. **Receipts:** Schema, storage, and querying
5. **Integration:** Session initialization and pre-commit hooks
6. **CLI:** Commands for governance and metrics

The code examples are production-ready patterns. Adapt them to LexRunner's existing architecture and conventions.

---

_Next: [09-METRICS-AND-TELEMETRY.md](./09-METRICS-AND-TELEMETRY.md) — What to measure and how_
