# Executor Integration Tests

Integration tests for executor lifecycle: load → prep → stochastic → receipt → emit.

## Status

⚠️ **Currently Skipped** - These tests are marked with `.skip()` because they depend on:
- PR #404: Executor Canonicalization
- PR #412: Executor Registry & Loader
- PR #411: Guardrail Enforcement Runtime

## Test Structure

The test suite covers:

### Happy Path
- Full lifecycle execution (load → prep → stochastic → receipt → emit)
- Multiple independent executor instances

### Error Paths
- Budget exceeded scenarios
- Guardrail violations
- Missing required frames
- Failure receipt generation
- Invalid input handling

### Registry Operations
- Executor registration and lookup
- Listing executors
- Clearing registry

### Artifact Generation
- Receipt artifact validation
- Output artifact generation
- Failure handling

## Running the Tests

Once dependencies are merged:

1. Remove `.skip()` from the main `describe` block in `lifecycle.spec.ts`:
   ```typescript
   // Change this:
   describe.skip('Executor Lifecycle Integration', () => {
   
   // To this:
   describe('Executor Lifecycle Integration', () => {
   ```

2. Update imports to use real implementations:
   ```typescript
   // Replace mock imports:
   import { ExecutorRegistry } from '../fixtures/executors/registry.js';
   import { MockExecutor } from '../fixtures/executors/mock-executor.js';
   
   // With real implementations:
   import { ExecutorRegistry } from '../../src/executors/registry.js';
   import { ExecutorLifecycle } from '../../src/executors/lifecycle.js';
   ```

3. Run the tests:
   ```bash
   # Run only executor tests
   npm test tests/executors/
   
   # Run all tests
   npm test
   ```

## Mock Implementations

The `tests/fixtures/executors/` directory contains:
- `types.ts` - Placeholder type definitions
- `mock-executor.ts` - Full mock executor with configurable behavior
- `registry.ts` - Simple mock registry for testing
- `README.md` - Documentation on fixtures

These can be used as reference implementations or removed once real implementations are available.

## Coverage Goals

Target: >80% code coverage for executor lifecycle

Areas covered:
- ✅ Full lifecycle execution
- ✅ Error handling and recovery
- ✅ Budget enforcement
- ✅ Guardrail checking
- ✅ Artifact generation
- ✅ Registry operations
