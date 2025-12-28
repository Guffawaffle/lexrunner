# 05 — Rule File Specification: Machine-Consumable Governance

> **TL;DR:** Rule files are first-class artifacts — versioned, role-scoped, testable, and small enough for any model to consume.

---

## The Problem with Prompts

Traditional AI guidance lives in prompts:

- System prompts
- User instructions
- Few-shot examples
- Embedded guidelines

This approach has fundamental problems:

### Problem 1: Not Versioned

```
# Yesterday's prompt
"Always use TypeScript strict mode"

# Today's prompt
"Use TypeScript with strict mode disabled for legacy compatibility"
```

Which version is correct? When did it change? Why?

### Problem 2: Not Testable

How do you verify that an agent follows your prompt? You run it and hope. There's no structured way to check compliance.

### Problem 3: Not Composable

You can't combine prompts systematically:

- "Use the security prompt AND the coding prompt"
- "Apply the senior role AND the auth domain"

It's just concatenation and hoping for the best.

### Problem 4: Not Portable

Prompts are tuned for specific models:

- Claude prompts don't work well for GPT
- GPT prompts don't work well for Claude
- Context window limits force different strategies

### Problem 5: Too Big

Long prompts:

- Consume context window
- Increase latency
- Cost more tokens
- Cause attention dilution

---

## The Rule File Solution

A **Rule File** is a machine-parseable governance artifact that:

- Lives in the repository (versioned with code)
- Has explicit schema (parseable, validatable)
- Is role-scoped (different rules for different agents)
- Is testable (compliance can be verified)
- Is small (4KB max for universal consumption)

---

## Rule File Specification

### File Format

```yaml
# YAML preferred for human readability
# JSON also supported for machine generation

schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "senior-dev-typescript"
  version: "1.2.0"
  scope: ["role:senior-dev", "lang:typescript"]
  description: "Rules for senior developers working on TypeScript code"
```

### Core Sections

#### 1. Constraints (MUST / MUST NOT)

```yaml
constraints:
  must:
    - id: "use-strict"
      rule: "Enable TypeScript strict mode"
      check: "tsconfig.json#compilerOptions.strict === true"

    - id: "signed-commits"
      rule: "Sign all commits with GPG"
      check: "git log --show-signature | grep 'Good signature'"

    - id: "test-coverage"
      rule: "Maintain >80% test coverage for new code"
      check: "coverage/lcov.info | extract_coverage >= 80"

  must_not:
    - id: "no-any"
      rule: "Do not use 'any' type"
      check: "!grep -r 'any' src/**/*.ts"

    - id: "no-force-push"
      rule: "Never force push to protected branches"
      check: "git reflog | !contains 'force'"
```

#### 2. Permissions (CAN / CANNOT)

```yaml
permissions:
  can:
    - "create_files: src/**/*.ts"
    - "modify_files: src/**/*.ts, test/**/*.ts"
    - "run_commands: npm test, npm run lint, npm run build"
    - "create_branches: feature/*, fix/*, refactor/*"

  cannot:
    - "modify_files: canon/**, CONTRACT.md, *.schema.json"
    - "delete_branches: main, develop"
    - "run_commands: rm -rf, git push --force"
    - "access: production credentials, API keys"
```

#### 3. Uncertainty Protocol

```yaml
uncertainty:
  expression:
    format: "marker"
    template: |
      ⚠️ UNCERTAIN: {reason}
      Confidence: {confidence}
      Alternatives: {alternatives}

  thresholds:
    continue: 0.7 # Above 70%: proceed normally
    flag_review: 0.5 # 50-70%: flag for human review
    escalate: 0.3 # Below 30%: escalate immediately

  on_uncertainty:
    - action: "create_reversible_change"
      condition: "confidence < 0.7"
    - action: "add_test_coverage"
      condition: "confidence < 0.5"
    - action: "request_human_review"
      condition: "confidence < 0.3"
```

#### 4. Receipts

```yaml
receipts:
  required_on:
    - "file_creation"
    - "file_deletion"
    - "configuration_change"
    - "dependency_update"

  format:
    type: "yaml"
    location: ".lex/receipts/{date}/{session_id}/"

  schema:
    action: "string"
    timestamp: "iso8601"
    files_affected: "string[]"
    rationale: "string"
    confidence: "number"
    reversible: "boolean"
```

#### 5. Gates

```yaml
gates:
  before_commit:
    - name: "lint"
      command: "npm run lint"
      required: true

    - name: "typecheck"
      command: "npm run typecheck"
      required: true

    - name: "test"
      command: "npm test"
      required: true

  before_push:
    - name: "full-test"
      command: "npm run test:all"
      required: true

    - name: "security"
      command: "npm audit"
      required: false
      warn_on_failure: true
```

#### 6. Escalation

```yaml
escalation:
  triggers:
    - condition: "uncertainty.confidence < 0.3"
      action: "escalate_to_human"

    - condition: "gate.failed && gate.required"
      action: "block_and_notify"

    - condition: "receipt.type == 'failure'"
      action: "preserve_state_and_escalate"

  contacts:
    human: "@maintainers"
    senior_agent: "role:senior-dev"

  timeout:
    agent_escalation: "15m"
    human_escalation: "4h"
```

---

## Size Constraint: 4KB Maximum

### Why 4KB?

```
4KB = ~4000 characters
    = ~800 tokens (rough estimate)
    = ~1% of smallest context windows (8K)
    = Always fits in any model's context
    = Forces focus on essential rules
```

### What Fits in 4KB

A well-designed rule file can include:

- 10-15 constraints
- 10-15 permissions
- Uncertainty protocol
- Receipt requirements
- 5-8 gates
- Escalation policy

### What Doesn't Fit

- Detailed explanations (use links)
- Full examples (reference external docs)
- Domain knowledge (use vocabulary files)
- Historical context (use receipts)

### Splitting Large Governance

```
.lex/
├── rules/
│   ├── base.rules.yaml        # Universal constraints (2KB)
│   ├── senior-dev.rules.yaml  # Role-specific (1.5KB)
│   ├── typescript.rules.yaml  # Language-specific (1.5KB)
│   └── auth-domain.rules.yaml # Domain-specific (1KB)
```

Compose by loading relevant rule files:

```yaml
# Session configuration
rules:
  - base.rules.yaml
  - senior-dev.rules.yaml
  - typescript.rules.yaml
```

---

## Schema Definition

### JSON Schema (for validation)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://lex.dev/schemas/rule-file.schema.json",
  "type": "object",
  "required": ["schemaVersion", "kind", "metadata"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    },
    "kind": {
      "type": "string",
      "enum": ["AgentRule"]
    },
    "metadata": {
      "type": "object",
      "required": ["name", "version"],
      "properties": {
        "name": { "type": "string", "maxLength": 64 },
        "version": { "type": "string" },
        "scope": {
          "type": "array",
          "items": { "type": "string" }
        },
        "description": { "type": "string", "maxLength": 256 }
      }
    },
    "constraints": {
      "type": "object",
      "properties": {
        "must": { "$ref": "#/definitions/ruleList" },
        "must_not": { "$ref": "#/definitions/ruleList" }
      }
    },
    "permissions": {
      "type": "object",
      "properties": {
        "can": { "type": "array", "items": { "type": "string" } },
        "cannot": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  "definitions": {
    "ruleList": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "rule"],
        "properties": {
          "id": { "type": "string" },
          "rule": { "type": "string" },
          "check": { "type": "string" }
        }
      }
    }
  }
}
```

### Zod Schema (for TypeScript)

```typescript
import { z } from 'zod';

const RuleSchema = z.object({
  id: z.string(),
  rule: z.string(),
  check: z.string().optional()
});

const ConstraintsSchema = z.object({
  must: z.array(RuleSchema).optional(),
  must_not: z.array(RuleSchema).optional()
});

const PermissionsSchema = z.object({
  can: z.array(z.string()).optional(),
  cannot: z.array(z.string()).optional()
});

const UncertaintySchema = z.object({
  expression: z.object({
    format: z.enum(['marker', 'structured', 'comment']),
    template: z.string().optional()
  }),
  thresholds: z.object({
    continue: z.number().min(0).max(1),
    flag_review: z.number().min(0).max(1),
    escalate: z.number().min(0).max(1)
  }),
  on_uncertainty: z.array(z.object({
    action: z.string(),
    condition: z.string()
  }))
});

export const RuleFileSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  kind: z.literal('AgentRule'),
  metadata: z.object({
    name: z.string().max(64),
    version: z.string(),
    scope: z.array(z.string()).optional(),
    description: z.string().max(256).optional()
  }),
  constraints: ConstraintsSchema.optional(),
  permissions: PermissionsSchema.optional(),
  uncertainty: UncertaintySchema.optional(),
  receipts: z.object({...}).optional(),
  gates: z.object({...}).optional(),
  escalation: z.object({...}).optional()
});

export type RuleFile = z.infer<typeof RuleFileSchema>;
```

---

## Rule File Operations

### Loading Rules

```typescript
async function loadRules(context: AgentContext): Promise<RuleFile[]> {
  const ruleFiles: RuleFile[] = [];

  // Load base rules (always)
  ruleFiles.push(await loadRuleFile(".lex/rules/base.rules.yaml"));

  // Load role-specific rules
  const roleFile = `.lex/rules/${context.role}.rules.yaml`;
  if (await exists(roleFile)) {
    ruleFiles.push(await loadRuleFile(roleFile));
  }

  // Load language-specific rules
  for (const lang of context.languages) {
    const langFile = `.lex/rules/${lang}.rules.yaml`;
    if (await exists(langFile)) {
      ruleFiles.push(await loadRuleFile(langFile));
    }
  }

  // Validate size constraint
  const totalSize = ruleFiles.reduce((sum, rf) => sum + rf.size, 0);
  if (totalSize > 4096) {
    console.warn(`Rule files exceed 4KB (${totalSize} bytes)`);
  }

  return ruleFiles;
}
```

### Merging Rules

```typescript
function mergeRules(ruleFiles: RuleFile[]): MergedRules {
  const merged: MergedRules = {
    constraints: { must: [], must_not: [] },
    permissions: { can: [], cannot: [] },
    uncertainty: null,
    gates: { before_commit: [], before_push: [] },
    escalation: null,
  };

  for (const rf of ruleFiles) {
    // Constraints: union (all rules apply)
    merged.constraints.must.push(...(rf.constraints?.must || []));
    merged.constraints.must_not.push(...(rf.constraints?.must_not || []));

    // Permissions: intersection (most restrictive wins)
    merged.permissions.can = intersect(merged.permissions.can, rf.permissions?.can || []);
    merged.permissions.cannot.push(...(rf.permissions?.cannot || []));

    // Uncertainty: last wins (most specific)
    if (rf.uncertainty) {
      merged.uncertainty = rf.uncertainty;
    }

    // Gates: union (all gates run)
    merged.gates.before_commit.push(...(rf.gates?.before_commit || []));
    merged.gates.before_push.push(...(rf.gates?.before_push || []));

    // Escalation: last wins
    if (rf.escalation) {
      merged.escalation = rf.escalation;
    }
  }

  return merged;
}
```

### Validating Compliance

```typescript
interface ComplianceResult {
  passed: boolean;
  violations: Violation[];
  warnings: Warning[];
}

async function checkCompliance(changes: Change[], rules: MergedRules): Promise<ComplianceResult> {
  const violations: Violation[] = [];
  const warnings: Warning[] = [];

  // Check constraints
  for (const must of rules.constraints.must) {
    if (must.check) {
      const passed = await runCheck(must.check, changes);
      if (!passed) {
        violations.push({
          ruleId: must.id,
          rule: must.rule,
          type: "constraint_violation",
        });
      }
    }
  }

  for (const mustNot of rules.constraints.must_not) {
    if (mustNot.check) {
      const violated = await runCheck(mustNot.check, changes);
      if (violated) {
        violations.push({
          ruleId: mustNot.id,
          rule: mustNot.rule,
          type: "forbidden_action",
        });
      }
    }
  }

  // Check permissions
  for (const change of changes) {
    if (!matchesPattern(change.file, rules.permissions.can)) {
      violations.push({
        file: change.file,
        type: "unauthorized_modification",
      });
    }
    if (matchesPattern(change.file, rules.permissions.cannot)) {
      violations.push({
        file: change.file,
        type: "forbidden_modification",
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
  };
}
```

---

## Testing Rule Files

### Unit Tests

```typescript
describe("Rule File Validation", () => {
  test("validates against schema", () => {
    const ruleFile = loadRuleFile("fixtures/valid-rule.yaml");
    expect(() => RuleFileSchema.parse(ruleFile)).not.toThrow();
  });

  test("rejects oversized rule files", () => {
    const ruleFile = loadRuleFile("fixtures/too-large.yaml");
    expect(ruleFile.size).toBeGreaterThan(4096);
    expect(() => validateSize(ruleFile)).toThrow("exceeds 4KB");
  });

  test("constraint checks work", async () => {
    const rules = loadRuleFile("fixtures/typescript-rules.yaml");
    const changes = [{ file: "src/index.ts", content: "const x: any = 1;" }];

    const result = await checkCompliance(changes, rules);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ ruleId: "no-any" }));
  });
});
```

### Integration Tests

```typescript
describe("Rule File Integration", () => {
  test("multiple rule files merge correctly", () => {
    const base = loadRuleFile(".lex/rules/base.rules.yaml");
    const senior = loadRuleFile(".lex/rules/senior-dev.rules.yaml");
    const ts = loadRuleFile(".lex/rules/typescript.rules.yaml");

    const merged = mergeRules([base, senior, ts]);

    // Constraints from all files should be present
    expect(merged.constraints.must).toContainEqual(
      expect.objectContaining({ id: "signed-commits" }) // from base
    );
    expect(merged.constraints.must).toContainEqual(
      expect.objectContaining({ id: "use-strict" }) // from ts
    );

    // Permissions should be intersection
    expect(merged.permissions.cannot).toContain("modify_files: CONTRACT.md");
  });

  test("compliance gate blocks invalid changes", async () => {
    const rules = await loadRulesForContext(seniorDevContext);
    const changes = [{ file: "CONTRACT.md", type: "modify", content: "changed" }];

    const result = await checkCompliance(changes, rules);
    expect(result.passed).toBe(false);
    expect(result.violations[0].type).toBe("forbidden_modification");
  });
});
```

---

## Example Rule Files

### Base Rules

```yaml
# .lex/rules/base.rules.yaml (1.2KB)
schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "base"
  version: "1.0.0"
  description: "Universal rules for all agents"

constraints:
  must:
    - id: "signed-commits"
      rule: "All commits must be signed"
    - id: "conventional-commits"
      rule: "Use conventional commit format"
    - id: "no-secrets"
      rule: "Never commit secrets or credentials"

  must_not:
    - id: "no-force-push"
      rule: "Never force push to protected branches"
    - id: "no-direct-main"
      rule: "Never commit directly to main"

permissions:
  cannot:
    - "modify_files: .github/**, CONTRACT.md"
    - "run_commands: rm -rf, git push --force"

gates:
  before_commit:
    - name: "lint"
      command: "npm run lint"
      required: true
```

### Senior Dev Rules

```yaml
# .lex/rules/senior-dev.rules.yaml (1.5KB)
schemaVersion: "1.0.0"
kind: "AgentRule"
metadata:
  name: "senior-dev"
  version: "1.0.0"
  scope: ["role:senior-dev"]

permissions:
  can:
    - "create_files: src/**/*.ts, test/**/*.ts"
    - "modify_files: src/**/*.ts, test/**/*.ts, docs/**/*.md"
    - "create_branches: feature/*, fix/*, refactor/*"
    - "run_commands: npm *, git *"

  cannot:
    - "modify_files: canon/**, migrations/**"
    - "merge_to: main"

uncertainty:
  thresholds:
    continue: 0.7
    flag_review: 0.5
    escalate: 0.3

  on_uncertainty:
    - action: "add_test_coverage"
      condition: "confidence < 0.7"
    - action: "flag_for_review"
      condition: "confidence < 0.5"

escalation:
  triggers:
    - condition: "confidence < 0.3"
      action: "escalate_to_human"
```

---

## Summary

Rule files are first-class governance artifacts.

**Properties:**

- Versioned (tracked with code)
- Role-scoped (different rules for different agents)
- Testable (compliance is verifiable)
- Small (4KB max for universal consumption)

**Sections:**

- Constraints (must/must not)
- Permissions (can/cannot)
- Uncertainty protocol
- Receipt requirements
- Gates
- Escalation policy

**Operations:**

- Load based on context
- Merge by precedence
- Validate compliance
- Test with fixtures

**Key insight:** Rules are not prompts. They're structured, composable, testable contracts.

---

_Next: [06-CAPABILITY-TIERS.md](./06-CAPABILITY-TIERS.md) — Matching model strength to task complexity_
