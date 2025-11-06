# Test Fixtures Library

Shared, reusable test fixtures for lex-pr-runner tests. This library provides deterministic, realistic scenarios for plan generation, gate execution, and merge operations.

## Purpose

- **Eliminate duplication**: Reusable fixtures across test files
- **Realistic scenarios**: Pre-built common dependency patterns
- **Determinism**: All fixtures are deterministic and reproducible
- **Type-safe**: Full TypeScript support with Zod validation
- **Easy cleanup**: Built-in utilities for temporary resources

## Quick Start

```typescript
import { fixtures } from '../fixtures';

describe('My feature', () => {
  it('handles diamond dependencies', async () => {
    const plan = fixtures.plans.diamond();
    // Use plan in your test
  });
});
```

## Directory Structure

```
tests/fixtures/
├── README.md                 # This file
├── index.ts                  # Main exports
├── plans/                    # Plan fixtures
│   ├── simple.ts            # 2-3 independent PRs
│   ├── linear.ts            # Linear dependency chain
│   ├── diamond.ts           # Diamond dependency pattern
│   └── complex.ts           # Large realistic scenario
├── gates/                    # Gate execution results
│   ├── results.ts           # Gate result factories
│   └── configs.ts           # Gate configuration factories
├── prs/                      # PR fixtures
│   ├── basic.ts             # Basic PR factory
│   ├── withDeps.ts          # PRs with dependencies
│   └── scenarios.ts         # Common PR scenarios
├── utils/                    # Test utilities
│   ├── tempDir.ts           # Temp directory helpers
│   ├── mockGitHub.ts        # Mock GitHub API
│   └── cleanup.ts           # Cleanup utilities
├── scenarios/                # Complete end-to-end scenarios
│   └── mergeWorkflows.ts    # Complete merge workflow scenarios
└── invalid/                  # Invalid fixtures for error testing
    └── plans.ts             # Invalid plan fixtures
```

## Fixture Categories

### Plans (`fixtures.plans`)

Pre-built plan configurations with various dependency patterns:

- **simple**: 2-3 independent PRs with no dependencies
- **linear**: Linear dependency chain (A → B → C)
- **diamond**: Diamond dependency pattern (A,B → C,D → E)
- **complex**: Large realistic scenario with 20+ PRs
- **cycle**: Circular dependency (for error testing)

```typescript
import { fixtures } from '../fixtures';

const plan = fixtures.plans.diamond();
// Returns a valid Plan object with diamond dependency structure
```

### PRs (`fixtures.prs`)

Factory functions for creating mock PR objects:

```typescript
import { fixtures } from '../fixtures';

// Create a basic PR
const pr = fixtures.prs.basic({
  number: 100,
  title: 'Add feature X'
});

// Create a PR with dependencies
const prWithDeps = fixtures.prs.withDeps({
  number: 101,
  title: 'Extend feature X',
  dependsOn: [100]
});

// Get a batch of realistic PRs
const prs = fixtures.prs.batch(10);
```

### Gates (`fixtures.gates`)

Gate configuration and result factories:

```typescript
import { fixtures } from '../fixtures';

// Create gate results
const passing = fixtures.gates.results.allPass(['lint', 'test']);
const failing = fixtures.gates.results.someFail({
  pass: ['lint'],
  fail: ['test']
});

// Create gate configurations
const lintGate = fixtures.gates.configs.lint();
const testGate = fixtures.gates.configs.test();
```

### Scenarios (`fixtures.scenarios`)

Complete end-to-end test scenarios:

```typescript
import { fixtures } from '../fixtures';

// Get a complete merge scenario
const scenario = fixtures.scenarios.complexMerge({
  prCount: 15,
  maxDependencyDepth: 4,
  conflictRate: 0.2
});

// scenario contains: { plan, prs, gates, expected }
```

### Utils (`fixtures.utils`)

Helper utilities for test setup and teardown:

```typescript
import { fixtures } from '../fixtures';

describe('My test', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fixtures.utils.tempDir.create();
  });

  afterEach(async () => {
    await fixtures.utils.tempDir.cleanup(tmpDir);
  });

  it('works with temp directory', async () => {
    // Use tmpDir for test
  });
});
```

## Design Principles

1. **Deterministic**: No random data unless explicitly seeded
2. **Typed**: All fixtures have proper TypeScript types
3. **Validated**: Fixtures validated against Zod schemas
4. **Realistic**: Based on real-world usage patterns
5. **Composable**: Can be combined to create complex scenarios
6. **Self-documenting**: Clear naming and inline documentation

## Usage Examples

### Basic Plan Test

```typescript
import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures';
import { generateOrder } from '../../src/mergeOrder';

describe('Merge order generator', () => {
  it('handles simple independent PRs', () => {
    const plan = fixtures.plans.simple();
    const result = generateOrder(plan);
    
    expect(result.order).toHaveLength(plan.items.length);
  });
  
  it('handles diamond dependencies correctly', () => {
    const plan = fixtures.plans.diamond();
    const result = generateOrder(plan);
    
    // Verify topological ordering
    expect(result.layers[0]).toContain('foundation-a');
    expect(result.layers[0]).toContain('foundation-b');
  });
});
```

### Gate Execution Test

```typescript
import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures';

describe('Gate executor', () => {
  it('handles all passing gates', async () => {
    const gates = fixtures.gates.configs.allPass();
    const results = await executeGates(gates);
    
    expect(results.every(r => r.status === 'pass')).toBe(true);
  });
  
  it('retries failed gates', async () => {
    const gate = fixtures.gates.configs.flaky({
      maxAttempts: 3
    });
    
    const result = await executeGate(gate);
    expect(result.attempts).toBeGreaterThan(1);
  });
});
```

### PR Factory Test

```typescript
import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures';

describe('PR analyzer', () => {
  it('detects dependencies from PR body', () => {
    const pr = fixtures.prs.withDeps({
      number: 100,
      dependsOn: [99]
    });
    
    const deps = parseDependencies(pr.body);
    expect(deps).toContain(99);
  });
});
```

### Complex Scenario Test

```typescript
import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures';

describe('Full merge workflow', () => {
  it('executes complex merge scenario', async () => {
    const scenario = fixtures.scenarios.complexMerge({
      prCount: 20,
      maxDependencyDepth: 5,
      conflictRate: 0.15
    });
    
    const result = await executePlan(scenario.plan);
    
    expect(result.merged).toBe(scenario.expected.merged);
    expect(result.blocked).toBe(scenario.expected.blocked);
  });
});
```

## Adding New Fixtures

When adding new fixtures:

1. Place in appropriate subdirectory
2. Export from subdirectory's `index.ts`
3. Re-export from main `index.ts`
4. Add documentation to this README
5. Add validation test in corresponding `.spec.ts`
6. Ensure fixture is deterministic
7. Validate against schema where applicable

Example:

```typescript
// tests/fixtures/plans/myNewPattern.ts
import type { Plan } from '../../../src/schema.js';

export function myNewPattern(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      // Your pattern here
    ]
  };
}
```

## Validation

All fixtures should pass schema validation:

```typescript
import { validatePlan } from '../../src/schema.js';
import { fixtures } from '../fixtures';

describe('Fixture validation', () => {
  it('validates simple plan', () => {
    const plan = fixtures.plans.simple();
    expect(() => validatePlan(plan)).not.toThrow();
  });
});
```

## Related Documentation

- [Test Instructions](.github/instructions/tests.instructions.md)
- [Schema Documentation](../../src/schema.ts)
- [Planner Test Helpers](../helpers/plannerTestHelpers.ts)

## Migration Guide

If you have existing inline fixtures, migrate them to this library:

**Before:**
```typescript
const plan = {
  schemaVersion: '1.0.0',
  target: 'main',
  items: [...]
};
```

**After:**
```typescript
import { fixtures } from '../fixtures';
const plan = fixtures.plans.simple();
```

Or create a custom fixture if your pattern is unique:

```typescript
import { fixtures } from '../fixtures';
const plan = fixtures.plans.custom({
  items: [...]
});
```
