---
name: Runtime Gate Input Schema Validation
about: Add runtime schema validation for gate inputs before execution
title: '[gates] Add runtime schema validation for gate inputs before execution'
labels: ['production-readiness', 'gates', 'schema', 'P1']
assignees: ''
---

## Problem Statement

Gate execution currently does not validate inputs before running commands. This causes failures only after execution has started, wasting time and making errors harder to debug. For agent-driven development, we need to fail fast with clear error messages when inputs don't match the expected schema.

## Current State

- Gate execution in `src/gates.ts` runs commands without pre-validation
- Schema definitions exist in `src/schema.ts` but aren't used at execution time
- Agents can pass malformed inputs that cause cryptic failures

**Example current flow:**
```typescript
// src/gates.ts (current - line ~120)
async function executeGate(gate: string, item: PlanItem) {
  const command = buildCommand(gate, item);
  const result = await exec(command);  // ❌ No input validation
  return result;
}
```

**What breaks:**
- Agent passes `files: []` (empty array) → gate runs, fails after 10s
- Agent passes invalid gate name → cryptic command-not-found error
- Agent omits required fields → gate crashes mid-execution

## Proposed Solution

### 1. Create gate-specific input schemas
**Location:** `schemas/gates/*.schema.json`

**Example** `schemas/gates/lint.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/Guffawaffle/lex-pr-runner/schemas/gates/lint.schema.json",
  "title": "Lint Gate Input Schema",
  "description": "Input contract for lint gate execution",
  "type": "object",
  "required": ["files", "linter"],
  "properties": {
    "files": {
      "type": "array",
      "items": {"type": "string", "minLength": 1},
      "minItems": 1,
      "description": "List of file paths or glob patterns to lint"
    },
    "linter": {
      "type": "string",
      "enum": ["eslint", "tslint", "pylint", "ruff"],
      "description": "Linter tool to use"
    },
    "fix": {
      "type": "boolean",
      "default": false,
      "description": "Auto-fix violations when possible"
    },
    "config": {
      "type": "string",
      "description": "Path to custom linter config file"
    }
  },
  "additionalProperties": false
}
```

**Required schemas:**
- `lint.schema.json` - Linting validation
- `test.schema.json` - Test execution
- `build.schema.json` - Build operations
- `security-scan.schema.json` - Security scanning
- `coverage.schema.json` - Coverage collection

### 2. Add validation logic
**Location:** `src/gates/validator.ts` (new file)

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  verbose: true
});

export class GateInputValidationError extends Error {
  public readonly gate: string;
  public readonly errors: ErrorObject[];

  constructor(gate: string, errors: ErrorObject[]) {
    const errorText = ajv.errorsText(errors, { separator: '\n  - ', dataVar: 'input' });
    super(`Invalid input for gate "${gate}":\n  - ${errorText}`);
    this.name = 'GateInputValidationError';
    this.gate = gate;
    this.errors = errors;
  }
}

/**
 * Validates gate input against its JSON schema
 * @throws {GateInputValidationError} if validation fails
 */
export function validateGateInput(gate: string, input: unknown): void {
  const schemaPath = join(__dirname, '../../schemas/gates', `${gate}.schema.json`);

  let schema: object;
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    // No schema = no validation (backward compatibility)
    return;
  }

  const validate = ajv.compile(schema);
  if (!validate(input)) {
    throw new GateInputValidationError(gate, validate.errors ?? []);
  }
}

/**
 * Checks if a gate has an input schema defined
 */
export function hasGateInputSchema(gate: string): boolean {
  const schemaPath = join(__dirname, '../../schemas/gates', `${gate}.schema.json`);
  try {
    readFileSync(schemaPath, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
```

### 3. Integrate into gate execution
**Location:** `src/gates.ts` (modify existing file)

```typescript
import { validateGateInput } from './gates/validator';

async function executeGate(gate: string, item: PlanItem, skipValidation = false) {
  // NEW: Validate before execution (unless explicitly skipped)
  if (!skipValidation) {
    validateGateInput(gate, item);
  }

  const command = buildCommand(gate, item);
  const result = await exec(command);
  return result;
}
```

### 4. Add CLI flag for backward compatibility
**Location:** `src/cli.ts` (modify execute command)

```typescript
program
  .command('execute')
  .option('--skip-input-validation', 'Skip gate input schema validation (not recommended)')
  .action(async (options) => {
    const skipValidation = options.skipInputValidation ?? false;
    if (skipValidation) {
      logger.warn('⚠️  Gate input validation disabled - use at your own risk');
    }
    // Pass skipValidation to executeGate calls
  });
```

### 5. Add comprehensive tests
**Location:** `tests/gates/validator.spec.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest';
import { validateGateInput, GateInputValidationError, hasGateInputSchema } from '../../src/gates/validator';

describe('Gate Input Validation', () => {
  describe('lint gate', () => {
    it('passes valid input', () => {
      const input = { files: ['src/index.ts'], linter: 'eslint' };
      expect(() => validateGateInput('lint', input)).not.toThrow();
    });

    it('fails on missing required field "files"', () => {
      const input = { linter: 'eslint' };
      expect(() => validateGateInput('lint', input))
        .toThrow(GateInputValidationError);
      expect(() => validateGateInput('lint', input))
        .toThrow(/required property 'files'/i);
    });

    it('fails on empty files array', () => {
      const input = { files: [], linter: 'eslint' };
      expect(() => validateGateInput('lint', input))
        .toThrow(/minItems/i);
    });

    it('fails on invalid linter enum', () => {
      const input = { files: ['src/index.ts'], linter: 'magic-linter' };
      expect(() => validateGateInput('lint', input))
        .toThrow(/must be equal to one of/i);
    });

    it('allows optional "fix" parameter', () => {
      const input = { files: ['src/index.ts'], linter: 'eslint', fix: true };
      expect(() => validateGateInput('lint', input)).not.toThrow();
    });

    it('rejects additional properties', () => {
      const input = { files: ['src/index.ts'], linter: 'eslint', unknownProp: 'value' };
      expect(() => validateGateInput('lint', input))
        .toThrow(/additionalProperties/i);
    });

    it('provides actionable error messages', () => {
      const input = { files: [], linter: 'eslint' };
      try {
        validateGateInput('lint', input);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GateInputValidationError);
        expect((err as GateInputValidationError).gate).toBe('lint');
        expect((err as GateInputValidationError).errors).toHaveLength(1);
      }
    });
  });

  describe('schema existence checks', () => {
    it('returns true for gates with schemas', () => {
      expect(hasGateInputSchema('lint')).toBe(true);
    });

    it('returns false for gates without schemas', () => {
      expect(hasGateInputSchema('nonexistent-gate')).toBe(false);
    });

    it('does not throw when validating gate without schema', () => {
      expect(() => validateGateInput('custom-gate', {})).not.toThrow();
    });
  });

  describe('test gate', () => {
    it('validates test gate input', () => {
      const input = {
        framework: 'vitest',
        files: ['tests/**/*.spec.ts'],
        coverage: true
      };
      expect(() => validateGateInput('test', input)).not.toThrow();
    });
  });

  describe('build gate', () => {
    it('validates build gate input', () => {
      const input = {
        command: 'npm run build',
        outputDir: 'dist'
      };
      expect(() => validateGateInput('build', input)).not.toThrow();
    });
  });
});
```

## Acceptance Criteria

- [ ] Gate input schemas defined for all built-in gates: `lint`, `test`, `build`, `security-scan`, `coverage`
- [ ] `executeGate()` in `src/gates.ts` validates inputs before execution
- [ ] Invalid inputs throw `GateInputValidationError` with actionable, human-readable messages
- [ ] Tests achieve >90% coverage for validator logic
- [ ] Tests cover: valid inputs pass, invalid inputs fail with clear errors, missing schemas don't break
- [ ] Backward compatible via `--skip-input-validation` CLI flag (default: validation enabled)
- [ ] Documentation updated in `docs/gates.md` with schema examples
- [ ] CLI shows clear error when validation fails with suggestion to check schema
- [ ] Error includes gate name and specific field violations
- [ ] Integration test: full execute workflow with validation enabled/disabled

## Success Metrics

- **Time-to-failure improvement:** Invalid inputs fail in <1s (vs. current ~10-30s)
- **Error clarity:** 100% of validation errors include actionable fix suggestions
- **Agent retry reduction:** Decrease false-start retries by >50%
- **Zero regressions:** All existing tests pass with validation enabled

## Priority

**P1 (High)** - Blocks production readiness. Agents need immediate feedback on invalid inputs to avoid wasting time and compute resources.

## Effort Estimate

**Medium** (2-3 days)
- **Day 1:** Create 5 gate input schemas, implement `validator.ts`, add to `gates.ts`
- **Day 2:** Write comprehensive tests (unit + integration), add CLI flag
- **Day 3:** Documentation updates, edge case testing, PR review

## Dependencies

- None (can be implemented immediately)
- **Ajv** already indirectly available via Zod dependencies (verify and add explicit dep if needed)

## Related Issues

- Builds on existing schema validation patterns in `src/schema/plan.ts`, `src/schema/gateReport.ts`
- Prerequisite for Issue A2 (gate output validation & drift detection)
- Related to #193 (Schema Versioning) - these gate schemas need versioning strategy
- Complements #192 (CI Context Blocks) - validated inputs enable better CI integration

## References

**Existing code:**
- Schema validation: `src/schema/plan.ts` (lines 15-45), `src/schema/gateReport.ts` (lines 20-60)
- Gate execution: `src/gates.ts` (lines 120-250)
- Error handling: `src/util/errors.ts` (custom error patterns)
- CLI option patterns: `src/cli.ts` (lines 300-500)

**External:**
- Ajv documentation: https://ajv.js.org/
- JSON Schema spec: https://json-schema.org/draft-07/schema

## Implementation Checklist

- [ ] Add `ajv` to `package.json` dependencies (if not already present)
- [ ] Create `schemas/gates/` directory
- [ ] Define input schemas: `lint.schema.json`, `test.schema.json`, `build.schema.json`, `security-scan.schema.json`, `coverage.schema.json`
- [ ] Implement `src/gates/validator.ts` with `validateGateInput()` and `GateInputValidationError`
- [ ] Modify `src/gates.ts` to call `validateGateInput()` before execution
- [ ] Add `--skip-input-validation` flag to `execute` command in `src/cli.ts`
- [ ] Write unit tests in `tests/gates/validator.spec.ts`
- [ ] Write integration tests in `tests/gates/validation-integration.spec.ts`
- [ ] Update `docs/gates.md` with:
  - Gate input schema documentation
  - Example valid/invalid inputs
  - How to add custom gate schemas
- [ ] Update `docs/cli.md` with new `--skip-input-validation` flag
- [ ] Add troubleshooting section to `docs/troubleshooting.md` for validation errors
- [ ] Update `CHANGELOG.md` under "Added" section
- [ ] Run full test suite: `npm test`
- [ ] Run determinism check: `npm run build && npm run format && git diff --exit-code`

## Migration Notes

**Breaking Changes:** None (validation is additive and can be disabled)

**User Impact:**
- Existing plans with invalid gate inputs will now fail fast at execution time
- Users should validate existing plans after upgrade: `lex-pr schema validate plan.json`
- If validation causes unexpected issues, temporarily disable with `--skip-input-validation` and file an issue

**Recommended Actions:**
1. Upgrade to new version
2. Run `lex-pr execute plan.json --dry-run` to test validation
3. Fix any validation errors in plan files
4. Remove `--skip-input-validation` flag if used temporarily

---

**Labels:** `production-readiness`, `gates`, `schema`, `P1`, `enhancement`
**Milestone:** Phase 3.2: Production Readiness
**Estimated Points:** 5 (medium)
